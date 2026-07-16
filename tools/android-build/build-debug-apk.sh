#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=versions.env
source "$repo_root/tools/android-build/versions.env"

find_apksigner() {
  local version candidate
  for version in "$ANDROID_BUILD_TOOLS_VERSION" "$ANDROID_FALLBACK_BUILD_TOOLS_VERSION"; do
    candidate="$ANDROID_SDK_ROOT/build-tools/$version/apksigner"
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  if command -v apksigner >/dev/null 2>&1; then
    command -v apksigner
    return 0
  fi
  echo "apksigner is unavailable. Run: bash tools/android-build/setup-sdk.sh" >&2
  return 1
}

if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is not on PATH. Run: bash tools/android-build/setup-sdk.sh" >&2
  exit 1
fi
if ! command -v java >/dev/null 2>&1 || ! java -version 2>&1 | grep -q 'version "17'; then
  echo "Java 17 is not on PATH. Run: bash tools/android-build/setup-sdk.sh" >&2
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
# A generic debug build is sideload-only. Phone update testing must opt in to
# an explicit trusted-LAN origin before Gradle embeds the update endpoint.
export CAATUU_ANDROID_UPDATE_BASE_URL="${CAATUU_ANDROID_UPDATE_BASE_URL:-https://updates.caatuu.invalid/android}"

bash "$repo_root/apps/caatuu-android/scripts/prepare-llama-vendor.sh"

cd "$repo_root/apps/caatuu-android"
gradle --no-daemon :app:assembleDebug

apk_path="$repo_root/artifacts/android/caatuu-debug.apk"
manifest_path="$repo_root/artifacts/android/caatuu-debug.json"
publish_dir="$(mktemp -d "$repo_root/artifacts/android/.publish-debug.XXXXXX")"
trap 'rm -rf "$publish_dir"' EXIT
staged_apk="$publish_dir/caatuu-debug.apk"
staged_manifest="$publish_dir/caatuu-debug.json"
cp app/build/outputs/apk/debug/app-debug.apk "$staged_apk"
apksigner_bin="$(find_apksigner)"
"$apksigner_bin" verify --verbose --print-certs "$staged_apk"

apk_sha="$(sha256sum "$staged_apk" | awk '{print $1}')"
apk_bytes="$(wc -c < "$staged_apk" | tr -d ' ')"
version_code="$(sed -nE 's/^[[:space:]]*versionCode[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' app/build.gradle.kts | head -1)"
version_name="$(sed -nE 's/^[[:space:]]*versionName[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' app/build.gradle.kts | head -1)"
if [[ ! "$version_code" =~ ^[0-9]+$ ]] || [[ -z "$version_name" ]]; then
  echo "Could not read a valid Android version from app/build.gradle.kts." >&2
  exit 1
fi
apk_abis="${CAATUU_ANDROID_ABIS:-arm64-v8a}"
update_base_url="$CAATUU_ANDROID_UPDATE_BASE_URL"
update_base_url="${update_base_url%/}"
versioned_relative_path="debug-releases/$version_code/caatuu-debug.apk"
versioned_apk_path="$repo_root/artifacts/android/$versioned_relative_path"

cat > "$staged_manifest" <<JSON
{
  "package_name": "com.waajacu.caatuu",
  "version_code": ${version_code:-0},
  "version_name": "${version_name:-debug}",
  "build_type": "debug",
  "debuggable": true,
  "apk_url": "$update_base_url/$versioned_relative_path",
  "sha256": "$apk_sha",
  "bytes": $apk_bytes,
  "abis": "$apk_abis"
}
JSON

# A version code owns one immutable APK forever. This prevents an interrupted
# Android download from resuming against bytes from a later publication.
mkdir -p "$(dirname "$versioned_apk_path")"
if [[ -f "$versioned_apk_path" ]]; then
  existing_sha="$(sha256sum "$versioned_apk_path" | awk '{print $1}')"
  if [[ "$existing_sha" != "$apk_sha" ]]; then
    echo "Refusing to replace immutable APK for versionCode $version_code." >&2
    exit 1
  fi
  rm -f "$staged_apk"
else
  mv "$staged_apk" "$versioned_apk_path"
fi

# Keep the unversioned APK only as a manual-download convenience. Update
# clients always use the immutable URL written into the manifest.
cp "$versioned_apk_path" "$publish_dir/caatuu-debug-latest.apk"
mv -f "$publish_dir/caatuu-debug-latest.apk" "$apk_path"
mv -f "$staged_manifest" "$manifest_path"

echo "Wrote $apk_path"
echo "Wrote $versioned_apk_path"
echo "Wrote $manifest_path"
