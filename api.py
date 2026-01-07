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
    suggestion: str


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
    import os
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

        # Format error info for AI
        error_info = error_parser.format_for_ai(parsed)

        # Build context from RAG if enabled
        context = ""
        if request.use_rag and parsed.locations:
            # Get related files from codebase
            search_terms = parsed.error_message + " " + " ".join(
                loc.file_path for loc in parsed.locations[:2]
            )
            relevant = codebase.search(search_terms, limit=2)

            for r in relevant:
                content_preview = r["content"][:800]
                context += f"\n### {r['filename']} (reference)\n```\n{content_preview}\n```\n"

        # Build prompt
        if context:
            prompt = f"""You are a code assistant. Analyze this test failure and suggest a fix.

Reference code from codebase:
{context}

Test failure details:
{error_info}

Provide a concise fix suggestion:"""
        else:
            prompt = f"""You are a code assistant. Analyze this test failure and suggest a fix.

Test failure details:
{error_info}

Provide a concise fix suggestion:"""

        # Generate suggestion
        suggestion = generate(prompt, request.max_new_tokens, request.use_finetuned)

        # Build location info
        locations = [
            {
                "file": loc.file_path,
                "line": loc.line_number,
                "column": loc.column,
                "code": loc.code_snippet,
            }
            for loc in parsed.locations
        ]

        results.append(ErrorAnalysis(
            title=parsed.title,
            error_message=parsed.error_message,
            locations=locations,
            suggestion=suggestion
        ))

    return AnalyzeErrorsResponse(
        results=results,
        total_errors=len(request.errors),
        analyzed=len(results)
    )


@app.post("/analyze-json-file")
async def analyze_json_file(file_path: str = "./json_result.json", use_rag: bool = True, use_finetuned: bool = True):
    """Analyze errors from a JSON file path."""
    import os

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
