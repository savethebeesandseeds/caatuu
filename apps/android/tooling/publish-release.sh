#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
public_base_url="${CAATUU_ANDROID_PUBLIC_BASE_URL:-https://caatuu.waajacu.com}"
publication_contract_url="$public_base_url/android/releases/status"
public_manifest_url="$public_base_url/android/caatuu.json"
legacy_manifest_url="$public_base_url/android/caatuu-debug.json"
profile="product"
channel="stable"
signing_lineage="direct-release-v1"
compatibility_keystore="$repo_root/artifacts/android/caatuu-debug.keystore"
certificate_pin_path="$repo_root/apps/android/tooling/direct-release-certificate.sha256"
source_aab="$repo_root/artifacts/android/caatuu.aab"
source_apk="$repo_root/artifacts/android/caatuu-universal.apk"

required_tracked_files=(
  apps/android/settings.gradle.kts
  apps/android/product/build.gradle.kts
  apps/android/product/proguard-rules.pro
  apps/android/product/src/main/AndroidManifest.xml
  apps/android/product/src/main/java/com/caatuu/android/ArtifactProgress.kt
  apps/android/product/src/main/java/com/caatuu/android/CaatuuActivity.kt
  apps/android/product/src/main/java/com/caatuu/android/ProductBridge.kt
  apps/android/product/src/main/res/xml/caatuu_file_paths.xml
  apps/android/tooling/build-release-aab.sh
  apps/android/tooling/build-product-assets.mjs
  apps/android/tooling/validate-product-package.mjs
  apps/android/tooling/publish-release.sh
  apps/android/tooling/direct-release-certificate.sha256
)

# These files belong to another active workstream. The product compiler removes
# Conjugation Comet and generates its own service worker, so none can affect the
# release bytes produced by this script.
allowed_unrelated_dirty_paths=(
  apps/languages/czech/static/conjugation-comet.html
  apps/languages/czech/static/source/games/conjugation-comet/conjugation-comet.css
  apps/languages/czech/static/source/games/conjugation-comet/conjugation-comet.js
  apps/languages/czech/static/sw.js
  apps/server/tooling/tests/conjugation-comet-shell.test.mjs
  apps/server/tooling/tests/semantic-learning-contract.test.mjs
)

is_allowed_unrelated_dirty_path() {
  local candidate="$1" allowed
  for allowed in "${allowed_unrelated_dirty_paths[@]}"; do
    [[ "$candidate" == "$allowed" ]] && return 0
  done
  return 1
}

is_product_source_path() {
  case "$1" in
    apps/android/settings.gradle.kts \
      | apps/android/build.gradle.kts \
      | apps/android/gradle.properties \
      | apps/android/gradle/libs.versions.toml \
      | apps/android/product/* \
      | apps/android/tooling/build-release-aab.sh \
      | apps/android/tooling/build-product-assets.mjs \
      | apps/android/tooling/validate-product-package.mjs \
      | apps/android/tooling/publish-release.sh \
      | apps/android/tooling/direct-release-certificate.sha256 \
      | apps/android/app/src/main/java/com/caatuu/android/AndroidSpeechManager.kt \
      | apps/android/app/src/main/java/com/caatuu/android/AppUpdateManager.kt \
      | apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt \
      | apps/android/app/src/main/java/com/caatuu/android/DictionaryManager.kt \
      | apps/android/app/src/main/java/com/caatuu/android/StaticAssetManager.kt \
      | apps/android/app/src/main/java/com/caatuu/android/VectorDatabaseManager.kt \
      | apps/languages/czech/static/* \
      | apps/launcher/static/*)
      return 0
      ;;
  esac
  return 1
}

check_source_state() {
  local required dirty_record status dirty_path renamed_path
  local -a product_dirty=() unexpected_dirty=()

  for required in "${required_tracked_files[@]}"; do
    if ! git -C "$repo_root" ls-files --error-unmatch -- "$required" >/dev/null 2>&1; then
      echo "Required Caatuu release source is not tracked: $required" >&2
      return 1
    fi
  done

  while IFS= read -r -d '' dirty_record; do
    status="${dirty_record:0:2}"
    dirty_path="${dirty_record:3}"
    if is_allowed_unrelated_dirty_path "$dirty_path"; then
      :
    elif is_product_source_path "$dirty_path"; then
      product_dirty+=("$dirty_path")
    else
      unexpected_dirty+=("$dirty_path")
    fi
    if [[ "$status" == *R* || "$status" == *C* ]]; then
      IFS= read -r -d '' renamed_path || return 1
      if is_allowed_unrelated_dirty_path "$renamed_path"; then
        :
      elif is_product_source_path "$renamed_path"; then
        product_dirty+=("$renamed_path")
      else
        unexpected_dirty+=("$renamed_path")
      fi
    fi
  done < <(git -C "$repo_root" status --porcelain=v1 -z --untracked-files=all)

  if [[ "${#product_dirty[@]}" -gt 0 ]]; then
    printf 'Caatuu publication requires every consumed source to be committed. Dirty source:\n' >&2
    printf '  %s\n' "${product_dirty[@]}" >&2
    return 1
  fi
  if [[ "${#unexpected_dirty[@]}" -gt 0 ]]; then
    printf 'Caatuu publication found unrelated unreviewed worktree changes:\n' >&2
    printf '  %s\n' "${unexpected_dirty[@]}" >&2
    return 1
  fi
}

find_apksigner() {
  local version candidate
  for version in "$ANDROID_BUILD_TOOLS_VERSION" "$ANDROID_FALLBACK_BUILD_TOOLS_VERSION"; do
    candidate="$ANDROID_SDK_ROOT/build-tools/$version/apksigner"
    [[ -x "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  echo "apksigner is unavailable. Run: bash apps/android/tooling/setup-sdk.sh" >&2
  return 1
}

read_signer_sha() {
  local apk="$1" verification_output signer_sha
  verification_output="$("$apksigner_bin" verify --verbose --print-certs "$apk")"
  printf '%s\n' "$verification_output" >&2
  signer_sha="$(awk -F': ' '/Signer #1 certificate SHA-256 digest:/ { print tolower($2); exit }' <<<"$verification_output")"
  [[ "$signer_sha" =~ ^[a-f0-9]{64}$ ]] || {
    echo "Could not read the APK signing certificate for $apk." >&2
    return 1
  }
  printf '%s\n' "$signer_sha"
}

manifest_version_code() {
  local url="$1" response_file="$2" status
  status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 "$url?release-preflight=$source_revision" || true)"
  case "$status" in
    200) jq -er '.version_code | tonumber' "$response_file" ;;
    404) printf '0\n' ;;
    *) echo "Unexpected HTTP $status from $url" >&2; return 1 ;;
  esac
}

cd "$repo_root"
for command in git curl jq node sed sha256sum wc flock cmp; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for Caatuu publication." >&2
    exit 1
  }
done

contract_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$publication_contract_url" || true)"
if [[ "$contract_status" != "204" ]]; then
  echo "Expected HTTP 204 from $publication_contract_url, got ${contract_status:-no response}." >&2
  exit 1
fi

check_source_state
source_revision="$(git rev-parse --verify HEAD)"
source_branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$source_revision" =~ ^[a-f0-9]{40}$ && -n "$source_branch" ]] || {
  echo "Caatuu publication requires a named branch and a valid source revision." >&2
  exit 1
}
origin_url="$(git remote get-url origin 2>/dev/null || true)"
case "$origin_url" in
  https://github.com/savethebeesandseeds/caatuu|https://github.com/savethebeesandseeds/caatuu.git|git@github.com:savethebeesandseeds/caatuu|git@github.com:savethebeesandseeds/caatuu.git|ssh://git@github.com/savethebeesandseeds/caatuu|ssh://git@github.com/savethebeesandseeds/caatuu.git) ;;
  *) echo "origin must be the canonical savethebeesandseeds/caatuu repository." >&2; exit 1 ;;
esac
remote_source_revision="$(git ls-remote --exit-code origin "refs/heads/$source_branch" 2>/dev/null | awk 'NR == 1 { print $1 }')" || {
  echo "Push $source_branch before publishing." >&2
  exit 1
}
[[ "$remote_source_revision" == "$source_revision" ]] || {
  echo "HEAD is not the commit currently pushed to origin/$source_branch." >&2
  exit 1
}
source_url="https://github.com/savethebeesandseeds/caatuu/tree/$source_revision"

candidate_version_code="$(sed -nE 's/^[[:space:]]*versionCode[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' apps/android/product/build.gradle.kts | head -1)"
[[ "$candidate_version_code" =~ ^[1-9][0-9]*$ ]] || {
  echo "Could not read the Caatuu versionCode." >&2
  exit 1
}
preflight_dir="$(mktemp -d "$repo_root/artifacts/android/.release-preflight.XXXXXX")"
trap 'rm -rf "$preflight_dir"' EXIT
stable_version_code="$(manifest_version_code "$public_manifest_url" "$preflight_dir/stable.json")"
legacy_version_code="$(manifest_version_code "$legacy_manifest_url" "$preflight_dir/legacy.json")"
if (( candidate_version_code <= stable_version_code || candidate_version_code <= legacy_version_code )); then
  echo "Caatuu versionCode $candidate_version_code must exceed stable $stable_version_code and installed-lineage $legacy_version_code." >&2
  exit 1
fi

[[ -f "$compatibility_keystore" ]] || {
  echo "The existing installed-lineage keystore is missing: $compatibility_keystore" >&2
  exit 1
}
expected_signer_sha="$(tr -d ':[:space:]' < "$certificate_pin_path" | tr '[:upper:]' '[:lower:]')"
[[ "$expected_signer_sha" =~ ^[a-f0-9]{64}$ ]] || {
  echo "The direct-release certificate pin is invalid." >&2
  exit 1
}

# Caatuu 0.1.0 intentionally keeps the signer already installed on tester
# devices. This permits an in-place migration to the real product. This key is
# not the future Google Play app-signing or upload key.
export CAATUU_ANDROID_KEYSTORE="$compatibility_keystore"
export CAATUU_ANDROID_KEYSTORE_PASSWORD="${CAATUU_ANDROID_DEBUG_KEYSTORE_PASSWORD:-android}"
export CAATUU_ANDROID_KEY_ALIAS="${CAATUU_ANDROID_DEBUG_KEY_ALIAS:-androiddebugkey}"
export CAATUU_ANDROID_KEY_PASSWORD="${CAATUU_ANDROID_DEBUG_KEY_PASSWORD:-android}"
export CAATUU_ANDROID_UPDATE_BASE_URL="$public_base_url/android"

# shellcheck source=versions.env
source apps/android/tooling/versions.env
if ! command -v java >/dev/null 2>&1 || ! command -v gradle >/dev/null 2>&1 || ! command -v apkanalyzer >/dev/null 2>&1; then
  bash apps/android/tooling/setup-sdk.sh
  source apps/android/tooling/versions.env
fi
apksigner_bin="$(find_apksigner)"

node --test apps/android/tooling/tests/product-*.test.mjs
bash apps/android/tooling/build-release-aab.sh
[[ -f "$source_aab" && -f "$source_apk" ]] || {
  echo "The signed Caatuu AAB-derived APK was not produced." >&2
  exit 1
}
node apps/android/tooling/validate-product-package.mjs \
  --aab "$source_aab" \
  --apk "$source_apk" \
  --apkanalyzer "$(command -v apkanalyzer)" \
  --unzip "$(command -v unzip)"

local_signer_sha="$(read_signer_sha "$source_apk")"
[[ "$local_signer_sha" == "$expected_signer_sha" ]] || {
  echo "Caatuu signer does not match the installed direct-release lineage." >&2
  exit 1
}
package_name="$(apkanalyzer manifest application-id "$source_apk" | tr -d '\r\n')"
version_code="$(apkanalyzer manifest version-code "$source_apk" | tr -d '\r\n')"
version_name="$(apkanalyzer manifest version-name "$source_apk" | tr -d '\r\n')"
debuggable="$(apkanalyzer manifest debuggable "$source_apk" | tr -d '\r\n')"
[[ "$package_name" == "com.waajacu.caatuu" && "$version_code" == "$candidate_version_code" && "$version_name" == "0.1.0" && "$debuggable" == "false" ]] || {
  echo "The Caatuu APK identity is not the expected non-debuggable 0.1.0 release." >&2
  exit 1
}

check_source_state
[[ "$(git rev-parse --verify HEAD)" == "$source_revision" ]] || {
  echo "HEAD changed during the Caatuu build." >&2
  exit 1
}

apk_sha="$(sha256sum "$source_apk" | awk '{print $1}')"
apk_bytes="$(wc -c < "$source_apk" | tr -d '[:space:]')"
versioned_relative_dir="releases/$version_code"
versioned_relative_apk="$versioned_relative_dir/caatuu.apk"
versioned_relative_manifest="$versioned_relative_dir/caatuu.json"
public_apk_url="$public_base_url/android/$versioned_relative_apk"
public_versioned_manifest_url="$public_base_url/android/$versioned_relative_manifest"
versioned_dir="$repo_root/artifacts/android/$versioned_relative_dir"
versioned_apk_path="$repo_root/artifacts/android/$versioned_relative_apk"
versioned_manifest_path="$repo_root/artifacts/android/$versioned_relative_manifest"

publish_dir="$(mktemp -d "$repo_root/artifacts/android/.publish-release.XXXXXX")"
rm -rf "$preflight_dir"
trap 'rm -rf "$publish_dir"' EXIT
staged_apk="$publish_dir/caatuu.apk"
staged_manifest="$publish_dir/caatuu.json"
staged_legacy_manifest="$publish_dir/caatuu-debug.json"
cp "$source_apk" "$staged_apk"
jq -n \
  --arg profile "$profile" --arg channel "$channel" --arg signing_lineage "$signing_lineage" \
  --arg package_name "$package_name" --arg version_name "$version_name" --arg apk_url "$public_apk_url" \
  --arg sha256 "$apk_sha" --arg signer_sha256 "$local_signer_sha" --arg source_revision "$source_revision" \
  --arg source_url "$source_url" --argjson version_code "$version_code" --argjson bytes "$apk_bytes" \
  '{schema_version: 1, profile: $profile, channel: $channel, signing_lineage: $signing_lineage,
    package_name: $package_name, version_code: $version_code, version_name: $version_name,
    build_type: "release", debuggable: false, apk_url: $apk_url, sha256: $sha256, bytes: $bytes,
    signer_certificate_sha256: $signer_sha256, source_revision: $source_revision, source_url: $source_url,
    native_abis: [], universal: true,
    capabilities: {llm: false, godot: false, embeddings: true},
    audit: {bundletool: "passed", product_package: "passed"}, device_smoke: "not-run"}' > "$staged_manifest"

# Versions <=144 validate this legacy document as a debug channel before they
# inspect the signed APK. These two legacy fields preserve that old protocol;
# the artifact_* fields state the real properties of the 0.1.0 APK.
jq '.channel = "legacy-update-bridge"
    | .build_type = "debug"
    | .debuggable = true
    | .artifact_build_type = "release"
    | .artifact_debuggable = false
    | .compatibility_for_version_codes_through = 144' \
  "$staged_manifest" > "$staged_legacy_manifest"

publication_lock="$repo_root/artifacts/android/.artifact-publication.lock"
exec {publication_lock_fd}>"$publication_lock"
flock -w "${CAATUU_ANDROID_PUBLICATION_LOCK_TIMEOUT_SECONDS:-120}" "$publication_lock_fd" || {
  echo "Timed out waiting for the Android publication lock." >&2
  exit 1
}
mkdir -p "$versioned_dir"
if [[ -f "$versioned_apk_path" ]] && [[ "$(sha256sum "$versioned_apk_path" | awk '{print $1}')" != "$apk_sha" ]]; then
  echo "Refusing to replace immutable Caatuu APK bytes for versionCode $version_code." >&2
  exit 1
fi
if [[ -f "$versioned_manifest_path" ]] && ! cmp -s "$versioned_manifest_path" "$staged_manifest"; then
  echo "Refusing to replace the immutable Caatuu manifest for versionCode $version_code." >&2
  exit 1
fi
[[ -f "$versioned_apk_path" ]] || cp "$staged_apk" "$versioned_apk_path"
[[ -f "$versioned_manifest_path" ]] || cp "$staged_manifest" "$versioned_manifest_path"
cp "$versioned_apk_path" "$repo_root/artifacts/android/caatuu.apk"
cp "$versioned_manifest_path" "$repo_root/artifacts/android/caatuu.json"
cp "$staged_legacy_manifest" "$repo_root/artifacts/android/caatuu-debug.json"
flock -u "$publication_lock_fd"

downloaded_apk="$publish_dir/downloaded-caatuu.apk"
downloaded_manifest="$publish_dir/downloaded-caatuu.json"
downloaded_legacy_manifest="$publish_dir/downloaded-legacy.json"
response_headers="$publish_dir/public-apk.headers"
curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 180 -D "$response_headers" -o "$downloaded_apk" "$public_apk_url"
curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 30 -o "$downloaded_manifest" "$public_versioned_manifest_url"
curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 30 -o "$downloaded_legacy_manifest" "$legacy_manifest_url"
[[ "$(sha256sum "$downloaded_apk" | awk '{print $1}')" == "$apk_sha" && "$(wc -c < "$downloaded_apk" | tr -d '[:space:]')" == "$apk_bytes" ]] || {
  echo "The public Caatuu APK does not match the release manifest." >&2
  exit 1
}
cmp -s "$versioned_manifest_path" "$downloaded_manifest" || {
  echo "The public immutable manifest differs from the local release manifest." >&2
  exit 1
}
cmp -s "$repo_root/artifacts/android/caatuu-debug.json" "$downloaded_legacy_manifest" || {
  echo "The installed-lineage compatibility manifest was not published." >&2
  exit 1
}
cache_control="$(tr -d '\r' < "$response_headers" | awk -F': *' 'tolower($1) == "cache-control" { print tolower($2); exit }')"
[[ "$cache_control" == *public* && "$cache_control" == *max-age=31536000* && "$cache_control" == *immutable* ]] || {
  echo "The public Caatuu APK is missing immutable cache headers." >&2
  exit 1
}
[[ "$(read_signer_sha "$downloaded_apk")" == "$expected_signer_sha" ]] || {
  echo "The downloaded Caatuu APK signer is incorrect." >&2
  exit 1
}
node apps/android/tooling/validate-product-package.mjs \
  --aab "$source_aab" --apk "$downloaded_apk" \
  --apkanalyzer "$(command -v apkanalyzer)" --unzip "$(command -v unzip)"

echo "Published Caatuu $version_name (code $version_code)."
echo "Manifest: $public_manifest_url"
echo "APK: $public_apk_url"
echo "APK SHA-256: $apk_sha"
echo "Existing installations can discover this release through the legacy update bridge."
echo "Physical device smoke test: not-run"
