#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=versions.env
source "$repo_root/apps/android/tooling/versions.env"

signing_keys=(
  CAATUU_ANDROID_KEYSTORE
  CAATUU_ANDROID_KEYSTORE_PASSWORD
  CAATUU_ANDROID_KEY_ALIAS
  CAATUU_ANDROID_KEY_PASSWORD
)
signing_values=0
for key in "${signing_keys[@]}"; do
  if [[ -n "${!key:-}" ]]; then
    signing_values=$((signing_values + 1))
  fi
done
if [[ "$signing_values" -ne 0 && "$signing_values" -ne "${#signing_keys[@]}" ]]; then
  echo "Set all four Android release-signing values, or leave all four unset for an unsigned Caatuu milestone build." >&2
  exit 1
fi
signed=false
if [[ "$signing_values" -eq "${#signing_keys[@]}" ]]; then
  signed=true
fi

candidate_version_code="$(sed -nE 's/.*caatuuVersionCode.*orElse\(([0-9]+)\).*/\1/p' "$repo_root/apps/android/product/build.gradle.kts" | head -1)"
candidate_version_name="$(sed -nE 's/.*caatuuVersionName.*orElse\("([^"]+)"\).*/\1/p' "$repo_root/apps/android/product/build.gradle.kts" | head -1)"
[[ "$candidate_version_code" =~ ^[1-9][0-9]*$ && -n "$candidate_version_name" ]] || {
  echo "Could not read the Caatuu release version." >&2
  exit 1
}
candidate_receipt="${CAATUU_RELEASE_CANDIDATE_RECEIPT:-$repo_root/artifacts/android/release-candidates/$candidate_version_code.json}"

# One global signed-release lock makes the receipt check and the build one
# atomic decision. Every version shares the same Gradle tree and mutable output
# paths, so different versions must not build concurrently either.
if [[ "$signed" == true ]]; then
  for command in git node flock mkdir; do
    command -v "$command" >/dev/null 2>&1 || {
      echo "$command is required to coordinate a signed Caatuu build." >&2
      exit 1
    }
  done
  mkdir -p "$repo_root/artifacts/android"
  build_lock="$repo_root/artifacts/android/.signed-release-build.lock"
  exec {build_lock_fd}>"$build_lock"
  flock -n "$build_lock_fd" || {
    echo "Another signed Android release build owns the lock; inspect that process and reuse its receipt when it finishes." >&2
    exit 1
  }
fi

# A sealed signed candidate is immutable. Re-running the builder for the same
# source and version verifies and reuses it instead of launching Gradle again.
if [[ "$signed" == true && -f "$candidate_receipt" ]]; then
  for command in git node; do
    command -v "$command" >/dev/null 2>&1 || {
      echo "$command is required to verify the existing Caatuu candidate." >&2
      exit 1
    }
  done
  source_revision="$(git -C "$repo_root" rev-parse --verify HEAD)"
  node "$repo_root/apps/android/tooling/release-candidate.mjs" verify \
    --repo-root "$repo_root" \
    --receipt "$candidate_receipt" \
    --expected-source-revision "$source_revision" >/dev/null
  node -e '
    const receipt = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    if (receipt.identity.version_code !== Number(process.argv[2]) || receipt.identity.version_name !== process.argv[3]) {
      throw new Error("Existing candidate receipt does not match the requested Android version");
    }
  ' "$candidate_receipt" "$candidate_version_code" "$candidate_version_name"
  echo "Reused sealed Caatuu $candidate_version_name (code $candidate_version_code); no Android build was started."
  echo "Candidate receipt: $candidate_receipt"
  exit 0
fi

if [[ "$signed" == true ]]; then
  node "$repo_root/apps/android/tooling/release-publication-state.mjs" assert-new-build-version \
    --durable-floor "$repo_root/apps/android/tooling/pages-current-release.json" \
    --candidate-version-code "$candidate_version_code" >/dev/null
  command -v git >/dev/null 2>&1 || {
    echo "git is required to bind a signed candidate to its source." >&2
    exit 1
  }
  source_revision="$(git -C "$repo_root" rev-parse --verify HEAD)"
  requested_source_revision="${CAATUU_RELEASE_SOURCE_REVISION:-$source_revision}"
  [[ "$requested_source_revision" == "$source_revision" ]] || {
    echo "The requested candidate source revision is not the checked-out commit." >&2
    exit 1
  }
  [[ "$source_revision" == "$(git -C "$repo_root" rev-parse --verify refs/remotes/origin/main)" ]] || {
    echo "Push main before building a signed release candidate." >&2
    exit 1
  }
  [[ -z "$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)" ]] || {
    echo "A signed release candidate requires a clean canonical worktree." >&2
    exit 1
  }
fi

for command in gradle java keytool node unzip apkanalyzer; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is not on PATH. Run: bash apps/android/tooling/setup-sdk.sh" >&2
    exit 1
  fi
done

aapt2_path="${CAATUU_AAPT2:-$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS_VERSION/aapt2}"
if [[ ! -x "$aapt2_path" ]]; then
  fallback_aapt2="$ANDROID_HOME/build-tools/$ANDROID_FALLBACK_BUILD_TOOLS_VERSION/aapt2"
  if [[ -x "$fallback_aapt2" ]]; then
    aapt2_path="$fallback_aapt2"
  else
    echo "aapt2 was not found in the pinned Android build-tools directories." >&2
    exit 1
  fi
fi
apksigner_path="${aapt2_path%/aapt2}/apksigner"
if [[ ! -x "$apksigner_path" ]]; then
  echo "apksigner was not found beside the selected aapt2 binary." >&2
  exit 1
fi

bundletool_root="${CAATUU_BUNDLETOOL_CACHE_ROOT:-$HOME/.gradle/caches/modules-2/files-2.1/com.android.tools.build/bundletool}"
bundletool_jar="${CAATUU_BUNDLETOOL_JAR:-}"
if [[ -z "$bundletool_jar" ]]; then
  mapfile -t bundletool_candidates < <(
    find "$bundletool_root" -type f -name 'bundletool-*.jar' -print 2>/dev/null | sort -V
  )
  if [[ "${#bundletool_candidates[@]}" -gt 0 ]]; then
    bundletool_jar="${bundletool_candidates[${#bundletool_candidates[@]} - 1]}"
  fi
fi
if [[ ! -f "$bundletool_jar" ]]; then
  echo "bundletool is not cached. Run a prepared Android build or set CAATUU_BUNDLETOOL_JAR." >&2
  exit 1
fi

# Gradle already resolved bundletool and its exact transitive dependencies for
# the Android plugin. Reuse that offline cache rather than downloading a second
# mutable copy during a release build.
mapfile -t gradle_cache_jars < <(
  find "$HOME/.gradle/caches/modules-2/files-2.1" -type f -name '*.jar' -print | sort
)
if [[ "${#gradle_cache_jars[@]}" -eq 0 ]]; then
  echo "The Gradle dependency cache is empty; bundletool cannot be started offline." >&2
  exit 1
fi
bundletool_classpath="$bundletool_jar"
for jar in "${gradle_cache_jars[@]}"; do
  if [[ "$jar" != "$bundletool_jar" ]]; then
    bundletool_classpath+=":$jar"
  fi
done
bundletool=(java -cp "$bundletool_classpath" com.android.tools.build.bundletool.BundleToolMain)
bundletool_version="$("${bundletool[@]}" version)"
echo "Using bundletool $bundletool_version from $bundletool_jar"

cd "$repo_root/apps/android"
gradle --no-daemon \
  -PcaatuuDistributionProfile=product \
  :product:generateProductAssets \
  :product:lintRelease \
  :product:assembleRelease \
  :product:bundleRelease

source_aab="$repo_root/apps/android/product/build/outputs/bundle/release/product-release.aab"
if [[ ! -f "$source_aab" ]]; then
  echo "Caatuu AAB was not produced at $source_aab" >&2
  exit 1
fi
if [[ "$signed" == true ]]; then
  source_direct_apk="$repo_root/apps/android/product/build/outputs/apk/release/product-release.apk"
else
  source_direct_apk="$repo_root/apps/android/product/build/outputs/apk/release/product-release-unsigned.apk"
fi
if [[ ! -f "$source_direct_apk" ]]; then
  echo "Caatuu release APK was not produced at $source_direct_apk" >&2
  exit 1
fi

artifact_dir="$repo_root/artifacts/android"
mkdir -p "$artifact_dir"
if [[ "$signed" == true ]]; then
  artifact_stem="caatuu"
  output_apks="$artifact_dir/$artifact_stem.apks"
  output_universal_apk="$artifact_dir/$artifact_stem-universal.apk"
else
  artifact_stem="caatuu-unsigned"
  output_apks="$artifact_dir/caatuu-inspection-debug-signed.apks"
  output_universal_apk="$artifact_dir/caatuu-inspection-debug-signed-universal.apk"
fi
output_aab="$artifact_dir/$artifact_stem.aab"
output_direct_apk="$artifact_dir/$artifact_stem-direct.apk"

cp "$source_aab" "$output_aab"
cp "$source_direct_apk" "$output_direct_apk"

"${bundletool[@]}" validate --bundle="$output_aab"

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/caatuu-product.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT
bundletool_build_args=(
  build-apks
  "--bundle=$output_aab"
  "--output=$output_apks"
  --mode=universal
  "--aapt2=$aapt2_path"
  --overwrite
)
if [[ "$signed" == true ]]; then
  keystore_password_file="$temporary_dir/keystore-password"
  key_password_file="$temporary_dir/key-password"
  printf '%s\n' "$CAATUU_ANDROID_KEYSTORE_PASSWORD" > "$keystore_password_file"
  printf '%s\n' "$CAATUU_ANDROID_KEY_PASSWORD" > "$key_password_file"
  chmod 600 "$keystore_password_file" "$key_password_file"
  bundletool_build_args+=(
    "--ks=$CAATUU_ANDROID_KEYSTORE"
    "--ks-key-alias=$CAATUU_ANDROID_KEY_ALIAS"
    "--ks-pass=file:$keystore_password_file"
    "--key-pass=file:$key_password_file"
  )
  "${bundletool[@]}" "${bundletool_build_args[@]}"
else
  # The release AAB and direct APK remain unsigned. bundletool must sign an APK
  # set, so create a one-use inspection identity and destroy it on exit. The
  # resulting universal APK is package-audit material, never a publishable APK.
  inspection_keystore="$temporary_dir/inspection.p12"
  inspection_password="caatuu-inspection-$RANDOM-$RANDOM-$$"
  inspection_password_file="$temporary_dir/inspection-password"
  printf '%s\n' "$inspection_password" > "$inspection_password_file"
  chmod 600 "$inspection_password_file"
  CAATUU_INSPECTION_PASSWORD="$inspection_password" keytool -genkeypair \
    -keystore "$inspection_keystore" \
    -storetype PKCS12 \
    -storepass:env CAATUU_INSPECTION_PASSWORD \
    -keypass:env CAATUU_INSPECTION_PASSWORD \
    -alias caatuu-product-inspection \
    -dname "CN=Caatuu package inspection, OU=Non-publishable, O=Waajacu, C=CZ" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 1 \
    -noprompt >/dev/null
  bundletool_build_args+=(
    "--ks=$inspection_keystore"
    --ks-key-alias=caatuu-product-inspection
    "--ks-pass=file:$inspection_password_file"
    "--key-pass=file:$inspection_password_file"
  )
  "${bundletool[@]}" "${bundletool_build_args[@]}"
fi

unzip -q -o "$output_apks" universal.apk -d "$temporary_dir/universal"
if [[ ! -f "$temporary_dir/universal/universal.apk" ]]; then
  echo "bundletool did not produce universal.apk inside $output_apks" >&2
  exit 1
fi
cp "$temporary_dir/universal/universal.apk" "$output_universal_apk"
if [[ "$signed" == false ]]; then
  inspection_certificate="$($apksigner_path verify --print-certs "$output_universal_apk")"
  if [[ "$inspection_certificate" != *"CN=Caatuu package inspection"* ]]; then
    echo "The package-audit APK was not signed by the ephemeral inspection identity." >&2
    exit 1
  fi
fi

node "$repo_root/apps/android/tooling/validate-product-package.mjs" \
  --aab "$output_aab" \
  --apk "$output_universal_apk" \
  --apkanalyzer "$(command -v apkanalyzer)" \
  --unzip "$(command -v unzip)"

if [[ "$signed" == true ]]; then
  current_source_revision="$(git -C "$repo_root" rev-parse --verify HEAD)"
  current_origin_revision="$(git -C "$repo_root" rev-parse --verify refs/remotes/origin/main)"
  [[ "$current_source_revision" == "$source_revision" && "$current_origin_revision" == "$source_revision" ]] || {
    echo "Caatuu source or origin/main changed while the signed candidate was building; refusing to seal it." >&2
    exit 1
  }
  [[ -z "$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)" ]] || {
    echo "The canonical worktree changed while the signed candidate was building; refusing to seal it." >&2
    exit 1
  }
  package_name="$(apkanalyzer manifest application-id "$output_universal_apk" | tr -d '\r\n')"
  version_code="$(apkanalyzer manifest version-code "$output_universal_apk" | tr -d '\r\n')"
  version_name="$(apkanalyzer manifest version-name "$output_universal_apk" | tr -d '\r\n')"
  debuggable="$(apkanalyzer manifest debuggable "$output_universal_apk" | tr -d '\r\n')"
  signer_sha256="$(
    "$apksigner_path" verify --verbose --print-certs "$output_universal_apk" \
      | awk -F': ' '/Signer #1 certificate SHA-256 digest:/ { print tolower($2); exit }'
  )"
  [[ "$version_code" == "$candidate_version_code" && "$version_name" == "$candidate_version_name" ]] || {
    echo "Built APK identity does not match the requested Caatuu version." >&2
    exit 1
  }
  node "$repo_root/apps/android/tooling/release-candidate.mjs" seal-existing \
    --repo-root "$repo_root" \
    --apk "artifacts/android/caatuu-universal.apk" \
    --aab "artifacts/android/caatuu.aab" \
    --source-revision "$source_revision" \
    --package-name "$package_name" \
    --version-code "$version_code" \
    --version-name "$version_name" \
    --debuggable "$debuggable" \
    --signer-sha256 "$signer_sha256" \
    --mode builder-emitted \
    --output "$candidate_receipt" >/dev/null
fi

echo "Wrote $output_aab"
echo "Wrote $output_direct_apk (direct build; diagnostic only)"
echo "Wrote $output_apks"
if [[ "$signed" == true ]]; then
  echo "Wrote $output_universal_apk (authoritative package audit input)"
  echo "Wrote $candidate_receipt (immutable release-candidate receipt)"
else
  echo "Wrote $output_universal_apk (ephemerally debug-signed package audit input; do not publish)"
fi
