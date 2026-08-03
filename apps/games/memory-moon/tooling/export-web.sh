#!/usr/bin/env bash
set -Eeuo pipefail

readonly project_source="/project"
readonly reference_root="/reference"
readonly macaw_reference_root="/macaw-reference"
readonly scenery_source_root="/scenery-source"
readonly work_root="/work/memory-moon"
readonly stage_root="/work/web-export"
readonly output_root="/output"
readonly bundle_manifest_name="bundle-manifest.json"
readonly bundle_manifest_schema="caatuu-game-web-bundle"
readonly game_id="memory-moon"
readonly game_version="0.1.0"
readonly artifact_version="godot-v1"
readonly engine_name="godot"
readonly scenery_metadata_root="${scenery_source_root}/metadata"
readonly scenery_images_root="${scenery_source_root}/images"
readonly -a required_notice_paths=(
    "LICENSES/Godot-MIT.txt"
    "LICENSES/Macaw-Parts-CC0.md"
    "LICENSES/Memory-Grove-Provenance.md"
    "LICENSES/Memory-Moon-Style-Provenance.md"
    "LICENSES/Quaternius-CC0.txt"
    "THIRD_PARTY_NOTICES.md"
)
readonly -a scenery_image_names=(
    "community-tree.png"
    "flower-patch.png"
    "moon-bush.png"
    "moon-sapling.png"
    "moss-boulder.png"
    "street-lamp.png"
    "terrain-atlas.png"
    "trail-sign.png"
    "tree-birch.png"
    "tree-maple.png"
    "tree-oak.png"
    "tree-pine.png"
    "tree-poplar.png"
    "tree-stump.png"
    "tree-willow.png"
    "village-well.png"
)
readonly glb_name="AnimationLibrary_Godot_Standard.glb"
readonly reference_license_name="Quaternius-License.txt"
readonly macaw_parts_relative_path="sources/prepared-parts/macaw-traveler-parts-sheet-v1.png"
readonly macaw_license_name="LICENSE-CC0.md"
readonly engine_archive="/toolchain/downloads/Godot_v4.7.1-stable_linux.x86_64.zip"
readonly engine_member="Godot_v4.7.1-stable_linux.x86_64"
readonly engine_archive_sha256="c7ff14fd28472c8d4f193043de30278dcf7e5241a1dcf7566b02e27addaa33ba"
readonly glb_sha256="1b7bf67866360665426bb99e4c71bd619f19b408453c24e30f0c3071601eee5c"
readonly reference_license_sha256="dfd829af5caf503d6f6bf80096124e8a60117c3c123a6e6a20199547203e0a3e"
readonly macaw_parts_sha256="8761ea535ad5d5550989a9c2b9c92e7b163af032f6ed952b3b15024d16378419"
readonly macaw_license_sha256="3185a4005a31eb8aabed1b0e3936a49115c9909cb9987f780c145f79ba141f08"
readonly template_sha256="b7b7d7da29fc6cc2f4934fdd26cc571a40e7af57f716ea3eb7e18da720dae28a"
readonly version_sha256="233b4ce93ffa3c6bc967b45dcfcdf2d29c7d65878d0af6d2fc7c95661d585013"
readonly scenery_catalog_sha256="cf27415129bf1d90b146d4abd1d8856ce40d364f6bc4df91a444fef6c72ff391"
readonly scenery_layout_sha256="e72968db90a879e71d498f12446af1cca083e93977f114627560943dd4195a79"
readonly scenery_tileset_sha256="06d5b133ff7bcba2c23f3fc015421badf22aeb50198b670b809621d3b4828dd4"

run_godot_checked() {
    local label="$1"
    shift
    local log_path="/work/${label}.log"

    if ! godot "$@" 2>&1 | tee "${log_path}"; then
        printf 'Godot %s command failed.\n' "${label}" >&2
        return 1
    fi
    if grep -Eq '(^|[[:space:]])(SCRIPT ERROR|ERROR):' "${log_path}"; then
        printf 'Godot %s command reported engine or script errors.\n' "${label}" >&2
        return 1
    fi
}

test "$(realpath -m "${work_root}")" = "/work/memory-moon"
test "$(realpath -m "${stage_root}")" = "/work/web-export"
test "$(realpath -m "${output_root}")" = "/output"
test "$(realpath -m "${scenery_source_root}")" = "/scenery-source"
test -r "${project_source}/project.godot"
test -r "${project_source}/export_presets.cfg"
test ! -e "${project_source}/assets/scenery"
test -r "${scenery_metadata_root}/catalog.json"
test -r "${scenery_metadata_root}/world.json"
test -r "${scenery_metadata_root}/checksums.sha256"
test -r "${scenery_metadata_root}/catalog.provenance.md"
test -r "${scenery_metadata_root}/world.provenance.md"
for scenery_image_name in "${scenery_image_names[@]}"; do
    test -r "${scenery_images_root}/${scenery_image_name}"
done
test -r "${reference_root}/${glb_name}"
test -r "${reference_root}/${reference_license_name}"
test -r "${macaw_reference_root}/${macaw_parts_relative_path}"
test -r "${macaw_reference_root}/${macaw_license_name}"
test -x /toolchain/bin/godot
test -r "${engine_archive}"
test -r /toolchain/READY
grep -Fxq "godot_version=4.7.1.stable" /toolchain/READY
printf '%s  %s\n' "${engine_archive_sha256}" "${engine_archive}" \
    | sha256sum --check --strict
printf '%s  %s\n' \
    "${template_sha256}" \
    /toolchain/templates/4.7.1.stable/web_nothreads_release.zip \
    | sha256sum --check --strict
printf '%s  %s\n' \
    "${version_sha256}" \
    /toolchain/templates/4.7.1.stable/version.txt \
    | sha256sum --check --strict
engine_hash_line="$(sha256sum /toolchain/bin/godot)"
readonly engine_hash="${engine_hash_line%% *}"
archive_engine_hash_line="$(unzip -p "${engine_archive}" "${engine_member}" | sha256sum)"
readonly archive_engine_hash="${archive_engine_hash_line%% *}"
if test "${engine_hash}" != "${archive_engine_hash}"; then
    printf 'Godot executable does not match the pinned editor archive.\n' >&2
    exit 1
fi
readonly godot_version="$(godot --headless --version)"
case "${godot_version}" in
    4.7.1.stable.*) ;;
    *)
        printf 'Unexpected Godot version: %s\n' "${godot_version}" >&2
        exit 1
        ;;
esac

printf '%s  %s\n' "${glb_sha256}" "${reference_root}/${glb_name}" \
    | sha256sum --check --strict
printf '%s  %s\n' "${reference_license_sha256}" "${reference_root}/${reference_license_name}" \
    | sha256sum --check --strict
printf '%s  %s\n' \
    "${macaw_parts_sha256}" \
    "${macaw_reference_root}/${macaw_parts_relative_path}" \
    | sha256sum --check --strict
printf '%s  %s\n' \
    "${macaw_license_sha256}" \
    "${macaw_reference_root}/${macaw_license_name}" \
    | sha256sum --check --strict
printf '%s  %s\n' \
    "${scenery_catalog_sha256}" \
    "${scenery_metadata_root}/catalog.json" \
    | sha256sum --check --strict
printf '%s  %s\n' \
    "${scenery_layout_sha256}" \
    "${scenery_metadata_root}/world.json" \
    | sha256sum --check --strict
printf '%s  %s\n' \
	"${scenery_tileset_sha256}" \
	"${scenery_images_root}/terrain-atlas.png" \
	| sha256sum --check --strict
(
    cd "${scenery_source_root}"
    sha256sum --check --strict metadata/checksums.sha256
)

rm -rf -- "${work_root}" "${stage_root}"
mkdir -p \
    "${HOME}" \
    "${XDG_CACHE_HOME}" \
    "${XDG_CONFIG_HOME}" \
    "${XDG_DATA_HOME}/godot/export_templates" \
    "${work_root}/assets" \
    "${work_root}/assets/macaw" \
    "${work_root}/assets/scenery/metadata" \
    "${work_root}/assets/scenery/images" \
    "${stage_root}"

ln -s /toolchain/templates/4.7.1.stable \
    "${XDG_DATA_HOME}/godot/export_templates/4.7.1.stable"

cp -R "${project_source}/." "${work_root}/"
cp \
    "${scenery_metadata_root}/catalog.json" \
    "${scenery_metadata_root}/world.json" \
    "${work_root}/assets/scenery/metadata/"
for scenery_image_name in "${scenery_image_names[@]}"; do
    cp \
        "${scenery_images_root}/${scenery_image_name}" \
        "${work_root}/assets/scenery/images/${scenery_image_name}"
done
cp "${reference_root}/${glb_name}" "${work_root}/assets/humanoid.glb"
cp \
    "${macaw_reference_root}/${macaw_parts_relative_path}" \
    "${work_root}/assets/macaw/macaw-parts.png"

rm -rf -- "${work_root}/.godot" "${work_root}/build"

run_godot_checked import \
    --headless \
    --path "${work_root}" \
    --import
run_godot_checked scenery \
    --headless \
    --path "${work_root}" \
    --script res://tooling/verify-world-scenery.gd
grep -Fxq \
	"MEMORY_MOON_SCENERY_SMOKE_OK layout=memory-grove-v6 terrain=chunk-stream chunks=49/144 tiles=441/1296 map_tiles=144 atlas_tiles=48 used_tile_types=32 navigation=true prop_placements=18 collision_objects=18 shadows=0" \
	/work/scenery.log
run_godot_checked movement \
    --headless \
    --path "${work_root}" \
    --script res://tooling/verify-movement.gd
grep -Fxq \
    "MEMORY_MOON_MOVEMENT_SMOKE_OK rates=30/60/120 acceleration=true braking=true arrival=true overshoot=false reversal=brake-first corner_drift_max=0.16 speed_cap=2.6 arrival_spread_max=0.12 los=string-pulled capsule_clearance=0.28 supercover=safe deterministic=true precise_target=fallback same_cell=move-to-center stall_progress=route-distance" \
    /work/movement.log
run_godot_checked responsive \
    --headless \
    --path "${work_root}" \
    --script res://tooling/verify-responsive-layout.gd
grep -Fxq \
    "MEMORY_MOON_RESPONSIVE_SMOKE_OK landscape=960x540 landscape_camera_height=8.7097 portrait=390x844 portrait_camera_height=10.5000 click_navigation=true direction_buttons=false compact=true camera=isometric-orthographic yaw=45 elevation=30 axis_dead_zone=true smooth_follow=true large_world_follow=true native_root=true native_hud=true" \
    /work/responsive.log
run_godot_checked costume-fallback \
    --headless \
    --path "${work_root}" \
    --script res://tooling/verify-macaw-costume.gd
grep -Fxq "MACAW_COSTUME_FALLBACK_OK zero_orphans=true" /work/costume-fallback.log
run_godot_checked smoke \
    --headless \
    --path "${work_root}" \
    --quit-after 4 \
    -- \
    --require-macaw-costume
grep -Fxq "MACAW_COSTUME_SMOKE_OK attachments=9 articulated=6" /work/smoke.log
run_godot_checked export \
    --headless \
    --path "${work_root}" \
    --export-release "Web" \
    "${stage_root}/index.html"

for artifact in index.html index.js index.pck index.wasm; do
    test -s "${stage_root}/${artifact}"
done

find "${output_root}" \
    -mindepth 1 \
    -maxdepth 1 \
    ! -name .gitkeep \
    -exec rm -rf -- {} +
cp -R "${stage_root}/." "${output_root}/"
mkdir -p "${output_root}/LICENSES"
cp "${project_source}/GODOT-LICENSE.txt" "${output_root}/LICENSES/Godot-MIT.txt"
cp "${reference_root}/${reference_license_name}" "${output_root}/LICENSES/Quaternius-CC0.txt"
cp "${macaw_reference_root}/${macaw_license_name}" "${output_root}/LICENSES/Macaw-Parts-CC0.md"
cp \
    "${scenery_metadata_root}/catalog.provenance.md" \
    "${output_root}/LICENSES/Memory-Moon-Style-Provenance.md"
cp \
    "${scenery_metadata_root}/world.provenance.md" \
    "${output_root}/LICENSES/Memory-Grove-Provenance.md"
cp "${project_source}/THIRD_PARTY_NOTICES.md" "${output_root}/THIRD_PARTY_NOTICES.md"

for artifact in index.html index.js index.pck index.wasm; do
    test -s "${output_root}/${artifact}"
done
for notice_path in "${required_notice_paths[@]}"; do
    test -s "${output_root}/${notice_path}"
done

unexpected_entry="$(
    find "${output_root}" \
        -mindepth 1 \
        \( -type l -o \( ! -type d ! -type f \) \) \
        -print \
        -quit
)"
if test -n "${unexpected_entry}"; then
    printf 'Web bundle contains an unsupported entry: %s\n' "${unexpected_entry}" >&2
    exit 1
fi

readonly bundle_manifest_path="${output_root}/${bundle_manifest_name}"
readonly bundle_manifest_temp_path="${output_root}/.${bundle_manifest_name}.tmp"
rm -f -- "${bundle_manifest_path}" "${bundle_manifest_temp_path}"

file_count=0
first_file=true
{
    printf '{\n'
    printf '  "schema_name": "%s",\n' "${bundle_manifest_schema}"
    printf '  "schema_version": 1,\n'
    printf '  "game": {\n'
    printf '    "id": "%s",\n' "${game_id}"
    printf '    "version": "%s",\n' "${game_version}"
    printf '    "artifact_version": "%s"\n' "${artifact_version}"
    printf '  },\n'
    printf '  "engine": {\n'
    printf '    "name": "%s",\n' "${engine_name}"
    printf '    "version": "%s"\n' "${godot_version}"
    printf '  },\n'
    printf '  "entrypoint": "index.html",\n'
    printf '  "required_notices": [\n'
    for notice_index in "${!required_notice_paths[@]}"; do
        notice_path="${required_notice_paths[${notice_index}]}"
        if test "${notice_index}" -lt "$((${#required_notice_paths[@]} - 1))"; then
            printf '    "%s",\n' "${notice_path}"
        else
            printf '    "%s"\n' "${notice_path}"
        fi
    done
    printf '  ],\n'
    printf '  "files": [\n'
    while IFS= read -r -d '' relative_path; do
        if [[ ! "${relative_path}" =~ ^[A-Za-z0-9._/-]+$ ]] \
            || [[ "${relative_path}" == /* ]] \
            || [[ "${relative_path}" == *//* ]] \
            || [[ "/${relative_path}/" == */./* ]] \
            || [[ "/${relative_path}/" == */../* ]]; then
            printf 'Web bundle path is not manifest-safe: %s\n' "${relative_path}" >&2
            exit 1
        fi
        file_path="${output_root}/${relative_path}"
        byte_count="$(stat --format='%s' "${file_path}")"
        hash_line="$(sha256sum "${file_path}")"
        sha256="${hash_line%% *}"
        if test "${first_file}" = true; then
            first_file=false
        else
            printf ',\n'
        fi
        printf '    {\n'
        printf '      "path": "%s",\n' "${relative_path}"
        printf '      "bytes": %s,\n' "${byte_count}"
        printf '      "sha256": "%s"\n' "${sha256}"
        printf '    }'
        file_count="$((file_count + 1))"
    done < <(
        find "${output_root}" \
            -type f \
            ! -path "${bundle_manifest_path}" \
            ! -path "${bundle_manifest_temp_path}" \
            -printf '%P\0' \
            | LC_ALL=C sort --zero-terminated
    )
    printf '\n  ]\n'
    printf '}\n'
} > "${bundle_manifest_temp_path}"

if test "${file_count}" -eq 0; then
    printf 'Web bundle manifest would contain no files.\n' >&2
    exit 1
fi
mv -- "${bundle_manifest_temp_path}" "${bundle_manifest_path}"

printf 'Memory Moon Web export completed with Godot '
godot --headless --version
