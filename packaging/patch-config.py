#!/usr/bin/env python3
"""
Patch Kvrocks configuration file for Linux distribution packaging.
Adjusts FHS paths (dir, log-dir) and daemon settings.
Supports replacing active settings or inserting right below commented directives.
"""

import sys
import re


def patch_directive(file_path: str, key: str, value: str):
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    active_pattern = re.compile(rf"^\s*{re.escape(key)}\s+")
    comment_pattern = re.compile(rf"^\s*#\s*{re.escape(key)}\s+")

    # 1. Look for active (uncommented) directive and replace it
    for i, line in enumerate(lines):
        if active_pattern.match(line):
            lines[i] = f"{key} {value}\n"
            with open(file_path, "w", encoding="utf-8") as f:
                f.writelines(lines)
            return

    # 2. Look for commented directive and insert right below it
    for i, line in enumerate(lines):
        if comment_pattern.match(line):
            lines.insert(i + 1, f"{key} {value}\n")
            with open(file_path, "w", encoding="utf-8") as f:
                f.writelines(lines)
            return

    # 3. If neither found, append at the end
    lines.append(f"\n{key} {value}\n")
    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <path-to-kvrocks.conf>")
        sys.exit(1)

    conf_file = sys.argv[1]

    # Apply standard FHS paths
    patch_directive(conf_file, "dir", "/var/lib/kvrocks")
    patch_directive(conf_file, "log-dir", "/var/log/kvrocks")
    patch_directive(conf_file, "daemonize", "no")

    print(f"Successfully patched {conf_file} with FHS directories.")


if __name__ == "__main__":
    main()
