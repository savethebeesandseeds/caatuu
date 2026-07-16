#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export CAATUU_ANDROID_UPDATE_BASE_URL="${CAATUU_ANDROID_UPDATE_BASE_URL:-https://caatuu.waajacu.com/android}"

bash "$repo_root/tools/android-build/build-debug-apk.sh"
