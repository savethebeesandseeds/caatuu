#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
public_base_url="https://caatuu.waajacu.com"
public_manifest_url="$public_base_url/android/caatuu-debug.json"
publication_contract_url="$public_base_url/android/debug-releases/status"
allow_same_version="${ALLOW_SAME_VERSION:-0}"
temporary_apk="$(mktemp "${TMPDIR:-/tmp}/caatuu-public-debug.XXXXXX.apk")"
trap 'rm -f "$temporary_apk"' EXIT

cd "$repo_root"

if ! grep -Eq '^[[:space:]]*CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS[[:space:]]*=[[:space:]]*1[[:space:]]*$' .env 2>/dev/null; then
  cat >&2 <<'EOF'
The public debug route is not enabled in the ignored root .env file.
Set CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS=1 and recreate the caatuu runtime
before publishing. See tools/android-build/README.md.
EOF
  exit 1
fi

source_version_code="$(
  sed -nE 's/^[[:space:]]*versionCode[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' \
    apps/caatuu-android/app/build.gradle.kts | head -1
)"
if [[ ! "$source_version_code" =~ ^[0-9]+$ ]]; then
  echo "Could not read Android versionCode from apps/caatuu-android/app/build.gradle.kts" >&2
  exit 1
fi
expected_apk_url="$public_base_url/android/debug-releases/$source_version_code/caatuu-debug.apk"

contract_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$publication_contract_url" || true)"
if [[ "$contract_status" != "204" ]]; then
  cat >&2 <<EOF
The public runtime does not expose the immutable Android publication contract.
Expected HTTP 204 from $publication_contract_url, got ${contract_status:-no response}.
Rebuild the lightweight runtime before publishing; no artifacts were changed.
EOF
  exit 1
fi

published_manifest="$(curl -fsS --max-time 20 "$public_manifest_url?preflight=$(date +%s)" 2>/dev/null || true)"
if [[ -n "$published_manifest" ]]; then
  published_version_code="$(jq -er '.version_code | tonumber' <<<"$published_manifest")"
  if (( published_version_code > source_version_code )); then
    echo "Public version $published_version_code is newer than source version $source_version_code. Refusing to publish an older build." >&2
    exit 1
  fi
  if (( published_version_code == source_version_code )) && [[ "$allow_same_version" != "1" ]]; then
    echo "Public version $published_version_code is not older than source version $source_version_code." >&2
    echo "Bump versionCode/versionName first, or set ALLOW_SAME_VERSION=1 only to repair the same release." >&2
    exit 1
  fi
fi

# shellcheck source=versions.env
source tools/android-build/versions.env

if ! command -v java >/dev/null 2>&1 \
  || ! java -version 2>&1 | grep -q 'version "17' \
  || ! command -v gradle >/dev/null 2>&1 \
  || [[ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]] \
  || { [[ ! -x "$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS_VERSION/apksigner" ]] \
    && [[ ! -x "$ANDROID_HOME/build-tools/$ANDROID_FALLBACK_BUILD_TOOLS_VERSION/apksigner" ]]; }; then
  echo "Preparing the persistent Android SDK and Gradle caches once..."
  bash tools/android-build/setup-sdk.sh
  source tools/android-build/versions.env
fi

echo "Building the public debug update in Linux..."
bash tools/android-build/build-public-debug-apk.sh

local_manifest_path="artifacts/android/caatuu-debug.json"
local_apk_path="artifacts/android/caatuu-debug.apk"
local_version_code="$(jq -er '.version_code | tonumber' "$local_manifest_path")"
local_version_name="$(jq -er '.version_name' "$local_manifest_path")"
local_apk_url="$(jq -er '.apk_url' "$local_manifest_path")"
local_sha="$(jq -er '.sha256 | ascii_downcase' "$local_manifest_path")"
local_bytes="$(jq -er '.bytes | tonumber' "$local_manifest_path")"
actual_local_sha="$(sha256sum "$local_apk_path" | awk '{print $1}')"
actual_local_bytes="$(wc -c < "$local_apk_path" | tr -d '[:space:]')"

if [[ "$local_apk_url" != "$expected_apk_url" \
  || "$local_sha" != "$actual_local_sha" \
  || "$local_bytes" != "$actual_local_bytes" ]]; then
  echo "The local public manifest does not match the built APK." >&2
  exit 1
fi

public_manifest=""
for attempt in $(seq 1 30); do
  candidate="$(curl -fsS --max-time 30 "$public_manifest_url?verify=$(date +%s)-$attempt" 2>/dev/null || true)"
  if [[ -n "$candidate" ]] \
    && [[ "$(jq -r '.sha256 // empty' <<<"$candidate")" == "$local_sha" ]]; then
    public_manifest="$candidate"
    break
  fi
  sleep 2
done
if [[ -z "$public_manifest" ]]; then
  echo "The public update manifest did not expose the new APK within 60 seconds." >&2
  exit 1
fi

public_version_code="$(jq -er '.version_code | tonumber' <<<"$public_manifest")"
public_version_name="$(jq -er '.version_name' <<<"$public_manifest")"
public_apk_url="$(jq -er '.apk_url' <<<"$public_manifest")"
public_sha="$(jq -er '.sha256 | ascii_downcase' <<<"$public_manifest")"
public_bytes="$(jq -er '.bytes | tonumber' <<<"$public_manifest")"
if [[ "$public_version_code" != "$local_version_code" \
  || "$public_version_name" != "$local_version_name" \
  || "$public_apk_url" != "$local_apk_url" \
  || "$public_sha" != "$local_sha" \
  || "$public_bytes" != "$local_bytes" ]]; then
  echo "The public manifest does not match the locally published manifest." >&2
  exit 1
fi

curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 180 \
  -o "$temporary_apk" "$public_apk_url"
download_sha="$(sha256sum "$temporary_apk" | awk '{print $1}')"
download_bytes="$(wc -c < "$temporary_apk" | tr -d '[:space:]')"
if [[ "$download_sha" != "$public_sha" || "$download_bytes" != "$public_bytes" ]]; then
  echo "The downloaded public APK does not match its manifest." >&2
  exit 1
fi

alias_sha="$(curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 180 \
  "$public_base_url/android/caatuu-debug.apk" | sha256sum | awk '{print $1}')"
if [[ "$alias_sha" != "$public_sha" ]]; then
  echo "The manual-download alias does not match the immutable published APK." >&2
  exit 1
fi

node tools/runtime/audit-runtime-boundary.mjs \
  --base-url "$public_base_url" \
  --apk "$local_apk_path" \
  --allow-debug-artifacts

echo "Published Caatuu $public_version_name (code $public_version_code)."
echo "Manifest: $public_manifest_url"
echo "APK SHA-256: $download_sha"
