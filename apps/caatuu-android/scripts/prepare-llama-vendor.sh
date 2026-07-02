#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
vendor_dir="$repo_root/tools/phone-bench/vendor"
llama_dir="$vendor_dir/llama.cpp"

if [ -d "$llama_dir/examples/llama.android/lib" ]; then
  echo "llama.cpp Android library already exists at $llama_dir"
  exit 0
fi

mkdir -p "$vendor_dir"
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$llama_dir"
echo "llama.cpp Android library is ready at $llama_dir"
