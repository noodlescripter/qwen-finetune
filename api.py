from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel
import torch


class GenerateRequest(BaseModel):
    prompt: str
    max_new_tokens: int = 100


class FixCodeRequest(BaseModel):
    code: str
    error: str = ""
    max_new_tokens: int = 150


class GenerateResponse(BaseModel):
    generated_text: str


class FixCodeResponse(BaseModel):
    suggestion: str


class CompareResponse(BaseModel):
    base_output: str
    finetuned_output: str


# Global variables for models
base_model = None
finetuned_model = None
tokenizer = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global base_model, finetuned_model, tokenizer

    base_model_name = "Qwen/Qwen2.5-Coder-0.5B"
    adapter_path = "./qwen-finetuned"

    print(f"Loading tokenizer: {base_model_name}")
    tokenizer = AutoTokenizer.from_pretrained(base_model_name, trust_remote_code=True)

    # 4-bit quantization config
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    # Load base model
    print("Loading base model...")
    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )

    # Load fine-tuned model (base + LoRA adapter)
    print("Loading fine-tuned model...")
    finetuned_base = AutoModelForCausalLM.from_pretrained(
        base_model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )
    finetuned_model = PeftModel.from_pretrained(finetuned_base, adapter_path)

    print("All models loaded successfully!")
    yield
    print("Shutting down...")


app = FastAPI(title="Qwen API", lifespan=lifespan)

# Enable CORS for UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def generate_text(model, prompt: str, max_new_tokens: int) -> str:
    """Basic text generation."""
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=0.4,
        top_p=0.9,
        top_k=40,
        repetition_penalty=1.2,
        pad_token_id=tokenizer.eos_token_id,
        eos_token_id=tokenizer.eos_token_id,
    )

    generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return generated_text


def fix_code(model, code: str, error: str, max_new_tokens: int) -> str:
    """Generate a fix suggestion for broken code."""

    # Create a focused prompt
    if error:
        prompt = f'''# Broken code:
{code}

# Error: {error}

# Fixed code:
'''
    else:
        prompt = f'''# Code to fix:
{code}

# Fixed code:
'''

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        do_sample=False,  # Deterministic for fixes
        temperature=0.2,
        top_k=20,
        repetition_penalty=1.2,
        pad_token_id=tokenizer.eos_token_id,
        eos_token_id=tokenizer.eos_token_id,
    )

    generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

    # Extract only the fixed code part
    if "# Fixed code:" in generated_text:
        suggestion = generated_text.split("# Fixed code:")[-1].strip()
    else:
        suggestion = generated_text[len(prompt):].strip()

    # Clean up - stop at common ending patterns
    stop_patterns = ["\n\n#", "\n# Error", "\n# Broken", "\n# Code to"]
    for pattern in stop_patterns:
        if pattern in suggestion:
            suggestion = suggestion[:suggestion.find(pattern)].strip()

    return suggestion


@app.post("/generate/base", response_model=GenerateResponse)
async def generate_base(request: GenerateRequest):
    """Generate using the base Qwen model."""
    generated_text = generate_text(base_model, request.prompt, request.max_new_tokens)
    return GenerateResponse(generated_text=generated_text)


@app.post("/generate/finetuned", response_model=GenerateResponse)
async def generate_finetuned(request: GenerateRequest):
    """Generate using the fine-tuned model."""
    generated_text = generate_text(finetuned_model, request.prompt, request.max_new_tokens)
    return GenerateResponse(generated_text=generated_text)


@app.post("/compare", response_model=CompareResponse)
async def compare(request: GenerateRequest):
    """Compare outputs from both models."""
    base_output = generate_text(base_model, request.prompt, request.max_new_tokens)
    finetuned_output = generate_text(finetuned_model, request.prompt, request.max_new_tokens)
    return CompareResponse(base_output=base_output, finetuned_output=finetuned_output)


@app.post("/fix", response_model=FixCodeResponse)
async def fix_broken_code(request: FixCodeRequest):
    """Get a fix suggestion for broken code."""
    suggestion = fix_code(finetuned_model, request.code, request.error, request.max_new_tokens)
    return FixCodeResponse(suggestion=suggestion)


@app.get("/health")
async def health():
    return {"status": "ok", "models": ["base", "finetuned"]}
