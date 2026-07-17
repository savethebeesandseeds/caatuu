"""Layer-manifest persistence through the hardened project repository."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from animated_fabric.application.ports import (
    LAYER_MANIFEST_FILENAME,
    LayerManifestRepository,
)
from animated_fabric.domain.assets import LayerManifest
from animated_fabric.domain.exceptions import (
    ProjectValidationError,
    ProjectValidationKind,
    ProjectVersionError,
)
from animated_fabric.infrastructure.persistence import JsonProjectRepository


def _payload() -> dict[str, object]:
    return {
        "format": "animated-fabric.layer-manifest.v1",
        "schema_version": "0.1.0",
        "layers": [
            {
                "asset_id": "se_head",
                "direction": "SE",
                "semantic_part": "head",
                "path": "source/layers/SE/head.png",
                "source_canvas_size": [192, 192],
                "trim_origin": [4, 6],
                "trim_size": [32, 48],
                "sha256": "a" * 64,
                "optional": False,
            }
        ],
    }


def _manifest() -> LayerManifest:
    return LayerManifest.model_validate_json(json.dumps(_payload()))


def test_layer_manifest_round_trip_uses_canonical_utf8_json_bytes(tmp_path: Path) -> None:
    repository = JsonProjectRepository()
    manifest = _manifest()

    repository.save_layer_manifest(tmp_path, manifest)

    target = tmp_path / LAYER_MANIFEST_FILENAME
    expected = (
        json.dumps(
            manifest.model_dump(mode="json"),
            allow_nan=False,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode()
    assert target.read_bytes() == expected
    assert repository.load_layer_manifest(tmp_path) == manifest


def test_concrete_repository_satisfies_layer_manifest_port() -> None:
    repository: LayerManifestRepository = JsonProjectRepository()

    assert callable(repository.load_layer_manifest)
    assert callable(repository.save_layer_manifest)


@pytest.mark.parametrize(
    ("field", "value", "error_type"),
    [
        ("format", "animated-fabric.project.v1", ProjectVersionError),
        ("schema_version", "0.2.0", ProjectVersionError),
        ("schema_version", "0.1.1-alpha.1", ProjectVersionError),
    ],
)
def test_layer_manifest_rejects_wrong_format_or_schema_family(
    tmp_path: Path,
    field: str,
    value: str,
    error_type: type[ProjectVersionError],
) -> None:
    payload = _payload()
    payload[field] = value
    (tmp_path / LAYER_MANIFEST_FILENAME).write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(error_type) as captured:
        JsonProjectRepository().load_layer_manifest(tmp_path)

    assert captured.value.path == LAYER_MANIFEST_FILENAME


def test_layer_manifest_is_fixed_at_project_root_and_missing_file_is_actionable(
    tmp_path: Path,
) -> None:
    nested = tmp_path / "source"
    nested.mkdir()
    (nested / LAYER_MANIFEST_FILENAME).write_text(json.dumps(_payload()), encoding="utf-8")

    with pytest.raises(ProjectValidationError, match="Missing layer manifest") as captured:
        JsonProjectRepository().load_layer_manifest(tmp_path)

    assert captured.value.kind is ProjectValidationKind.MISSING_DOCUMENT
    assert captured.value.path == LAYER_MANIFEST_FILENAME


def test_layer_manifest_symlink_cannot_escape_approved_project_root(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    outside = tmp_path / "outside.json"
    sentinel = b"outside sentinel"
    outside.write_bytes(sentinel)
    (project_root / LAYER_MANIFEST_FILENAME).symlink_to(outside)
    repository = JsonProjectRepository()

    with pytest.raises(ProjectValidationError, match="outside the approved project root") as load:
        repository.load_layer_manifest(project_root)
    with pytest.raises(ProjectValidationError, match="outside the approved project root"):
        repository.save_layer_manifest(project_root, _manifest())

    assert load.value.kind is ProjectValidationKind.UNSAFE_PATH
    assert load.value.path == LAYER_MANIFEST_FILENAME
    assert outside.read_bytes() == sentinel
