#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [[ "${1:-}" == "--local-build" && "$#" -eq 1 ]]; then
  exec bash "$repo_root/apps/android/tooling/build-public-debug-apk.sh"
fi

echo "The public debug channel is retired." >&2
echo "Publish Caatuu with: bash apps/android/tooling/publish-release.sh" >&2
echo "Build the development-only APK locally with: bash apps/android/tooling/publish-public-debug.sh --local-build" >&2
exit 1
