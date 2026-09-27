#!/usr/bin/env python3
"""
Patch Kvrocks configuration file for Linux distribution packaging.
Adjusts FHS paths (dir, log-dir) and daemon settings in a single atomic pass.
Supports replacing active settings, inserting right below commented directives,
or appending if missing.
"""

import os
import re
import sys
import tempfile
from typing import Dict, List


def patch_lines(lines: List[str], key: str, value: str) -> List[str]:
    """Patch a single directive in a list of configuration lines."""
    active_pattern = re.compile(rf"^\s*{re.escape(key)}\s+")
    comment_pattern = re.compile(rf"^\s*#+\s*{re.escape(key)}\s+")

    # 1. Look for active (uncommented) directive and replace it
    for i, line in enumerate(lines):
        if active_pattern.match(line):
            lines[i] = f"{key} {value}\n"
            return lines

    # 2. Look for commented directive and insert right below it
    for i, line in enumerate(lines):
        if comment_pattern.match(line):
            lines.insert(i + 1, f"{key} {value}\n")
            return lines

    # 3. If neither found, append at the end
    lines.append(f"\n{key} {value}\n")
    return lines


def patch_config(file_path: str, directives: Dict[str, str]) -> None:
    """Atomically patch multiple directives in the configuration file."""
    if not os.path.isfile(file_path):
        print(f"Error: Configuration file not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    for key, value in directives.items():
        lines = patch_lines(lines, key, value)

    dir_name = os.path.dirname(os.path.abspath(file_path))
    with tempfile.NamedTemporaryFile("w", dir=dir_name, encoding="utf-8", delete=False) as tf:
        tf.writelines(lines)
        temp_name = tf.name

    os.replace(temp_name, file_path)


def patch_directive(file_path: str, key: str, value: str) -> None:
    """Backwards-compatible wrapper to patch a single directive."""
    patch_config(file_path, {key: value})


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <path-to-kvrocks.conf>", file=sys.stderr)
        sys.exit(1)

    conf_file = sys.argv[1]

    # Apply standard FHS paths and systemd supervision
    patches = {
        "dir": "/var/lib/kvrocks",
        "log-dir": "/var/log/kvrocks",
        "daemonize": "no",
        "supervised": "systemd",
    }

    patch_config(conf_file, patches)
    print(f"Successfully patched {conf_file} with FHS directories and systemd supervision.")


if __name__ == "__main__":
    main()
