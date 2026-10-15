#!/usr/bin/env python3
"""
Merge Debian APT `Packages` indexes produced by the release workflow's dpkg-scanpackages.

Stanzas are keyed by the original (Package, Architecture, Version) strings; version validation
belongs to the release workflow. This script is not a general Debian metadata validator.

If the target Packages file does not exist, it is created (first release); if it exists, historical
order and normalized stanza content are preserved, and new versions are appended.
For an existing key, a matching SHA256 is an idempotent retry that keeps the historical stanza;
a different SHA256 is rejected (duplicate/altered version prohibited).
Identity fields and SHA256 must be nonempty and single-line. Basic parsing checks reject duplicate
fields, missing colons and orphaned continuation lines. Empty inputs are rejected. Line endings
and stanza separators are normalized, then output is atomically replaced with 0644 permissions.
The release workflow serializes writers; this script does not provide concurrent-update locking.
"""

import argparse
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

# Package, Architecture, Version (original strings)
Key = Tuple[str, str, str]

KEY_FIELDS = ("package", "architecture", "version")
SINGLE_LINE_FIELDS = {"package", "architecture", "version", "sha256"}


def normalize_content(content: str) -> str:
    """Normalize line endings to standard Unix LF (\\n)."""
    return content.replace("\r\n", "\n").replace("\r", "\n")


def parse_stanzas(content: str) -> List[str]:
    """Split on blank lines, normalizing line endings without stripping field indentation."""
    stanzas: List[str] = []
    lines: List[str] = []
    for line in normalize_content(content).split("\n"):
        if line.strip(" \t"):
            lines.append(line)
        elif lines:
            stanzas.append("\n".join(lines))
            lines = []
    if lines:
        stanzas.append("\n".join(lines))
    return stanzas


def parse_stanza_fields(stanza: str) -> Dict[str, str]:
    """Read first-line field values with basic syntax checks; retain continuations in the stanza."""
    fields: Dict[str, str] = {}
    current_field: Optional[str] = None

    for line in stanza.rstrip("\n").split("\n"):
        if line.startswith((" ", "\t")):
            if current_field is None:
                raise ValueError(f"Orphaned continuation line at beginning of stanza: {line}")
            if current_field in SINGLE_LINE_FIELDS:
                raise ValueError(
                    f"Single-line field '{current_field}' must not contain continuation line: {line}"
                )
            continue

        name, separator, value = line.partition(":")
        if not separator:
            raise ValueError(f"Invalid stanza line without colon: {line}")

        if name != name.rstrip():
            raise ValueError(
                f"Field name '{name}' must not have whitespace before colon: {line}"
            )
        if not name:
            raise ValueError(f"Empty field name in stanza: {line}")

        lower_name = name.lower()
        if lower_name in fields:
            raise ValueError(f"Duplicate field '{name}' in stanza")

        current_field = lower_name
        fields[current_field] = value.strip()

    return fields


def validate_stanza(fields: Dict[str, str], raw_stanza: str) -> Key:
    """Require the identity fields and checksum needed for merging, and return the raw key."""
    missing = [name for name in KEY_FIELDS + ("sha256",) if not fields.get(name)]
    if missing:
        raise ValueError(f"Stanza is missing required field(s) {', '.join(missing)}:\n{raw_stanza}")

    return fields["package"], fields["architecture"], fields["version"]


def extract_stanza_key(stanza: str) -> Key:
    """Return the raw (Package, Architecture, Version) key after checking merge prerequisites."""
    fields = parse_stanza_fields(stanza)
    return validate_stanza(fields, stanza)


def load_index(path: Path) -> Dict[Key, Tuple[str, str]]:
    """Load raw keys into an insertion-ordered mapping of (stanza, SHA256)."""
    stanzas: Dict[Key, Tuple[str, str]] = {}

    content = path.read_text(encoding="utf-8")
    for stanza in parse_stanzas(content):
        fields = parse_stanza_fields(stanza)
        key = validate_stanza(fields, stanza)
        if key in stanzas:
            raise ValueError(f"Duplicate stanza {key} in {path}")
        stanzas[key] = stanza, fields["sha256"].lower()

    return stanzas


def merge_packages(
    new_file: Union[str, Path],
    target_file: Union[str, Path],
) -> None:
    """
    Append stanzas of `new_file` to `target_file`.
    If `target_file` exists, historical stanzas are preserved and new versions are appended.
    If `target_file` does not exist, it is initialized from `new_file`.
    """
    target = Path(target_file)
    if target.exists():
        merged_stanzas = load_index(target)
        if not merged_stanzas:
            raise ValueError(f"Existing Packages file '{target}' contains no package stanzas")
    else:
        merged_stanzas = {}

    new_stanzas = load_index(Path(new_file))
    if not new_stanzas:
        raise ValueError(f"{new_file} contains no package stanzas")

    added_count = 0
    skipped_count = 0

    for key, (stanza, sha256) in new_stanzas.items():
        if key in merged_stanzas:
            if merged_stanzas[key][1] == sha256:
                skipped_count += 1
                continue
            raise ValueError(
                f"Refusing to overwrite already indexed package version: {key} (SHA256 differs)"
            )

        merged_stanzas[key] = stanza, sha256
        added_count += 1

    content = "\n\n".join(stanza for stanza, _ in merged_stanzas.values()) + "\n"

    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    try:
        temp.write_text(content, encoding="utf-8")
        temp.chmod(0o644)
        temp.replace(target)
    except Exception:
        temp.unlink(missing_ok=True)
        raise

    print(
        f"Merged {added_count} new stanza(s) "
        f"({skipped_count} identical skipped) "
        f"into {len(merged_stanzas) - added_count} existing ones: {target}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("new", help="Packages file containing the newly built packages")
    parser.add_argument("target", help="target Packages file to create or append to")
    args = parser.parse_args()

    merge_packages(args.new, args.target)


if __name__ == "__main__":
    main()
