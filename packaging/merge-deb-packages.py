#!/usr/bin/env python3
"""
Merge Debian APT `Packages` index files in an append-only fashion.

Stanzas are keyed by (Package, Architecture, Version). Historical stanzas are kept untouched and the
new ones are added. Anything suspicious (malformed stanzas, a version that is already indexed) is an
error: a published version must never be silently altered or dropped from the index.
"""

import argparse
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

Key = Tuple[str, str, str]

KEY_FIELDS = ("package", "architecture", "version")


def parse_stanzas(content: str) -> List[str]:
    """Split a Packages index into its RFC 822 stanzas (separated by blank lines)."""
    return [stanza.strip() for stanza in re.split(r"\n\s*\n", content) if stanza.strip()]


def extract_stanza_key(stanza: str) -> Key:
    """Return the (Package, Architecture, Version) key of a stanza; raise ValueError if it is incomplete."""
    fields: Dict[str, str] = {}
    for line in stanza.splitlines():
        if line.startswith((" ", "\t")):  # continuation of the previous field
            continue
        name, separator, value = line.partition(":")
        if separator:
            fields.setdefault(name.strip().lower(), value.strip())

    missing = [name for name in KEY_FIELDS if not fields.get(name)]
    if missing:
        raise ValueError(f"Stanza is missing required field(s) {', '.join(missing)}:\n{stanza}")
    return fields["package"], fields["architecture"], fields["version"]


def load_index(path: Path) -> Dict[Key, str]:
    """Load a Packages file into a {key: stanza} mapping."""
    index: Dict[Key, str] = {}
    for stanza in parse_stanzas(path.read_text(encoding="utf-8")):
        key = extract_stanza_key(stanza)
        if key in index:
            raise ValueError(f"Duplicate stanza {key} in {path}")
        index[key] = stanza
    return index


def merge_packages(
    old_file: Optional[Union[str, Path]],
    new_file: Union[str, Path],
    output_file: Union[str, Path],
) -> None:
    """Append the stanzas of `new_file` to those of `old_file` (if any) and write `output_file`."""
    merged = load_index(Path(old_file)) if old_file else {}

    new = load_index(Path(new_file))
    if not new:
        raise ValueError(f"{new_file} contains no package stanzas")

    already_indexed = sorted(merged.keys() & new.keys())
    if already_indexed:
        raise ValueError(f"Refusing to overwrite already indexed package version(s): {already_indexed}")
    merged.update(new)

    content = "\n\n".join(merged[key] for key in sorted(merged)) + "\n"

    output = Path(output_file)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(output.name + ".tmp")
    temp.write_text(content, encoding="utf-8")
    temp.chmod(0o644)
    temp.replace(output)

    print(f"Merged {len(new)} new stanza(s) into {len(merged) - len(new)} existing ones: {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--old", help="existing Packages file to append to (omit for the first release)")
    parser.add_argument("new", help="Packages file containing the newly built packages")
    parser.add_argument("output", help="merged Packages file to write (may be the same as --old)")
    args = parser.parse_args()

    merge_packages(args.old, args.new, args.output)


if __name__ == "__main__":
    main()
