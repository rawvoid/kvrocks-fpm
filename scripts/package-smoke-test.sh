#!/usr/bin/env bash
#
# Copyright 2026 Rawvoid(https://github.com/rawvoid)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 VERSION ITERATION" >&2
    exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required to run package lifecycle smoke tests" >&2
    exit 1
fi

version="$1"
iteration="$2"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "${root_dir}/dist" ] || [ ! -d "${root_dir}/test-baseline" ]; then
    echo "Missing dist/ or test-baseline/ directory. Build packages before running smoke tests." >&2
    exit 1
fi

run_container() {
    local image="$1"
    local mode="$2"
    echo "=== Package lifecycle smoke test: ${image} (${mode}) ==="
    timeout 900 docker run --rm \
        -v "${root_dir}/dist:/dist:ro" \
        -v "${root_dir}/test-baseline:/test-baseline:ro" \
        -v "${root_dir}/scripts/package-smoke-container.sh:/package-smoke-container.sh:ro" \
        "$image" bash /package-smoke-container.sh "$mode" "$version" "$iteration"
}

run_container ubuntu:22.04 deb
run_container debian:13 deb
# Keep the newest supported release pinned; bump it before the tagged release reaches EOL.
run_container fedora:45 rpm
