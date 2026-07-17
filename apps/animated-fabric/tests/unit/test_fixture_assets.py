from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

from animated_fabric.domain.project import Direction
from animated_fabric.infrastructure.fixtures import PART_NAMES, load_stick_humanoid_project
from animated_fabric.infrastructure.fixtures.stick_humanoid import NE_DRAW_ORDER, SE_DRAW_ORDER
from scripts.generate_fixture_assets import generate_fixture_assets

REQUIRED_PARTS = {
    "torso",
    "head",
    "upper_arm_l",
    "lower_arm_l",
    "hand_l",
    "upper_arm_r",
    "lower_arm_r",
    "hand_r",
    "thigh_l",
    "shin_l",
    "foot_l",
    "thigh_r",
    "shin_r",
    "foot_r",
}


def _file_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(item for item in root.rglob("*") if item.is_file())
    }


def test_generator_writes_complete_rgba_layer_sets(tmp_path: Path) -> None:
    fixture_root = generate_fixture_assets(tmp_path)

    for direction in ("SE", "NE"):
        direction_root = fixture_root / "source" / "layers" / direction
        layer_paths = sorted(direction_root.glob("*.png"))
        assert {path.stem for path in layer_paths} == REQUIRED_PARTS

        for layer_path in layer_paths:
            with Image.open(layer_path) as image:
                assert image.format == "PNG"
                assert image.mode == "RGBA"
                assert image.size == (192, 192)
                alpha = image.getchannel("A")
                assert alpha.getextrema() == (0, 255)
                assert alpha.getbbox() is not None
                left, top, right, bottom = alpha.getbbox() or (0, 0, 192, 192)
                assert left > 0 and top > 0
                assert right < 192 and bottom < 192

    for part_name in REQUIRED_PARTS:
        se_layer = fixture_root / "source" / "layers" / "SE" / f"{part_name}.png"
        ne_layer = fixture_root / "source" / "layers" / "NE" / f"{part_name}.png"
        assert se_layer.read_bytes() != ne_layer.read_bytes()


def test_manifest_records_stable_paths_dimensions_and_hashes(tmp_path: Path) -> None:
    fixture_root = generate_fixture_assets(tmp_path)
    manifest_path = fixture_root / "fixture_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert manifest["schema_version"] == "0.1.0"
    assert manifest["fixture_id"] == "stick_humanoid"
    assert manifest["template_id"] == "humanoid_v1"
    assert manifest["directions"] == ["SE", "NE"]
    assert manifest["canvas"] == {
        "ground_anchor": [96, 160],
        "height": 192,
        "width": 192,
    }
    assert len(manifest["layers"]) == len(REQUIRED_PARTS) * 2

    for layer in manifest["layers"]:
        relative_path = Path(layer["path"])
        assert not relative_path.is_absolute()
        assert "\\" not in layer["path"]
        asset_path = fixture_root / relative_path
        assert layer["sha256"] == hashlib.sha256(asset_path.read_bytes()).hexdigest()


def test_generation_is_byte_for_byte_deterministic(tmp_path: Path) -> None:
    first_root = generate_fixture_assets(tmp_path / "first")
    second_root = generate_fixture_assets(tmp_path / "second")

    assert _file_hashes(first_root) == _file_hashes(second_root)
    assert (first_root / "fixture_manifest.json").read_bytes() == (
        second_root / "fixture_manifest.json"
    ).read_bytes()


def test_generator_publishes_a_canonical_render_project_and_rig(tmp_path: Path) -> None:
    fixture_root = generate_fixture_assets(tmp_path)

    assert (fixture_root / "project.animated-fabric.json").is_file()
    assert (fixture_root / "rig" / "main.animated-rig.json").is_file()

    loaded = load_stick_humanoid_project(fixture_root)

    assert loaded.project.root == fixture_root
    assert loaded.project.manifest.slug == "stick_humanoid"
    assert loaded.project.manifest.canvas.width == 192
    assert loaded.project.manifest.canvas.height == 192
    assert loaded.project.manifest.canvas.ground_anchor.x == 96.0
    assert loaded.project.manifest.canvas.ground_anchor.y == 160.0
    assert loaded.rig.template_id == "humanoid_v1"
    assert tuple(part.part_id for part in loaded.rig.parts) == PART_NAMES
    assert tuple(socket.socket_id for socket in loaded.rig.sockets) == (
        "head_hat",
        "hand_r_weapon",
    )
    assert len(loaded.project.assets) == len(PART_NAMES) * 2

    for direction in (Direction.SE, Direction.NE):
        for part_name in PART_NAMES:
            asset_id = f"{direction.value.lower()}_{part_name}"
            asset = loaded.project.assets[asset_id]
            assert asset.asset_id == asset_id
            assert asset.direction is direction
            assert asset.path == f"source/layers/{direction.value}/{part_name}.png"
            assert asset.source_canvas_size.width == 192
            assert asset.source_canvas_size.height == 192


def test_canonical_fixture_rig_records_direction_specific_draw_order(tmp_path: Path) -> None:
    loaded = load_stick_humanoid_project(generate_fixture_assets(tmp_path))

    base_order = tuple(
        part.part_id for part in sorted(loaded.rig.parts, key=lambda part: part.slot_order)
    )
    ne_profile = loaded.rig.direction_profiles[Direction.NE]
    ne_order = tuple(
        part.part_id
        for part in sorted(
            loaded.rig.parts,
            key=lambda part: ne_profile.slot_order[part.part_id],
        )
    )

    assert base_order == SE_DRAW_ORDER
    assert ne_order == NE_DRAW_ORDER


def test_script_accepts_required_out_argument(tmp_path: Path) -> None:
    repository_root = Path(__file__).resolve().parents[2]
    output_root = tmp_path / "cli-output"

    completed = subprocess.run(
        [
            sys.executable,
            str(repository_root / "scripts" / "generate_fixture_assets.py"),
            "--out",
            str(output_root),
        ],
        cwd=repository_root,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert "Generated geometric fixture" in completed.stdout
    assert (output_root / "stick_humanoid" / "fixture_manifest.json").is_file()
