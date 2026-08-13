#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

for key in \
  CAATUU_ANDROID_KEYSTORE \
  CAATUU_ANDROID_KEYSTORE_PASSWORD \
  CAATUU_ANDROID_KEY_ALIAS \
  CAATUU_ANDROID_KEY_PASSWORD
do
  if [[ -z "${!key:-}" ]]; then
    echo "Set $key before building a signed Caatuu release." >&2
    exit 1
  fi
done

bash "$repo_root/apps/android/tooling/build-release-aab.sh"

echo "Signed Caatuu release APK: $repo_root/artifacts/android/caatuu-universal.apk"
echo "Signed Caatuu release AAB: $repo_root/artifacts/android/caatuu.aab"
