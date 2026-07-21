"""Tests for the AF-044 Blender frame review packager."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, PngImagePlugin

from animated_fabric.domain.exceptions import ExportError, ExportFailureKind
from animated_fabric.domain.export import GridSpritesheetMetadata
from animated_fabric.infrastructure.exporters import GridSpritesheetPacker
from scripts.generate_af052_directional_goldens import generate_directional_goldens
from scripts.package_blender_directional_export import (
    main as directional_export_main,
)
from scripts.package_blender_directional_export import (
    package_blender_directional_export,
)
from scripts.package_blender_walk_demo import package_blender_walk_demo
from scripts.verify_blender_directional_goldens import verify_directional_goldens
from tools.blender import evidence, motion

APP_ROOT = Path(__file__).resolve().parents[2]


def _mirror_difference(root: Path, direct: str, source: str) -> float:
    different_pixels = 0
    pixel_count = motion.FRAME_SIZE[0] * motion.FRAME_SIZE[1] * motion.FRAME_COUNT
    for index in range(motion.FRAME_COUNT):
        with Image.open(root / "walk" / direct / f"{index:03d}.png") as direct_image:
            direct_pixels = np.asarray(direct_image, dtype=np.uint8).copy()
        with Image.open(root / "walk" / source / f"{index:03d}.png") as source_image:
            source_pixels = np.asarray(source_image, dtype=np.uint8).copy()
        delta = np.abs(
            direct_pixels.astype(np.int16) - np.flip(source_pixels, axis=1).astype(np.int16)
        )
        different_pixels += int(np.count_nonzero(np.any(delta > 1, axis=2)))
    return round(different_pixels / pixel_count, 8)


def _write_sequence(
    root: Path,
    *,
    transparent_frame: bool = False,
    edge_frame: bool = False,
) -> None:
    animation_root = root / "walk"
    for direction_index, direction in enumerate(motion.DIRECTIONS):
        direction_root = animation_root / direction
        direction_root.mkdir(parents=True)
        for index in range(motion.FRAME_COUNT):
            destination = direction_root / f"{index:03d}.png"
            image = Image.new("RGBA", motion.FRAME_SIZE, (0, 0, 0, 0))
            if not (transparent_frame and direction == "SE" and index == 0):
                color = (60 + direction_index * 35, 120, 210 - (index % 4) * 30, 255)
                start_x = 0 if edge_frame and direction == "SE" and index == 0 else 70 + index % 4
                for x in range(start_x, 122 + index % 4):
                    for y in range(45, 165):
                        image.putpixel((x, y), color)
            image.save(destination, format="PNG")
    (animation_root / "animation.json").write_text(
        motion.canonical_manifest_json(),
        encoding="utf-8",
    )
    shared_frames = motion.walk_frames()
    directional_path = root / motion.DIRECTIONAL_PRERENDER_FILENAME
    directional_path.write_text(
        motion.canonical_directional_prerender_json(shared_frames),
        encoding="utf-8",
    )
    hashes = {
        path.relative_to(root).as_posix(): evidence.sha256_file(path)
        for path in animation_root.rglob("*")
        if path.is_file()
    }
    hashes[motion.DIRECTIONAL_PRERENDER_FILENAME] = evidence.sha256_file(directional_path)
    total_bytes = sum(root.joinpath(*relative.split("/")).stat().st_size for relative in hashes)
    provenance = {
        "format": evidence.EVIDENCE_FORMAT,
        "schema_version": evidence.EVIDENCE_SCHEMA_VERSION,
        "ticket": "AF-044",
        "source": {
            "kind": "owned_procedural_humanoid",
            "animation": "one_in_place_walk",
            **evidence.source_hashes(
                APP_ROOT / "tools" / "blender",
                APP_ROOT / "containers" / "blender" / "Dockerfile",
                APP_ROOT / "compose.yaml",
            ),
        },
        "container": {
            "image": evidence.CONTAINER_IMAGE,
            "platform": evidence.CONTAINER_PLATFORM,
            "runtime_network": "none",
        },
        "blender": {
            "version": evidence.BLENDER_VERSION,
            "archive_sha256": evidence.BLENDER_ARCHIVE_SHA256,
            "render_engine": "CYCLES",
            "device": "CPU",
            "samples": 32,
            "threads": 2,
            "seed": 0,
        },
        "motion": {
            "stance_ratio": motion.STANCE_RATIO,
            "stride_length": motion.STRIDE_LENGTH,
            "foot_lift": motion.FOOT_LIFT,
            "stance_width": motion.STANCE_WIDTH,
            "pelvis_base_height": motion.PELVIS_BASE_HEIGHT,
            "pelvis_bob": motion.PELVIS_BOB,
            "pelvis_sway": motion.PELVIS_SWAY,
            "arm_swing": motion.ARM_SWING,
            "sha256": motion.motion_sha256(shared_frames),
        },
        "render": {
            "frame_size": list(motion.FRAME_SIZE),
            "ground_origin": list(motion.GROUND_ORIGIN),
            "fps": motion.FPS,
            "duration_ms": motion.DURATION_MS,
            "frames_per_direction": motion.FRAME_COUNT,
            "directions": list(motion.DIRECTIONS),
            "direction_yaw_degrees": dict(motion.DIRECTION_YAW_DEGREES),
            "camera_location": [6.0, -6.0, 7.301],
            "camera_target": [0.0, 0.0, 1.301],
            "camera_orthographic_scale": 3.0,
            "transparent": True,
            "color_transform": "Standard",
            "scene_objects": 32,
            "scene_objects_max": evidence.MAX_SCENE_OBJECTS,
        },
        "mirror_comparison": {
            "direct_SW_vs_mirrored_SE": {
                "mean_absolute_rgba": 0.03,
                "maximum_absolute_rgba": 1.0,
                "different_pixel_fraction": _mirror_difference(root, "SW", "SE"),
            },
            "direct_NW_vs_mirrored_NE": {
                "mean_absolute_rgba": 0.03,
                "maximum_absolute_rgba": 1.0,
                "different_pixel_fraction": _mirror_difference(root, "NW", "NE"),
            },
        },
        "outputs": {
            "file_count": evidence.EXPECTED_FILE_COUNT,
            "total_bytes": total_bytes,
            "max_bytes": evidence.MAX_OUTPUT_BYTES,
            "sha256": hashes,
        },
    }
    (root / "provenance.json").write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _published_bytes(destination: Path) -> dict[str, bytes]:
    return {
        path.relative_to(destination).as_posix(): path.read_bytes()
        for path in sorted(destination.rglob("*"))
        if path.is_file()
    }


def _assert_no_transaction_debris(destination: Path) -> None:
    assert list(destination.parent.glob(f".{destination.name}.stage-*")) == []
    assert list(destination.parent.glob(f".{destination.name}.backup-*")) == []


def _refresh_output_provenance(source: Path, relative: str) -> None:
    provenance_path = source / "provenance.json"
    payload = json.loads(provenance_path.read_text(encoding="utf-8"))
    payload["outputs"]["sha256"][relative] = evidence.sha256_file(source / relative)
    payload["outputs"]["total_bytes"] = sum(
        source.joinpath(*path.split("/")).stat().st_size for path in payload["outputs"]["sha256"]
    )
    provenance_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


class _OccupiedOutputPacker(GridSpritesheetPacker):
    def pack_animation(self, **kwargs: object) -> object:
        destination_root = kwargs["destination_root"]
        assert isinstance(destination_root, Path)
        (destination_root / "walk.png").write_bytes(b"occupied")
        return super().pack_animation(**kwargs)  # type: ignore[arg-type,return-value]


class _SourceMutatingPacker(GridSpritesheetPacker):
    def __init__(self, source: Path) -> None:
        self._source = source

    def pack_animation(self, **kwargs: object) -> object:
        result = super().pack_animation(**kwargs)  # type: ignore[arg-type]
        (self._source / "walk" / "SE" / "000.png").write_bytes(b"changed")
        return result


class _Cancellation:
    def is_cancelled(self) -> bool:
        return True


class _CancelAfterProductStaged:
    def __init__(self, destination: Path) -> None:
        self._destination = destination

    def is_cancelled(self) -> bool:
        return any(
            (stage / "walk.spritesheet.json").is_file()
            for stage in self._destination.parent.glob(f".{self._destination.name}.stage-*")
        )


def test_directional_golden_candidates_verify_decoded_pixels_and_mirror_distinction(
    tmp_path: Path,
) -> None:
    source = tmp_path / "render"
    golden_root = tmp_path / "goldens"
    _write_sequence(source)

    written = generate_directional_goldens(source, golden_root)
    summary = verify_directional_goldens(source, golden_root)

    assert len(written) == len(motion.DIRECTIONS)
    assert summary.maximum_golden_difference == 0
    assert summary.maximum_golden_outlier_fraction == 0.0
    assert summary.direct_sw_difference >= 0.10
    assert summary.direct_nw_difference >= 0.10
    with pytest.raises(ValueError, match="Refusing to replace"):
        generate_directional_goldens(source, golden_root)
    with pytest.raises(ExportError):
        generate_directional_goldens(source, source / "goldens")


def test_directional_golden_verifier_enforces_channel_and_pixel_tolerances(
    tmp_path: Path,
) -> None:
    source = tmp_path / "render"
    golden_root = tmp_path / "goldens"
    _write_sequence(source)
    generate_directional_goldens(source, golden_root)
    target = golden_root / "af052_blender_walk_se_t0000.png"
    with Image.open(target) as image:
        changed = image.copy()
    original = changed.getpixel((0, 0))
    changed.putpixel((0, 0), (original[0] + 2, *original[1:]))
    changed.save(target, format="PNG")
    assert verify_directional_goldens(source, golden_root).maximum_golden_difference == 2

    second = changed.getpixel((1, 0))
    changed.putpixel((1, 0), (second[0] + 3, *second[1:]))
    changed.save(target, format="PNG")
    with pytest.raises(ValueError, match="max_channel=3"):
        verify_directional_goldens(source, golden_root)

    changed.putpixel((1, 0), second)
    for x in range(1, 37):
        pixel = changed.getpixel((x, 0))
        changed.putpixel((x, 0), (pixel[0] + 1, *pixel[1:]))
    changed.save(target, format="PNG")
    with pytest.raises(ValueError, match="outlier_fraction"):
        verify_directional_goldens(source, golden_root)


def test_committed_directional_goldens_match_scoped_cc0_provenance() -> None:
    golden_root = APP_ROOT / "tests" / "golden"
    provenance = json.loads(
        (golden_root / "af052_blender_walk.provenance.json").read_text(encoding="utf-8")
    )
    expected_names = {name for name in provenance["paths"]}

    assert expected_names == {
        "af052_blender_walk_se_t0000.png",
        "af052_blender_walk_sw_t0000.png",
        "af052_blender_walk_ne_t0000.png",
        "af052_blender_walk_nw_t0000.png",
    }
    assert provenance["license"] == "CC0-1.0"
    assert provenance["attribution_required"] is False
    assert "SPDX-License-Identifier: CC0-1.0" in (
        golden_root / provenance["license_notice"]
    ).read_text(encoding="utf-8")
    for name, expected_hash in provenance["paths"].items():
        assert evidence.sha256_file(golden_root / name) == expected_hash


def test_directional_product_packager_writes_verified_deterministic_grid(
    tmp_path: Path,
) -> None:
    source = tmp_path / "render"
    destination = tmp_path / "product"
    _write_sequence(source)

    first = package_blender_directional_export(source, destination)
    first_bytes = _published_bytes(destination)
    (destination / "stale.txt").write_text("stale", encoding="utf-8")
    second = package_blender_directional_export(source, destination)

    assert first == second
    assert _published_bytes(destination) == first_bytes
    assert set(first_bytes) == {"walk.png", "walk.spritesheet.json"}
    assert first.animations[0].frame_count == motion.FRAME_COUNT
    metadata = GridSpritesheetMetadata.model_validate_json(
        (destination / "walk.spritesheet.json").read_bytes()
    )
    assert tuple(direction.value for direction in metadata.directions) == motion.DIRECTIONS
    assert metadata.frames_per_direction == motion.FRAME_COUNT
    assert metadata.fps == motion.FPS
    assert metadata.duration_ms == motion.DURATION_MS
    assert metadata.frame_size.width == motion.FRAME_SIZE[0]
    assert metadata.frame_size.height == motion.FRAME_SIZE[1]

    with Image.open(destination / "walk.png") as sheet:
        sheet.load()
        assert sheet.format == "PNG"
        assert sheet.mode == "RGBA"
        assert sheet.size == (
            motion.FRAME_SIZE[0] * motion.FRAME_COUNT,
            motion.FRAME_SIZE[1] * len(motion.DIRECTIONS),
        )
        for row, direction in enumerate(motion.DIRECTIONS):
            for index in range(motion.FRAME_COUNT):
                left = index * motion.FRAME_SIZE[0]
                top = row * motion.FRAME_SIZE[1]
                cell = sheet.crop(
                    (
                        left,
                        top,
                        left + motion.FRAME_SIZE[0],
                        top + motion.FRAME_SIZE[1],
                    )
                )
                with Image.open(source / "walk" / direction / f"{index:03d}.png") as frame:
                    frame.load()
                    assert cell.tobytes() == frame.tobytes()
    _assert_no_transaction_debris(destination)


def test_directional_product_packager_preserves_previous_output_on_tampering(
    tmp_path: Path,
) -> None:
    source = tmp_path / "render"
    destination = tmp_path / "product"
    _write_sequence(source)
    destination.mkdir()
    (destination / "previous.txt").write_bytes(b"previous")
    directional_path = source / motion.DIRECTIONAL_PRERENDER_FILENAME
    payload = json.loads(directional_path.read_text(encoding="utf-8"))
    payload["views"][0]["actor_yaw_degrees"] = -89
    directional_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ExportError) as captured:
        package_blender_directional_export(source, destination)

    assert captured.value.kind is ExportFailureKind.VERIFICATION
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


@pytest.mark.parametrize(
    "packer_factory",
    [
        lambda source: _OccupiedOutputPacker(),
        _SourceMutatingPacker,
    ],
)
def test_directional_product_packager_rejects_transaction_or_source_races(
    tmp_path: Path,
    packer_factory: Callable[[Path], GridSpritesheetPacker],
) -> None:
    source = tmp_path / "render"
    destination = tmp_path / "product"
    _write_sequence(source)
    destination.mkdir()
    (destination / "previous.txt").write_bytes(b"previous")

    with pytest.raises(ExportError) as captured:
        package_blender_directional_export(
            source,
            destination,
            packer=packer_factory(source),
        )

    assert captured.value.kind is ExportFailureKind.VERIFICATION
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_directional_product_packager_rejects_wrong_dimensions_before_decode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "render"
    destination = tmp_path / "product"
    _write_sequence(source)
    target = source / "walk" / "SE" / "000.png"
    Image.new("RGBA", (motion.FRAME_SIZE[0] + 1, motion.FRAME_SIZE[1]), (1, 2, 3, 4)).save(
        target,
        format="PNG",
    )
    _refresh_output_provenance(source, "walk/SE/000.png")

    def fail_if_decoded(self: Image.Image) -> None:
        del self
        raise AssertionError("wrong-sized source was decoded")

    monkeypatch.setattr(PngImagePlugin.PngImageFile, "load", fail_if_decoded)
    with pytest.raises(ExportError) as captured:
        package_blender_directional_export(source, destination)

    assert captured.value.kind is ExportFailureKind.VERIFICATION
    assert not destination.exists()
    _assert_no_transaction_debris(destination)


def test_directional_product_packager_rejects_destination_inside_source(
    tmp_path: Path,
) -> None:
    source = tmp_path / "render"
    _write_sequence(source)

    with pytest.raises(ExportError) as captured:
        package_blender_directional_export(source, source / "exports" / "product")

    assert captured.value.kind is ExportFailureKind.DESTINATION
    assert not (source / "exports").exists()


def test_directional_product_packager_cancellation_preserves_previous_output(
    tmp_path: Path,
) -> None:
    source = tmp_path / "render"
    destination = tmp_path / "product"
    _write_sequence(source)
    destination.mkdir()
    (destination / "previous.txt").write_bytes(b"previous")

    with pytest.raises(ExportError) as captured:
        package_blender_directional_export(
            source,
            destination,
            cancellation=_Cancellation(),
        )

    assert captured.value.kind is ExportFailureKind.CANCELLED
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_directional_product_packager_cancels_after_staging_before_publication(
    tmp_path: Path,
) -> None:
    source = tmp_path / "render"
    destination = tmp_path / "product"
    _write_sequence(source)
    destination.mkdir()
    (destination / "previous.txt").write_bytes(b"previous")

    with pytest.raises(ExportError) as captured:
        package_blender_directional_export(
            source,
            destination,
            cancellation=_CancelAfterProductStaged(destination),
        )

    assert captured.value.kind is ExportFailureKind.CANCELLED
    assert captured.value.location == "before product publication"
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_directional_product_packager_cli_reports_success_and_verification_failure(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    source = tmp_path / "render"
    destination = tmp_path / "product"
    _write_sequence(source)

    assert directional_export_main(["--source", str(source), "--out", str(destination)]) == 0
    success_output = capsys.readouterr().out
    assert "Wrote AF-052 spritesheet" in success_output
    assert "Wrote AF-052 metadata" in success_output

    (source / "walk" / "SE" / "000.png").unlink()
    assert (
        directional_export_main(["--source", str(source), "--out", str(tmp_path / "failed")]) == 5
    )
    assert "AF-052 directional export packaging failed" in capsys.readouterr().out


def test_review_packager_writes_deterministic_contact_sheet_and_animation(
    tmp_path: Path,
) -> None:
    source = tmp_path / "render"
    destination = source / "review"
    _write_sequence(source)

    first = package_blender_walk_demo(source, destination)
    first_contact = first.contact_sheet.read_bytes()
    first_preview = first.animated_preview.read_bytes()
    (destination / "stale.txt").write_text("stale", encoding="utf-8")
    second = package_blender_walk_demo(source, destination)

    assert second == first
    assert second.contact_sheet.read_bytes() == first_contact
    assert second.animated_preview.read_bytes() == first_preview
    assert not (destination / "stale.txt").exists()
    with Image.open(second.contact_sheet) as contact_sheet:
        assert contact_sheet.format == "PNG"
        assert contact_sheet.mode == "RGBA"
        assert contact_sheet.size == (768, 848)
    with Image.open(second.animated_preview) as preview:
        assert preview.format == "GIF"
        assert preview.size == (384, 424)
        assert preview.n_frames == 12


def test_review_packager_rejects_a_completely_transparent_frame(tmp_path: Path) -> None:
    source = tmp_path / "render"
    destination = source / "review"
    _write_sequence(source, transparent_frame=True)

    with pytest.raises(ValueError, match="completely transparent"):
        package_blender_walk_demo(source, destination)

    assert not destination.exists()


def test_review_packager_rejects_alpha_touching_the_canvas_edge(tmp_path: Path) -> None:
    source = tmp_path / "render"
    destination = source / "review"
    _write_sequence(source, edge_frame=True)

    with pytest.raises(ValueError, match="touches the canvas edge"):
        package_blender_walk_demo(source, destination)

    assert not destination.exists()


def test_review_packager_rejects_missing_or_invalid_metadata(tmp_path: Path) -> None:
    destination = tmp_path / "missing" / "review"

    with pytest.raises(ValueError, match="does not exist"):
        package_blender_walk_demo(tmp_path / "missing", destination)

    invalid_root = tmp_path / "invalid"
    (invalid_root / "walk").mkdir(parents=True)
    (invalid_root / "walk" / "animation.json").write_text("{}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="disagrees with the fixed motion manifest"):
        package_blender_walk_demo(invalid_root, invalid_root / "review")


@pytest.mark.parametrize(
    ("destination_factory", "message"),
    [
        (lambda source: source, "named 'review'"),
        (lambda source: source / "walk", "named 'review'"),
        (lambda source: source.parent / "review", "direct child"),
    ],
)
def test_review_packager_rejects_destructive_or_unrelated_destinations(
    tmp_path: Path,
    destination_factory: Callable[[Path], Path],
    message: str,
) -> None:
    source = tmp_path / "scope" / "render"
    _write_sequence(source)
    with pytest.raises(ValueError, match=message):
        package_blender_walk_demo(source, destination_factory(source))

    assert (source / "walk" / "animation.json").is_file()


def test_review_packager_rejects_symlink_destination(tmp_path: Path) -> None:
    source = tmp_path / "render"
    _write_sequence(source)
    target = source / "existing-review"
    target.mkdir()
    destination = source / "review"
    try:
        destination.symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("Filesystem does not permit symlinks.")

    with pytest.raises(ValueError, match="symbolic link"):
        package_blender_walk_demo(source, destination)


def test_review_packager_rejects_symlink_source(tmp_path: Path) -> None:
    source = tmp_path / "render"
    _write_sequence(source)
    alias = tmp_path / "alias"
    try:
        alias.symlink_to(source, target_is_directory=True)
    except OSError:
        pytest.skip("Filesystem does not permit symlinks.")

    with pytest.raises(ValueError, match="source root must not be a symbolic link"):
        package_blender_walk_demo(alias, alias / "review")


def test_review_packager_rejects_valid_png_tampering_against_provenance(tmp_path: Path) -> None:
    source = tmp_path / "render"
    _write_sequence(source)
    target = source / "walk" / "SE" / "000.png"
    Image.new("RGBA", motion.FRAME_SIZE, (220, 30, 40, 255)).save(target, format="PNG")

    with pytest.raises(ValueError, match="evidence hash mismatch"):
        package_blender_walk_demo(source, source / "review")


def test_review_packager_rejects_extra_walk_file(tmp_path: Path) -> None:
    source = tmp_path / "render"
    _write_sequence(source)
    (source / "walk" / "unexpected.txt").write_text("extra", encoding="utf-8")

    with pytest.raises(ValueError, match="exact bounded file set"):
        package_blender_walk_demo(source, source / "review")


def test_review_packager_rejects_extra_walk_directory(tmp_path: Path) -> None:
    source = tmp_path / "render"
    _write_sequence(source)
    (source / "walk" / "extra").mkdir()

    with pytest.raises(ValueError, match="exact bounded layout"):
        package_blender_walk_demo(source, source / "review")
