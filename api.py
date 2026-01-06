from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel
import torch
from codebase_index import CodebaseIndex


# Request/Response models
class AskRequest(BaseModel):
    question: str
    max_new_tokens: int = 200
    use_rag: bool = True  # Set False to use only trained knowledge


class FixCodeRequest(BaseModel):
    code: str
    error: str = ""
    max_new_tokens: int = 200
    use_rag: bool = True  # Set False to use only trained knowledge


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


# Global variables
model = None
tokenizer = None
codebase = CodebaseIndex()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, tokenizer

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

    print("Loading model...")
    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )

    # Load fine-tuned adapter if exists
    import os
    if os.path.exists(adapter_path):
        print("Loading fine-tuned adapter...")
        model = PeftModel.from_pretrained(base_model, adapter_path)
    else:
        print("No fine-tuned adapter found, using base model")
        model = base_model

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


def generate(prompt: str, max_new_tokens: int) -> str:
    """Generate response from model."""
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=0.3,
        top_p=0.9,
        top_k=30,
        repetition_penalty=1.2,
        pad_token_id=tokenizer.eos_token_id,
    )

    response = tokenizer.decode(outputs[0], skip_special_tokens=True)

    # Extract only the generated part after the prompt
    if prompt in response:
        response = response[len(prompt):].strip()

    # Clean up
    stop_patterns = ["\n\n\n", "Question:", "Code:", "# ---"]
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

    answer = generate(prompt, request.max_new_tokens)

    return AskResponse(answer=answer, relevant_files=relevant_files)


@app.post("/fix", response_model=FixCodeResponse)
async def fix_code(request: FixCodeRequest):
    """Get fix suggestion for broken code."""

    relevant_files = []
    error_part = f"\nError: {request.error}" if request.error else ""

    if request.use_rag:
        # RAG mode: Search for similar code patterns
        search_query = request.code[:200] + " " + request.error
        relevant = codebase.search(search_query, limit=2)
        relevant_files = [r["filename"] for r in relevant]

        context = ""
        for r in relevant:
            content_preview = r["content"][:1000]
            context += f"\n### {r['filename']} (reference)\n```\n{content_preview}\n```\n"

        prompt = f"""Reference code from codebase:
{context}

Broken code:
```
{request.code}
```{error_part}

Fixed code:
```
"""
    else:
        # Trained knowledge mode
        prompt = f"""You are a code assistant trained on a specific codebase.
Fix this code using the coding patterns and conventions you learned.

Broken code:
```
{request.code}
```{error_part}

Fixed code:
```
"""

    suggestion = generate(prompt, request.max_new_tokens)

    # Clean up code block markers
    suggestion = suggestion.replace("```", "").strip()

    return FixCodeResponse(suggestion=suggestion, relevant_files=relevant_files)


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
    }
