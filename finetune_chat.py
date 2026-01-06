"""
Fine-tune Qwen model using chat/instruction format dataset.
This produces better results for Q&A and code assistance tasks.
"""
import os
import json
import argparse
from datasets import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling,
    BitsAndBytesConfig,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
import torch


def load_chat_dataset(file_path: str) -> list[dict]:
    """Load chat-format dataset from JSONL or JSON file."""
    data = []

    if file_path.endswith(".jsonl"):
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    data.append(json.loads(line))
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                data = [data]

    print(f"Loaded {len(data)} examples from {file_path}")
    return data


def format_chat_to_text(messages: list[dict], tokenizer) -> str:
    """Convert chat messages to text format for training."""
    # Use the tokenizer's chat template if available
    if hasattr(tokenizer, 'apply_chat_template'):
        try:
            return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        except:
            pass

    # Fallback: manual formatting
    text = ""
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if role == "system":
            text += f"<|system|>\n{content}\n"
        elif role == "user":
            text += f"<|user|>\n{content}\n"
        elif role == "assistant":
            text += f"<|assistant|>\n{content}\n"

    return text


def prepare_dataset(data: list[dict], tokenizer, max_length: int = 512):
    """Prepare dataset for training."""

    # Convert chat format to text
    texts = []
    for item in data:
        messages = item.get("messages", [])
        if messages:
            text = format_chat_to_text(messages, tokenizer)
            texts.append(text)

    print(f"Prepared {len(texts)} training examples")

    def tokenize_function(examples):
        return tokenizer(
            examples["text"],
            truncation=True,
            max_length=max_length,
            padding="max_length",
        )

    dataset = Dataset.from_dict({"text": texts})
    tokenized_dataset = dataset.map(
        tokenize_function,
        batched=True,
        remove_columns=["text"],
    )

    return tokenized_dataset


def main():
    parser = argparse.ArgumentParser(description="Fine-tune Qwen with chat format")
    parser.add_argument("--dataset", default="./training_data.jsonl", help="Path to training data")
    parser.add_argument("--output-dir", default="./qwen-finetuned", help="Output directory")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--epochs", type=int, default=3, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=1, help="Batch size")
    parser.add_argument("--learning-rate", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--max-length", type=int, default=512, help="Max sequence length")
    args = parser.parse_args()

    model_name = "Qwen/Qwen2.5-Coder-0.5B"

    print(f"Loading model: {model_name}")
    if args.resume:
        print(f"Will resume from: {args.output_dir}")

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # 4-bit quantization config (QLoRA)
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )
    model.gradient_checkpointing_enable()

    # Prepare model for training
    model = prepare_model_for_kbit_training(model)

    # Resume or create new LoRA
    if args.resume and os.path.exists(args.output_dir):
        print("Loading existing LoRA adapters...")
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.output_dir, is_trainable=True)
    else:
        lora_config = LoraConfig(
            r=16,  # Higher rank for chat fine-tuning
            lora_alpha=32,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, lora_config)

    model.print_trainable_parameters()

    # Load and prepare dataset
    print(f"\nLoading dataset from: {args.dataset}")
    if not os.path.exists(args.dataset):
        print(f"Dataset not found: {args.dataset}")
        print("Run: python generate_dataset.py --data-dir ./data")
        return

    data = load_chat_dataset(args.dataset)
    dataset = prepare_dataset(data, tokenizer, args.max_length)

    # Split dataset
    split_dataset = dataset.train_test_split(test_size=0.1)

    # Data collator
    data_collator = DataCollatorForLanguageModeling(
        tokenizer=tokenizer,
        mlm=False,
    )

    # Training arguments
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=8,
        eval_strategy="steps",
        eval_steps=50,
        save_strategy="steps",
        save_steps=50,
        logging_steps=10,
        learning_rate=args.learning_rate,
        weight_decay=0.01,
        warmup_ratio=0.1,
        lr_scheduler_type="cosine",
        fp16=False,
        bf16=False,
        optim="paged_adamw_8bit",
        save_total_limit=2,
        load_best_model_at_end=True,
        report_to="none",
        gradient_checkpointing=True,
        max_grad_norm=0.3,
    )

    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=split_dataset["train"],
        eval_dataset=split_dataset["test"],
        data_collator=data_collator,
    )

    # Train
    print("\nStarting training...")
    trainer.train()

    # Save
    print(f"\nSaving model to {args.output_dir}")
    trainer.save_model()
    tokenizer.save_pretrained(args.output_dir)

    print("Training complete!")


if __name__ == "__main__":
    main()
