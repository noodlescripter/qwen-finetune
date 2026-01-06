"""
Codebase indexer - stores and searches your code files.
"""
import os
import json
import glob
from pathlib import Path


class CodebaseIndex:
    """Simple codebase index for searching and retrieving code."""

    def __init__(self, data_dir: str = "./data"):
        self.data_dir = data_dir
        self.files: dict[str, dict] = {}  # filename -> {path, content, summary}
        self.index_path = "./codebase_index.json"

    def index_codebase(self, extensions: list[str] = None) -> int:
        """Index all code files in the data directory."""
        if extensions is None:
            extensions = [".py", ".js", ".ts", ".java", ".cpp", ".c", ".go", ".rs", ".rb"]

        self.files = {}
        code_files = []

        for ext in extensions:
            pattern = os.path.join(self.data_dir, "**", f"*{ext}")
            code_files.extend(glob.glob(pattern, recursive=True))

        for file_path in code_files:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

                if content.strip():
                    filename = os.path.basename(file_path)
                    rel_path = os.path.relpath(file_path, self.data_dir)

                    # Extract first docstring/comment as summary
                    summary = self._extract_summary(content, file_path)

                    self.files[filename] = {
                        "path": rel_path,
                        "full_path": file_path,
                        "content": content,
                        "summary": summary,
                        "lines": len(content.splitlines()),
                    }
            except Exception as e:
                print(f"Error reading {file_path}: {e}")

        self.save_index()
        print(f"Indexed {len(self.files)} files")
        return len(self.files)

    def _extract_summary(self, content: str, file_path: str) -> str:
        """Extract summary from docstring or first comment."""
        lines = content.strip().splitlines()

        # Python docstring
        if file_path.endswith(".py"):
            if '"""' in content[:500]:
                start = content.find('"""') + 3
                end = content.find('"""', start)
                if end > start:
                    return content[start:end].strip()[:200]

        # JS/TS block comment
        if file_path.endswith((".js", ".ts")):
            if "/**" in content[:500]:
                start = content.find("/**") + 3
                end = content.find("*/", start)
                if end > start:
                    summary = content[start:end].replace("*", "").strip()
                    return summary[:200]

        # First comment line
        for line in lines[:10]:
            line = line.strip()
            if line.startswith("#") and not line.startswith("#!"):
                return line[1:].strip()[:200]
            if line.startswith("//"):
                return line[2:].strip()[:200]

        return ""

    def save_index(self):
        """Save index to JSON file."""
        # Save without full content for smaller file
        index_data = {}
        for name, data in self.files.items():
            index_data[name] = {
                "path": data["path"],
                "summary": data["summary"],
                "lines": data["lines"],
            }

        with open(self.index_path, "w") as f:
            json.dump(index_data, f, indent=2)

    def load_index(self):
        """Load index and re-read file contents."""
        if os.path.exists(self.index_path):
            with open(self.index_path, "r") as f:
                index_data = json.load(f)

            for name, data in index_data.items():
                full_path = os.path.join(self.data_dir, data["path"])
                if os.path.exists(full_path):
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                    self.files[name] = {
                        "path": data["path"],
                        "full_path": full_path,
                        "content": content,
                        "summary": data["summary"],
                        "lines": data["lines"],
                    }

    def search(self, query: str, limit: int = 3) -> list[dict]:
        """Search for relevant files based on query."""
        query_lower = query.lower()
        results = []

        for filename, data in self.files.items():
            score = 0

            # Exact filename match
            if query_lower in filename.lower():
                score += 10

            # Check summary
            if data["summary"] and query_lower in data["summary"].lower():
                score += 5

            # Check content for keywords
            content_lower = data["content"].lower()
            query_words = query_lower.split()
            for word in query_words:
                if len(word) > 2 and word in content_lower:
                    score += content_lower.count(word)

            if score > 0:
                results.append({
                    "filename": filename,
                    "path": data["path"],
                    "summary": data["summary"],
                    "content": data["content"],
                    "score": score,
                })

        # Sort by score descending
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def get_file(self, filename: str) -> dict | None:
        """Get a specific file by name."""
        # Exact match
        if filename in self.files:
            return self.files[filename]

        # Partial match
        for name, data in self.files.items():
            if filename.lower() in name.lower():
                return {**data, "filename": name}

        return None

    def list_files(self) -> list[dict]:
        """List all indexed files."""
        return [
            {"filename": name, "path": data["path"], "summary": data["summary"], "lines": data["lines"]}
            for name, data in self.files.items()
        ]


# Global instance
codebase = CodebaseIndex()


if __name__ == "__main__":
    # Index the codebase
    codebase.index_codebase()

    print("\nIndexed files:")
    for f in codebase.list_files():
        print(f"  - {f['filename']}: {f['summary'][:50]}...")
