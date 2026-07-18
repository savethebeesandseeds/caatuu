"""End-to-end CLI publication tests for the AF-043 animation commands."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from animated_fabric.application.generate_animation import (
    ANIMATION_GENERATION_FAILURE_CODE,
    ANIMATION_REPLACEMENT_REQUIRED_CODE,
)
from animated_fabric.cli.app import app
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import BoneDefinition, RigDefinition
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.persistence import JsonProjectRepository

runner = CliRunner()


def _humanoid_rig(*, invalid_draw_slots: bool = False) -> RigDefinition:
    parents = (
        ("root", None),
        ("pelvis", "root"),
        ("torso", "pelvis"),
        ("neck", "torso"),
        ("head", "neck"),
        ("upper_arm_l", "torso"),
        ("lower_arm_l", "upper_arm_l"),
        ("hand_l", "lower_arm_l"),
        ("upper_arm_r", "torso"),
        ("lower_arm_r", "upper_arm_r"),
        ("hand_r", "lower_arm_r"),
        ("thigh_l", "pelvis"),
        ("shin_l", "thigh_l"),
        ("foot_l", "shin_l"),
        ("thigh_r", "pelvis"),
        ("shin_r", "thigh_r"),
        ("foot_r", "shin_r"),
    )
    slots = (
        {
            Direction.SE: ("body", "body"),
            Direction.NE: ("body",),
        }
        if invalid_draw_slots
        else {}
    )
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id="humanoid_v1",
        bones=tuple(
            BoneDefinition(bone_id=bone_id, parent_id=parent_id) for bone_id, parent_id in parents
        ),
        draw_slot_profiles=slots,
    )


def _write_ready_project(root: Path, *, invalid_draw_slots: bool = False) -> None:
    repository = JsonProjectRepository()
    manifest = build_stick_humanoid_manifest()
    repository.save(root, manifest)
    repository.save_rig(
        root,
        manifest.rig_path,
        _humanoid_rig(invalid_draw_slots=invalid_draw_slots),
    )


def test_generate_idle_defaults_persists_registers_and_revalidates_project(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    _write_ready_project(root)

    result = runner.invoke(
        app,
        [
            "animation",
            "generate",
            str(root),
            "--generator",
            "humanoid_idle_v1",
            "--clip",
            "idle",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Generated animation clip 'idle'" in result.stdout
    assert "animations/idle.animated-clip.json" in result.stdout
    repository = JsonProjectRepository()
    manifest = repository.load(root)
    assert manifest.animation_paths == ("animations/idle.animated-clip.json",)
    clip = repository.load_animation(root, manifest.animation_paths[0])
    assert (clip.clip_id, clip.display_name, clip.duration_ms) == ("idle", "Idle", 2000)
    assert clip.generator_provenance is not None
    assert clip.generator_provenance.generator_id == "humanoid_idle_v1"
    assert clip.generator_provenance.parameters["breath_y_px"] == 1.5
    assert len(clip.tracks) == 6

    validation = runner.invoke(app, ["validate", str(root), "--json"])
    assert validation.exit_code == 0, validation.output
    assert json.loads(validation.stdout) == []


def test_generate_walk_accepts_repeatable_json_parameters_and_preserves_manifest_order(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    _write_ready_project(root)
    idle = runner.invoke(
        app,
        [
            "animation",
            "generate",
            str(root),
            "--generator",
            "humanoid_idle_v1",
            "--clip",
            "idle",
            "--json",
        ],
    )
    assert idle.exit_code == 0, idle.output

    result = runner.invoke(
        app,
        [
            "animation",
            "generate",
            str(root),
            "--generator",
            "humanoid_walk_v1",
            "--clip",
            "hero_walk",
            "--set",
            "duration_ms=1000",
            "--set",
            "step_angle_deg=24",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout) == []
    repository = JsonProjectRepository()
    manifest = repository.load(root)
    assert manifest.animation_paths == (
        "animations/idle.animated-clip.json",
        "animations/hero_walk.animated-clip.json",
    )
    clip = repository.load_animation(root, manifest.animation_paths[1])
    assert (clip.clip_id, clip.display_name, clip.duration_ms) == (
        "hero_walk",
        "Hero Walk",
        1000,
    )
    assert clip.generator_provenance is not None
    assert clip.generator_provenance.parameters["step_angle_deg"] == 24.0
    assert [(event.time_ms, event.event) for event in clip.events] == [
        (0, "foot_contact_l"),
        (500, "foot_contact_r"),
    ]
    assert len(clip.tracks) == 12


def test_generate_requires_explicit_replacement_then_replaces_once(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    _write_ready_project(root)
    arguments = [
        "animation",
        "generate",
        str(root),
        "--generator",
        "humanoid_idle_v1",
        "--clip",
        "idle",
    ]
    created = runner.invoke(app, arguments)
    assert created.exit_code == 0, created.output
    manifest_path = root / "project.animated-fabric.json"
    clip_path = root / "animations/idle.animated-clip.json"
    before = (manifest_path.read_bytes(), clip_path.read_bytes())

    blocked = runner.invoke(app, [*arguments, "--set", "duration_ms=2400", "--json"])

    assert blocked.exit_code == 2
    assert [item["code"] for item in json.loads(blocked.stdout)] == [
        ANIMATION_REPLACEMENT_REQUIRED_CODE
    ]
    assert (manifest_path.read_bytes(), clip_path.read_bytes()) == before

    replaced = runner.invoke(
        app,
        [
            *arguments,
            "--set",
            "duration_ms=2400",
            "--replace-existing",
            "--json",
        ],
    )

    assert replaced.exit_code == 0, replaced.output
    assert json.loads(replaced.stdout) == []
    repository = JsonProjectRepository()
    manifest = repository.load(root)
    assert manifest.animation_paths == ("animations/idle.animated-clip.json",)
    assert repository.load_animation(root, manifest.animation_paths[0]).duration_ms == 2400
    assert manifest_path.read_bytes() == before[0]
    assert clip_path.read_bytes() != before[1]


def test_invalid_generator_parameters_fail_without_publishing_or_changing_manifest(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    _write_ready_project(root)
    manifest_path = root / "project.animated-fabric.json"
    before = manifest_path.read_bytes()

    result = runner.invoke(
        app,
        [
            "animation",
            "generate",
            str(root),
            "--generator",
            "humanoid_idle_v1",
            "--clip",
            "idle",
            "--set",
            "duration_ms=3",
            "--json",
        ],
    )

    assert result.exit_code == 3
    assert [item["code"] for item in json.loads(result.stdout)] == [
        ANIMATION_GENERATION_FAILURE_CODE
    ]
    assert manifest_path.read_bytes() == before
    assert not (root / "animations/idle.animated-clip.json").exists()


def test_structural_validation_errors_use_exit_two_without_publication(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    _write_ready_project(root, invalid_draw_slots=True)
    manifest_path = root / "project.animated-fabric.json"
    before = manifest_path.read_bytes()

    result = runner.invoke(
        app,
        [
            "animation",
            "generate",
            str(root),
            "--generator",
            "humanoid_walk_v1",
            "--clip",
            "walk",
            "--json",
        ],
    )

    assert result.exit_code == 2
    assert "AFV404" in [item["code"] for item in json.loads(result.stdout)]
    assert manifest_path.read_bytes() == before
    assert not (root / "animations/walk.animated-clip.json").exists()
