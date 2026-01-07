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

# ============== Models ==============

class ErrorRequest(BaseModel):
    errors: list[dict]  # [{title, state, error, fullError, complete_error}]


class ErrorAnalysis(BaseModel):
    title: str
    error_message: str
    file: str
    line: int
    code_block: str
    root_cause: str
    suggested_fix: str
    code_fix: str


class AskRequest(BaseModel):
    question: str


class FixRequest(BaseModel):
    code: str
    error: str = ""


# ============== Codebase Index ==============

class CodebaseIndex:
    """Simple file index for the codebase."""

    EXTENSIONS = ['.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.go', '.rs', '.c', '.cpp', '.h']

    def __init__(self, data_dir: str = "./data"):
        self.data_dir = data_dir
        self.files: dict[str, dict] = {}

    def index(self):
        """Index all code files."""
        self.files.clear()

        for root, dirs, filenames in os.walk(self.data_dir):
            # Skip hidden and common ignore dirs
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '__pycache__', 'build', 'dist']]

            for filename in filenames:
                ext = os.path.splitext(filename)[1].lower()
                if ext in self.EXTENSIONS:
                    filepath = os.path.join(root, filename)
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                        self.files[filename] = {
                            'path': filepath,
                            'content': content,
                            'lines': content.split('\n')
                        }
                    except:
                        pass

        print(f"Indexed {len(self.files)} files")
        return len(self.files)

    def find_file(self, name: str) -> dict | None:
        """Find a file by name (partial match)."""
        name = os.path.basename(name)

        # Exact match
        if name in self.files:
            return self.files[name]

        # Partial match
        for filename, data in self.files.items():
            if name in filename or filename in name:
                return data

        return None

    def get_code_block(self, filename: str, line_number: int) -> tuple[str, str]:
        """Get the code block (function/class) containing a line.
        Returns (block_code, full_file_content)."""

        file_data = self.find_file(filename)
        if not file_data:
            return "", ""

        lines = file_data['lines']
        if line_number < 1 or line_number > len(lines):
            return "", file_data['content']

        idx = line_number - 1

        # Find block start
        start_idx = idx
        for i in range(idx, -1, -1):
            line = lines[i].strip()
            if (line.startswith('def ') or line.startswith('async def ') or
                line.startswith('function ') or line.startswith('async function ') or
                line.startswith('class ') or
                ('=> {' in line) or (') {' in line and not line.startswith('if') and not line.startswith('for'))):
                start_idx = i
                break

        # Find block end
        end_idx = idx
        if start_idx < len(lines) and lines[start_idx].rstrip().endswith('{'):
            brace_count = 0
            for i in range(start_idx, len(lines)):
                brace_count += lines[i].count('{') - lines[i].count('}')
                end_idx = i
                if brace_count <= 0 and i > start_idx:
                    break
        else:
            # Python indentation
            if start_idx < len(lines):
                base_indent = len(lines[start_idx]) - len(lines[start_idx].lstrip())
                for i in range(start_idx + 1, len(lines)):
                    if lines[i].strip() == '':
                        continue
                    current_indent = len(lines[i]) - len(lines[i].lstrip())
                    if current_indent <= base_indent and lines[i].strip():
                        end_idx = i - 1
                        break
                    end_idx = i

        # Build block with line numbers, mark error line
        block_lines = []
        for i in range(start_idx, min(end_idx + 1, len(lines))):
            marker = ">>>" if i == idx else "   "
            block_lines.append(f"{marker} {i+1}: {lines[i]}")

        return '\n'.join(block_lines), file_data['content']

    def search(self, query: str, limit: int = 3) -> list[dict]:
        """Search files by content."""
        results = []
        query_lower = query.lower()

        for filename, data in self.files.items():
            if query_lower in data['content'].lower():
                results.append({
                    'filename': filename,
                    'content': data['content'][:1000]
                })
                if len(results) >= limit:
                    break

        return results


# ============== Error Parser ==============

import re

def parse_stack_trace(error_text: str) -> list[dict]:
    """Extract file:line locations from error stack trace."""
    locations = []

    patterns = [
        r'at\s+(?:[\w.<>]+\s+)?\(?([^\s():]+):(\d+):(\d+)\)?',  # JS: at func (file:10:5)
        r'File\s+"([^"]+)",\s+line\s+(\d+)',  # Python: File "x.py", line 10
        r'([^\s:()]+\.[a-zA-Z]{1,4}):(\d+)(?::(\d+))?',  # Generic: file.js:10:5
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, error_text):
            groups = match.groups()
            locations.append({
                'file': groups[0],
                'line': int(groups[1]),
                'column': int(groups[2]) if len(groups) > 2 and groups[2] else None
            })

    # Remove duplicates
    seen = set()
    unique = []
    for loc in locations:
        key = (loc['file'], loc['line'])
        if key not in seen:
            seen.add(key)
            unique.append(loc)

    return unique


# ============== Globals ==============

model = None
tokenizer = None
codebase = CodebaseIndex()


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

    print("Indexing codebase...")
    codebase.index()

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

    for error in request.errors:
        if error.get('state') != 'failed':
            continue

        title = error.get('title', 'Unknown')
        error_msg = error.get('error', '')
        full_error = error.get('fullError', '') or error.get('complete_error', '')

        # Parse stack trace to find file locations
        locations = parse_stack_trace(full_error)

        if not locations:
            results.append(ErrorAnalysis(
                title=title,
                error_message=error_msg,
                file="unknown",
                line=0,
                code_block="Could not parse file location from error",
                root_cause="Unable to locate source file",
                suggested_fix="Check the error message manually",
                code_fix=""
            ))
            continue

        # Get code from first location
        loc = locations[0]
        code_block, _ = codebase.get_code_block(loc['file'], loc['line'])

        if not code_block:
            code_block = f"File {loc['file']} not found in codebase"

        # Generate root cause
        root_cause_prompt = f"""Error: {error_msg}

Code ({loc['file']} line {loc['line']}):
{code_block}

Root cause of this error:"""

        root_cause = generate(root_cause_prompt, 150)

        # Generate suggested fix
        fix_prompt = f"""Error: {error_msg}

Code:
{code_block}

Steps to fix:
1."""

        suggested_fix = "1." + generate(fix_prompt, 150)

        # Generate code fix
        code_fix_prompt = f"""Error: {error_msg}

Original code:
{code_block}

Corrected code:"""

        code_fix = generate(code_fix_prompt, 200)

        results.append(ErrorAnalysis(
            title=title,
            error_message=error_msg,
            file=loc['file'],
            line=loc['line'],
            code_block=code_block,
            root_cause=root_cause.strip(),
            suggested_fix=suggested_fix.strip(),
            code_fix=code_fix.strip()
        ))

    return {"results": results, "total": len(request.errors), "analyzed": len(results)}


@app.post("/ask")
async def ask_question(request: AskRequest):
    """Ask about the codebase."""

    # Search codebase for relevant files
    relevant = codebase.search(request.question, limit=2)

    context = ""
    files_used = []
    for r in relevant:
        context += f"\n{r['filename']}:\n{r['content']}\n"
        files_used.append(r['filename'])

    prompt = f"""Based on this code:
{context}

Question: {request.question}

Answer:"""

    answer = generate(prompt, 200)

    return {"answer": answer, "files": files_used}


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
    return [{"filename": f, "lines": len(d['lines'])} for f, d in codebase.files.items()]


@app.post("/reindex")
async def reindex():
    """Reindex the codebase."""
    count = codebase.index()
    return {"indexed": count}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "Qwen2.5-Coder-0.5B",
        "quantization": "4-bit",
        "files_indexed": len(codebase.files)
    }
