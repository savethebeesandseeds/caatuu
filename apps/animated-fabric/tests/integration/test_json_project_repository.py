"""Integration tests for deterministic, safe, and atomic JSON persistence."""

from __future__ import annotations

import copy
import json
import math
import os
from collections.abc import Callable
from pathlib import Path

import pytest

import animated_fabric.infrastructure.persistence.json_project_repository as repository_module
from animated_fabric.application.ports import ProjectRepository
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.exceptions import (
    ProjectValidationError,
    ProjectValidationKind,
    ProjectVersionError,
)
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.infrastructure.persistence.json_project_repository import (
    PROJECT_MANIFEST_FILENAME,
    JsonProjectRepository,
)


def manifest_payload() -> dict[str, object]:
    return {
        "format": "animated-fabric.project.v1",
        "schema_version": "0.1.0",
        "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
        "slug": "eva_mage",
        "display_name": "Éva, Forest Mage 🧵",
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
        "animation_paths": [
            "animations/idle.animated-clip.json",
            "animations/walk.animated-clip.json",
        ],
        "export_profiles": ["default_grid"],
        "selection_ellipse": {
            "center_offset": [0.0, -2.0],
            "radius_x": 20.0,
            "radius_y": 9.0,
        },
    }


def make_manifest(**changes: object) -> ProjectManifest:
    payload = manifest_payload()
    payload.update(changes)
    return ProjectManifest.model_validate_json(json.dumps(payload, ensure_ascii=False))


def make_rig() -> RigDefinition:
    payload = {
        "format": "animated-fabric.rig.v1",
        "schema_version": "0.1.0",
        "rig_id": "main",
        "template_id": "humanoid_v1",
        "bones": [
            {
                "bone_id": "root",
                "rest_transform": {
                    "position": [96.0, 160.0],
                    "rotation_deg": 0.0,
                    "scale": [1.0, 1.0],
                },
            }
        ],
        "parts": [],
        "sockets": [],
        "direction_profiles": {},
        "draw_slot_profiles": {"SE": ["torso", "head"]},
    }
    return RigDefinition.model_validate_json(json.dumps(payload))


def make_clip() -> AnimationClip:
    payload = {
        "format": "animated-fabric.animation-clip.v1",
        "schema_version": "0.1.0",
        "clip_id": "idle",
        "display_name": "Idle",
        "template_id": "humanoid_v1",
        "duration_ms": 2000,
        "loop": True,
        "fps_hint": 12,
        "tracks": [
            {
                "target_type": "bone",
                "target_id": "root",
                "property": "position_y",
                "value_mode": "delta",
                "keys": [
                    {"time_ms": 0, "value": -1.5, "interpolation": "smooth"},
                    {"time_ms": 1000, "value": 1.5, "interpolation": "smooth"},
                ],
            }
        ],
        "events": [{"time_ms": 0, "event": "foot_contact_l"}],
        "generator_provenance": {
            "generator_id": "humanoid_idle_v1",
            "parameters": {"breath_y_px": 1.5, "duration_ms": 2000},
        },
    }
    return AnimationClip.model_validate_json(json.dumps(payload))


def manifest_path(root: Path) -> Path:
    return root / PROJECT_MANIFEST_FILENAME


def write_manifest_document(root: Path, payload: object) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    path = manifest_path(root)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def temporary_files(parent: Path) -> list[Path]:
    return list(parent.glob(".*.tmp"))


def test_manifest_save_uses_canonical_utf8_json_bytes(tmp_path: Path) -> None:
    repository = JsonProjectRepository()
    manifest = make_manifest()

    repository.save(tmp_path, manifest)

    raw = manifest_path(tmp_path).read_bytes()
    expected = (
        json.dumps(
            manifest.model_dump(mode="json"),
            allow_nan=False,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")
    assert raw == expected
    assert raw.startswith(b"{\n  ")
    assert raw.endswith(b"\n") and not raw.endswith(b"\n\n")
    assert b"\r" not in raw
    assert not raw.startswith(b"\xef\xbb\xbf")
    assert "Éva, Forest Mage 🧵".encode() in raw
    assert b"\\u00c9" not in raw


def test_equivalent_map_orders_and_repeated_saves_are_byte_deterministic(
    tmp_path: Path,
) -> None:
    repository = JsonProjectRepository()
    first_payload = manifest_payload()
    second_payload = copy.deepcopy(first_payload)
    directions = second_payload["directions"]
    assert isinstance(directions, dict)
    second_payload["directions"] = dict(reversed(tuple(directions.items())))
    first = ProjectManifest.model_validate_json(json.dumps(first_payload, ensure_ascii=False))
    second = ProjectManifest.model_validate_json(json.dumps(second_payload, ensure_ascii=False))
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"

    repository.save(first_root, first)
    first_bytes = manifest_path(first_root).read_bytes()
    repository.save(second_root, second)
    second_bytes = manifest_path(second_root).read_bytes()
    repository.save(first_root, first)

    assert first_bytes == second_bytes
    assert manifest_path(first_root).read_bytes() == first_bytes


def test_manifest_rig_and_animation_round_trip_through_filesystem(tmp_path: Path) -> None:
    repository = JsonProjectRepository()
    manifest = make_manifest()
    rig = make_rig()
    clip = make_clip()

    repository.save(tmp_path, manifest)
    repository.save_rig(tmp_path, "rig/main.animated-rig.json", rig)
    repository.save_animation(tmp_path, "animations/idle.animated-clip.json", clip)

    assert repository.load(tmp_path) == manifest
    assert repository.load_rig(tmp_path, "rig/main.animated-rig.json") == rig
    assert repository.load_animation(tmp_path, "animations/idle.animated-clip.json") == clip

    before = {
        path.relative_to(tmp_path).as_posix(): path.read_bytes()
        for path in tmp_path.rglob("*.json")
    }
    repository.save(tmp_path, repository.load(tmp_path))
    repository.save_rig(
        tmp_path,
        "rig/main.animated-rig.json",
        repository.load_rig(tmp_path, "rig/main.animated-rig.json"),
    )
    repository.save_animation(
        tmp_path,
        "animations/idle.animated-clip.json",
        repository.load_animation(tmp_path, "animations/idle.animated-clip.json"),
    )
    after = {
        path.relative_to(tmp_path).as_posix(): path.read_bytes()
        for path in tmp_path.rglob("*.json")
    }
    assert after == before


def test_concrete_repository_satisfies_the_complete_application_port() -> None:
    repository: ProjectRepository = JsonProjectRepository()

    assert callable(repository.load)
    assert callable(repository.save)
    assert callable(repository.load_rig)
    assert callable(repository.save_rig)
    assert callable(repository.load_animation)
    assert callable(repository.save_animation)


def test_supported_patch_schema_loads(tmp_path: Path) -> None:
    payload = manifest_payload()
    payload["schema_version"] = "0.1.47+local.1"
    write_manifest_document(tmp_path, payload)

    loaded = JsonProjectRepository().load(tmp_path)

    assert loaded.schema_version == "0.1.47+local.1"


@pytest.mark.parametrize("schema_version", ["0.2.0", "1.0.0", "0.1.1-alpha.1"])
def test_incompatible_or_prerelease_schema_is_rejected(
    tmp_path: Path,
    schema_version: str,
) -> None:
    payload = manifest_payload()
    payload["schema_version"] = schema_version
    write_manifest_document(tmp_path, payload)

    with pytest.raises(ProjectVersionError, match="schema"):
        JsonProjectRepository().load(tmp_path)


def test_wrong_artifact_format_is_rejected_before_model_validation(tmp_path: Path) -> None:
    payload = manifest_payload()
    payload["format"] = "animated-fabric.rig.v1"
    write_manifest_document(tmp_path, payload)

    with pytest.raises(ProjectVersionError, match="unsupported format") as captured:
        JsonProjectRepository().load(tmp_path)

    assert captured.value.path == PROJECT_MANIFEST_FILENAME


@pytest.mark.parametrize(
    "change",
    [
        lambda payload: payload.pop("format"),
        lambda payload: payload.pop("schema_version"),
        lambda payload: payload.update(schema_version="0.1"),
        lambda payload: payload.update(canvas={"width": "192"}),
    ],
)
def test_missing_or_invalid_document_contract_is_rejected(
    tmp_path: Path,
    change: Callable[[dict[str, object]], object],
) -> None:
    payload = manifest_payload()
    change(payload)
    write_manifest_document(tmp_path, payload)

    with pytest.raises(ProjectValidationError) as captured:
        JsonProjectRepository().load(tmp_path)

    assert captured.value.kind is ProjectValidationKind.INVALID_DOCUMENT


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (b"{", "Malformed JSON"),
        (
            b'{"format":"animated-fabric.project.v1",'
            b'"format":"animated-fabric.rig.v1","schema_version":"0.1.0"}',
            "duplicate JSON key",
        ),
        (
            b'{"format":"animated-fabric.project.v1","schema_version":"0.1.0","value":NaN}',
            "nonstandard JSON value",
        ),
        (b"\xff", "not valid UTF-8"),
        (b"[]", "must contain a JSON object"),
        (b"null", "must contain a JSON object"),
        (b'"project"', "must contain a JSON object"),
    ],
)
def test_malformed_ambiguous_nonstandard_or_top_level_input_is_rejected(
    tmp_path: Path,
    raw: bytes,
    message: str,
) -> None:
    tmp_path.mkdir(parents=True, exist_ok=True)
    manifest_path(tmp_path).write_bytes(raw)

    with pytest.raises(ProjectValidationError, match=message):
        JsonProjectRepository().load(tmp_path)


@pytest.mark.parametrize(
    "path",
    [
        "../outside.animated-rig.json",
        "/outside.animated-rig.json",
        "C:/outside.animated-rig.json",
        "rig\\outside.animated-rig.json",
        "rig/../outside.animated-rig.json",
        "rig/./outside.animated-rig.json",
        "rig//outside.animated-rig.json",
        "rig/\x00outside.animated-rig.json",
    ],
)
def test_lexical_path_escapes_are_rejected_without_writing(
    tmp_path: Path,
    path: str,
) -> None:
    project_root = tmp_path / "project"
    outside = tmp_path / "outside.animated-rig.json"

    with pytest.raises(ProjectValidationError, match="safe relative paths") as captured:
        JsonProjectRepository().save_rig(project_root, path, make_rig())

    assert captured.value.kind is ProjectValidationKind.UNSAFE_PATH
    assert not outside.exists()


def test_symlinked_parent_cannot_escape_project_for_load_or_save(tmp_path: Path) -> None:
    repository = JsonProjectRepository()
    project_root = tmp_path / "project"
    project_root.mkdir()
    outside = tmp_path / "outside"
    repository.save_rig(outside, "main.animated-rig.json", make_rig())
    outside_path = outside / "main.animated-rig.json"
    original = outside_path.read_bytes()
    (project_root / "rig").symlink_to(outside, target_is_directory=True)

    with pytest.raises(
        ProjectValidationError, match="outside the approved project root"
    ) as captured:
        repository.load_rig(project_root, "rig/main.animated-rig.json")
    with pytest.raises(ProjectValidationError, match="outside the approved project root"):
        repository.save_rig(project_root, "rig/main.animated-rig.json", make_rig())

    assert captured.value.kind is ProjectValidationKind.UNSAFE_PATH
    assert captured.value.path == "rig/main.animated-rig.json"
    assert outside_path.read_bytes() == original


def test_repository_never_writes_beneath_immutable_source(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    target = source / "main.animated-rig.json"
    original = b"immutable source sentinel"
    target.write_bytes(original)

    with pytest.raises(ProjectValidationError, match="immutable source"):
        JsonProjectRepository().save_rig(
            tmp_path,
            "source/main.animated-rig.json",
            make_rig(),
        )

    assert target.read_bytes() == original


def test_source_immutability_cannot_be_bypassed_through_an_in_root_alias(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    target = source / "main.animated-rig.json"
    original = b"immutable source sentinel"
    target.write_bytes(original)
    (tmp_path / "rig_alias").symlink_to(source, target_is_directory=True)

    with pytest.raises(ProjectValidationError, match="immutable source"):
        JsonProjectRepository().save_rig(
            tmp_path,
            "rig_alias/main.animated-rig.json",
            make_rig(),
        )

    assert target.read_bytes() == original


def test_rig_and_animation_paths_require_canonical_suffixes(tmp_path: Path) -> None:
    repository = JsonProjectRepository()

    with pytest.raises(ProjectValidationError, match=r"\.animated-rig\.json"):
        repository.save_rig(tmp_path, "rig/main.json", make_rig())
    with pytest.raises(ProjectValidationError, match=r"\.animated-rig\.json"):
        repository.load_rig(tmp_path, "rig/main.json")
    with pytest.raises(ProjectValidationError, match=r"\.animated-clip\.json"):
        repository.save_animation(tmp_path, "animations/idle.json", make_clip())
    with pytest.raises(ProjectValidationError, match=r"\.animated-clip\.json"):
        repository.load_animation(tmp_path, "animations/idle.json")

    assert list(tmp_path.iterdir()) == []


def test_missing_and_directory_manifest_targets_are_reported(tmp_path: Path) -> None:
    repository = JsonProjectRepository()

    with pytest.raises(ProjectValidationError, match="Missing project manifest") as captured:
        repository.load(tmp_path)

    assert captured.value.kind is ProjectValidationKind.MISSING_DOCUMENT
    assert captured.value.path == PROJECT_MANIFEST_FILENAME

    manifest_path(tmp_path).mkdir()
    with pytest.raises(ProjectValidationError, match="found a directory"):
        repository.load(tmp_path)
    with pytest.raises(ProjectValidationError, match="over a directory"):
        repository.save(tmp_path, make_manifest())


def test_atomic_replace_uses_a_sibling_temporary_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = JsonProjectRepository()
    target = manifest_path(tmp_path)
    real_replace = os.replace
    calls: list[tuple[Path, Path]] = []

    def observed_replace(source: str | bytes | Path, destination: str | bytes | Path) -> None:
        source_path = Path(source)
        destination_path = Path(destination)
        calls.append((source_path, destination_path))
        assert source_path.parent == destination_path.parent
        assert source_path.exists()
        real_replace(source, destination)

    monkeypatch.setattr(repository_module.os, "replace", observed_replace)

    repository.save(tmp_path, make_manifest())

    assert len(calls) == 1
    temporary, destination = calls[0]
    assert destination == target
    assert temporary.name.startswith(f".{target.name}.")
    assert temporary.suffix == ".tmp"
    assert target.is_file()
    assert temporary_files(tmp_path) == []


def test_invalid_mutated_json_value_is_rejected_before_any_write(tmp_path: Path) -> None:
    clip = make_clip()
    assert clip.generator_provenance is not None
    clip.generator_provenance.parameters["invalid"] = math.inf

    with pytest.raises(ProjectValidationError, match="canonical JSON") as captured:
        JsonProjectRepository().save_animation(
            tmp_path,
            "animations/idle.animated-clip.json",
            clip,
        )

    assert captured.value.kind is ProjectValidationKind.INVALID_DOCUMENT
    assert not (tmp_path / "animations" / "idle.animated-clip.json").exists()


def test_replace_failure_preserves_previous_file_and_removes_temporary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = JsonProjectRepository()
    original_manifest = make_manifest(display_name="Original")
    repository.save(tmp_path, original_manifest)
    target = manifest_path(tmp_path)
    original = target.read_bytes()

    def fail_replace(_source: object, _destination: object) -> None:
        raise OSError("injected replace failure")

    monkeypatch.setattr(repository_module.os, "replace", fail_replace)

    with pytest.raises(ProjectValidationError, match="atomically save"):
        repository.save(tmp_path, make_manifest(display_name="Replacement"))

    assert target.read_bytes() == original
    assert temporary_files(tmp_path) == []


def test_fsync_failure_preserves_previous_file_and_removes_temporary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = JsonProjectRepository()
    original_manifest = make_manifest(display_name="Original")
    repository.save(tmp_path, original_manifest)
    target = manifest_path(tmp_path)
    original = target.read_bytes()

    def fail_fsync(_descriptor: int) -> None:
        raise OSError("injected fsync failure")

    monkeypatch.setattr(repository_module.os, "fsync", fail_fsync)

    with pytest.raises(ProjectValidationError, match="atomically save"):
        repository.save(tmp_path, make_manifest(display_name="Replacement"))

    assert target.read_bytes() == original
    assert temporary_files(tmp_path) == []


@pytest.mark.parametrize(
    "operation",
    [
        lambda repository, root: repository.load(root),
        lambda repository, root: repository.save(root, make_manifest()),
    ],
)
def test_project_root_must_be_a_directory(
    tmp_path: Path,
    operation: Callable[[JsonProjectRepository, Path], object],
) -> None:
    root_file = tmp_path / "not_a_directory"
    root_file.write_bytes(b"sentinel")

    with pytest.raises(ProjectValidationError, match="approved project root"):
        operation(JsonProjectRepository(), root_file)

    assert root_file.read_bytes() == b"sentinel"
