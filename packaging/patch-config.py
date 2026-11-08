#!/usr/bin/env python3
"""
Patch Kvrocks configuration file for Linux distribution packaging.
Adjusts FHS paths (dir, log-dir) and daemon settings in a single atomic pass.
Replaces active settings or inserts right below commented-out directives. Every
patched directive must already exist in the upstream configuration: appending a
missing one would ship a setting the target Kvrocks version may not understand,
so the run aborts instead.
"""

import os
import re
import sys
import tempfile
from typing import Dict, List, Optional


def patch_lines(lines: List[str], key: str, value: str) -> Optional[List[str]]:
    """Patch a single directive in a list of configuration lines.

    Returns the patched lines, or None when the configuration carries no such
    directive in either form.
    """
    active_pattern = re.compile(rf"^\s*{re.escape(key)}\s+")
    # A commented-out directive is a whole "key value" line that only needs to be
    # uncommented to become valid configuration. Lines that merely mention the key
    # inside a comment sentence or a values list do not qualify.
    commented_pattern = re.compile(rf"^\s*#+\s*{re.escape(key)}\s+\S+\s*$")

    # 1. Look for active (uncommented) directive and replace it
    for i, line in enumerate(lines):
        if active_pattern.match(line):
            lines[i] = f"{key} {value}\n"
            return lines

    # 2. Look for commented-out directive and insert right below it
    for i, line in enumerate(lines):
        if commented_pattern.match(line):
            lines.insert(i + 1, f"{key} {value}\n")
            return lines

    return None


def patch_config(file_path: str, directives: Dict[str, str]) -> None:
    """Atomically patch multiple directives in the configuration file."""
    if not os.path.isfile(file_path):
        print(f"Error: Configuration file not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    missing: List[str] = []
    for key, value in directives.items():
        patched = patch_lines(lines, key, value)
        if patched is None:
            missing.append(key)
        else:
            lines = patched

    if missing:
        print(f"Error: missing required directives in {file_path}:", file=sys.stderr)
        for key in missing:
            print(f"  - {key}", file=sys.stderr)
        print(
            "Patch aborted: the packaging contract requires every patched directive to "
            "exist in the upstream default configuration, active or commented out. "
            "A Kvrocks release that dropped or renamed one of them is not supported.",
            file=sys.stderr,
        )
        sys.exit(1)

    dir_name = os.path.dirname(os.path.abspath(file_path))
    with tempfile.NamedTemporaryFile("w", dir=dir_name, encoding="utf-8", delete=False) as tf:
        tf.writelines(lines)
        temp_name = tf.name

    os.replace(temp_name, file_path)


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <path-to-kvrocks.conf>", file=sys.stderr)
        sys.exit(1)

    conf_file = sys.argv[1]

    # Apply standard FHS paths, systemd supervision and native log retention
    patches = {
        "dir": "/var/lib/kvrocks",
        "log-dir": "/var/log/kvrocks",
        "log-retention-days": "30",
        "daemonize": "no",
        "supervised": "systemd",
    }

    patch_config(conf_file, patches)
    print(f"Successfully patched {conf_file} with FHS directories and systemd supervision.")


if __name__ == "__main__":
    main()
