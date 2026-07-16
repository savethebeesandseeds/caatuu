#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
# shellcheck source=../../../tools/android-build/versions.env
source "$repo_root/tools/android-build/versions.env"
vendor_dir="$repo_root/tools/phone-bench/vendor"
llama_dir="$vendor_dir/llama.cpp"
llama_remote="https://github.com/ggml-org/llama.cpp.git"
android_min_sdk="${CAATUU_ANDROID_MIN_SDK:-30}"
android_abis_raw="${CAATUU_ANDROID_ABIS:-arm64-v8a}"
patch_file="$repo_root/apps/caatuu-android/patches/llama-android-thinking.patch"

IFS=',' read -r -a android_abis <<< "$android_abis_raw"
abi_list=""
for abi in "${android_abis[@]}"; do
  abi="${abi//[[:space:]]/}"
  case "$abi" in
    arm64-v8a|armeabi-v7a|x86|x86_64) ;;
    *)
      echo "Unsupported Android ABI in CAATUU_ANDROID_ABIS: ${abi:-<empty>}" >&2
      exit 1
      ;;
  esac
  if [ -n "$abi_list" ]; then
    abi_list+=", "
  fi
  abi_list+="\"$abi\""
done

if [[ ! "$LLAMA_CPP_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "LLAMA_CPP_COMMIT must be a full 40-character lowercase Git commit hash." >&2
  exit 1
fi

if [ -e "$llama_dir" ] && [ ! -d "$llama_dir/.git" ]; then
  echo "Existing llama.cpp vendor path is not a Git checkout: $llama_dir" >&2
  exit 1
fi

if [ ! -d "$llama_dir/.git" ]; then
  mkdir -p "$vendor_dir"
  git init "$llama_dir"
fi

# Windows-mounted worktrees do not preserve executable bits consistently. Ignore
# those metadata-only changes when deciding whether it is safe to change commits.
git -C "$llama_dir" config core.fileMode false

current_commit="$(git -C "$llama_dir" rev-parse --verify HEAD 2>/dev/null || true)"
if [ "$current_commit" != "$LLAMA_CPP_COMMIT" ]; then
  if [ -n "$current_commit" ] && [ -n "$(git -C "$llama_dir" status --porcelain --untracked-files=normal)" ]; then
    echo "Refusing to replace dirty llama.cpp checkout at $current_commit; expected $LLAMA_CPP_COMMIT." >&2
    echo "Preserve or remove the local changes, then run this script again." >&2
    exit 1
  fi

  git -C "$llama_dir" fetch --depth 1 "$llama_remote" "$LLAMA_CPP_COMMIT"
  fetched_commit="$(git -C "$llama_dir" rev-parse FETCH_HEAD)"
  if [ "$fetched_commit" != "$LLAMA_CPP_COMMIT" ]; then
    echo "Fetched llama.cpp commit $fetched_commit, expected $LLAMA_CPP_COMMIT." >&2
    exit 1
  fi
  git -C "$llama_dir" checkout --detach FETCH_HEAD
fi

current_commit="$(git -C "$llama_dir" rev-parse HEAD)"
if [ "$current_commit" != "$LLAMA_CPP_COMMIT" ]; then
  echo "llama.cpp checkout verification failed: got $current_commit, expected $LLAMA_CPP_COMMIT." >&2
  exit 1
fi
echo "llama.cpp is pinned at $LLAMA_CPP_COMMIT"

if [ ! -d "$llama_dir/examples/llama.android/lib" ]; then
  echo "Pinned llama.cpp checkout does not contain the Android library: $llama_dir" >&2
  exit 1
fi

lib_gradle="$llama_dir/examples/llama.android/lib/build.gradle.kts"
if [ -f "$lib_gradle" ]; then
  if ! grep -Eq "minSdk = $android_min_sdk([[:space:]]|$)" "$lib_gradle"; then
    sed -i -E "s/minSdk = [0-9]+/minSdk = $android_min_sdk/" "$lib_gradle"
  fi
  if ! grep -Fq "abiFilters += listOf($abi_list)" "$lib_gradle"; then
    sed -i -E "s/abiFilters[[:space:]]*\+=[[:space:]]*listOf\([^)]*\)/abiFilters += listOf($abi_list)/" "$lib_gradle"
  fi
  grep -Fq "abiFilters += listOf($abi_list)" "$lib_gradle" || {
    echo "Could not configure llama.cpp Android ABI filters." >&2
    exit 1
  }
  echo "llama.cpp Android library minSdk set to $android_min_sdk"
  echo "llama.cpp Android library ABIs set to $android_abis_raw"
fi

if [ -f "$patch_file" ]; then
  if git -C "$llama_dir" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
    echo "llama.cpp Android thinking patch already applied"
  elif git -C "$llama_dir" apply --check "$patch_file" >/dev/null 2>&1; then
    git -C "$llama_dir" apply "$patch_file"
    echo "llama.cpp Android thinking patch applied"
  else
    echo "llama.cpp Android thinking patch neither applies cleanly nor matches the current checkout." >&2
    exit 1
  fi
fi

if [ "$(git -C "$llama_dir" rev-parse HEAD)" != "$LLAMA_CPP_COMMIT" ]; then
  echo "llama.cpp HEAD changed while applying the Android overlay." >&2
  exit 1
fi
