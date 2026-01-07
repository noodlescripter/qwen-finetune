"""
Simple API using Qwen2.5-Coder-0.5B base model with codebase access.
No fine-tuning, just code retrieval + base model reasoning.
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
import torch
from codebase_index import CodebaseIndex
from error_parser import ErrorParser


# ============== Request/Response Models ==============

class ErrorRequest(BaseModel):
    errors: list[dict] | None = None  # [{title, state, error, fullError, complete_error}]
    raw_text: str | None = None  # Raw error text (non-JSON format)


class ErrorAnalysis(BaseModel):
    title: str
    error_message: str
    locations: list[dict]  # [{file, line, column, code}]
    rootCause: str
    suggestedFix: str
    possibleCodeFix: str


class AskRequest(BaseModel):
    question: str


class FixRequest(BaseModel):
    code: str
    error: str = ""


# ============== Globals ==============

model = None
tokenizer = None
codebase = CodebaseIndex()
error_parser = ErrorParser(base_path="./data")


# ============== Helper Functions ==============

def get_file_content(file_path: str) -> tuple[str, list[str]]:
    """Get file content from codebase index ONLY (no disk access).
    Returns (filename, lines).
    """
    # Search in codebase index only
    for filename, data in codebase.files.items():
        # Match by: exact name, path ends with search, or basename matches
        if (filename == file_path or
            filename.endswith(file_path) or
            file_path.endswith(filename) or
            os.path.basename(file_path) == filename):
            return filename, data["content"].split("\n")

    return file_path, []


def extract_code_block(lines: list[str], line_number: int, context_before: int = 5, context_after: int = 10) -> tuple[int, int, str]:
    """Extract code around the error line with context.
    Returns (start_line, end_line, block_code).

    Gets the error line plus surrounding context for better understanding.
    """
    if not lines or line_number < 1 or line_number > len(lines):
        return 0, 0, ""

    idx = line_number - 1  # 0-indexed

    # Get context: 5 lines before, error line, 10 lines after
    start_idx = max(0, idx - context_before)
    end_idx = min(len(lines) - 1, idx + context_after)

    # Try to extend start to include function/class definition if nearby
    for i in range(idx, max(start_idx - 1, -1), -1):
        line = lines[i].strip()
        if (line.startswith("def ") or line.startswith("async def ") or
            line.startswith("function ") or line.startswith("async function ") or
            line.startswith("class ") or
            "=> {" in line or ") {" in line or
            (line.startswith("const ") and "=" in line and ("=>" in line or "function" in line))):
            start_idx = i
            break
        if ":" in line and ("function" in lines[i] or "=>" in lines[i]):
            start_idx = i
            break

    # Build code block with line numbers, mark error line
    code_lines = []
    for i in range(start_idx, min(end_idx + 1, len(lines))):
        marker = ">>> " if i == idx else "    "
        code_lines.append(f"{marker}{i+1}: {lines[i]}")

    return start_idx + 1, end_idx + 1, "\n".join(code_lines)


def get_error_line(file_path: str, line_number: int, with_context: bool = False) -> str:
    """Get a single line from a file, optionally with context."""
    _, lines = get_file_content(file_path)
    if not lines or line_number < 1 or line_number > len(lines):
        return ""

    if not with_context:
        return lines[line_number - 1]

    # Return error line + 3 lines after for preview
    idx = line_number - 1
    end_idx = min(len(lines), idx + 4)
    context_lines = []
    for i in range(idx, end_idx):
        marker = ">>> " if i == idx else "    "
        context_lines.append(f"{marker}{i+1}: {lines[i]}")
    return "\n".join(context_lines)


# ============== App Setup ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, tokenizer

    model_name = "Qwen/Qwen2.5-Coder-0.5B"

    print(f"Loading model: {model_name}")

    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("Loading model (4-bit quantized)...")
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )

    print("Loading codebase index...")
    codebase.load_index()
    if not codebase.files:
        print("No index found, indexing codebase...")
        codebase.index_codebase()

    print(f"Ready! {model_name} loaded, {len(codebase.files)} files indexed.")
    yield
    print("Shutting down...")


app = FastAPI(title="Qwen Base Model API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== Generation ==============

def generate(prompt: str, max_tokens: int = 300) -> str:
    """Generate response from base model."""
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=max_tokens,
        do_sample=True,
        temperature=0.3,
        top_p=0.9,
        repetition_penalty=1.2,
        pad_token_id=tokenizer.eos_token_id,
    )

    response = tokenizer.decode(outputs[0], skip_special_tokens=True)

    # Remove prompt from response
    if prompt in response:
        response = response[len(prompt):].strip()

    # Clean up
    for pattern in ["\n\n\n", "<|"]:
        if pattern in response:
            response = response[:response.find(pattern)]

    return response.strip()


# ============== Endpoints ==============

@app.post("/analyze-errors")
async def analyze_errors(request: ErrorRequest):
    """Analyze errors by finding code in codebase and using base model."""

    results = []

    # Parse errors - either from JSON or raw text
    if request.raw_text:
        # Parse raw text into error format
        import re
        error_match = re.search(r'(?:Error|TypeError|ReferenceError):\s*(.+?)(?:\n|$)', request.raw_text)
        error_msg = error_match.group(1).strip() if error_match else request.raw_text[:200]
        error_dicts = [{
            "title": "Test Failure",
            "state": "failed",
            "error": error_msg,
            "fullError": request.raw_text,
            "complete_error": request.raw_text
        }]
    elif request.errors:
        error_dicts = request.errors
    else:
        return {"results": [], "total": 0, "analyzed": 0}

    # Parse all errors using ErrorParser
    parsed_errors = error_parser.parse_json_data(error_dicts)

    for parsed in parsed_errors:
        # Skip passed tests
        if parsed.state != "failed":
            continue

        # Step 1: Find and extract code from files in stack trace
        code_blocks = []
        for loc in parsed.locations[:3]:  # Max 3 locations
            filename, lines = get_file_content(loc.file_path)
            if lines:
                start, end, block = extract_code_block(lines, loc.line_number)
                if block:
                    code_blocks.append({
                        "file": os.path.basename(filename),
                        "line": loc.line_number,
                        "code": block
                    })

        # Step 2: Build context - the code and error
        if code_blocks:
            code_text = ""
            for b in code_blocks:
                code_text += f"\n{b['file']} (error at line {b['line']}):\n{b['code']}\n"
        else:
            code_text = "No code found in indexed files"

        # Step 3: Generate analysis with base model
        analysis_prompt = f"""Analyze this code error.

Error: {parsed.error_message}

Code:
{code_text}

Analysis:
1. Root cause:"""

        full_response = generate(analysis_prompt, 250)

        # Parse response into parts
        root_cause = ""
        suggested_fix = ""
        possible_code_fix = ""

        response_lines = full_response.split("\n")
        current_section = "root_cause"

        for line in response_lines:
            line_lower = line.lower().strip()
            if "fix" in line_lower or "solution" in line_lower or "to fix" in line_lower:
                current_section = "fix"
            elif "code" in line_lower and ("correct" in line_lower or "fixed" in line_lower):
                current_section = "code"

            if current_section == "root_cause":
                root_cause += line + "\n"
            elif current_section == "fix":
                suggested_fix += line + "\n"
            else:
                possible_code_fix += line + "\n"

        # Fallbacks
        if not root_cause.strip():
            root_cause = full_response
        if not suggested_fix.strip():
            suggested_fix = "See root cause analysis above"
        if not possible_code_fix.strip() and code_blocks:
            error_line = get_error_line(parsed.locations[0].file_path, parsed.locations[0].line_number)
            if error_line:
                possible_code_fix = f"Error line: {error_line}"

        # Build locations for UI (with code context)
        locations = [
            {
                "file": loc.file_path,
                "line": loc.line_number,
                "column": loc.column,
                "code": loc.code_snippet or get_error_line(loc.file_path, loc.line_number, with_context=True),
            }
            for loc in parsed.locations
        ]

        results.append(ErrorAnalysis(
            title=parsed.title,
            error_message=parsed.error_message,
            locations=locations,
            rootCause=root_cause.strip(),
            suggestedFix=suggested_fix.strip(),
            possibleCodeFix=possible_code_fix.strip()
        ))

    return {"results": results, "total": len(error_dicts), "analyzed": len(results)}


@app.post("/ask")
async def ask_question(request: AskRequest):
    """Ask about the codebase."""

    relevant = codebase.search(request.question, limit=2)
    relevant_files = [r["filename"] for r in relevant]

    context = ""
    for r in relevant:
        context += f"\n{r['filename']}:\n{r['content'][:1500]}\n"

    prompt = f"""Based on this code:
{context}

Question: {request.question}

Answer:"""

    answer = generate(prompt, 200)

    return {"answer": answer, "files": relevant_files}


@app.post("/fix")
async def fix_code(request: FixRequest):
    """Get fix suggestion for code."""

    error_part = f"\nError: {request.error}" if request.error else ""

    prompt = f"""Fix this code.
{error_part}
Code:
{request.code}

Fixed code:"""

    suggestion = generate(prompt, 200)

    return {"suggestion": suggestion}


@app.get("/files")
async def list_files():
    """List indexed files."""
    return [{"filename": f, "lines": len(d['content'].split('\n'))} for f, d in codebase.files.items()]


@app.post("/reindex")
async def reindex():
    """Reindex the codebase."""
    count = codebase.index_codebase()
    return {"indexed": count}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "Qwen2.5-Coder-0.5B",
        "quantization": "4-bit",
        "files_indexed": len(codebase.files)
    }
