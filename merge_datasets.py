"""
Merge multiple training datasets together.
Supports incremental dataset building.
"""
import os
import json
import argparse
from pathlib import Path


def load_jsonl(file_path: str) -> list[dict]:
    """Load data from JSONL file."""
    data = []
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    data.append(json.loads(line))
    return data


def load_json(file_path: str) -> list[dict]:
    """Load data from JSON file."""
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return [data]
            return data
    return []


def save_jsonl(data: list[dict], file_path: str):
    """Save data to JSONL file."""
    with open(file_path, "w", encoding="utf-8") as f:
        for item in data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")


def save_json(data: list[dict], file_path: str):
    """Save data to JSON file."""
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_content_hash(item: dict) -> str:
    """Get a hash for deduplication."""
    messages = item.get("messages", [])
    if messages:
        # Use user message as key for deduplication
        user_msgs = [m.get("content", "")[:100] for m in messages if m.get("role") == "user"]
        return "|".join(user_msgs)
    return json.dumps(item)[:200]


def merge_datasets(files: list[str], output: str, deduplicate: bool = True):
    """Merge multiple dataset files."""
    all_data = []
    seen_hashes = set()

    for file_path in files:
        print(f"Loading: {file_path}")

        if file_path.endswith(".jsonl"):
            data = load_jsonl(file_path)
        else:
            data = load_json(file_path)

        print(f"  Found {len(data)} examples")

        for item in data:
            if deduplicate:
                content_hash = get_content_hash(item)
                if content_hash in seen_hashes:
                    continue
                seen_hashes.add(content_hash)
            all_data.append(item)

    print(f"\nTotal examples after merge: {len(all_data)}")

    # Save merged data
    if output.endswith(".jsonl"):
        save_jsonl(all_data, output)
    else:
        save_json(all_data, output)

    print(f"Saved to: {output}")
    return all_data


def add_to_dataset(new_data_file: str, existing_dataset: str, output: str = None):
    """Add new data to existing dataset."""
    if output is None:
        output = existing_dataset  # Overwrite existing

    files = []
    if os.path.exists(existing_dataset):
        files.append(existing_dataset)
    files.append(new_data_file)

    return merge_datasets(files, output)


def create_from_directory(data_dir: str, output: str):
    """Create dataset from all JSONL/JSON files in a directory."""
    files = []

    for ext in ["*.jsonl", "*.json"]:
        files.extend(Path(data_dir).glob(ext))
        files.extend(Path(data_dir).glob(f"**/{ext}"))

    files = [str(f) for f in files]
    print(f"Found {len(files)} dataset files in {data_dir}")

    return merge_datasets(files, output)


def main():
    parser = argparse.ArgumentParser(description="Merge training datasets")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Merge command
    merge_parser = subparsers.add_parser("merge", help="Merge multiple files")
    merge_parser.add_argument("files", nargs="+", help="Files to merge")
    merge_parser.add_argument("--output", "-o", default="./merged_training_data.jsonl", help="Output file")
    merge_parser.add_argument("--no-dedupe", action="store_true", help="Don't remove duplicates")

    # Add command
    add_parser = subparsers.add_parser("add", help="Add new data to existing dataset")
    add_parser.add_argument("new_data", help="New data file to add")
    add_parser.add_argument("--to", dest="existing", default="./training_data.jsonl", help="Existing dataset")
    add_parser.add_argument("--output", "-o", help="Output file (default: overwrite existing)")

    # From-dir command
    dir_parser = subparsers.add_parser("from-dir", help="Create from directory of datasets")
    dir_parser.add_argument("directory", help="Directory with dataset files")
    dir_parser.add_argument("--output", "-o", default="./training_data.jsonl", help="Output file")

    # Stats command
    stats_parser = subparsers.add_parser("stats", help="Show dataset statistics")
    stats_parser.add_argument("file", help="Dataset file to analyze")

    args = parser.parse_args()

    if args.command == "merge":
        merge_datasets(args.files, args.output, deduplicate=not args.no_dedupe)

    elif args.command == "add":
        add_to_dataset(args.new_data, args.existing, args.output)

    elif args.command == "from-dir":
        create_from_directory(args.directory, args.output)

    elif args.command == "stats":
        if args.file.endswith(".jsonl"):
            data = load_jsonl(args.file)
        else:
            data = load_json(args.file)

        print(f"Dataset: {args.file}")
        print(f"Total examples: {len(data)}")

        # Count by type (based on system message)
        types = {}
        for item in data:
            messages = item.get("messages", [])
            for msg in messages:
                if msg.get("role") == "system":
                    content = msg.get("content", "")[:50]
                    types[content] = types.get(content, 0) + 1
                    break

        print("\nBy type:")
        for t, count in sorted(types.items(), key=lambda x: -x[1]):
            print(f"  {t}...: {count}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
