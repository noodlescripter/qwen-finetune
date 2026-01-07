# Qwen Code Assistant

A complete toolkit for fine-tuning Qwen2.5-Coder-0.5B on your custom codebase with RAG support, error analysis, and a web UI.

## Features

- **Instruction-tuning** with chat format for better Q&A results
- **RAG (Retrieval Augmented Generation)** for accurate codebase knowledge
- **QLoRA fine-tuning** with 4-bit quantization (3-4GB VRAM)
- **Error analysis** from JSON test results
- **Web UI** for easy interaction
- **Incremental training** with dataset merging
- **Base vs Fine-tuned** model selection

## Requirements

- Python 3.10+
- CUDA-compatible GPU (3GB+ VRAM)

## Installation

```bash
pip install -r requirements.txt
```

## Quick Start

### 1. Prepare Your Codebase

```bash
mkdir -p data
cp -r /path/to/your/codebase/* data/
```

Supported: `.py`, `.js`, `.ts`, `.java`, `.cpp`, `.c`, `.go`, `.rs`, `.rb`

### 2. Generate Instruction Dataset

```bash
python generate_dataset.py --data-dir ./data --output ./training_data.jsonl
```

This creates Q&A pairs, code completions, and fix examples from your code.

### 3. Fine-tune the Model

```bash
python finetune_chat.py --dataset ./training_data.jsonl --epochs 3
```

### 4. Start the API & UI

```bash
uvicorn api:app --host 0.0.0.0 --port 8000
# Open ui.html in browser
```

## Training

### Dataset Generation

Generate instruction-tuning dataset from your code:

```bash
python generate_dataset.py [OPTIONS]

Options:
  --data-dir    Directory with code files (default: ./data)
  --output      Output file (default: ./training_data.jsonl)
```

**Generated dataset format:**
```json
{
  "messages": [
    {"role": "system", "content": "You are a code assistant..."},
    {"role": "user", "content": "What does AuthService do?"},
    {"role": "assistant", "content": "The AuthService class..."}
  ]
}
```

**Types of training data generated:**

| Type | Example | Purpose |
|------|---------|---------|
| Q&A | "What does logger.js do?" | Explain files/functions |
| Completion | "Complete this code..." | Code autocomplete |
| Fix | "Review this code..." | Bug fixing |

### Fine-tuning Options

**Chat format (recommended):**
```bash
python finetune_chat.py [OPTIONS]

Options:
  --dataset       Training data file (default: ./training_data.jsonl)
  --output-dir    Output directory (default: ./qwen-finetuned)
  --resume        Resume from existing checkpoint
  --epochs        Number of epochs (default: 3)
  --batch-size    Batch size (default: 1)
  --learning-rate Learning rate (default: 2e-4)
  --max-length    Max sequence length (default: 512)
```

**Raw code format (simpler):**
```bash
python finetune.py [OPTIONS]
```

### Incremental Training

**Option 1: Add new code → Regenerate → Resume**
```bash
# Add new code
cp -r /path/to/new/code/* data/

# Regenerate dataset (includes all files)
python generate_dataset.py

# Resume training (keeps old knowledge)
python finetune_chat.py --resume --learning-rate 1e-4
```

**Option 2: Merge separate datasets**
```bash
# Generate new dataset separately
python generate_dataset.py --data-dir ./new_code --output ./new_data.jsonl

# Merge with existing
python merge_datasets.py add ./new_data.jsonl --to ./training_data.jsonl

# Train on merged data
python finetune_chat.py --resume
```

### Dataset Merging

```bash
python merge_datasets.py [COMMAND]

Commands:
  merge     Combine multiple files
  add       Add new data to existing dataset
  from-dir  Create from directory of datasets
  stats     Show dataset statistics

Examples:
  # Merge multiple files
  python merge_datasets.py merge old.jsonl new.jsonl -o combined.jsonl

  # Add new data to existing
  python merge_datasets.py add new_data.jsonl --to training_data.jsonl

  # Check dataset stats
  python merge_datasets.py stats training_data.jsonl
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/ask` | Ask questions about codebase |
| POST | `/fix` | Get code fix suggestions |
| POST | `/analyze-errors` | Analyze JSON test errors |
| POST | `/analyze-json-file` | Analyze errors from file |
| GET | `/files` | List indexed files |
| POST | `/reindex` | Re-index codebase |
| GET | `/health` | Health check |
| GET | `/docs` | Swagger UI |

### Request Parameters

All POST endpoints support:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `use_rag` | bool | true | Use RAG (retrieve files) |
| `use_finetuned` | bool | true | Use fine-tuned model |
| `max_new_tokens` | int | 200 | Max tokens to generate |

### Examples

**Ask about codebase:**
```bash
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What does the AuthService do?", "use_rag": true}'
```

**Fix code:**
```bash
curl -X POST http://localhost:8000/fix \
  -H "Content-Type: application/json" \
  -d '{"code": "def foo()\n  return 1", "error": "SyntaxError"}'
```

**Analyze test errors:**
```bash
curl -X POST http://localhost:8000/analyze-errors \
  -H "Content-Type: application/json" \
  -d '{
    "errors": [{
      "title": "test login",
      "state": "failed",
      "error": "TypeError",
      "fullError": "at auth.js:10:5"
    }]
  }'
```

**Use base model only (no fine-tuning):**
```bash
curl -X POST http://localhost:8000/ask \
  -d '{"question": "How do I sort an array?", "use_finetuned": false}'
```

## Web UI

Open `ui.html` in your browser after starting the API.

**Features:**

| Tab | Function |
|-----|----------|
| Ask About Code | Q&A about your codebase |
| Fix Code | Get fix suggestions |
| Analyze Errors | Parse JSON test results |
| Browse Files | View indexed files |

**Options on each tab:**
- ✓ Use RAG - Include actual file contents
- ✓ Use Fine-tuned - Use your trained model

## Project Structure

```
qwen/
├── api.py                 # FastAPI server
├── ui.html                # Web interface
├── generate_dataset.py    # Create instruction dataset
├── finetune_chat.py       # Fine-tune with chat format
├── finetune.py            # Fine-tune with raw code
├── merge_datasets.py      # Merge training datasets
├── codebase_index.py      # RAG indexing
├── error_parser.py        # Parse error stack traces
├── test_model.py          # Interactive testing
├── requirements.txt
├── data/                  # Your codebase files
├── training_data.jsonl    # Generated training data
└── qwen-finetuned/        # Trained model output
```

## RAG vs Fine-tuned

| Mode | What it does | Best for |
|------|--------------|----------|
| **RAG on** | Retrieves actual files | Specific questions about files |
| **RAG off** | Uses model memory only | General patterns/style |
| **Fine-tuned** | Your trained model | Your codebase patterns |
| **Base** | Original Qwen model | General coding questions |

**Recommended combinations:**

| Use Case | RAG | Model |
|----------|-----|-------|
| "What does auth.js do?" | ✓ | Fine-tuned |
| "Fix this code from my project" | ✓ | Fine-tuned |
| "How should I structure a service?" | ✗ | Fine-tuned |
| "How do I use async/await?" | ✗ | Base |

## Memory Settings

| VRAM | batch-size | max-length |
|------|------------|------------|
| 3-4 GB | 1 | 256 |
| 6-8 GB | 2 | 512 |
| 12+ GB | 4 | 1024 |

**If OOM errors:**
```bash
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True python finetune_chat.py
```

## Dependencies

```
transformers
torch
peft
bitsandbytes
accelerate
datasets
fastapi
uvicorn
```

## License

MIT
