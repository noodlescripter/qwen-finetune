"""
Generate instruction-tuning dataset from codebase files.
Creates chat-format data for better fine-tuning results.
"""
import os
import json
import glob
import random
from pathlib import Path


def load_code_files(data_dir: str, extensions: list[str] = None) -> list[dict]:
    """Load all code files with metadata."""
    if extensions is None:
        extensions = [".py", ".js", ".ts", ".java", ".cpp", ".c", ".go", ".rs", ".rb"]

    files = []
    for ext in extensions:
        pattern = os.path.join(data_dir, "**", f"*{ext}")
        for file_path in glob.glob(pattern, recursive=True):
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                if content.strip():
                    files.append({
                        "path": file_path,
                        "filename": os.path.basename(file_path),
                        "extension": ext,
                        "content": content,
                    })
            except Exception as e:
                print(f"Error reading {file_path}: {e}")

    return files


def extract_functions(content: str, extension: str) -> list[dict]:
    """Extract functions/methods from code."""
    functions = []
    lines = content.split("\n")

    if extension in [".py"]:
        # Python functions
        current_func = None
        func_lines = []
        indent_level = 0

        for i, line in enumerate(lines):
            if line.strip().startswith("def ") or line.strip().startswith("async def "):
                if current_func and func_lines:
                    functions.append({
                        "name": current_func,
                        "code": "\n".join(func_lines),
                        "line": i - len(func_lines) + 1
                    })
                current_func = line.strip().split("(")[0].replace("def ", "").replace("async ", "")
                func_lines = [line]
                indent_level = len(line) - len(line.lstrip())
            elif current_func:
                if line.strip() and not line.startswith(" " * (indent_level + 1)) and not line.strip().startswith("#"):
                    if func_lines:
                        functions.append({
                            "name": current_func,
                            "code": "\n".join(func_lines),
                            "line": i - len(func_lines) + 1
                        })
                    current_func = None
                    func_lines = []
                else:
                    func_lines.append(line)

        if current_func and func_lines:
            functions.append({
                "name": current_func,
                "code": "\n".join(func_lines),
                "line": len(lines) - len(func_lines) + 1
            })

    elif extension in [".js", ".ts"]:
        # JavaScript/TypeScript functions
        import re
        # Match function declarations and arrow functions
        patterns = [
            r'function\s+(\w+)\s*\([^)]*\)\s*\{',
            r'const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>',
            r'(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>',
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, content):
                name = match.group(1)
                start = match.start()
                # Find the function body (simplified)
                line_num = content[:start].count('\n') + 1
                functions.append({
                    "name": name,
                    "code": content[start:start+500],  # Simplified extraction
                    "line": line_num
                })

    return functions


def extract_classes(content: str, extension: str) -> list[dict]:
    """Extract classes from code."""
    classes = []
    lines = content.split("\n")

    if extension == ".py":
        current_class = None
        class_lines = []

        for i, line in enumerate(lines):
            if line.strip().startswith("class "):
                if current_class and class_lines:
                    classes.append({
                        "name": current_class,
                        "code": "\n".join(class_lines),
                    })
                current_class = line.strip().split("(")[0].split(":")[0].replace("class ", "")
                class_lines = [line]
            elif current_class:
                if line and not line.startswith(" ") and not line.startswith("\t") and line.strip():
                    classes.append({
                        "name": current_class,
                        "code": "\n".join(class_lines),
                    })
                    current_class = None
                    class_lines = []
                else:
                    class_lines.append(line)

        if current_class and class_lines:
            classes.append({
                "name": current_class,
                "code": "\n".join(class_lines),
            })

    elif extension in [".js", ".ts"]:
        import re
        for match in re.finditer(r'class\s+(\w+)', content):
            classes.append({
                "name": match.group(1),
                "code": content[match.start():match.start()+1000],
            })

    return classes


def generate_qa_pairs(files: list[dict]) -> list[dict]:
    """Generate question-answer pairs from code files."""
    qa_pairs = []

    for file_info in files:
        filename = file_info["filename"]
        content = file_info["content"]
        ext = file_info["extension"]

        # 1. "What does this file do?" questions
        qa_pairs.append({
            "messages": [
                {"role": "system", "content": "You are a code assistant that explains code clearly and concisely."},
                {"role": "user", "content": f"What does the file {filename} do?"},
                {"role": "assistant", "content": f"The file `{filename}` contains the following code:\n\n```{ext[1:]}\n{content[:1500]}\n```\n\nThis file provides functionality for the codebase."}
            ]
        })

        # 2. Extract and explain functions
        functions = extract_functions(content, ext)
        for func in functions[:5]:  # Limit per file
            qa_pairs.append({
                "messages": [
                    {"role": "system", "content": "You are a code assistant that explains code clearly."},
                    {"role": "user", "content": f"Explain the function `{func['name']}` in {filename}"},
                    {"role": "assistant", "content": f"Here's the `{func['name']}` function:\n\n```{ext[1:]}\n{func['code'][:800]}\n```\n\nThis function is part of {filename}."}
                ]
            })

        # 3. Extract and explain classes
        classes = extract_classes(content, ext)
        for cls in classes[:3]:
            qa_pairs.append({
                "messages": [
                    {"role": "system", "content": "You are a code assistant that explains code clearly."},
                    {"role": "user", "content": f"What is the `{cls['name']}` class in {filename}?"},
                    {"role": "assistant", "content": f"The `{cls['name']}` class in `{filename}`:\n\n```{ext[1:]}\n{cls['code'][:1000]}\n```"}
                ]
            })

        # 4. "How do I use this?" questions
        if functions:
            func = random.choice(functions)
            qa_pairs.append({
                "messages": [
                    {"role": "system", "content": "You are a helpful code assistant."},
                    {"role": "user", "content": f"How do I use the {func['name']} function?"},
                    {"role": "assistant", "content": f"To use the `{func['name']}` function from `{filename}`:\n\n```{ext[1:]}\n{func['code'][:600]}\n```\n\nYou can call it by importing from `{filename}` and using it in your code."}
                ]
            })

    return qa_pairs


def generate_code_completion_pairs(files: list[dict]) -> list[dict]:
    """Generate code completion training pairs."""
    pairs = []

    for file_info in files:
        content = file_info["content"]
        ext = file_info["extension"]
        lines = content.split("\n")

        # Create completion examples from actual code
        for i in range(0, len(lines) - 5, 10):  # Sample every 10 lines
            prefix = "\n".join(lines[max(0, i-3):i+2])
            completion = "\n".join(lines[i+2:i+7])

            if len(prefix.strip()) > 20 and len(completion.strip()) > 20:
                pairs.append({
                    "messages": [
                        {"role": "system", "content": "You are a code completion assistant. Complete the code based on the context."},
                        {"role": "user", "content": f"Complete this code:\n```{ext[1:]}\n{prefix}\n```"},
                        {"role": "assistant", "content": f"```{ext[1:]}\n{completion}\n```"}
                    ]
                })

    return pairs


def generate_fix_pairs(files: list[dict]) -> list[dict]:
    """Generate code fixing training pairs."""
    pairs = []

    # Common error patterns and fixes
    error_patterns = [
        {"broken": "def foo()", "fixed": "def foo():", "error": "SyntaxError: expected ':'"},
        {"broken": "if x == 1", "fixed": "if x == 1:", "error": "SyntaxError: expected ':'"},
        {"broken": "return value", "fixed": "    return value", "error": "IndentationError"},
        {"broken": "print(x", "fixed": "print(x)", "error": "SyntaxError: unexpected EOF"},
    ]

    for file_info in files:
        content = file_info["content"]
        ext = file_info["extension"]
        functions = extract_functions(content, ext)

        for func in functions[:3]:
            # Create a "fix this code" example using real code
            pairs.append({
                "messages": [
                    {"role": "system", "content": "You are a code assistant that fixes bugs and errors."},
                    {"role": "user", "content": f"Review and improve this code if needed:\n```{ext[1:]}\n{func['code'][:500]}\n```"},
                    {"role": "assistant", "content": f"The code looks correct. Here it is with proper formatting:\n\n```{ext[1:]}\n{func['code'][:500]}\n```"}
                ]
            })

    return pairs


def generate_dataset(data_dir: str = "./data", output_file: str = "./training_data.jsonl"):
    """Generate complete instruction-tuning dataset."""
    print(f"Loading files from {data_dir}...")
    files = load_code_files(data_dir)
    print(f"Loaded {len(files)} files")

    all_pairs = []

    # Generate different types of training data
    print("Generating Q&A pairs...")
    qa_pairs = generate_qa_pairs(files)
    all_pairs.extend(qa_pairs)
    print(f"  Generated {len(qa_pairs)} Q&A pairs")

    print("Generating code completion pairs...")
    completion_pairs = generate_code_completion_pairs(files)
    all_pairs.extend(completion_pairs[:100])  # Limit completion pairs
    print(f"  Generated {min(len(completion_pairs), 100)} completion pairs")

    print("Generating fix pairs...")
    fix_pairs = generate_fix_pairs(files)
    all_pairs.extend(fix_pairs)
    print(f"  Generated {len(fix_pairs)} fix pairs")

    # Shuffle the dataset
    random.shuffle(all_pairs)

    # Save as JSONL (one JSON object per line)
    print(f"\nSaving {len(all_pairs)} training examples to {output_file}...")
    with open(output_file, "w", encoding="utf-8") as f:
        for pair in all_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + "\n")

    # Also save as regular JSON for inspection
    json_output = output_file.replace(".jsonl", ".json")
    with open(json_output, "w", encoding="utf-8") as f:
        json.dump(all_pairs, f, indent=2, ensure_ascii=False)

    print(f"Saved to {output_file} and {json_output}")
    print(f"\nDataset statistics:")
    print(f"  Total examples: {len(all_pairs)}")
    print(f"  Q&A pairs: {len(qa_pairs)}")
    print(f"  Completion pairs: {min(len(completion_pairs), 100)}")
    print(f"  Fix pairs: {len(fix_pairs)}")

    return all_pairs


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate instruction-tuning dataset")
    parser.add_argument("--data-dir", default="./data", help="Directory with code files")
    parser.add_argument("--output", default="./training_data.jsonl", help="Output file path")
    args = parser.parse_args()

    generate_dataset(args.data_dir, args.output)
