"""Focused tests for deterministic, bounded prepared-layer folder imports."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from pathlib import Path

import pytest
from PIL import Image

from animated_fabric.application.import_layers import (
    ImportLimits,
    LayerAssignment,
    LayerImportRequest,
)
from animated_fabric.application.ports import LAYER_MANIFEST_FILENAME
from animated_fabric.domain.exceptions import AssetImportError
from animated_fabric.domain.geometry import IntPoint, IntSize
from animated_fabric.domain.project import Direction
from animated_fabric.domain.validation.models import ValidationCode
from animated_fabric.infrastructure.importing.folder_layer_importer import (
    IMPORT_SOURCE_LIMIT_CODE,
    FolderLayerImporter,
)
from animated_fabric.infrastructure.persistence.json_project_repository import (
    JsonProjectRepository,
)


def _save_rgba(
    path: Path,
    *,
    size: tuple[int, int] = (7, 6),
    box: tuple[int, int, int, int] | None = (2, 1, 5, 4),
    color: tuple[int, int, int, int] = (17, 83, 149, 255),
) -> bytes:
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    if box is not None:
        left, top, right, bottom = box
        for y in range(top, bottom):
            for x in range(left, right):
                image.putpixel((x, y), color)
    image.save(path, format="PNG")
    return path.read_bytes()


def _save_indexed(
    path: Path,
    *,
    transparency: bool,
) -> bytes:
    image = Image.new("P", (5, 4), color=0)
    palette = [0, 0, 0, 221, 44, 77] + [0, 0, 0] * 254
    image.putpalette(palette)
    image.putpixel((3, 2), 1)
    save_options: dict[str, object] = {"format": "PNG"}
    if transparency:
        save_options["transparency"] = 0
    image.save(path, **save_options)
    return path.read_bytes()


def _request(
    project_root: Path,
    source: Path,
    assignments: tuple[LayerAssignment, ...],
    *,
    direction: Direction = Direction.SE,
    trim: bool = True,
) -> LayerImportRequest:
    return LayerImportRequest(
        project_root=project_root,
        source=source,
        direction=direction,
        assignments=assignments,
        trim=trim,
    )


def _importer(*, limits: ImportLimits | None = None) -> FolderLayerImporter:
    return FolderLayerImporter(JsonProjectRepository(), limits=limits)


def test_inspect_is_stably_ordered_and_proposes_builtin_aliases(tmp_path: Path) -> None:
    source = tmp_path / "input"
    source.mkdir()
    _save_rgba(source / "z_head.png")
    _save_rgba(source / "Left Upper Arm.PNG")
    _save_rgba(source / "arm_l_upper.png")
    (source / LAYER_MANIFEST_FILENAME).write_text("{}", encoding="utf-8")

    first = _importer().inspect(source)
    second = _importer().inspect(source)

    assert first == second
    assert [layer.source_name for layer in first.layers] == [
        "arm_l_upper.png",
        "Left Upper Arm.PNG",
        "z_head.png",
    ]
    assert [layer.proposed_semantic_part for layer in first.layers] == [
        "upper_arm_l",
        "upper_arm_l",
        "z_head",
    ]
    assert not first.has_errors


def test_inspect_accepts_rgba_and_indexed_png_with_transparency(tmp_path: Path) -> None:
    source = tmp_path / "input"
    project = tmp_path / "project"
    source.mkdir()
    project.mkdir()
    rgba_bytes = _save_rgba(source / "head.png")
    indexed_bytes = _save_indexed(source / "hand_l.png", transparency=True)

    importer = _importer()
    inspection = importer.inspect(source)
    by_name = {layer.source_name: layer for layer in inspection.layers}

    assert not inspection.has_errors
    assert by_name["head.png"].source_sha256 == hashlib.sha256(rgba_bytes).hexdigest()
    assert by_name["head.png"].alpha_origin == IntPoint(x=2, y=1)
    assert by_name["head.png"].alpha_size == IntSize(width=3, height=3)
    assert by_name["hand_l.png"].source_sha256 == hashlib.sha256(indexed_bytes).hexdigest()
    assert by_name["hand_l.png"].alpha_origin == IntPoint(x=3, y=2)
    assert by_name["hand_l.png"].alpha_size == IntSize(width=1, height=1)

    result = importer.import_layers(
        _request(
            project,
            source,
            (
                LayerAssignment(source_name="head.png", semantic_part="head"),
                LayerAssignment(source_name="hand_l.png", semantic_part="hand_l"),
            ),
        )
    )
    indexed_asset = next(
        asset for asset in result.imported_assets if asset.semantic_part == "hand_l"
    )
    with Image.open(project / indexed_asset.path) as image:
        assert image.mode == "RGBA"
        assert image.size == (1, 1)
        assert image.getpixel((0, 0)) == (221, 44, 77, 255)


def test_import_trims_exactly_hashes_output_and_preserves_source(tmp_path: Path) -> None:
    source = tmp_path / "input"
    project = tmp_path / "project"
    source.mkdir()
    project.mkdir()
    source_path = source / "head.png"
    source_bytes = _save_rgba(source_path)

    result = _importer().import_layers(
        _request(
            project,
            source,
            (LayerAssignment(source_name="head.png", semantic_part="head"),),
        )
    )

    assert source_path.read_bytes() == source_bytes
    assert len(result.imported_assets) == 1
    asset = result.imported_assets[0]
    assert asset.asset_id == "se_head"
    assert asset.path == "source/layers/SE/head.png"
    assert asset.source_canvas_size == IntSize(width=7, height=6)
    assert asset.trim_origin == IntPoint(x=2, y=1)
    assert asset.trim_size == IntSize(width=3, height=3)
    output = project / asset.path
    assert asset.sha256 == hashlib.sha256(output.read_bytes()).hexdigest()
    with Image.open(output) as image:
        image.load()
        assert image.mode == "RGBA"
        assert image.size == (3, 3)
        assert image.tobytes() == bytes((17, 83, 149, 255)) * 9

    manifest = JsonProjectRepository().load_layer_manifest(project)
    assert manifest.layers == result.catalog_assets == (asset,)


def test_import_can_retain_the_full_source_canvas_when_trim_is_disabled(
    tmp_path: Path,
) -> None:
    source = tmp_path / "input"
    project = tmp_path / "project"
    source.mkdir()
    project.mkdir()
    source_path = source / "torso.png"
    source_bytes = _save_rgba(source_path)

    result = _importer().import_layers(
        _request(
            project,
            source,
            (LayerAssignment(source_name="torso.png", semantic_part="torso"),),
            trim=False,
        )
    )

    asset = result.imported_assets[0]
    assert asset.trim_origin == IntPoint(x=0, y=0)
    assert asset.trim_size == asset.source_canvas_size == IntSize(width=7, height=6)
    assert source_path.read_bytes() == source_bytes
    with Image.open(project / asset.path) as image:
        image.load()
        assert image.mode == "RGBA"
        assert image.size == (7, 6)
        assert image.getpixel((0, 0)) == (0, 0, 0, 0)
        assert image.getpixel((2, 1)) == (17, 83, 149, 255)


def test_fully_transparent_layer_warns_and_retains_full_canvas(tmp_path: Path) -> None:
    source = tmp_path / "input"
    project = tmp_path / "project"
    source.mkdir()
    project.mkdir()
    _save_rgba(source / "shadow.png", size=(4, 3), box=None)
    importer = _importer()

    inspection = importer.inspect(source)
    result = importer.import_layers(
        _request(
            project,
            source,
            (
                LayerAssignment(
                    source_name="shadow.png",
                    semantic_part="shadow",
                    optional=True,
                ),
            ),
        )
    )

    assert inspection.layers[0].fully_transparent is True
    assert inspection.layers[0].alpha_origin is None
    assert inspection.layers[0].alpha_size is None
    assert [item.code for item in inspection.diagnostics] == [ValidationCode.TRANSPARENT_LAYER]
    assert result.diagnostics == inspection.diagnostics
    asset = result.imported_assets[0]
    assert asset.optional is True
    assert asset.trim_origin == IntPoint(x=0, y=0)
    assert asset.trim_size == asset.source_canvas_size == IntSize(width=4, height=3)
    with Image.open(project / asset.path) as image:
        assert image.size == (4, 3)
        assert image.getchannel("A").getbbox() is None


def _write_corrupt(path: Path) -> None:
    path.write_bytes(b"\x89PNG\r\n\x1a\nnot-a-valid-image")


def _write_rgb(path: Path) -> None:
    Image.new("RGB", (3, 2), (20, 30, 40)).save(path, format="PNG")


def _write_palette_without_transparency(path: Path) -> None:
    _save_indexed(path, transparency=False)


@pytest.mark.parametrize(
    ("writer", "expected_code"),
    [
        (_write_corrupt, ValidationCode.PNG_UNREADABLE),
        (_write_rgb, ValidationCode.PNG_UNREADABLE),
        (_write_palette_without_transparency, ValidationCode.PNG_UNREADABLE),
    ],
    ids=("corrupt", "rgb", "indexed-without-transparency"),
)
def test_inspect_rejects_unsupported_or_unreadable_png_encodings(
    tmp_path: Path,
    writer: Callable[[Path], None],
    expected_code: str,
) -> None:
    source = tmp_path / "input"
    source.mkdir()
    writer(source / "head.png")

    inspection = _importer().inspect(source)

    assert inspection.layers == ()
    assert inspection.has_errors
    assert [item.code for item in inspection.diagnostics] == [expected_code]


def test_inspect_enforces_the_configured_dimension_limit(tmp_path: Path) -> None:
    source = tmp_path / "input"
    source.mkdir()
    _save_rgba(source / "head.png", size=(5, 3), box=(1, 1, 2, 2))

    inspection = _importer(
        limits=ImportLimits(max_layer_dimension=4, max_file_bytes=10_000, max_layers=2)
    ).inspect(source)

    assert inspection.layers == ()
    assert [item.code for item in inspection.diagnostics] == [ValidationCode.DIMENSIONS_EXCEEDED]


def test_inspect_enforces_the_configured_layer_count_limit(tmp_path: Path) -> None:
    source = tmp_path / "input"
    source.mkdir()
    _save_rgba(source / "head.png")
    _save_rgba(source / "torso.png")

    inspection = _importer(
        limits=ImportLimits(max_layer_dimension=16, max_file_bytes=10_000, max_layers=1)
    ).inspect(source)

    assert inspection.layers == ()
    assert [item.code for item in inspection.diagnostics] == [IMPORT_SOURCE_LIMIT_CODE]


def test_inspect_enforces_the_configured_encoded_file_size_limit(tmp_path: Path) -> None:
    source = tmp_path / "input"
    source.mkdir()
    encoded = _save_rgba(source / "head.png")

    inspection = _importer(
        limits=ImportLimits(
            max_layer_dimension=16,
            max_file_bytes=len(encoded) - 1,
            max_layers=2,
        )
    ).inspect(source)

    assert inspection.layers == ()
    assert [item.code for item in inspection.diagnostics] == [IMPORT_SOURCE_LIMIT_CODE]


@pytest.mark.parametrize(
    "assignments",
    [
        (),
        (LayerAssignment(source_name="head.png", semantic_part="Head"),),
        (LayerAssignment(source_name="unknown.png", semantic_part="head"),),
        (
            LayerAssignment(source_name="head.png", semantic_part="head"),
            LayerAssignment(source_name="head.png", semantic_part="other_head"),
        ),
        (
            LayerAssignment(source_name="head.png", semantic_part="head"),
            LayerAssignment(source_name="torso.png", semantic_part="head"),
        ),
    ],
    ids=(
        "missing",
        "invalid-semantic-part",
        "unknown-source",
        "duplicate-source",
        "duplicate-semantic-part",
    ),
)
def test_import_rejects_invalid_incomplete_or_duplicate_assignments_without_writes(
    tmp_path: Path,
    assignments: tuple[LayerAssignment, ...],
) -> None:
    source = tmp_path / "input"
    project = tmp_path / "project"
    source.mkdir()
    project.mkdir()
    _save_rgba(source / "head.png")
    _save_rgba(source / "torso.png")

    with pytest.raises(AssetImportError):
        _importer().import_layers(_request(project, source, assignments))

    assert not (project / "source").exists()
    assert not (project / LAYER_MANIFEST_FILENAME).exists()


def test_import_is_byte_deterministic_and_idempotent(tmp_path: Path) -> None:
    source = tmp_path / "input"
    first_project = tmp_path / "first-project"
    second_project = tmp_path / "second-project"
    source.mkdir()
    first_project.mkdir()
    second_project.mkdir()
    _save_rgba(source / "head.png")
    assignments = (LayerAssignment(source_name="head.png", semantic_part="head"),)
    importer = _importer()

    first = importer.import_layers(_request(first_project, source, assignments))
    first_png = first_project / first.imported_assets[0].path
    first_bytes = first_png.read_bytes()
    first_manifest = (first_project / LAYER_MANIFEST_FILENAME).read_bytes()
    repeated = importer.import_layers(_request(first_project, source, assignments))
    second = importer.import_layers(_request(second_project, source, assignments))

    assert repeated == first
    assert first_png.read_bytes() == first_bytes
    assert (first_project / LAYER_MANIFEST_FILENAME).read_bytes() == first_manifest
    assert (second_project / second.imported_assets[0].path).read_bytes() == first_bytes
    assert (second_project / LAYER_MANIFEST_FILENAME).read_bytes() == first_manifest


def test_import_merges_the_catalog_across_directions(tmp_path: Path) -> None:
    se_source = tmp_path / "se-input"
    ne_source = tmp_path / "ne-input"
    project = tmp_path / "project"
    se_source.mkdir()
    ne_source.mkdir()
    project.mkdir()
    _save_rgba(se_source / "head.png", color=(200, 10, 20, 255))
    _save_rgba(ne_source / "head.png", color=(10, 20, 200, 255))
    assignment = (LayerAssignment(source_name="head.png", semantic_part="head"),)
    importer = _importer()

    se_result = importer.import_layers(
        _request(project, se_source, assignment, direction=Direction.SE)
    )
    ne_result = importer.import_layers(
        _request(project, ne_source, assignment, direction=Direction.NE)
    )

    assert [asset.asset_id for asset in ne_result.catalog_assets] == ["ne_head", "se_head"]
    assert ne_result.imported_assets[0].direction is Direction.NE
    assert (project / se_result.imported_assets[0].path).is_file()
    assert (project / ne_result.imported_assets[0].path).is_file()
    assert JsonProjectRepository().load_layer_manifest(project).layers == (ne_result.catalog_assets)


def test_import_rejects_an_existing_conflicting_immutable_target(tmp_path: Path) -> None:
    source = tmp_path / "input"
    project = tmp_path / "project"
    source.mkdir()
    target = project / "source" / "layers" / "SE" / "head.png"
    target.parent.mkdir(parents=True)
    _save_rgba(source / "head.png", color=(20, 30, 40, 255))
    conflicting_bytes = _save_rgba(target, color=(200, 210, 220, 255))

    with pytest.raises(AssetImportError, match="Immutable destination"):
        _importer().import_layers(
            _request(
                project,
                source,
                (LayerAssignment(source_name="head.png", semantic_part="head"),),
            )
        )

    assert target.read_bytes() == conflicting_bytes
    assert not (project / LAYER_MANIFEST_FILENAME).exists()
