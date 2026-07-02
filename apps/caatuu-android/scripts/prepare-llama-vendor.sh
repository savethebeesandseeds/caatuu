#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
vendor_dir="$repo_root/tools/phone-bench/vendor"
llama_dir="$vendor_dir/llama.cpp"
android_min_sdk="${CAATUU_ANDROID_MIN_SDK:-30}"
patch_file="$repo_root/apps/caatuu-android/patches/llama-android-thinking.patch"

if [ -d "$llama_dir/examples/llama.android/lib" ]; then
  echo "llama.cpp Android library already exists at $llama_dir"
else
  mkdir -p "$vendor_dir"
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$llama_dir"
  echo "llama.cpp Android library is ready at $llama_dir"
fi

lib_gradle="$llama_dir/examples/llama.android/lib/build.gradle.kts"
if [ -f "$lib_gradle" ]; then
  sed -i -E "s/minSdk = [0-9]+/minSdk = $android_min_sdk/" "$lib_gradle"
  echo "llama.cpp Android library minSdk set to $android_min_sdk"
fi

if [ -f "$patch_file" ]; then
  if git -C "$llama_dir" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
    echo "llama.cpp Android thinking patch already applied"
  else
    git -C "$llama_dir" apply "$patch_file"
    echo "llama.cpp Android thinking patch applied"
  fi
fi
