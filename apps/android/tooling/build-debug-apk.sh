#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=versions.env
source "$repo_root/apps/android/tooling/versions.env"

# A generic debug build is sideload-only. Phone update testing must opt in to
# an explicit trusted-LAN origin before Gradle embeds the update endpoint.
export CAATUU_ANDROID_UPDATE_BASE_URL="${CAATUU_ANDROID_UPDATE_BASE_URL:-https://updates.caatuu.invalid/android}"

# The public runtime serves this workspace's mutable debug manifest directly.
# Refuse a fail-closed sideload build while that route is enabled, because it
# would replace the public manifest with an updates.caatuu.invalid APK URL and
# break every installed public-debug client. The hosted wrapper supplies the
# correct public origin and passes this guard.
if grep -Eq '^[[:space:]]*CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS[[:space:]]*=[[:space:]]*1[[:space:]]*$' \
  "$repo_root/.env" 2>/dev/null \
  && [[ "$CAATUU_ANDROID_UPDATE_BASE_URL" == "https://updates.caatuu.invalid/android" ]]; then
  cat >&2 <<'EOF'
Public Android debug downloads are enabled, so a generic sideload build would
overwrite the live manifest with an invalid update origin. Use:
  bash apps/android/tooling/publish-public-debug.sh
or disable CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS before building locally.
EOF
  exit 1
fi

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
  echo "apksigner is unavailable. Run: bash apps/android/tooling/setup-sdk.sh" >&2
  return 1
}

if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is not on PATH. Run: bash apps/android/tooling/setup-sdk.sh" >&2
  exit 1
fi
if ! command -v java >/dev/null 2>&1 || ! java -version 2>&1 | grep -q 'version "17'; then
  echo "Java 17 is not on PATH. Run: bash apps/android/tooling/setup-sdk.sh" >&2
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  echo "flock is unavailable. Install util-linux before publishing Android artifacts." >&2
  exit 1
fi

mkdir -p "$repo_root/artifacts/android"
debug_keystore="$repo_root/artifacts/android/caatuu-debug.keystore"
if [[ ! -f "$debug_keystore" ]]; then
  if [[ "${CAATUU_REQUIRE_EXISTING_DEBUG_KEYSTORE:-0}" == "1" ]]; then
    cat >&2 <<EOF
The public debug signing keystore is missing:
  $debug_keystore
Refusing to create a new signing lineage. Restore the existing ignored
keystore before publishing an update for installed Caatuu clients.
EOF
    exit 1
  fi
  if ! command -v keytool >/dev/null 2>&1; then
    echo "keytool is not on PATH. Run: bash apps/android/tooling/setup-container.sh" >&2
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
bash "$repo_root/apps/android/scripts/prepare-llama-vendor.sh"

cd "$repo_root/apps/android"
gradle --no-daemon :app:assembleDebug

apk_path="$repo_root/artifacts/android/caatuu-debug.apk"
manifest_path="$repo_root/artifacts/android/caatuu-debug.json"
publish_dir="$(mktemp -d "$repo_root/artifacts/android/.publish-debug.XXXXXX")"
trap 'rm -rf "$publish_dir"' EXIT
staged_apk="$publish_dir/caatuu-debug.apk"
staged_manifest="$publish_dir/caatuu-debug.json"
cp app/build/outputs/apk/debug/app-debug.apk "$staged_apk"
apksigner_bin="$(find_apksigner)"
verification_output="$("$apksigner_bin" verify --verbose --print-certs "$staged_apk")"
printf '%s\n' "$verification_output"
signer_sha="$(
  awk -F': ' '/Signer #1 certificate SHA-256 digest:/ { print tolower($2); exit }' \
    <<<"$verification_output"
)"
if [[ ! "$signer_sha" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Could not read the APK signing certificate SHA-256 digest." >&2
  exit 1
fi
if [[ -n "${CAATUU_EXPECTED_DEBUG_CERT_SHA256:-}" ]]; then
  expected_signer_sha="$(
    printf '%s' "$CAATUU_EXPECTED_DEBUG_CERT_SHA256" \
      | tr -d ':[:space:]' \
      | tr '[:upper:]' '[:lower:]'
  )"
  if [[ ! "$expected_signer_sha" =~ ^[a-f0-9]{64}$ ]]; then
    echo "CAATUU_EXPECTED_DEBUG_CERT_SHA256 is not a valid SHA-256 digest." >&2
    exit 1
  fi
  if [[ "$signer_sha" != "$expected_signer_sha" ]]; then
    cat >&2 <<EOF
The APK signing certificate does not match the pinned public update lineage.
Expected: $expected_signer_sha
Actual:   $signer_sha
Refusing to publish an APK that installed Caatuu clients cannot update to.
EOF
    exit 1
  fi
fi

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
publication_lock="$repo_root/artifacts/android/.artifact-publication.lock"
exec {publication_lock_fd}>"$publication_lock"
if ! flock -w "${CAATUU_ANDROID_PUBLICATION_LOCK_TIMEOUT_SECONDS:-120}" "$publication_lock_fd"; then
  echo "Timed out waiting for the Android artifact publication lock." >&2
  exit 1
fi
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
