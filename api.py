import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel
import torch
from codebase_index import CodebaseIndex
from error_parser import ErrorParser, ParsedError


# Request/Response models
class AskRequest(BaseModel):
    question: str
    max_new_tokens: int = 300
    use_rag: bool = True
    use_finetuned: bool = True


class FixCodeRequest(BaseModel):
    code: str
    error: str = ""
    max_new_tokens: int = 300
    use_rag: bool = True
    use_finetuned: bool = True


class AskResponse(BaseModel):
    answer: str
    relevant_files: list[str]


class FixCodeResponse(BaseModel):
    suggestion: str
    relevant_files: list[str]


class FileInfo(BaseModel):
    filename: str
    path: str
    summary: str
    lines: int


class TestError(BaseModel):
    title: str
    state: str = "failed"
    duration: int = 0
    error: str = ""
    fullError: str = ""
    complete_error: str = ""


class AnalyzeErrorsRequest(BaseModel):
    errors: list[TestError]
    use_rag: bool = True
    use_finetuned: bool = True
    max_new_tokens: int = 500


class ErrorAnalysis(BaseModel):
    title: str
    error_message: str
    locations: list[dict]
    suggestedFix: str  # Bullet points / numbered steps
    rootCause: str  # Why the error happened
    possibleCodeFix: str  # Code block with the fix


class AnalyzeErrorsResponse(BaseModel):
    results: list[ErrorAnalysis]
    total_errors: int
    analyzed: int


# Global variables
base_model = None
finetuned_model = None
tokenizer = None
codebase = CodebaseIndex()
error_parser = ErrorParser(base_path="./data")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global base_model, finetuned_model, tokenizer

    base_model_name = "Qwen/Qwen2.5-Coder-0.5B"
    adapter_path = "./qwen-finetuned"

    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(base_model_name, trust_remote_code=True)

    # 4-bit quantization
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    print("Loading base model...")
    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )

    # Load fine-tuned adapter if exists
    if os.path.exists(adapter_path):
        print("Loading fine-tuned model...")
        finetuned_base = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            trust_remote_code=True,
            quantization_config=bnb_config,
            device_map="auto",
        )
        finetuned_model = PeftModel.from_pretrained(finetuned_base, adapter_path)
    else:
        print("No fine-tuned adapter found, finetuned_model = base_model")
        finetuned_model = base_model

    # Load codebase index
    print("Loading codebase index...")
    codebase.load_index()
    if not codebase.files:
        print("No index found, indexing codebase...")
        codebase.index_codebase()

    print(f"Ready! {len(codebase.files)} files indexed.")
    yield
    print("Shutting down...")


app = FastAPI(title="Qwen Code Assistant API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_model(use_finetuned: bool = True):
    """Get the appropriate model based on preference."""
    return finetuned_model if use_finetuned else base_model


def generate(prompt: str, max_new_tokens: int, use_finetuned: bool = True) -> str:
    """Generate response from model."""
    model = get_model(use_finetuned)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=0.3,
        top_p=0.9,
        repetition_penalty=1.2,
        pad_token_id=tokenizer.eos_token_id,
    )

    response = tokenizer.decode(outputs[0], skip_special_tokens=True)

    # Extract only the generated part after the prompt
    if prompt in response:
        response = response[len(prompt):].strip()

    # Stop at obvious repetition patterns
    stop_patterns = ["\n\n\n", "<|", "Question:", "Answer:"]
    for pattern in stop_patterns:
        if pattern in response:
            response = response[:response.find(pattern)].strip()

    return response


@app.post("/ask", response_model=AskResponse)
async def ask_about_codebase(request: AskRequest):
    """Ask a question about the codebase."""

    relevant_files = []

    if request.use_rag:
        # RAG mode: Search and include file contents
        relevant = codebase.search(request.question, limit=2)
        relevant_files = [r["filename"] for r in relevant]

        context = ""
        for r in relevant:
            content_preview = r["content"][:1500]
            context += f"\n### {r['filename']}\n```\n{content_preview}\n```\n"

        prompt = f"""Based on this codebase:
{context}

Question: {request.question}

Answer:"""
    else:
        # Trained knowledge mode: Use only what model learned during fine-tuning
        prompt = f"""You are a code assistant trained on a specific codebase.
Answer based on your trained knowledge about the codebase patterns and conventions.

Question: {request.question}

Answer:"""

    answer = generate(prompt, request.max_new_tokens, request.use_finetuned)

    return AskResponse(answer=answer, relevant_files=relevant_files)


@app.post("/fix", response_model=FixCodeResponse)
async def fix_code(request: FixCodeRequest):
    """Get fix suggestion for broken code."""

    relevant_files = []
    error_info = f"\nError: {request.error}" if request.error else ""

    if request.use_rag:
        # RAG mode: Search for similar code patterns
        search_query = request.code[:200] + " " + request.error
        relevant = codebase.search(search_query, limit=2)
        relevant_files = [r["filename"] for r in relevant]

        context = ""
        for r in relevant:
            context += f"\n{r['filename']}:\n{r['content'][:600]}\n"

        prompt = f"""Reference code:
{context}

Code to fix:{error_info}
{request.code}

Suggestion:"""
    else:
        prompt = f"""Code to fix:{error_info}
{request.code}

Suggestion:"""

    suggestion = generate(prompt, request.max_new_tokens, request.use_finetuned)

    return FixCodeResponse(suggestion=suggestion, relevant_files=relevant_files)


@app.post("/analyze-errors", response_model=AnalyzeErrorsResponse)
async def analyze_test_errors(request: AnalyzeErrorsRequest):
    """Analyze test errors and provide fix suggestions."""

    results = []

    # Convert request errors to dict format for parser
    error_dicts = [
        {
            "title": e.title,
            "state": e.state,
            "error": e.error,
            "fullError": e.fullError,
            "complete_error": e.complete_error,
        }
        for e in request.errors
    ]

    # Parse all errors
    parsed_errors = error_parser.parse_json_data(error_dicts)

    for parsed in parsed_errors:
        # Skip passed tests
        if parsed.state != "failed":
            continue

        # Step 1: Collect ALL relevant code from error locations
        code_context = []
        files_involved = []

        for loc in parsed.locations:
            file_code = get_file_code_around_line(loc.file_path, loc.line_number)
            if file_code:
                code_context.append(file_code)
                files_involved.append(loc.file_path)

        # Step 2: Also search codebase for related files if RAG enabled
        if request.use_rag:
            # Search by error message and file names
            search_terms = parsed.error_message
            for loc in parsed.locations[:2]:
                search_terms += " " + os.path.basename(loc.file_path)

            relevant = codebase.search(search_terms, limit=2)
            for r in relevant:
                if r["filename"] not in files_involved:
                    code_context.append(f"Related file {r['filename']}:\n{r['content'][:500]}")

        # Step 3: Build comprehensive context for AI
        full_context = f"""Test Failed: {parsed.title}
Error Message: {parsed.error_message}

Files involved in the error:
{'=' * 40}
"""
        for ctx in code_context:
            full_context += f"\n{ctx}\n"

        full_context += f"""
{'=' * 40}
Full stack trace:
{parsed.full_error[:800] if parsed.full_error else 'N/A'}
"""

        # Step 4: Generate analysis with ONE comprehensive prompt
        analysis_prompt = f"""{full_context}

Based on the code above, analyze this error:

1. ROOT CAUSE (why did this happen):
"""
        root_cause = generate(analysis_prompt, 150, request.use_finetuned)

        # Generate fix steps
        fix_prompt = f"""{full_context}

Error: {parsed.error_message}

Steps to fix this error (numbered):
1."""
        suggested_fix = "1." + generate(fix_prompt, 200, request.use_finetuned)

        # Generate code fix
        error_line_code = ""
        if parsed.locations and parsed.locations[0].code_snippet:
            error_line_code = parsed.locations[0].code_snippet
        elif parsed.locations:
            error_line_code = get_error_line(parsed.locations[0].file_path, parsed.locations[0].line_number)

        if error_line_code:
            code_fix_prompt = f"""Error: {parsed.error_message}

This line has an error:
{error_line_code}

The fixed code should be:
```"""
            code_fix_raw = generate(code_fix_prompt, 150, request.use_finetuned)
            possible_code_fix = "```" + code_fix_raw.split("```")[0] + "```" if code_fix_raw else ""
        else:
            possible_code_fix = "Could not extract error line for fix suggestion"

        # Build location info for response
        locations = [
            {
                "file": loc.file_path,
                "line": loc.line_number,
                "column": loc.column,
                "code": loc.code_snippet or get_error_line(loc.file_path, loc.line_number),
            }
            for loc in parsed.locations
        ]

        results.append(ErrorAnalysis(
            title=parsed.title,
            error_message=parsed.error_message,
            locations=locations,
            suggestedFix=suggested_fix.strip(),
            rootCause=root_cause.strip(),
            possibleCodeFix=possible_code_fix.strip()
        ))

    return AnalyzeErrorsResponse(
        results=results,
        total_errors=len(request.errors),
        analyzed=len(results)
    )


def get_file_code_around_line(file_path: str, line_number: int, context: int = 10) -> str:
    """Get code from a file around a specific line."""
    # Try to find file in codebase index first
    for filename, data in codebase.files.items():
        if filename.endswith(file_path) or file_path.endswith(filename) or os.path.basename(file_path) == filename:
            lines = data["content"].split("\n")
            start = max(0, line_number - context - 1)
            end = min(len(lines), line_number + context)

            code_lines = []
            for i in range(start, end):
                marker = "→ " if i == line_number - 1 else "  "
                code_lines.append(f"{marker}{i+1}: {lines[i]}")

            return f"File: {filename} (around line {line_number})\n" + "\n".join(code_lines)

    # Try to read from disk
    paths_to_try = [
        file_path,
        os.path.join("./data", file_path),
        os.path.join("./data", os.path.basename(file_path)),
    ]

    for path in paths_to_try:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()

                start = max(0, line_number - context - 1)
                end = min(len(lines), line_number + context)

                code_lines = []
                for i in range(start, end):
                    marker = "→ " if i == line_number - 1 else "  "
                    code_lines.append(f"{marker}{i+1}: {lines[i].rstrip()}")

                return f"File: {path} (around line {line_number})\n" + "\n".join(code_lines)
            except:
                pass

    return ""


def get_error_line(file_path: str, line_number: int) -> str:
    """Get a single line from a file."""
    for filename, data in codebase.files.items():
        if filename.endswith(file_path) or file_path.endswith(filename) or os.path.basename(file_path) == filename:
            lines = data["content"].split("\n")
            if 0 < line_number <= len(lines):
                return lines[line_number - 1]

    paths_to_try = [
        file_path,
        os.path.join("./data", file_path),
        os.path.join("./data", os.path.basename(file_path)),
    ]

    for path in paths_to_try:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                if 0 < line_number <= len(lines):
                    return lines[line_number - 1].rstrip()
            except:
                pass

    return ""


@app.post("/analyze-json-file")
async def analyze_json_file(file_path: str = "./json_result.json", use_rag: bool = True, use_finetuned: bool = True):
    """Analyze errors from a JSON file path."""
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    try:
        parsed_errors = error_parser.parse_json_file(file_path)

        # Convert to request format and reuse the analyze endpoint
        errors = [
            TestError(
                title=p.title,
                state=p.state,
                error=p.error_message,
                fullError=p.full_error,
            )
            for p in parsed_errors
        ]

        request = AnalyzeErrorsRequest(errors=errors, use_rag=use_rag, use_finetuned=use_finetuned)
        return await analyze_test_errors(request)

    except Exception as e:
        return {"error": str(e)}


@app.get("/files", response_model=list[FileInfo])
async def list_files():
    """List all indexed files."""
    return codebase.list_files()


@app.get("/file/{filename}")
async def get_file(filename: str):
    """Get content of a specific file."""
    file_data = codebase.get_file(filename)
    if file_data:
        return {
            "filename": filename,
            "path": file_data["path"],
            "summary": file_data["summary"],
            "content": file_data["content"],
        }
    return {"error": "File not found"}


@app.post("/reindex")
async def reindex_codebase():
    """Re-index the codebase."""
    count = codebase.index_codebase()
    return {"message": f"Indexed {count} files"}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "files_indexed": len(codebase.files),
        "models": {
            "base": base_model is not None,
            "finetuned": finetuned_model is not None and finetuned_model is not base_model,
        }
    }
