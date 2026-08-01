#!/usr/bin/env bash
set -Eeuo pipefail

readonly project_source="/project"
readonly reference_root="/reference"
readonly macaw_reference_root="/macaw-reference"
readonly scenery_source_root="/scenery-source"
readonly work_root="/work/memory-moon"
readonly stage_root="/work/web-export"
readonly output_root="/output"
readonly scenery_style_root="${scenery_source_root}/memory-moon-style-v1"
readonly scenery_layout_root="${scenery_source_root}/memory-grove-v6"
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
readonly scenery_catalog_sha256="dfcb4d6b1152d1a6789b73332b98b6e455f57da3c4d7845929dc58d668693320"
readonly scenery_layout_sha256="58060ac36a3fbdbdb9859fcfd5789ee5ad31ab6f499267881453c690ab5a092a"
readonly scenery_tileset_sha256="2599b115dd4f5528eb9e8a1e62dff2cc786541593f9e3a803392f97e663b6bcb"

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
test -r "${scenery_style_root}/catalog.json"
test -r "${scenery_style_root}/manifest.json"
test -r "${scenery_style_root}/SHA256SUMS"
test -r "${scenery_style_root}/PROVENANCE.md"
test -r "${scenery_layout_root}/layout.json"
test -r "${scenery_layout_root}/manifest.json"
test -r "${scenery_layout_root}/PROVENANCE.md"
test -r "${scenery_layout_root}/terrain/moonroot-reusable-tiles-v1.png"
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
    "${scenery_style_root}/catalog.json" \
    | sha256sum --check --strict
printf '%s  %s\n' \
    "${scenery_layout_sha256}" \
    "${scenery_layout_root}/layout.json" \
    | sha256sum --check --strict
printf '%s  %s\n' \
	"${scenery_tileset_sha256}" \
	"${scenery_layout_root}/terrain/moonroot-reusable-tiles-v1.png" \
	| sha256sum --check --strict
(
    cd "${scenery_style_root}"
    sha256sum --check --strict SHA256SUMS
)

rm -rf -- "${work_root}" "${stage_root}"
mkdir -p \
    "${HOME}" \
    "${XDG_CACHE_HOME}" \
    "${XDG_CONFIG_HOME}" \
    "${XDG_DATA_HOME}/godot/export_templates" \
    "${work_root}/assets" \
    "${work_root}/assets/macaw" \
    "${work_root}/assets/scenery/memory-moon-style-v1" \
    "${work_root}/assets/scenery/memory-grove-v6" \
    "${stage_root}"

ln -s /toolchain/templates/4.7.1.stable \
    "${XDG_DATA_HOME}/godot/export_templates/4.7.1.stable"

cp -R "${project_source}/." "${work_root}/"
cp -R \
    "${scenery_style_root}/." \
    "${work_root}/assets/scenery/memory-moon-style-v1/"
cp -R \
    "${scenery_layout_root}/." \
    "${work_root}/assets/scenery/memory-grove-v6/"
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
	"MEMORY_MOON_SCENERY_SMOKE_OK layout=memory-grove-v6 terrain=chunk-stream chunks=25/64 tiles=225/576 map_tiles=144 atlas_tiles=20 used_tile_types=16 navigation=true prop_placements=18 collision_objects=18 shadows=0" \
	/work/scenery.log
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
    "${scenery_style_root}/PROVENANCE.md" \
    "${output_root}/LICENSES/Memory-Moon-Style-Provenance.md"
cp \
    "${scenery_layout_root}/PROVENANCE.md" \
    "${output_root}/LICENSES/Memory-Grove-Provenance.md"
cp "${project_source}/THIRD_PARTY_NOTICES.md" "${output_root}/THIRD_PARTY_NOTICES.md"

printf 'Memory Moon Web export completed with Godot '
godot --headless --version
