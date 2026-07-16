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

for key in \
  CAATUU_ANDROID_KEYSTORE \
  CAATUU_ANDROID_KEYSTORE_PASSWORD \
  CAATUU_ANDROID_KEY_ALIAS \
  CAATUU_ANDROID_KEY_PASSWORD
do
  if [ -z "${!key:-}" ]; then
    echo "Set $key before building a signed release APK." >&2
    exit 1
  fi
done

export CAATUU_ANDROID_UPDATE_BASE_URL="${CAATUU_ANDROID_UPDATE_BASE_URL:-https://caatuu.waajacu.com/android}"

if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is not on PATH. Run: bash tools/android-build/setup-sdk.sh" >&2
  exit 1
fi

bash "$repo_root/apps/caatuu-android/scripts/prepare-llama-vendor.sh"

cd "$repo_root/apps/caatuu-android"
gradle --no-daemon :app:assembleRelease

mkdir -p "$repo_root/artifacts/android"
apk_path="$repo_root/artifacts/android/caatuu.apk"
manifest_path="$repo_root/artifacts/android/caatuu.json"
publish_dir="$(mktemp -d "$repo_root/artifacts/android/.publish-release.XXXXXX")"
trap 'rm -rf "$publish_dir"' EXIT
staged_apk="$publish_dir/caatuu.apk"
staged_manifest="$publish_dir/caatuu.json"
cp app/build/outputs/apk/release/app-release.apk "$staged_apk"
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
versioned_relative_path="releases/$version_code/caatuu.apk"
versioned_apk_path="$repo_root/artifacts/android/$versioned_relative_path"

cat > "$staged_manifest" <<JSON
{
  "package_name": "com.waajacu.caatuu",
  "version_code": ${version_code:-0},
  "version_name": "${version_name:-release}",
  "build_type": "release",
  "debuggable": false,
  "apk_url": "$update_base_url/$versioned_relative_path",
  "sha256": "$apk_sha",
  "bytes": $apk_bytes,
  "abis": "$apk_abis"
}
JSON

# Never mutate the bytes owned by a published version code.
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

cp "$versioned_apk_path" "$publish_dir/caatuu-latest.apk"
mv -f "$publish_dir/caatuu-latest.apk" "$apk_path"
mv -f "$staged_manifest" "$manifest_path"

echo "Wrote $apk_path"
echo "Wrote $versioned_apk_path"
echo "Wrote $manifest_path"
