#!/usr/bin/env python3
"""
Merge Debian APT `Packages` indexes produced by dpkg-scanpackages.

Stanzas are keyed by (Package, Architecture, Version). If the target Packages file does not exist,
it is created; if it exists, historical stanzas and their order are preserved and new versions are
appended. An existing key with an identical SHA256 is skipped idempotently; a different SHA256 is
rejected so a published package version can never be silently altered.
"""

import argparse
import re
from pathlib import Path
from typing import Dict, List, Tuple, Union

Key = Tuple[str, str, str]

KEY_FIELDS = ("package", "architecture", "version")
REQUIRED_FIELDS = (*KEY_FIELDS, "sha256")


def parse_stanzas(content: str) -> List[str]:
    """Split a Packages index into its RFC 822 stanzas (separated by blank lines)."""
    return [stanza.strip() for stanza in re.split(r"\n\s*\n", content) if stanza.strip()]


def parse_stanza_fields(stanza: str) -> Dict[str, str]:
    """Extract first-line field values from a stanza, ignoring multiline continuations."""
    fields: Dict[str, str] = {}
    for line in stanza.splitlines():
        if line.startswith((" ", "\t")):
            continue
        name, separator, value = line.partition(":")
        if separator:
            fields.setdefault(name.strip().lower(), value.strip())
    return fields


def extract_stanza_key(stanza: str) -> Key:
    """Return the (Package, Architecture, Version) key of a stanza."""
    fields = parse_stanza_fields(stanza)
    missing = [name for name in REQUIRED_FIELDS if not fields.get(name)]
    if missing:
        raise ValueError(f"Stanza is missing required field(s) {', '.join(missing)}:\n{stanza}")
    return fields["package"], fields["architecture"], fields["version"]


def load_index(path: Path) -> Dict[Key, Tuple[str, str]]:
    """Load a Packages file into an insertion-ordered {key: (stanza, sha256)} mapping."""
    stanzas: Dict[Key, Tuple[str, str]] = {}
    for stanza in parse_stanzas(path.read_text(encoding="utf-8")):
        fields = parse_stanza_fields(stanza)
        missing = [name for name in REQUIRED_FIELDS if not fields.get(name)]
        if missing:
            raise ValueError(f"Stanza is missing required field(s) {', '.join(missing)}:\n{stanza}")
        key = (fields["package"], fields["architecture"], fields["version"])
        if key in stanzas:
            raise ValueError(f"Duplicate stanza {key} in {path}")
        stanzas[key] = (stanza, fields["sha256"].lower())
    return stanzas


def merge_packages(
    new_file: Union[str, Path],
    target_file: Union[str, Path],
) -> None:
    """Append stanzas of `new_file` to `target_file`, preserving historical entries."""
    target = Path(target_file)
    if target.exists():
        merged = load_index(target)
        if not merged:
            raise ValueError(f"Existing Packages file '{target}' contains no package stanzas")
    else:
        merged = {}

    new = load_index(Path(new_file))
    if not new:
        raise ValueError(f"{new_file} contains no package stanzas")

    added = 0
    skipped = 0
    for key, (stanza, sha256) in new.items():
        if key in merged:
            if merged[key][1] == sha256:
                skipped += 1
                continue
            raise ValueError(
                f"Refusing to overwrite already indexed package version: {key} (SHA256 differs)"
            )
        merged[key] = (stanza, sha256)
        added += 1

    content = "\n\n".join(stanza for stanza, _ in merged.values()) + "\n"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")

    print(
        f"Merged {added} new stanza(s) ({skipped} identical skipped) "
        f"into {len(merged) - added} existing ones: {target}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("new", help="Packages file containing the newly built packages")
    parser.add_argument("target", help="target Packages file to create or append to")
    args = parser.parse_args()

    merge_packages(args.new, args.target)


if __name__ == "__main__":
    main()
