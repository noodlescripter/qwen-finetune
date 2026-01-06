"""Test script to compare base and fine-tuned models."""
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel
import torch


def load_base_model():
    """Load the base Qwen model."""
    model_name = "Qwen/Qwen2.5-Coder-0.5B"
    print(f"Loading base model: {model_name}")

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)

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

    return model, tokenizer


def load_finetuned_model():
    """Load the fine-tuned model with LoRA adapter."""
    base_model_name = "Qwen/Qwen2.5-Coder-0.5B"
    adapter_path = "./qwen-finetuned"
    print(f"Loading fine-tuned model from: {adapter_path}")

    tokenizer = AutoTokenizer.from_pretrained(base_model_name, trust_remote_code=True)

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    # Load base model
    model = AutoModelForCausalLM.from_pretrained(
        base_model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )

    # Load LoRA adapter
    model = PeftModel.from_pretrained(model, adapter_path)

    return model, tokenizer


def generate(model, tokenizer, prompt: str, max_new_tokens: int = 100) -> str:
    """Generate text from a prompt."""
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
            if idx > len(prompt):
                generated_text = generated_text[:idx].rstrip()

    return generated_text


def main():
    print("=" * 60)
    print("Loading models...")
    print("=" * 60)

    # Load both models
    base_model, base_tokenizer = load_base_model()
    finetuned_model, finetuned_tokenizer = load_finetuned_model()

    print("\nModels loaded! Enter prompts to compare outputs.")
    print("Type 'quit' to exit.\n")

    while True:
        prompt = input("\nEnter prompt: ").strip()
        if prompt.lower() == "quit":
            break

        if not prompt:
            continue

        print("\n" + "-" * 40)
        print("BASE MODEL:")
        print("-" * 40)
        base_output = generate(base_model, base_tokenizer, prompt)
        print(base_output)

        print("\n" + "-" * 40)
        print("FINE-TUNED MODEL:")
        print("-" * 40)
        finetuned_output = generate(finetuned_model, finetuned_tokenizer, prompt)
        print(finetuned_output)


if __name__ == "__main__":
    main()
