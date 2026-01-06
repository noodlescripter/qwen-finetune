# Qwen Code Model - Fine-tuning & API

A toolkit for fine-tuning the Qwen2.5-Coder-0.5B model on your custom codebase and serving it via a FastAPI endpoint.

## Features

- Fine-tune Qwen2.5-Coder on your own code using QLoRA (4-bit quantization)
- Low VRAM support (~3-4GB GPU memory)
- Resume training to incrementally add new data
- REST API with endpoints for both base and fine-tuned models
- Side-by-side model comparison

## Requirements

- Python 3.10+
- CUDA-compatible GPU (3GB+ VRAM)

## Installation

```bash
pip install -r requirements.txt
```

## Quick Start

### 1. Prepare Training Data

Add your code files to the `data/` directory:

```bash
mkdir -p data
cp -r /path/to/your/codebase/* data/
```

Supported file extensions: `.py`, `.js`, `.ts`, `.java`, `.cpp`, `.c`, `.go`, `.rs`, `.rb`

### 2. Fine-tune the Model

```bash
python finetune.py
```

### 3. Test the Model

```bash
python test_model.py
```

### 4. Start the API Server

```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```

## Usage

### Fine-tuning Options

```bash
python finetune.py [OPTIONS]

Options:
  --resume          Resume training from existing checkpoint
  --data-dir        Training data directory (default: ./data)
  --output-dir      Output directory (default: ./qwen-finetuned)
  --epochs          Number of training epochs (default: 3)
  --batch-size      Batch size (default: 1)
  --learning-rate   Learning rate (default: 2e-4)
  --max-length      Max sequence length (default: 256)
```

**Examples:**

```bash
# Fresh training
python finetune.py

# Resume with new data
python finetune.py --resume

# Custom settings
python finetune.py --epochs 5 --learning-rate 1e-4

# Resume with lower learning rate (recommended)
python finetune.py --resume --learning-rate 1e-4 --epochs 2
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/generate/base` | Generate using base Qwen model |
| POST | `/generate/finetuned` | Generate using fine-tuned model |
| POST | `/compare` | Compare outputs from both models |
| GET | `/health` | Health check |
| GET | `/docs` | Swagger UI documentation |

**Request Body:**

```json
{
  "prompt": "def hello_world():",
  "max_new_tokens": 100
}
```

**Example Requests:**

```bash
# Base model
curl -X POST http://localhost:8000/generate/base \
  -H "Content-Type: application/json" \
  -d '{"prompt": "def calculate_sum(", "max_new_tokens": 100}'

# Fine-tuned model
curl -X POST http://localhost:8000/generate/finetuned \
  -H "Content-Type: application/json" \
  -d '{"prompt": "def calculate_sum(", "max_new_tokens": 100}'

# Compare both
curl -X POST http://localhost:8000/compare \
  -H "Content-Type: application/json" \
  -d '{"prompt": "class Logger:", "max_new_tokens": 100}'
```

**Python Example:**

```python
import requests

response = requests.post(
    "http://localhost:8000/generate/finetuned",
    json={"prompt": "def get_logger(", "max_new_tokens": 100}
)
print(response.json()["generated_text"])
```

## Project Structure

```
qwen/
├── api.py              # FastAPI server with both models
├── finetune.py         # Fine-tuning script with QLoRA
├── test_model.py       # Interactive CLI for testing
├── run_qwen.py         # Simple inference script
├── requirements.txt    # Dependencies
├── README.md
├── data/               # Training data (your code files)
│   ├── models/
│   ├── services/
│   ├── utils/
│   └── ...
└── qwen-finetuned/     # Output directory (after training)
    ├── adapter_config.json
    ├── adapter_model.safetensors
    └── ...
```

## Training Tips

### Incremental Training

To add new code to an already fine-tuned model:

1. Add new files to `data/` directory
2. Run with `--resume` flag:
   ```bash
   python finetune.py --resume --learning-rate 1e-4
   ```

### Memory Issues

If you encounter CUDA OOM errors:

```bash
# Set environment variable
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True python finetune.py

# Or reduce max length
python finetune.py --max-length 128
```

### Recommended Settings by VRAM

| VRAM | batch-size | max-length |
|------|------------|------------|
| 3-4 GB | 1 | 128-256 |
| 6-8 GB | 2 | 256-512 |
| 12+ GB | 4 | 512-1024 |

## Dependencies

- `transformers` - Model loading and inference
- `torch` - PyTorch backend
- `peft` - Parameter-efficient fine-tuning (LoRA)
- `bitsandbytes` - 4-bit quantization
- `accelerate` - Device management
- `datasets` - Dataset handling
- `fastapi` - API framework
- `uvicorn` - ASGI server

## License

MIT
