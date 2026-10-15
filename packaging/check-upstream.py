#!/usr/bin/env python3
"""
Detect unpublished apache/kvrocks upstream versions for the auto-release workflow.

Compares upstream git tags (including release candidates, which upstream only
tags but never publishes as GitHub Releases) against this repository's release
tags (``v<version>-<iteration>``). When everything is already published, it
reports ``should_build=false`` so the workflow exits quietly.

Selection: the oldest upstream version newer than everything already published,
with one exception: a repository without any release aligns with the newest
upstream version instead of replaying the full tag history. Historical gaps are
intentionally not backfilled (e.g. an rc skipped while its GA is already out
stays skipped).

Version ordering: triplets compare numerically; a prerelease sorts below its
own GA (``2.17.0-rc1 < 2.17.0-rc2 < 2.17.0``).
"""

import argparse
import os
import re
import subprocess
import sys
from typing import List, Optional, Tuple

UPSTREAM_REPO = "https://github.com/apache/kvrocks.git"

VERSION_CORE = r"[0-9]+\.[0-9]+\.[0-9]+"
PRERELEASE = r"[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*"
UPSTREAM_REF_RE = re.compile(rf"^refs/tags/v({VERSION_CORE}(?:-{PRERELEASE})?)$")
# Release tags append a strictly positive iteration: v<version>-<iteration>.
PUBLISHED_REF_RE = re.compile(rf"^refs/tags/v({VERSION_CORE}(?:-{PRERELEASE})?)-([1-9][0-9]*)$")

# Sort key: (major, minor, patch, ga_flag, prerelease parts); GA sorts after
# any prerelease of the same triplet, prerelease parts order naturally.
SortKey = Tuple[int, int, int, int, List[Tuple[int, object]]]


def split_version(version: str) -> Tuple[Tuple[int, int, int], str]:
    """Split '2.17.0-rc1' into ((2, 17, 0), 'rc1'); a GA version has no prerelease."""
    base, separator, prerelease = version.partition("-")
    return tuple(int(part) for part in base.split(".")), prerelease if separator else ""  # type: ignore[return-value]


def prerelease_key(prerelease: str) -> List[Tuple[int, object]]:
    """Order prerelease identifiers naturally so that rc1 < rc2 < rc10."""
    key: List[Tuple[int, object]] = []
    for chunk in prerelease.split("."):
        for run in re.findall(r"\d+|[A-Za-z]+", chunk):
            key.append((0, int(run)) if run.isdigit() else (1, run))
    return key


def version_key(version: str) -> SortKey:
    """Return a sort key with rc1 < rc2 < GA for the same triplet."""
    (major, minor, patch), prerelease = split_version(version)
    return (major, minor, patch, 1 if not prerelease else 0, prerelease_key(prerelease))


def ref_name(line: str) -> str:
    """Return the ref from a `git ls-remote` line (or the line itself when bare)."""
    parts = line.split()
    return parts[1] if len(parts) > 1 else parts[0]


def parse_upstream_versions(lines: List[str]) -> List[str]:
    """Extract upstream versions; annotated-tag peel lines (`^{}`) never match."""
    return sorted(
        {match.group(1) for line in lines if (match := UPSTREAM_REF_RE.match(ref_name(line)))},
        key=version_key,
    )


def parse_published_versions(lines: List[str]) -> List[str]:
    """Extract versions from this repository's `v<version>-<iteration>` release tags."""
    return sorted(
        {match.group(1) for line in lines if (match := PUBLISHED_REF_RE.match(ref_name(line)))},
        key=version_key,
    )


def select_version(upstream: List[str], published: List[str]) -> Optional[str]:
    """Pick the oldest upstream version newer than everything published (None if none)."""
    if not upstream:
        raise ValueError("no upstream versions found")
    if not published:
        # Fresh repository: align with the newest upstream version instead of
        # replaying the full tag history from the oldest release.
        return max(upstream, key=version_key)
    published_set = set(published)
    newest_published = max(published, key=version_key)
    candidates = [
        version
        for version in upstream
        if version not in published_set and version_key(newest_published) < version_key(version)
    ]
    if not candidates:
        return None
    return min(candidates, key=version_key)


def ls_remote_tags(target: str) -> List[str]:
    """List tag refs of a repository via `git ls-remote` (remote name or URL)."""
    proc = subprocess.run(
        ["git", "ls-remote", "--tags", target],
        check=True,
        capture_output=True,
        text=True,
    )
    return proc.stdout.splitlines()


def write_outputs(outputs: dict) -> None:
    """Append step outputs to $GITHUB_OUTPUT, or print them when run locally."""
    lines = [f"{name}={value}" for name, value in outputs.items()]
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    else:
        print("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--upstream", default=UPSTREAM_REPO, help="upstream repository URL")
    parser.add_argument(
        "--repo", default="origin", help="own repository (remote name or URL) holding releases"
    )
    args = parser.parse_args()

    try:
        upstream = parse_upstream_versions(ls_remote_tags(args.upstream))
    except subprocess.CalledProcessError as exc:
        print(f"::error::Could not list upstream tags in {args.upstream}: {exc}", file=sys.stderr)
        return 1
    if not upstream:
        print(f"::error::No version tags found in {args.upstream}.", file=sys.stderr)
        return 1

    try:
        published = parse_published_versions(ls_remote_tags(args.repo))
    except subprocess.CalledProcessError as exc:
        print(f"::error::Could not list own release tags in {args.repo}: {exc}", file=sys.stderr)
        return 1

    try:
        version = select_version(upstream, published)
    except ValueError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1

    if version is None:
        print("Every upstream version is already published; nothing to build.")
        write_outputs({"should_build": "false", "version": ""})
    else:
        print(f"Auto-detected unpublished upstream version: {version} (iteration 1)")
        write_outputs({"should_build": "true", "version": version})
    return 0


if __name__ == "__main__":
    sys.exit(main())
