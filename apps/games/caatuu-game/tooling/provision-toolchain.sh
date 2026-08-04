#!/usr/bin/env bash
set -Eeuo pipefail

readonly toolchain_root="/toolchain"
readonly downloads_root="${toolchain_root}/downloads"
readonly engine_url="https://github.com/godotengine/godot-builds/releases/download/4.7.1-stable/Godot_v4.7.1-stable_linux.x86_64.zip"
readonly engine_archive="${downloads_root}/Godot_v4.7.1-stable_linux.x86_64.zip"
readonly engine_archive_sha256="c7ff14fd28472c8d4f193043de30278dcf7e5241a1dcf7566b02e27addaa33ba"
readonly templates_url="https://github.com/godotengine/godot-builds/releases/download/4.7.1-stable/Godot_v4.7.1-stable_export_templates.tpz"
readonly template_member="templates/web_nothreads_release.zip"
readonly template_sha256="b7b7d7da29fc6cc2f4934fdd26cc571a40e7af57f716ea3eb7e18da720dae28a"
readonly version_member="templates/version.txt"
readonly version_sha256="233b4ce93ffa3c6bc967b45dcfcdf2d29c7d65878d0af6d2fc7c95661d585013"

test "$(realpath -m "${toolchain_root}")" = "/toolchain"
mkdir -p "${downloads_root}" "${toolchain_root}/bin" "${toolchain_root}/templates/4.7.1.stable"
chmod -R u+w "${toolchain_root}"

download_verified() {
    local url="$1"
    local output="$2"
    local expected_hash="$3"
    local partial="${output}.partial"

    if test -s "${output}" \
        && printf '%s  %s\n' "${expected_hash}" "${output}" | sha256sum --check --strict >/dev/null; then
        return
    fi

    for attempt in 1 2; do
        if ! curl \
            --continue-at - \
            --fail \
            --location \
            --output "${partial}" \
            --retry 20 \
            --retry-all-errors \
            --retry-delay 2 \
            --speed-limit 16384 \
            --speed-time 60 \
            "${url}"; then
            rm -f "${partial}"
            printf 'Download attempt %d failed for %s.\n' "${attempt}" "${url}" >&2
            continue
        fi
        if printf '%s  %s\n' "${expected_hash}" "${partial}" \
            | sha256sum --check --strict; then
            mv "${partial}" "${output}"
            return
        fi
        rm -f "${partial}"
        printf 'Verified download attempt %d failed for %s.\n' "${attempt}" "${url}" >&2
    done
    return 1
}

download_verified "${engine_url}" "${engine_archive}" "${engine_archive_sha256}"

readonly engine_stage="${toolchain_root}/bin.next"
rm -rf -- "${engine_stage}"
mkdir -p "${engine_stage}"
unzip -q "${engine_archive}" -d "${engine_stage}"
rm -rf -- "${toolchain_root}/bin/godot"
mv \
    "${engine_stage}/Godot_v4.7.1-stable_linux.x86_64" \
    "${toolchain_root}/bin/godot"
rm -rf -- "${engine_stage}"
chmod 0555 "${toolchain_root}/bin/godot"

readonly template_path="${toolchain_root}/templates/4.7.1.stable/web_nothreads_release.zip"
readonly version_path="${toolchain_root}/templates/4.7.1.stable/version.txt"
if ! test -s "${template_path}" \
    || ! printf '%s  %s\n' "${template_sha256}" "${template_path}" \
        | sha256sum --check --strict >/dev/null \
    || ! test -s "${version_path}" \
    || ! printf '%s  %s\n' "${version_sha256}" "${version_path}" \
        | sha256sum --check --strict >/dev/null; then
    python3 /opt/caatuu-game/extract_remote_zip.py \
        --url "${templates_url}" \
        --member "${template_member}" \
        --expect "${template_member}=${template_sha256}" \
        --member "${version_member}" \
        --expect "${version_member}=${version_sha256}" \
        --output "${toolchain_root}/templates/4.7.1.stable"
fi

cp /opt/licenses/GODOT-LICENSE.txt "${toolchain_root}/GODOT-LICENSE.txt"
printf '%s\n' \
    "godot_version=4.7.1.stable" \
    "editor_archive_sha256=${engine_archive_sha256}" \
    "web_nothreads_release_sha256=${template_sha256}" \
    "template_version_sha256=${version_sha256}" \
    > "${toolchain_root}/READY"

chmod -R a-w "${toolchain_root}/bin" "${toolchain_root}/templates" "${toolchain_root}/GODOT-LICENSE.txt"
printf 'Godot 4.7.1 Web toolchain is ready in %s.\n' "${toolchain_root}"
