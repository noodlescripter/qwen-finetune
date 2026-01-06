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


class GenerateResponse(BaseModel):
    generated_text: str


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
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    # Stop sequences to prevent hallucination
    stop_strings = [
        "\n\n\n",
        "Output:",
        "Error:",
        "Traceback",
        '"""',
        "I am getting",
        "The above exception",
        "# File:",
    ]

    # Encode stop sequences
    stop_token_ids = []
    for stop_str in stop_strings:
        tokens = tokenizer.encode(stop_str, add_special_tokens=False)
        if tokens:
            stop_token_ids.append(tokens[0])

    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=0.7,
        top_p=0.9,
        top_k=50,
        repetition_penalty=1.1,
        pad_token_id=tokenizer.eos_token_id,
        eos_token_id=tokenizer.eos_token_id,
    )

    generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

    # Post-process: cut at stop sequences
    for stop_str in stop_strings:
        if stop_str in generated_text:
            idx = generated_text.find(stop_str)
            # Keep the prompt part, cut at stop sequence
            if idx > len(prompt):
                generated_text = generated_text[:idx].rstrip()

    return generated_text


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


@app.get("/health")
async def health():
    return {"status": "ok", "models": ["base", "finetuned"]}
