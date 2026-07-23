#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export CAATUU_ANDROID_UPDATE_BASE_URL="${CAATUU_ANDROID_UPDATE_BASE_URL:-https://caatuu.waajacu.com/android}"
certificate_pin_path="$repo_root/apps/android/tooling/public-debug-certificate.sha256"

if [[ ! -f "$certificate_pin_path" ]]; then
  echo "Public debug signing certificate pin is missing: $certificate_pin_path" >&2
  exit 1
fi

expected_signer_sha="$(
  tr -d ':[:space:]' < "$certificate_pin_path" \
    | tr '[:upper:]' '[:lower:]'
)"
if [[ ! "$expected_signer_sha" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Public debug signing certificate pin is invalid: $certificate_pin_path" >&2
  exit 1
fi

export CAATUU_REQUIRE_EXISTING_DEBUG_KEYSTORE=1
export CAATUU_EXPECTED_DEBUG_CERT_SHA256="$expected_signer_sha"

exec bash "$repo_root/apps/android/tooling/build-debug-apk.sh"
