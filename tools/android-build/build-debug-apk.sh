#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=versions.env
source "$repo_root/tools/android-build/versions.env"

if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is not on PATH. Run: bash tools/android-build/setup-sdk.sh" >&2
  exit 1
fi

bash "$repo_root/apps/caatuu-android/scripts/prepare-llama-vendor.sh"

cd "$repo_root/apps/caatuu-android"
gradle --no-daemon :app:assembleDebug

mkdir -p "$repo_root/artifacts/android"
cp app/build/outputs/apk/debug/app-debug.apk "$repo_root/artifacts/android/caatuu-debug.apk"
echo "Wrote $repo_root/artifacts/android/caatuu-debug.apk"
