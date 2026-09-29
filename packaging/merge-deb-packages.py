#!/usr/bin/env python3
"""
Merge Debian APT `Packages` index files while preserving historical versions.
Parses RFC 822 stanzas, deduplicating by (Package, Architecture, Version) key,
overwriting duplicates with new entries, and appending new versions.
"""

import os
import sys
import tempfile
from typing import Dict, List, Optional, Tuple


def parse_stanzas(content: str) -> List[str]:
    """Parse raw Packages content into individual RFC 822 stanzas."""
    stanzas: List[str] = []
    current_lines: List[str] = []

    for raw_line in content.splitlines(keepends=True):
        line = raw_line.rstrip("\r\n")
        if not line.strip():
            if current_lines:
                stanzas.append("".join(current_lines).strip())
                current_lines = []
        else:
            current_lines.append(raw_line)

    if current_lines:
        stanzas.append("".join(current_lines).strip())

    return stanzas


def extract_stanza_key(stanza: str) -> Optional[Tuple[str, str, str]]:
    """Extract (Package, Architecture, Version) tuple from a stanza."""
    pkg = None
    arch = None
    ver = None

    for line in stanza.splitlines():
        if line.startswith("Package:"):
            pkg = line.split(":", 1)[1].strip()
        elif line.startswith("Architecture:"):
            arch = line.split(":", 1)[1].strip()
        elif line.startswith("Version:"):
            ver = line.split(":", 1)[1].strip()

    if pkg and arch and ver:
        return (pkg, arch, ver)
    return None


def merge_packages(old_file: Optional[str], new_file: str, output_file: str) -> None:
    """Merge old and new Packages files into output_file atomically."""
    merged: Dict[Tuple[str, str, str], str] = {}

    # 1. Load existing stanzas if old_file exists and is readable
    if old_file:
        if not os.path.isfile(old_file):
            raise FileNotFoundError(f"Existing packages file specified but not found: {old_file}")
        with open(old_file, "r", encoding="utf-8", errors="replace") as f:
            old_stanzas = parse_stanzas(f.read())
        for stanza in old_stanzas:
            key = extract_stanza_key(stanza)
            if key:
                merged[key] = stanza

    # 2. Load and overlay new stanzas (must exist and contain valid stanzas)
    if not os.path.isfile(new_file):
        raise FileNotFoundError(f"New packages file not found: {new_file}")

    with open(new_file, "r", encoding="utf-8", errors="replace") as f:
        new_stanzas = parse_stanzas(f.read())

    if not new_stanzas:
        raise ValueError(f"New packages file {new_file} contains no package stanzas")

    for stanza in new_stanzas:
        key = extract_stanza_key(stanza)
        if not key:
            raise ValueError(f"Failed to extract (Package, Architecture, Version) key from stanza in {new_file}:\n{stanza}")
        merged[key] = stanza

    # 3. Format output
    output_lines = []
    for stanza in merged.values():
        output_lines.append(stanza)

    out_content = "\n\n".join(output_lines)
    if out_content:
        out_content += "\n"

    # 4. Atomic write with cleanup on error
    out_dir = os.path.dirname(os.path.abspath(output_file))
    os.makedirs(out_dir, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=out_dir, encoding="utf-8", delete=False) as tf:
            tf.write(out_content)
            temp_name = tf.name
        os.replace(temp_name, output_file)
    except Exception:
        if temp_name and os.path.exists(temp_name):
            try:
                os.unlink(temp_name)
            except OSError:
                pass
        raise

    print(f"Successfully merged {len(merged)} package stanza(s) into {output_file}")


def main() -> None:
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} <old-Packages-file|none> <new-Packages-file> <output-Packages-file>", file=sys.stderr)
        sys.exit(1)

    old_path = sys.argv[1]
    new_path = sys.argv[2]
    out_path = sys.argv[3]

    if old_path.lower() in ("none", "", "null", "-"):
        old_file = None
    else:
        old_file = old_path

    merge_packages(old_file, new_path, out_path)


if __name__ == "__main__":
    main()
