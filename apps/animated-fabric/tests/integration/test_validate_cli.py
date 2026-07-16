"""CLI integration tests for the AF-012 validation use case."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from animated_fabric.cli.app import app
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.infrastructure.persistence import JsonProjectRepository

runner = CliRunner()


def make_manifest(*, animation_paths: list[str] | None = None) -> ProjectManifest:
    payload = {
        "format": "animated-fabric.project.v1",
        "schema_version": "0.1.0",
        "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
        "slug": "eva_mage",
        "display_name": "Eva",
        "template_id": "humanoid_v1",
        "canvas": {
            "width": 192,
            "height": 192,
            "ground_anchor": [96.0, 160.0],
            "pixel_snap": "none",
        },
        "directions": {
            "SE": {"mode": "authored"},
            "SW": {"mode": "mirror", "source": "SE"},
            "NE": {"mode": "authored"},
            "NW": {"mode": "mirror", "source": "NE"},
        },
        "rig_path": "rig/main.animated-rig.json",
        "animation_paths": animation_paths or [],
        "export_profiles": [],
        "selection_ellipse": {
            "center_offset": [0.0, -2.0],
            "radius_x": 20.0,
            "radius_y": 9.0,
        },
    }
    return ProjectManifest.model_validate_json(json.dumps(payload))


def make_rig(*, cyclic: bool = False) -> RigDefinition:
    bones: list[dict[str, object]] = [{"bone_id": "root"}]
    if cyclic:
        bones.extend(
            [
                {"bone_id": "arm_a", "parent_id": "arm_b"},
                {"bone_id": "arm_b", "parent_id": "arm_a"},
            ]
        )
    payload = {
        "format": "animated-fabric.rig.v1",
        "schema_version": "0.1.0",
        "rig_id": "main",
        "template_id": "humanoid_v1",
        "bones": bones,
        "parts": [],
        "sockets": [],
        "direction_profiles": {},
        "draw_slot_profiles": {"SE": [], "NE": []},
    }
    return RigDefinition.model_validate_json(json.dumps(payload))


def make_empty_clip() -> AnimationClip:
    payload = {
        "format": "animated-fabric.animation-clip.v1",
        "schema_version": "0.1.0",
        "clip_id": "idle",
        "display_name": "Idle",
        "template_id": "humanoid_v1",
        "duration_ms": 1000,
        "loop": True,
        "fps_hint": 12,
        "tracks": [],
        "events": [],
        "generator_provenance": None,
    }
    return AnimationClip.model_validate_json(json.dumps(payload))


def save_project(
    root: Path,
    *,
    rig: RigDefinition,
    clip: AnimationClip | None = None,
) -> None:
    repository = JsonProjectRepository()
    paths = ["animations/idle.animated-clip.json"] if clip is not None else []
    repository.save(root, make_manifest(animation_paths=paths))
    repository.save_rig(root, "rig/main.animated-rig.json", rig)
    if clip is not None:
        repository.save_animation(root, paths[0], clip)


def test_validate_reports_a_healthy_project(tmp_path: Path) -> None:
    save_project(tmp_path, rig=make_rig())

    result = runner.invoke(app, ["validate", str(tmp_path)])

    assert result.exit_code == 0
    assert result.stdout.strip() == "Validation complete: no problems found."


def test_validate_returns_code_two_and_json_for_a_cyclic_rig(tmp_path: Path) -> None:
    save_project(tmp_path, rig=make_rig(cyclic=True))

    result = runner.invoke(app, ["validate", str(tmp_path), "--json"])

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFV201"]
    assert payload[0]["path"] == "rig/main.animated-rig.json"
    assert payload[0]["location"].endswith(".parent_id")
    assert payload[0]["suggestion"]


def test_validate_maps_a_missing_project_to_afv001(tmp_path: Path) -> None:
    missing_root = tmp_path / "missing"

    result = runner.invoke(app, ["validate", str(missing_root), "--json"])

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFV001"]
    assert payload[0]["path"] == "project.animated-fabric.json"


def test_validate_maps_incompatible_schema_to_afv002(tmp_path: Path) -> None:
    save_project(tmp_path, rig=make_rig())
    manifest_path = tmp_path / "project.animated-fabric.json"
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    payload["schema_version"] = "1.0.0"
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")

    result = runner.invoke(app, ["validate", str(tmp_path), "--json"])

    assert result.exit_code == 2
    assert [item["code"] for item in json.loads(result.stdout)] == ["AFV002"]


def test_validate_maps_a_symlink_escape_to_afv003(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    outside_root = tmp_path / "outside"
    repository = JsonProjectRepository()
    repository.save(project_root, make_manifest())
    repository.save_rig(outside_root, "main.animated-rig.json", make_rig())
    (project_root / "rig").symlink_to(outside_root, target_is_directory=True)

    result = runner.invoke(app, ["validate", str(project_root), "--json"])

    assert result.exit_code == 2
    assert [item["code"] for item in json.loads(result.stdout)] == ["AFV003"]


def test_validate_maps_a_missing_referenced_document_to_afv004(tmp_path: Path) -> None:
    JsonProjectRepository().save(tmp_path, make_manifest())

    result = runner.invoke(app, ["validate", str(tmp_path), "--json"])

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFV004"]
    assert payload[0]["path"] == "rig/main.animated-rig.json"


def test_validate_warnings_do_not_fail_the_command(tmp_path: Path) -> None:
    save_project(tmp_path, rig=make_rig(), clip=make_empty_clip())

    result = runner.invoke(app, ["validate", str(tmp_path)])

    assert result.exit_code == 0
    assert "WARNING AFV304" in result.stdout
    assert "animations/idle.animated-clip.json" in result.stdout
