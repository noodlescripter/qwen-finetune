"""
Error parser - extracts file locations from error stack traces and fetches code.
"""
import re
import os
import json
from dataclasses import dataclass
from typing import Optional


@dataclass
class ErrorLocation:
    """Represents a location in a file where an error occurred."""
    file_path: str
    line_number: int
    column: Optional[int] = None
    code_snippet: Optional[str] = None
    context_before: list[str] = None
    context_after: list[str] = None


@dataclass
class ParsedError:
    """Parsed error with all extracted information."""
    title: str
    state: str
    error_message: str
    full_error: str
    locations: list[ErrorLocation]


class ErrorParser:
    """Parses error JSON and extracts code locations."""

    # Common patterns for file:line:column in stack traces
    LOCATION_PATTERNS = [
        # JavaScript/TypeScript: at functionName (file.js:10:5)
        r'at\s+(?:[\w.<>]+\s+)?\(?([^\s():]+):(\d+):(\d+)\)?',
        # Python: File "path/file.py", line 10
        r'File\s+"([^"]+)",\s+line\s+(\d+)',
        # Generic: file.js:10:5 or file.py:10
        r'([^\s:()]+\.[a-zA-Z]{1,4}):(\d+)(?::(\d+))?',
        # Windows paths: C:\path\file.js:10:5
        r'([A-Za-z]:\\[^\s:]+):(\d+)(?::(\d+))?',
    ]

    def __init__(self, base_path: str = "./"):
        self.base_path = base_path

    def parse_json_file(self, json_path: str) -> list[ParsedError]:
        """Parse a JSON file containing test results."""
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if isinstance(data, dict):
            data = [data]

        return [self._parse_error_entry(entry) for entry in data]

    def parse_json_data(self, data: list[dict]) -> list[ParsedError]:
        """Parse JSON data directly."""
        if isinstance(data, dict):
            data = [data]
        return [self._parse_error_entry(entry) for entry in data]

    def _parse_error_entry(self, entry: dict) -> ParsedError:
        """Parse a single error entry."""
        title = entry.get('title', 'Unknown test')
        state = entry.get('state', 'unknown')
        error_message = entry.get('error', '')
        full_error = entry.get('fullError', '') or entry.get('complete_error', '')

        # Extract all file locations from the error
        locations = self._extract_locations(full_error)

        # Also check complete_error if available
        if entry.get('complete_error'):
            locations.extend(self._extract_locations(entry['complete_error']))

        # Remove duplicates
        seen = set()
        unique_locations = []
        for loc in locations:
            key = (loc.file_path, loc.line_number)
            if key not in seen:
                seen.add(key)
                unique_locations.append(loc)

        return ParsedError(
            title=title,
            state=state,
            error_message=error_message,
            full_error=full_error,
            locations=unique_locations
        )

    def _extract_locations(self, error_text: str) -> list[ErrorLocation]:
        """Extract file locations from error text."""
        locations = []

        for pattern in self.LOCATION_PATTERNS:
            matches = re.finditer(pattern, error_text)
            for match in matches:
                groups = match.groups()
                file_path = groups[0]
                line_number = int(groups[1])
                column = int(groups[2]) if len(groups) > 2 and groups[2] else None

                # Try to resolve the file path
                resolved_path = self._resolve_path(file_path)

                location = ErrorLocation(
                    file_path=resolved_path or file_path,
                    line_number=line_number,
                    column=column
                )

                # Try to get code snippet
                if resolved_path and os.path.exists(resolved_path):
                    self._attach_code_snippet(location, resolved_path)

                locations.append(location)

        return locations

    def _resolve_path(self, file_path: str) -> Optional[str]:
        """Try to resolve a file path to an actual file."""
        # Check if absolute path exists
        if os.path.isabs(file_path) and os.path.exists(file_path):
            return file_path

        # Try relative to base path
        relative_path = os.path.join(self.base_path, file_path)
        if os.path.exists(relative_path):
            return relative_path

        # Try to find file by name in base path
        filename = os.path.basename(file_path)
        for root, dirs, files in os.walk(self.base_path):
            if filename in files:
                return os.path.join(root, filename)

        # Try data directory
        data_path = os.path.join("./data", file_path)
        if os.path.exists(data_path):
            return data_path

        return None

    def _attach_code_snippet(self, location: ErrorLocation, file_path: str, context_lines: int = 5):
        """Attach code snippet to the location."""
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()

            line_idx = location.line_number - 1  # Convert to 0-indexed

            if 0 <= line_idx < len(lines):
                # Get the error line
                location.code_snippet = lines[line_idx].rstrip()

                # Get context before
                start_idx = max(0, line_idx - context_lines)
                location.context_before = [l.rstrip() for l in lines[start_idx:line_idx]]

                # Get context after
                end_idx = min(len(lines), line_idx + context_lines + 1)
                location.context_after = [l.rstrip() for l in lines[line_idx + 1:end_idx]]

        except Exception as e:
            print(f"Error reading {file_path}: {e}")

    def format_for_ai(self, parsed_error: ParsedError) -> str:
        """Format parsed error for AI consumption."""
        output = []
        output.append(f"Test: {parsed_error.title}")
        output.append(f"Status: {parsed_error.state}")
        output.append(f"Error: {parsed_error.error_message}")
        output.append("")

        if parsed_error.locations:
            output.append("Error locations found:")
            for i, loc in enumerate(parsed_error.locations, 1):
                output.append(f"\n--- Location {i}: {loc.file_path}:{loc.line_number} ---")

                if loc.context_before:
                    for j, line in enumerate(loc.context_before):
                        line_num = loc.line_number - len(loc.context_before) + j
                        output.append(f"  {line_num}: {line}")

                if loc.code_snippet:
                    output.append(f"→ {loc.line_number}: {loc.code_snippet}  ← ERROR HERE")

                if loc.context_after:
                    for j, line in enumerate(loc.context_after):
                        line_num = loc.line_number + j + 1
                        output.append(f"  {line_num}: {line}")
        else:
            output.append("Could not locate source files.")
            output.append(f"Full error: {parsed_error.full_error}")

        return "\n".join(output)


# Global instance
error_parser = ErrorParser()


if __name__ == "__main__":
    # Test with json_result.json
    import sys

    json_file = sys.argv[1] if len(sys.argv) > 1 else "json_result.json"

    if os.path.exists(json_file):
        parser = ErrorParser(base_path="./data")
        errors = parser.parse_json_file(json_file)

        for error in errors:
            print("=" * 50)
            print(parser.format_for_ai(error))
    else:
        print(f"File not found: {json_file}")
