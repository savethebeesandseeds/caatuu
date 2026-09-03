#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
canonical_public_base_url="https://caatuu.waajacu.com"
public_base_url="${CAATUU_ANDROID_PUBLIC_BASE_URL:-$canonical_public_base_url}"
source_apk="$repo_root/artifacts/android/caatuu-universal.apk"
source_aab="$repo_root/artifacts/android/caatuu.aab"
certificate_pin_path="$repo_root/apps/android/tooling/direct-release-certificate.sha256"
compatibility_keystore="$repo_root/artifacts/android/caatuu-debug.keystore"
mode=""
candidate_receipt=""
expected_apk_sha256=""
expected_source_revision=""
build_outcome="not-requested"
pipeline_started_at=$SECONDS
phase_name=""
phase_started_at=0

start_phase() {
  phase_name="$1"
  phase_started_at=$SECONDS
  printf '==> %s\n' "$phase_name"
}

finish_phase() {
  printf '<== %s completed in %ss\n' "$phase_name" "$((SECONDS - phase_started_at))"
}

usage() {
  cat >&2 <<'USAGE'
Usage:
  publish-release.sh --build-once
  publish-release.sh --candidate-receipt <receipt> [--expected-apk-sha256 <sha>] [--source-revision <commit>]
  publish-release.sh --adopt-existing --expected-apk-sha256 <sha> --source-revision <commit>

With no mode, the publisher reuses the sealed receipt for the version declared
in build.gradle.kts. It never starts an implicit Android build.
USAGE
}

set_mode() {
  [[ -z "$mode" ]] || {
    echo "Choose exactly one release mode." >&2
    usage
    exit 2
  }
  mode="$1"
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --build-once)
      set_mode build-once
      shift
      ;;
    --candidate-receipt)
      set_mode receipt
      [[ "$#" -ge 2 ]] || { usage; exit 2; }
      candidate_receipt="$2"
      shift 2
      ;;
    --adopt-existing)
      set_mode adopt-existing
      shift
      ;;
    --expected-apk-sha256)
      [[ "$#" -ge 2 ]] || { usage; exit 2; }
      expected_apk_sha256="$(tr '[:upper:]' '[:lower:]' <<<"$2" | tr -d '[:space:]')"
      shift 2
      ;;
    --source-revision)
      [[ "$#" -ge 2 ]] || { usage; exit 2; }
      expected_source_revision="$(tr '[:upper:]' '[:lower:]' <<<"$2" | tr -d '[:space:]')"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

[[ "$public_base_url" == "$canonical_public_base_url" ]] || {
  echo "Stable Android releases must use exactly $canonical_public_base_url." >&2
  echo "Refusing CAATUU_ANDROID_PUBLIC_BASE_URL=$public_base_url." >&2
  exit 2
}

for command in git jq node sha256sum wc flock cmp cp mv mkdir mktemp realpath rm rmdir sed awk tr head; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for Caatuu release finalization." >&2
    exit 1
  }
done

candidate_version_code="$(sed -nE 's/.*caatuuVersionCode.*orElse\(([0-9]+)\).*/\1/p' "$repo_root/apps/android/product/build.gradle.kts" | head -1)"
candidate_version_name="$(sed -nE 's/.*caatuuVersionName.*orElse\("([^"]+)"\).*/\1/p' "$repo_root/apps/android/product/build.gradle.kts" | head -1)"
[[ "$candidate_version_code" =~ ^[1-9][0-9]*$ && -n "$candidate_version_name" ]] || {
  echo "Could not read the Caatuu release version." >&2
  exit 1
}
default_candidate_receipt="$repo_root/artifacts/android/release-candidates/$candidate_version_code.json"

if [[ -z "$mode" ]]; then
  if [[ -f "$default_candidate_receipt" ]]; then
    mode=receipt
    candidate_receipt="$default_candidate_receipt"
  else
    echo "No sealed candidate exists for Caatuu $candidate_version_name (code $candidate_version_code)." >&2
    echo "Use --build-once for one new build, or --adopt-existing with an approved hash and source commit." >&2
    exit 2
  fi
fi

assert_main_only() {
  local -a local_heads=() remote_heads=() worktrees=()
  [[ "$(git -C "$repo_root" branch --show-current)" == "main" ]] || {
    echo "Caatuu release work must run on main." >&2
    return 1
  }
  mapfile -t local_heads < <(git -C "$repo_root" for-each-ref --format='%(refname)' refs/heads)
  mapfile -t remote_heads < <(
    git -C "$repo_root" for-each-ref --format='%(refname) %(symref)' refs/remotes \
      | awk '$2 == "" { print $1 }'
  )
  mapfile -t worktrees < <(git -C "$repo_root" worktree list --porcelain | awk '/^worktree / { print $2 }')
  [[ "${#local_heads[@]}" -eq 1 && "${local_heads[0]}" == "refs/heads/main" ]] || {
    printf 'Expected only refs/heads/main; found: %s\n' "${local_heads[*]-<none>}" >&2
    return 1
  }
  [[ "${#remote_heads[@]}" -eq 1 && "${remote_heads[0]}" == "refs/remotes/origin/main" ]] || {
    printf 'Expected only refs/remotes/origin/main; found: %s\n' "${remote_heads[*]-<none>}" >&2
    return 1
  }
  [[ "${#worktrees[@]}" -eq 1 ]] || {
    printf 'Expected one worktree; found: %s\n' "${worktrees[*]-<none>}" >&2
    return 1
  }
}

assert_source_on_origin_main() {
  local revision="$1"
  [[ "$revision" =~ ^[a-f0-9]{40}$ ]] || {
    echo "Invalid Caatuu source revision: $revision" >&2
    return 1
  }
  git -C "$repo_root" cat-file -e "$revision^{commit}" 2>/dev/null || {
    echo "Caatuu source commit is missing locally: $revision" >&2
    return 1
  }
  git -C "$repo_root" merge-base --is-ancestor "$revision" refs/remotes/origin/main || {
    echo "Caatuu source commit is not present on origin/main: $revision" >&2
    return 1
  }
}

assert_clean_build_source() {
  [[ "$(git -C "$repo_root" rev-parse HEAD)" == "$(git -C "$repo_root" rev-parse refs/remotes/origin/main)" ]] || {
    echo "Push main before building a release candidate." >&2
    return 1
  }
  local dirty
  dirty="$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)"
  [[ -z "$dirty" ]] || {
    echo "A new release build requires a clean canonical worktree:" >&2
    printf '%s\n' "$dirty" >&2
    return 1
  }
}

find_apksigner() {
  local version candidate
  for version in "$ANDROID_BUILD_TOOLS_VERSION" "$ANDROID_FALLBACK_BUILD_TOOLS_VERSION"; do
    candidate="$ANDROID_SDK_ROOT/build-tools/$version/apksigner"
    [[ -x "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  echo "apksigner is unavailable. Run the documented SDK setup once; publication will not install it implicitly." >&2
  return 1
}

load_android_tools() {
  # shellcheck source=versions.env
  source "$repo_root/apps/android/tooling/versions.env"
  for command in java apkanalyzer unzip; do
    command -v "$command" >/dev/null 2>&1 || {
      echo "$command is unavailable. Run the documented SDK setup once; publication will not install it implicitly." >&2
      return 1
    }
  done
  apksigner_bin="$(find_apksigner)"
}

read_signer_sha() {
  local apk="$1" output signer
  output="$("$apksigner_bin" verify --verbose --print-certs "$apk")"
  signer="$(awk -F': ' '/Signer #1 certificate SHA-256 digest:/ { print tolower($2); exit }' <<<"$output")"
  [[ "$signer" =~ ^[a-f0-9]{64}$ ]] || {
    echo "Could not read the APK signing certificate: $apk" >&2
    return 1
  }
  printf '%s\n' "$signer"
}

validate_and_read_existing_candidate() {
  local apk="$1" aab="$2"
  node "$repo_root/apps/android/tooling/validate-product-package.mjs" \
    --aab "$aab" \
    --apk "$apk" \
    --apkanalyzer "$(command -v apkanalyzer)" \
    --unzip "$(command -v unzip)"
  package_name="$(apkanalyzer manifest application-id "$apk" | tr -d '\r\n')"
  version_code="$(apkanalyzer manifest version-code "$apk" | tr -d '\r\n')"
  version_name="$(apkanalyzer manifest version-name "$apk" | tr -d '\r\n')"
  debuggable="$(apkanalyzer manifest debuggable "$apk" | tr -d '\r\n')"
  signer_sha256="$(read_signer_sha "$apk")"
  expected_signer_sha256="$(tr -d ':[:space:]' < "$certificate_pin_path" | tr '[:upper:]' '[:lower:]')"
  [[ "$package_name" == "com.waajacu.caatuu" \
    && "$version_code" =~ ^[1-9][0-9]*$ \
    && -n "$version_name" \
    && "$debuggable" == "false" \
    && "$signer_sha256" == "$expected_signer_sha256" ]] || {
    echo "Existing Caatuu candidate has the wrong package, version, debug state, or signing lineage." >&2
    return 1
  }
}

assert_main_only

if [[ "$mode" == "build-once" ]]; then
  candidate_receipt="$default_candidate_receipt"
  assert_clean_build_source
  expected_source_revision="$(git -C "$repo_root" rev-parse HEAD)"
  if [[ -f "$candidate_receipt" ]]; then
    receipt_version_code="$(jq -er '.identity.version_code' "$candidate_receipt")"
    receipt_version_name="$(jq -er '.identity.version_name' "$candidate_receipt")"
    [[ "$receipt_version_code" == "$candidate_version_code" && "$receipt_version_name" == "$candidate_version_name" ]] || {
      echo "The existing candidate receipt does not match the Android version declared by current main." >&2
      exit 1
    }
    echo "A sealed candidate exists; verifying that it belongs to exact current main before reuse."
    build_outcome="reused"
    mode=receipt
  else
    [[ -f "$compatibility_keystore" ]] || {
      echo "The installed-lineage keystore is missing: $compatibility_keystore" >&2
      exit 1
    }
    export CAATUU_ANDROID_KEYSTORE="$compatibility_keystore"
    export CAATUU_ANDROID_KEYSTORE_PASSWORD="${CAATUU_ANDROID_DEBUG_KEYSTORE_PASSWORD:-android}"
    export CAATUU_ANDROID_KEY_ALIAS="${CAATUU_ANDROID_DEBUG_KEY_ALIAS:-androiddebugkey}"
    export CAATUU_ANDROID_KEY_PASSWORD="${CAATUU_ANDROID_DEBUG_KEY_PASSWORD:-android}"
    export CAATUU_ANDROID_UPDATE_BASE_URL="$public_base_url/android"
    export CAATUU_RELEASE_CANDIDATE_RECEIPT="$candidate_receipt"
    export CAATUU_RELEASE_SOURCE_REVISION="$(git -C "$repo_root" rev-parse HEAD)"
    start_phase "Validate release source"
    node "$repo_root/tools/language-content/validate.mjs" --release
    node --test "$repo_root"/apps/android/tooling/tests/product-*.test.mjs
    finish_phase
    start_phase "Build one signed release candidate"
    bash "$repo_root/apps/android/tooling/build-release-aab.sh"
    finish_phase
    [[ -f "$candidate_receipt" ]] || {
      echo "The one Android build completed without an immutable candidate receipt." >&2
      exit 1
    }
    build_outcome="built"
    mode=receipt
  fi
fi

load_android_tools

if [[ "$mode" == "adopt-existing" ]]; then
  start_phase "Adopt existing signed candidate"
  [[ "$expected_apk_sha256" =~ ^[a-f0-9]{64}$ ]] || {
    echo "--adopt-existing requires --expected-apk-sha256." >&2
    exit 2
  }
  [[ "$expected_source_revision" =~ ^[a-f0-9]{40}$ ]] || {
    echo "--adopt-existing requires --source-revision." >&2
    exit 2
  }
  assert_source_on_origin_main "$expected_source_revision"
  [[ -f "$source_apk" && -f "$source_aab" ]] || {
    echo "The existing Caatuu APK or AAB is missing." >&2
    exit 1
  }
  [[ "$(sha256sum "$source_apk" | awk '{print $1}')" == "$expected_apk_sha256" ]] || {
    echo "The existing APK does not match the explicitly approved SHA-256." >&2
    exit 1
  }
  validate_and_read_existing_candidate "$source_apk" "$source_aab"
  candidate_receipt="$repo_root/artifacts/android/release-candidates/$version_code.json"
  node "$repo_root/apps/android/tooling/release-candidate.mjs" seal-existing \
    --repo-root "$repo_root" \
    --apk "artifacts/android/caatuu-universal.apk" \
    --aab "artifacts/android/caatuu.aab" \
    --source-revision "$expected_source_revision" \
    --package-name "$package_name" \
    --version-code "$version_code" \
    --version-name "$version_name" \
    --debuggable "$debuggable" \
    --signer-sha256 "$signer_sha256" \
    --mode adopted-existing \
    --expected-apk-sha256 "$expected_apk_sha256" \
    --output "$candidate_receipt" >/dev/null
  finish_phase
  mode=receipt
fi

[[ "$mode" == "receipt" && -n "$candidate_receipt" ]] || {
  echo "No Caatuu candidate receipt was selected." >&2
  exit 1
}

if [[ "$candidate_receipt" != /* ]]; then
  candidate_receipt="$repo_root/${candidate_receipt#./}"
fi
[[ ! -L "$candidate_receipt" ]] || {
  echo "Candidate receipt must not be a symbolic link: $candidate_receipt" >&2
  exit 1
}
candidate_receipt="$(realpath -e "$candidate_receipt")"
case "$candidate_receipt" in
  "$repo_root"/*) ;;
  *)
    echo "Candidate receipt must be inside the canonical Caatuu repository." >&2
    exit 1
    ;;
esac

mkdir -p "$repo_root/artifacts/android"
staging_dir="$(mktemp -d "$repo_root/artifacts/android/.publish-candidate.XXXXXX")"
staged_receipt="$staging_dir/caatuu-release-candidate.json"
verified_receipt="$staging_dir/verified-release-candidate.json"
staged_candidate_apk="$staging_dir/caatuu.apk"
staged_candidate_aab="$staging_dir/caatuu.aab"
staged_manifest="$staging_dir/caatuu.json"
alias_apk_next=""
alias_manifest_next=""
install_apk_tmp=""
install_manifest_tmp=""
install_receipt_tmp=""
cleanup() {
  local path
  for path in \
    "$alias_apk_next" "$alias_manifest_next" \
    "$install_apk_tmp" "$install_manifest_tmp" "$install_receipt_tmp" \
    "$verified_receipt" "$staged_manifest" "$staged_candidate_apk" "$staged_candidate_aab" "$staged_receipt"; do
    [[ -z "$path" ]] || rm -f -- "$path"
  done
  rmdir "$staging_dir" 2>/dev/null || true
}
trap cleanup EXIT

# Snapshot the receipt first, then verify and copy only the bytes named by that
# snapshot. Any concurrent artifact change makes the copied hash/size check
# fail; publication never returns to the mutable source paths after this point.
start_phase "Verify sealed release candidate"
cp "$candidate_receipt" "$staged_receipt"
verify_arguments=(verify --repo-root "$repo_root" --receipt "$staged_receipt")
[[ -z "$expected_apk_sha256" ]] || verify_arguments+=(--expected-apk-sha256 "$expected_apk_sha256")
[[ -z "$expected_source_revision" ]] || verify_arguments+=(--expected-source-revision "$expected_source_revision")
node "$repo_root/apps/android/tooling/release-candidate.mjs" "${verify_arguments[@]}" > "$verified_receipt"

receipt_apk_relative="$(jq -er '.artifacts.apk.path' "$verified_receipt")"
receipt_aab_relative="$(jq -er '.artifacts.aab.path' "$verified_receipt")"
receipt_apk="$repo_root/$receipt_apk_relative"
receipt_aab="$repo_root/$receipt_aab_relative"
receipt_source_revision="$(jq -er '.source_revision' "$verified_receipt")"
apk_sha256="$(jq -er '.artifacts.apk.sha256' "$verified_receipt")"
apk_bytes="$(jq -er '.artifacts.apk.bytes' "$verified_receipt")"
aab_sha256="$(jq -er '.artifacts.aab.sha256' "$verified_receipt")"
aab_bytes="$(jq -er '.artifacts.aab.bytes' "$verified_receipt")"

assert_file_identity() {
  local path="$1" expected_sha256="$2" expected_bytes="$3" label="$4"
  local actual_sha256 actual_bytes
  [[ -f "$path" && ! -L "$path" ]] || {
    echo "$label is not a regular file: $path" >&2
    return 1
  }
  actual_sha256="$(sha256sum "$path" | awk '{print $1}')"
  actual_bytes="$(wc -c < "$path" | tr -d '[:space:]')"
  [[ "$actual_sha256" == "$expected_sha256" && "$actual_bytes" == "$expected_bytes" ]] || {
    echo "$label changed while it was being snapshotted." >&2
    echo "Expected $expected_bytes bytes / $expected_sha256; found $actual_bytes bytes / $actual_sha256." >&2
    return 1
  }
}

cp "$receipt_apk" "$staged_candidate_apk"
cp "$receipt_aab" "$staged_candidate_aab"
assert_file_identity "$staged_candidate_apk" "$apk_sha256" "$apk_bytes" "Sealed candidate APK"
assert_file_identity "$staged_candidate_aab" "$aab_sha256" "$aab_bytes" "Sealed candidate AAB"
receipt_sha256="$(sha256sum "$staged_receipt" | awk '{print $1}')"
assert_source_on_origin_main "$receipt_source_revision"
validate_and_read_existing_candidate "$staged_candidate_apk" "$staged_candidate_aab"

[[ "$version_code" == "$(jq -er '.identity.version_code' "$verified_receipt")" \
  && "$version_name" == "$(jq -er '.identity.version_name' "$verified_receipt")" \
  && "$package_name" == "$(jq -er '.identity.package_name' "$verified_receipt")" \
  && "$debuggable" == "$(jq -er '.identity.debuggable' "$verified_receipt")" \
  && "$signer_sha256" == "$(jq -er '.identity.signer_certificate_sha256' "$verified_receipt")" ]] || {
  echo "APK identity differs from its sealed candidate receipt." >&2
  exit 1
}
finish_phase

versioned_relative_dir="releases/$version_code"
versioned_relative_apk="$versioned_relative_dir/caatuu.apk"
versioned_relative_manifest="$versioned_relative_dir/caatuu.json"
versioned_relative_receipt="$versioned_relative_dir/caatuu-release-candidate.json"
public_apk_url="$public_base_url/android/$versioned_relative_apk"
source_url="https://github.com/savethebeesandseeds/caatuu/tree/$receipt_source_revision"

jq -n \
  --arg package_name "$package_name" \
  --arg version_name "$version_name" \
  --arg apk_url "$public_apk_url" \
  --arg sha256 "$apk_sha256" \
  --arg signer_sha256 "$signer_sha256" \
  --arg source_revision "$receipt_source_revision" \
  --arg source_url "$source_url" \
  --arg candidate_receipt_sha256 "$receipt_sha256" \
  --argjson version_code "$version_code" \
  --argjson bytes "$apk_bytes" \
  '{schema_version: 1, profile: "product", channel: "stable", signing_lineage: "direct-release-v1",
    package_name: $package_name, version_code: $version_code, version_name: $version_name,
    build_type: "release", debuggable: false, apk_url: $apk_url, sha256: $sha256, bytes: $bytes,
    signer_certificate_sha256: $signer_sha256, source_revision: $source_revision, source_url: $source_url,
    native_abis: [], universal: true,
    capabilities: {llm: false, godot: false, embeddings: true},
    audit: {bundletool: "passed", product_package: "passed", candidate_receipt_sha256: $candidate_receipt_sha256},
    device_smoke: "not-run"}' > "$staged_manifest"

start_phase "Finalize local immutable release"
publication_lock="$repo_root/artifacts/android/.artifact-publication.lock"
exec {publication_lock_fd}>"$publication_lock"
flock -n "$publication_lock_fd" || {
  echo "Another Android finalizer owns the publication lock; inspect that process and reuse its result." >&2
  exit 1
}
if [[ "$build_outcome" != "not-requested" ]]; then
  [[ "$(git -C "$repo_root" rev-parse HEAD)" == "$expected_source_revision" ]] || {
    echo "Current main changed after the build-once source was selected; refusing to finalize the candidate." >&2
    exit 1
  }
  assert_clean_build_source
fi

versioned_dir="$repo_root/artifacts/android/$versioned_relative_dir"
versioned_apk="$repo_root/artifacts/android/$versioned_relative_apk"
versioned_manifest="$repo_root/artifacts/android/$versioned_relative_manifest"
versioned_receipt="$repo_root/artifacts/android/$versioned_relative_receipt"
mkdir -p "$versioned_dir"
if [[ -f "$versioned_apk" ]]; then
  assert_file_identity "$versioned_apk" "$apk_sha256" "$apk_bytes" "Immutable APK for versionCode $version_code" || {
    echo "Refusing to replace immutable APK bytes for versionCode $version_code." >&2
    exit 1
  }
fi
if [[ -f "$versioned_manifest" ]] && ! cmp -s "$versioned_manifest" "$staged_manifest"; then
  echo "Refusing to replace the immutable manifest for versionCode $version_code." >&2
  exit 1
fi
if [[ -f "$versioned_receipt" ]] && ! cmp -s "$versioned_receipt" "$staged_receipt"; then
  echo "Refusing to replace the immutable receipt for versionCode $version_code." >&2
  exit 1
fi

# Each first-time immutable file is copied to a unique file in its destination
# directory, checked, and renamed atomically. An interruption can leave only a
# disposable temporary file, never a partial immutable release.
if [[ ! -f "$versioned_apk" ]]; then
  install_apk_tmp="$(mktemp "$versioned_dir/.caatuu.apk.XXXXXX")"
  cp "$staged_candidate_apk" "$install_apk_tmp"
  assert_file_identity "$install_apk_tmp" "$apk_sha256" "$apk_bytes" "Staged immutable APK"
  mv "$install_apk_tmp" "$versioned_apk"
  install_apk_tmp=""
fi
if [[ ! -f "$versioned_manifest" ]]; then
  install_manifest_tmp="$(mktemp "$versioned_dir/.caatuu.json.XXXXXX")"
  cp "$staged_manifest" "$install_manifest_tmp"
  cmp -s "$install_manifest_tmp" "$staged_manifest" || {
    echo "Staged immutable manifest changed while it was copied." >&2
    exit 1
  }
  mv "$install_manifest_tmp" "$versioned_manifest"
  install_manifest_tmp=""
fi
if [[ ! -f "$versioned_receipt" ]]; then
  install_receipt_tmp="$(mktemp "$versioned_dir/.caatuu-release-candidate.json.XXXXXX")"
  cp "$staged_receipt" "$install_receipt_tmp"
  cmp -s "$install_receipt_tmp" "$staged_receipt" || {
    echo "Staged immutable receipt changed while it was copied." >&2
    exit 1
  }
  # Install the receipt only after the APK and manifest. The routine wrapper
  # treats it as the finalization signal, so a crash cannot advertise an
  # incomplete version-owned release.
  mv "$install_receipt_tmp" "$versioned_receipt"
  install_receipt_tmp=""
fi

stable_apk="$repo_root/artifacts/android/caatuu.apk"
stable_manifest="$repo_root/artifacts/android/caatuu.json"
node "$repo_root/apps/android/tooling/release-publication-state.mjs" assert-alias-update \
  --stable-manifest "$stable_manifest" \
  --stable-apk "$stable_apk" \
  --candidate-manifest "$staged_manifest" \
  --candidate-apk "$versioned_apk" \
  --candidate-receipt "$staged_receipt" \
  --versioned-receipt "$versioned_receipt" \
  --durable-floor "$repo_root/apps/android/tooling/pages-current-release.json" >/dev/null

if [[ "$build_outcome" != "not-requested" ]]; then
  [[ "$(git -C "$repo_root" rev-parse HEAD)" == "$expected_source_revision" ]] || {
    echo "Current main changed during candidate finalization; refusing to update the stable aliases." >&2
    exit 1
  }
  assert_clean_build_source
fi

alias_apk_next="$(mktemp "$repo_root/artifacts/android/.caatuu.apk.next.XXXXXX")"
alias_manifest_next="$(mktemp "$repo_root/artifacts/android/.caatuu.json.next.XXXXXX")"
cp "$versioned_apk" "$alias_apk_next"
assert_file_identity "$alias_apk_next" "$apk_sha256" "$apk_bytes" "Stable APK alias candidate"
cp "$versioned_manifest" "$alias_manifest_next"
cmp -s "$alias_manifest_next" "$versioned_manifest" || {
  echo "Stable manifest alias changed while it was copied." >&2
  exit 1
}
mv -f "$alias_apk_next" "$stable_apk"
alias_apk_next=""
mv -f "$alias_manifest_next" "$stable_manifest"
alias_manifest_next=""
flock -u "$publication_lock_fd"
finish_phase

case "$build_outcome" in
  built)
    echo "Built once and finalized Caatuu $version_name (code $version_code)."
    ;;
  reused)
    echo "Reused the exact current-source candidate and finalized Caatuu $version_name (code $version_code); no Gradle build ran."
    ;;
  *)
    echo "Finalized Caatuu $version_name (code $version_code) from a sealed candidate; no Gradle build ran."
    ;;
esac
echo "APK: $versioned_apk"
echo "APK SHA-256: $apk_sha256"
echo "Candidate receipt: $versioned_receipt"
echo "No GitHub Release, Pages deployment, DNS, or tunnel change was performed."
printf 'Local release pipeline completed in %ss\n' "$((SECONDS - pipeline_started_at))"
