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

apk_path="$repo_root/artifacts/android/caatuu-debug.apk"
manifest_path="$repo_root/artifacts/android/caatuu-debug.json"
cp app/build/outputs/apk/debug/app-debug.apk "$apk_path"

apk_sha="$(sha256sum "$apk_path" | awk '{print $1}')"
apk_bytes="$(wc -c < "$apk_path" | tr -d ' ')"
version_code="$(sed -nE 's/^[[:space:]]*versionCode[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' app/build.gradle.kts | head -1)"
version_name="$(sed -nE 's/^[[:space:]]*versionName[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' app/build.gradle.kts | head -1)"
apk_abis="${CAATUU_ANDROID_ABIS:-arm64-v8a}"

cat > "$manifest_path" <<JSON
{
  "package_name": "com.waajacu.caatuu",
  "version_code": ${version_code:-0},
  "version_name": "${version_name:-debug}",
  "apk_url": "https://caatuu.waajacu.com/android/caatuu-debug.apk",
  "sha256": "$apk_sha",
  "bytes": $apk_bytes,
  "abis": "$apk_abis"
}
JSON

echo "Wrote $apk_path"
echo "Wrote $manifest_path"
