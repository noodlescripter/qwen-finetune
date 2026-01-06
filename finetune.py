import os
import glob
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


def load_code_files(data_dir: str, extensions: list[str] = None) -> list[str]:
    """Load code files from a directory recursively."""
    if extensions is None:
        extensions = [".py", ".js", ".ts", ".java", ".cpp", ".c", ".go", ".rs", ".rb"]

    code_files = []
    for ext in extensions:
        pattern = os.path.join(data_dir, "**", f"*{ext}")
        code_files.extend(glob.glob(pattern, recursive=True))

    texts = []
    for file_path in code_files:
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                if content.strip():
                    # Just use the code content without file path prefix
                    texts.append(content)
        except Exception as e:
            print(f"Error reading {file_path}: {e}")

    print(f"Loaded {len(texts)} code files")
    return texts


def prepare_dataset(texts: list[str], tokenizer, max_length: int = 512):
    """Tokenize and prepare dataset for training."""

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
    import argparse

    parser = argparse.ArgumentParser(description="Fine-tune Qwen model")
    parser.add_argument("--resume", action="store_true", help="Resume training from existing checkpoint")
    parser.add_argument("--data-dir", default="./data", help="Directory containing code files")
    parser.add_argument("--output-dir", default="./qwen-finetuned", help="Output directory for model")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=1, help="Batch size")
    parser.add_argument("--learning-rate", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--max-length", type=int, default=256, help="Max sequence length")
    args = parser.parse_args()

    # Configuration
    model_name = "Qwen/Qwen2.5-Coder-0.5B"
    data_dir = args.data_dir
    output_dir = args.output_dir
    resume_from_checkpoint = args.resume

    # Training hyperparameters (optimized for low VRAM)
    num_epochs = args.epochs
    batch_size = args.batch_size
    learning_rate = args.learning_rate
    max_length = args.max_length

    print(f"Loading model: {model_name}")
    if resume_from_checkpoint:
        print(f"Resuming from checkpoint: {output_dir}")

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

    # Load model with 4-bit quantization
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )
    model.gradient_checkpointing_enable()

    # Prepare model for training
    model = prepare_model_for_kbit_training(model)

    # Resume from existing LoRA or create new
    if resume_from_checkpoint and os.path.exists(output_dir):
        print("Loading existing LoRA adapters...")
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, output_dir, is_trainable=True)
    else:
        # Configure LoRA (smaller rank for low VRAM)
        lora_config = LoraConfig(
            r=8,  # Reduced rank
            lora_alpha=16,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, lora_config)

    model.print_trainable_parameters()

    # Load and prepare dataset
    print(f"Loading code files from: {data_dir}")
    texts = load_code_files(data_dir)

    if not texts:
        print(f"No code files found in {data_dir}")
        print("Please create a 'data' directory and add your code files.")
        return

    dataset = prepare_dataset(texts, tokenizer, max_length)

    # Split dataset
    split_dataset = dataset.train_test_split(test_size=0.1)

    # Data collator
    data_collator = DataCollatorForLanguageModeling(
        tokenizer=tokenizer,
        mlm=False,
    )

    # Training arguments (optimized for low VRAM)
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=num_epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        gradient_accumulation_steps=8,  # Increased to compensate for small batch
        eval_strategy="steps",
        eval_steps=50,
        save_strategy="steps",
        save_steps=50,
        logging_steps=10,
        learning_rate=learning_rate,
        weight_decay=0.01,
        warmup_ratio=0.1,
        lr_scheduler_type="cosine",
        fp16=False,  # Disabled since using 4-bit
        bf16=False,
        optim="paged_adamw_8bit",  # Memory-efficient optimizer
        save_total_limit=2,
        load_best_model_at_end=True,
        report_to="none",
        gradient_checkpointing=True,
        max_grad_norm=0.3,
    )

    # Initialize trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=split_dataset["train"],
        eval_dataset=split_dataset["test"],
        data_collator=data_collator,
    )

    # Train
    print("Starting training...")
    trainer.train()

    # Save the fine-tuned model
    print(f"Saving model to {output_dir}")
    trainer.save_model()
    tokenizer.save_pretrained(output_dir)

    print("Training complete!")


if __name__ == "__main__":
    main()
