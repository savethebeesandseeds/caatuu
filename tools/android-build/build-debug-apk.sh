#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=versions.env
source "$repo_root/tools/android-build/versions.env"

if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is not on PATH. Run: bash tools/android-build/setup-sdk.sh" >&2
  exit 1
fi

mkdir -p "$repo_root/artifacts/android"
debug_keystore="$repo_root/artifacts/android/caatuu-debug.keystore"
if [[ ! -f "$debug_keystore" ]]; then
  if ! command -v keytool >/dev/null 2>&1; then
    echo "keytool is not on PATH. Run: bash tools/android-build/setup-container.sh" >&2
    exit 1
  fi

  keytool -genkeypair \
    -keystore "$debug_keystore" \
    -storetype PKCS12 \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Caatuu Debug,O=Waajacu,C=US"
fi

export CAATUU_ANDROID_DEBUG_KEYSTORE="$debug_keystore"
export CAATUU_ANDROID_DEBUG_KEYSTORE_PASSWORD="${CAATUU_ANDROID_DEBUG_KEYSTORE_PASSWORD:-android}"
export CAATUU_ANDROID_DEBUG_KEY_ALIAS="${CAATUU_ANDROID_DEBUG_KEY_ALIAS:-androiddebugkey}"
export CAATUU_ANDROID_DEBUG_KEY_PASSWORD="${CAATUU_ANDROID_DEBUG_KEY_PASSWORD:-android}"

bash "$repo_root/apps/caatuu-android/scripts/prepare-llama-vendor.sh"

cd "$repo_root/apps/caatuu-android"
gradle --no-daemon :app:assembleDebug

cp app/build/outputs/apk/debug/app-debug.apk "$repo_root/artifacts/android/caatuu-debug.apk"
echo "Wrote $repo_root/artifacts/android/caatuu-debug.apk"
