#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
public_base_url="${CAATUU_ANDROID_PUBLIC_BASE_URL:-https://caatuu.waajacu.com}"
publication_contract_url="$public_base_url/android/debug-releases/status"
public_debug_manifest_url="$public_base_url/android/caatuu-debug.json"
channel="store-mvp-preview"
profile="storeMvp"
signing_lineage="public-debug-preview-v1"
artifact_name="caatuu-store-mvp.apk"
manifest_name="caatuu-store-mvp.json"
debug_keystore="$repo_root/artifacts/android/caatuu-debug.keystore"
certificate_pin_path="$repo_root/apps/android/tooling/public-debug-certificate.sha256"
source_aab="$repo_root/artifacts/android/caatuu-store-mvp.aab"
source_apk="$repo_root/artifacts/android/caatuu-store-mvp-universal.apk"

required_tracked_files=(
  apps/android/settings.gradle.kts
  apps/android/storeMvp/build.gradle.kts
  apps/android/storeMvp/proguard-rules.pro
  apps/android/storeMvp/src/main/AndroidManifest.xml
  apps/android/storeMvp/src/main/java/com/caatuu/android/ArtifactProgress.kt
  apps/android/storeMvp/src/main/java/com/caatuu/android/StoreMvpActivity.kt
  apps/android/storeMvp/src/main/java/com/caatuu/android/StoreMvpBridge.kt
  apps/android/storeMvp/src/main/res/drawable/ic_launcher.xml
  apps/android/storeMvp/src/main/res/values/strings.xml
  apps/android/storeMvp/src/main/res/values/styles.xml
  apps/android/tooling/build-release-aab.sh
  apps/android/tooling/build-store-mvp-assets.mjs
  apps/android/tooling/validate-store-mvp-package.mjs
  apps/android/tooling/publish-public-debug.sh
  apps/android/tooling/publish-public-store-mvp-preview.sh
  apps/android/tooling/public-debug-certificate.sha256
)

# These paths may belong to the concurrent Conjugation Comet session. The Store
# MVP compiler explicitly excludes the game sources and generates its own
# service worker, so these changes cannot alter the compiled preview surface.
allowed_unrelated_dirty_paths=(
  apps/languages/czech/static/conjugation-comet.html
  apps/languages/czech/static/source/games/conjugation-comet/conjugation-comet.css
  apps/languages/czech/static/source/games/conjugation-comet/conjugation-comet.js
  apps/languages/czech/static/sw.js
  apps/server/tooling/tests/conjugation-comet-shell.test.mjs
  apps/server/tooling/tests/semantic-learning-contract.test.mjs
)

is_allowed_unrelated_dirty_path() {
  local candidate="$1"
  local allowed
  for allowed in "${allowed_unrelated_dirty_paths[@]}"; do
    if [[ "$candidate" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

is_store_source_path() {
  case "$1" in
    apps/android/settings.gradle.kts \
      | apps/android/build.gradle.kts \
      | apps/android/gradle.properties \
      | apps/android/gradle/libs.versions.toml \
      | apps/android/storeMvp/* \
      | apps/android/tooling/build-release-aab.sh \
      | apps/android/tooling/build-store-mvp-assets.mjs \
      | apps/android/tooling/validate-store-mvp-package.mjs \
      | apps/android/tooling/publish-public-debug.sh \
      | apps/android/tooling/publish-public-store-mvp-preview.sh \
      | apps/android/tooling/public-debug-certificate.sha256 \
      | apps/android/app/src/main/java/com/caatuu/android/AndroidSpeechManager.kt \
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
  local -a store_dirty=()
  local -a unexpected_dirty=()

  for required in "${required_tracked_files[@]}"; do
    if ! git -C "$repo_root" ls-files --error-unmatch -- "$required" >/dev/null 2>&1; then
      echo "Required Store MVP publication source is not tracked: $required" >&2
      return 1
    fi
  done

  while IFS= read -r -d '' dirty_record; do
    status="${dirty_record:0:2}"
    dirty_path="${dirty_record:3}"
    if is_allowed_unrelated_dirty_path "$dirty_path"; then
      :
    elif is_store_source_path "$dirty_path"; then
      store_dirty+=("$dirty_path")
    else
      unexpected_dirty+=("$dirty_path")
    fi

    if [[ "$status" == *R* || "$status" == *C* ]]; then
      if ! IFS= read -r -d '' renamed_path; then
        echo "Could not parse renamed path from git status." >&2
        return 1
      fi
      if is_allowed_unrelated_dirty_path "$renamed_path"; then
        :
      elif is_store_source_path "$renamed_path"; then
        store_dirty+=("$renamed_path")
      else
        unexpected_dirty+=("$renamed_path")
      fi
    fi
  done < <(git -C "$repo_root" status --porcelain=v1 -z --untracked-files=all)

  if [[ "${#store_dirty[@]}" -gt 0 ]]; then
    printf 'Store MVP publication requires every consumed source to be tracked and clean. Dirty source:\n' >&2
    printf '  %s\n' "${store_dirty[@]}" >&2
    return 1
  fi
  if [[ "${#unexpected_dirty[@]}" -gt 0 ]]; then
    printf 'Store MVP publication found unreviewed worktree changes outside its explicit concurrent-work allowlist:\n' >&2
    printf '  %s\n' "${unexpected_dirty[@]}" >&2
    return 1
  fi
}

find_apksigner() {
  local version candidate
  for version in "$ANDROID_BUILD_TOOLS_VERSION" "$ANDROID_FALLBACK_BUILD_TOOLS_VERSION"; do
    candidate="$ANDROID_SDK_ROOT/build-tools/$version/apksigner"
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "apksigner is unavailable. Run: bash apps/android/tooling/setup-sdk.sh" >&2
  return 1
}

read_signer_sha() {
  local apk="$1"
  local verification_output signer_sha
  verification_output="$("$apksigner_bin" verify --verbose --print-certs "$apk")"
  printf '%s\n' "$verification_output" >&2
  signer_sha="$({
    awk -F': ' '/Signer #1 certificate SHA-256 digest:/ { print tolower($2); exit }' \
      <<<"$verification_output"
  })"
  if [[ ! "$signer_sha" =~ ^[a-f0-9]{64}$ ]]; then
    echo "Could not read the APK signing certificate SHA-256 digest for $apk." >&2
    return 1
  fi
  printf '%s\n' "$signer_sha"
}

cd "$repo_root"

if ! grep -Eq '^[[:space:]]*CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS[[:space:]]*=[[:space:]]*1[[:space:]]*$' .env 2>/dev/null; then
  echo "The gated public Android preview routes are not enabled in the ignored root .env file." >&2
  exit 1
fi

for command in git curl jq node sed sha256sum wc flock cmp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for Store MVP preview publication." >&2
    exit 1
  fi
done

contract_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$publication_contract_url" || true)"
if [[ "$contract_status" != "204" ]]; then
  echo "Expected HTTP 204 from $publication_contract_url, got ${contract_status:-no response}. No artifacts were changed." >&2
  exit 1
fi

check_source_state
source_revision="$(git rev-parse --verify HEAD)"
if [[ ! "$source_revision" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Could not resolve the Store MVP source revision." >&2
  exit 1
fi
source_branch="$(git symbolic-ref --quiet --short HEAD || true)"
if [[ -z "$source_branch" ]]; then
  echo "Store MVP publication requires a named, pushed branch; detached HEAD is not allowed." >&2
  exit 1
fi
origin_url="$(git remote get-url origin 2>/dev/null || true)"
case "$origin_url" in
  https://github.com/savethebeesandseeds/caatuu \
    | https://github.com/savethebeesandseeds/caatuu.git \
    | git@github.com:savethebeesandseeds/caatuu \
    | git@github.com:savethebeesandseeds/caatuu.git \
    | ssh://git@github.com/savethebeesandseeds/caatuu \
    | ssh://git@github.com/savethebeesandseeds/caatuu.git)
    ;;
  *)
    echo "origin must be the canonical savethebeesandseeds/caatuu GitHub repository, got: ${origin_url:-missing}" >&2
    exit 1
    ;;
esac
remote_source_revision="$(
  git ls-remote --exit-code origin "refs/heads/$source_branch" 2>/dev/null \
    | awk 'NR == 1 { print $1 }'
)" || {
  echo "Current branch $source_branch is not available from origin; push the reviewed commit first." >&2
  exit 1
}
if [[ "$remote_source_revision" != "$source_revision" ]]; then
  echo "HEAD $source_revision is not the commit published at origin/$source_branch (${remote_source_revision:-missing})." >&2
  echo "Push the exact reviewed commit before publishing its APK." >&2
  exit 1
fi
source_url="https://github.com/savethebeesandseeds/caatuu/tree/$source_revision"

candidate_version_code="$(
  sed -nE 's/^[[:space:]]*versionCode[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' \
    apps/android/storeMvp/build.gradle.kts | head -1
)"
if [[ ! "$candidate_version_code" =~ ^[1-9][0-9]*$ ]]; then
  echo "Could not read the Store MVP versionCode." >&2
  exit 1
fi
public_debug_manifest="$(
  curl -fsS --max-time 20 "$public_debug_manifest_url?store-mvp-preflight=$source_revision"
)" || {
  echo "Could not read the current public same-package Android manifest: $public_debug_manifest_url" >&2
  exit 1
}
public_debug_package="$(jq -er '.package_name' <<<"$public_debug_manifest")"
public_debug_version_code="$(jq -er '.version_code | tonumber' <<<"$public_debug_manifest")"
if [[ "$public_debug_package" != "com.waajacu.caatuu" \
  || ! "$public_debug_version_code" =~ ^[1-9][0-9]*$ ]]; then
  echo "The current public Android manifest has an unexpected package or version." >&2
  exit 1
fi
if (( candidate_version_code <= public_debug_version_code )); then
  echo "Store MVP versionCode $candidate_version_code must be greater than current public same-package versionCode $public_debug_version_code." >&2
  exit 1
fi

if [[ ! -f "$debug_keystore" ]]; then
  echo "The persistent public-preview keystore is missing: $debug_keystore" >&2
  echo "Restore it; never create a replacement signing lineage during publication." >&2
  exit 1
fi
if [[ ! -f "$certificate_pin_path" ]]; then
  echo "The tracked public-preview signing certificate pin is missing: $certificate_pin_path" >&2
  exit 1
fi
expected_signer_sha="$(
  tr -d ':[:space:]' < "$certificate_pin_path" | tr '[:upper:]' '[:lower:]'
)"
if [[ ! "$expected_signer_sha" =~ ^[a-f0-9]{64}$ ]]; then
  echo "The public-preview signing certificate pin is invalid: $certificate_pin_path" >&2
  exit 1
fi

# shellcheck source=versions.env
source apps/android/tooling/versions.env
if ! command -v java >/dev/null 2>&1 \
  || ! java -version 2>&1 | grep -q 'version "17' \
  || ! command -v gradle >/dev/null 2>&1 \
  || ! command -v apkanalyzer >/dev/null 2>&1; then
  echo "Preparing the persistent Android SDK and Gradle caches once..."
  bash apps/android/tooling/setup-sdk.sh
  source apps/android/tooling/versions.env
fi
apksigner_bin="$(find_apksigner)"

# The Store MVP preview deliberately uses Caatuu's persistent, pinned preview
# lineage. It remains separate from release/Play signing and can replace an
# existing same-lineage debug installation for maintainer testing.
export CAATUU_ANDROID_KEYSTORE="$debug_keystore"
export CAATUU_ANDROID_KEYSTORE_PASSWORD="${CAATUU_ANDROID_DEBUG_KEYSTORE_PASSWORD:-android}"
export CAATUU_ANDROID_KEY_ALIAS="${CAATUU_ANDROID_DEBUG_KEY_ALIAS:-androiddebugkey}"
export CAATUU_ANDROID_KEY_PASSWORD="${CAATUU_ANDROID_DEBUG_KEY_PASSWORD:-android}"

node --test apps/android/tooling/tests/store-mvp-*.test.mjs
bash apps/android/tooling/build-release-aab.sh

if [[ ! -f "$source_aab" || ! -f "$source_apk" ]]; then
  echo "The signed Store MVP AAB-derived universal APK was not produced." >&2
  exit 1
fi

node apps/android/tooling/validate-store-mvp-package.mjs \
  --aab "$source_aab" \
  --apk "$source_apk" \
  --apkanalyzer "$(command -v apkanalyzer)" \
  --unzip "$(command -v unzip)"

local_signer_sha="$(read_signer_sha "$source_apk")"
if [[ "$local_signer_sha" != "$expected_signer_sha" ]]; then
  echo "Store MVP signer does not match the pinned public-preview lineage." >&2
  echo "Expected: $expected_signer_sha" >&2
  echo "Actual:   $local_signer_sha" >&2
  exit 1
fi

package_name="$(apkanalyzer manifest application-id "$source_apk" | tr -d '\r\n')"
version_code="$(apkanalyzer manifest version-code "$source_apk" | tr -d '\r\n')"
version_name="$(apkanalyzer manifest version-name "$source_apk" | tr -d '\r\n')"
debuggable="$(apkanalyzer manifest debuggable "$source_apk" | tr -d '\r\n')"
if [[ "$package_name" != "com.waajacu.caatuu" \
  || ! "$version_code" =~ ^[1-9][0-9]*$ \
  || "$version_code" != "$candidate_version_code" \
  || -z "$version_name" \
  || "$debuggable" != "false" ]]; then
  echo "The Store MVP APK identity or release state is invalid." >&2
  exit 1
fi

# Nothing consumed by the build may have changed while Gradle was running.
check_source_state
if [[ "$(git rev-parse --verify HEAD)" != "$source_revision" ]]; then
  echo "HEAD changed during the Store MVP build; refusing to publish mixed-source bytes." >&2
  exit 1
fi

apk_sha="$(sha256sum "$source_apk" | awk '{print $1}')"
apk_bytes="$(wc -c < "$source_apk" | tr -d '[:space:]')"
versioned_relative_dir="debug-releases/$channel/$version_code"
versioned_relative_apk="$versioned_relative_dir/$artifact_name"
versioned_relative_manifest="$versioned_relative_dir/$manifest_name"
public_apk_url="$public_base_url/android/$versioned_relative_apk"
public_manifest_url="$public_base_url/android/$versioned_relative_manifest"
versioned_dir="$repo_root/artifacts/android/$versioned_relative_dir"
versioned_apk_path="$repo_root/artifacts/android/$versioned_relative_apk"
versioned_manifest_path="$repo_root/artifacts/android/$versioned_relative_manifest"

publish_dir="$(mktemp -d "$repo_root/artifacts/android/.publish-store-mvp-preview.XXXXXX")"
trap 'rm -rf "$publish_dir"' EXIT
staged_apk="$publish_dir/$artifact_name"
staged_manifest="$publish_dir/$manifest_name"
cp "$source_apk" "$staged_apk"
jq -n \
  --arg profile "$profile" \
  --arg channel "$channel" \
  --arg signing_lineage "$signing_lineage" \
  --arg package_name "$package_name" \
  --arg version_name "$version_name" \
  --arg apk_url "$public_apk_url" \
  --arg sha256 "$apk_sha" \
  --arg signer_sha256 "$local_signer_sha" \
  --arg source_revision "$source_revision" \
  --arg source_url "$source_url" \
  --argjson version_code "$version_code" \
  --argjson bytes "$apk_bytes" \
  '{
    schema_version: 1,
    profile: $profile,
    channel: $channel,
    signing_lineage: $signing_lineage,
    package_name: $package_name,
    version_code: $version_code,
    version_name: $version_name,
    build_type: "release",
    debuggable: false,
    apk_url: $apk_url,
    sha256: $sha256,
    bytes: $bytes,
    signer_certificate_sha256: $signer_sha256,
    source_revision: $source_revision,
    source_url: $source_url,
    native_abis: [],
    universal: true,
    audit: {
      bundletool: "passed",
      store_mvp_package: "passed"
    },
    device_smoke: "not-run"
  }' > "$staged_manifest"

publication_lock="$repo_root/artifacts/android/.artifact-publication.lock"
exec {publication_lock_fd}>"$publication_lock"
if ! flock -w "${CAATUU_ANDROID_PUBLICATION_LOCK_TIMEOUT_SECONDS:-120}" "$publication_lock_fd"; then
  echo "Timed out waiting for the Android artifact publication lock." >&2
  exit 1
fi

mkdir -p "$versioned_dir"
apk_already_published=false
if [[ -f "$versioned_apk_path" ]]; then
  existing_sha="$(sha256sum "$versioned_apk_path" | awk '{print $1}')"
  if [[ "$existing_sha" != "$apk_sha" ]]; then
    echo "Refusing to replace changed Store MVP preview bytes for versionCode $version_code." >&2
    exit 1
  fi
  apk_already_published=true
fi
manifest_already_published=false
if [[ -f "$versioned_manifest_path" ]]; then
  if ! cmp -s "$versioned_manifest_path" "$staged_manifest"; then
    echo "Refusing to replace the immutable Store MVP preview manifest for versionCode $version_code." >&2
    exit 1
  fi
  manifest_already_published=true
fi

# Check both immutable destinations before moving either staged file. This
# prevents a conflicting manifest from leaving a newly published orphan APK.
if [[ "$apk_already_published" == false ]]; then
  mv "$staged_apk" "$versioned_apk_path"
fi
if [[ "$manifest_already_published" == false ]]; then
  mv "$staged_manifest" "$versioned_manifest_path"
fi
flock -u "$publication_lock_fd"

downloaded_apk="$publish_dir/downloaded-$artifact_name"
downloaded_manifest="$publish_dir/downloaded-$manifest_name"
response_headers="$publish_dir/public-apk.headers"
curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 180 \
  -D "$response_headers" -o "$downloaded_apk" "$public_apk_url"
curl -fsS --retry 5 --retry-all-errors --retry-delay 2 --max-time 30 \
  -o "$downloaded_manifest" "$public_manifest_url"

download_sha="$(sha256sum "$downloaded_apk" | awk '{print $1}')"
download_bytes="$(wc -c < "$downloaded_apk" | tr -d '[:space:]')"
if [[ "$download_sha" != "$apk_sha" || "$download_bytes" != "$apk_bytes" ]]; then
  echo "The public Store MVP preview APK does not match its immutable manifest." >&2
  exit 1
fi
if ! cmp -s "$versioned_manifest_path" "$downloaded_manifest"; then
  echo "The public Store MVP preview manifest does not match the local immutable manifest." >&2
  exit 1
fi

cache_control="$(
  tr -d '\r' < "$response_headers" \
    | awk -F': *' 'tolower($1) == "cache-control" { print tolower($2); exit }'
)"
if [[ "$cache_control" != *public* \
  || "$cache_control" != *max-age=31536000* \
  || "$cache_control" != *immutable* ]]; then
  echo "The public Store MVP APK is missing immutable cache headers: ${cache_control:-none}" >&2
  exit 1
fi

public_signer_sha="$(read_signer_sha "$downloaded_apk")"
if [[ "$public_signer_sha" != "$expected_signer_sha" ]]; then
  echo "The downloaded Store MVP APK signer does not match the pinned preview lineage." >&2
  exit 1
fi

node apps/android/tooling/validate-store-mvp-package.mjs \
  --aab "$source_aab" \
  --apk "$downloaded_apk" \
  --apkanalyzer "$(command -v apkanalyzer)" \
  --unzip "$(command -v unzip)"

echo "Published Caatuu Store MVP preview $version_name (code $version_code)."
echo "Manifest: $public_manifest_url"
echo "APK: $public_apk_url"
echo "APK SHA-256: $download_sha"
echo "Device smoke: not-run"
