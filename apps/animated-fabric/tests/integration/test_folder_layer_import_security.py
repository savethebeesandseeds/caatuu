"""Security and transaction boundaries for prepared-layer folder imports."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from animated_fabric.application.import_layers import (
    ImportLimits,
    LayerAssignment,
    LayerImportRequest,
)
from animated_fabric.application.ports import LAYER_MANIFEST_FILENAME
from animated_fabric.domain.assets import LayerManifest
from animated_fabric.domain.diagnostics import Severity
from animated_fabric.domain.exceptions import (
    AssetImportError,
    ProjectValidationError,
    ProjectValidationKind,
)
from animated_fabric.domain.project import Direction
from animated_fabric.domain.validation.models import ValidationCode
from animated_fabric.infrastructure.importing.folder_layer_importer import (
    IMPORT_MAPPING_CODE,
    IMPORT_UNSUPPORTED_ENTRY_CODE,
    FolderLayerImporter,
)
from animated_fabric.infrastructure.persistence import JsonProjectRepository


def _write_rgba_layer(path: Path, *, full_canvas: bool = False) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    bounds = range(8) if full_canvas else range(2, 6)
    for y in bounds:
        for x in bounds:
            image.putpixel((x, y), (40 + x, 80 + y, 120, 255))
    image.save(path, format="PNG", optimize=False, compress_level=9)
    return path.read_bytes()


def _request(
    project_root: Path,
    source: Path,
    *assignments: tuple[str, str],
    trim: bool = True,
) -> LayerImportRequest:
    return LayerImportRequest(
        project_root=project_root,
        source=source,
        direction=Direction.SE,
        assignments=tuple(
            LayerAssignment(source_name=source_name, semantic_part=semantic_part)
            for source_name, semantic_part in assignments
        ),
        trim=trim,
    )


def _symlink_or_skip(link: Path, target: Path, *, directory: bool = False) -> None:
    try:
        link.symlink_to(target, target_is_directory=directory)
    except (NotImplementedError, OSError) as error:
        pytest.skip(f"Symbolic links are unavailable on this filesystem: {error}")


def _assert_no_staging_remnants(project_root: Path) -> None:
    staging_parent = project_root / ".animated-fabric" / "import-staging"
    if staging_parent.exists():
        assert tuple(staging_parent.iterdir()) == ()


class _FailingManifestRepository:
    def load_layer_manifest(self, root: Path) -> LayerManifest:
        raise ProjectValidationError(
            "Missing layer manifest.",
            kind=ProjectValidationKind.MISSING_DOCUMENT,
            path=LAYER_MANIFEST_FILENAME,
        )

    def save_layer_manifest(self, root: Path, manifest: LayerManifest) -> None:
        raise ProjectValidationError(
            "Injected catalog save failure.",
            kind=ProjectValidationKind.FILESYSTEM,
            path=LAYER_MANIFEST_FILENAME,
        )


def test_external_source_file_symlink_is_rejected_without_reading_it(tmp_path: Path) -> None:
    source = tmp_path / "incoming"
    source.mkdir()
    outside = tmp_path / "outside" / "head.png"
    _write_rgba_layer(outside)
    link = source / "head.png"
    _symlink_or_skip(link, outside)

    inspection = FolderLayerImporter(JsonProjectRepository()).inspect(source)

    assert inspection.layers == ()
    assert [
        (diagnostic.code, diagnostic.severity, diagnostic.path)
        for diagnostic in inspection.diagnostics
    ] == [(ValidationCode.PATH_OUTSIDE_PROJECT, Severity.ERROR, "head.png")]
    assert outside.is_file()


def test_destination_parent_symlink_cannot_escape_project_root(tmp_path: Path) -> None:
    incoming = tmp_path / "incoming"
    _write_rgba_layer(incoming / "head.png")
    project = tmp_path / "project"
    destination_parent = project / "source" / "layers"
    destination_parent.mkdir(parents=True)
    outside = tmp_path / "published-outside"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("preserve me", encoding="utf-8")
    _symlink_or_skip(destination_parent / "SE", outside, directory=True)
    importer = FolderLayerImporter(JsonProjectRepository())

    with pytest.raises(AssetImportError, match="outside the approved root"):
        importer.import_layers(_request(project, incoming, ("head.png", "head")))

    assert sentinel.read_text(encoding="utf-8") == "preserve me"
    assert sorted(path.name for path in outside.iterdir()) == ["sentinel.txt"]
    assert not (project / LAYER_MANIFEST_FILENAME).exists()
    _assert_no_staging_remnants(project)


def test_nested_and_non_png_entries_are_blocking_and_not_enumerated_recursively(
    tmp_path: Path,
) -> None:
    source = tmp_path / "incoming"
    _write_rgba_layer(source / "head.png")
    _write_rgba_layer(source / "nested" / "hidden.png")
    (source / "notes.txt").write_text("not an image", encoding="utf-8")

    inspection = FolderLayerImporter(JsonProjectRepository()).inspect(source)

    assert tuple(layer.source_name for layer in inspection.layers) == ("head.png",)
    assert [
        (diagnostic.code, diagnostic.severity, diagnostic.path)
        for diagnostic in inspection.diagnostics
        if diagnostic.code == IMPORT_UNSUPPORTED_ENTRY_CODE
    ] == [
        (IMPORT_UNSUPPORTED_ENTRY_CODE, Severity.ERROR, "nested"),
        (IMPORT_UNSUPPORTED_ENTRY_CODE, Severity.ERROR, "notes.txt"),
    ]


def test_case_colliding_png_names_are_rejected_when_filesystem_preserves_both(
    tmp_path: Path,
) -> None:
    source = tmp_path / "incoming"
    _write_rgba_layer(source / "Head.png")
    _write_rgba_layer(source / "head.PNG")
    png_names = sorted(
        (path.name for path in source.iterdir() if path.suffix.lower() == ".png"),
        key=lambda name: (name.casefold(), name),
    )
    if png_names != ["Head.png", "head.PNG"]:
        pytest.skip("The filesystem does not preserve case-distinct filenames.")

    inspection = FolderLayerImporter(JsonProjectRepository()).inspect(source)

    assert tuple(layer.source_name for layer in inspection.layers) == tuple(png_names)
    collisions = [
        diagnostic
        for diagnostic in inspection.diagnostics
        if diagnostic.code == IMPORT_MAPPING_CODE
    ]
    assert len(collisions) == 1
    assert collisions[0].severity is Severity.ERROR
    assert collisions[0].path == "head.PNG"
    assert "collide when compared case-insensitively" in collisions[0].message


def test_catalog_save_failure_rolls_back_every_new_layer_and_cleans_staging(
    tmp_path: Path,
) -> None:
    incoming = tmp_path / "incoming"
    _write_rgba_layer(incoming / "head.png")
    _write_rgba_layer(incoming / "torso.png")
    project = tmp_path / "project"
    project.mkdir()
    importer = FolderLayerImporter(_FailingManifestRepository())

    with pytest.raises(AssetImportError, match="without changing the catalog"):
        importer.import_layers(
            _request(
                project,
                incoming,
                ("head.png", "head"),
                ("torso.png", "torso"),
            )
        )

    assert not (project / "source" / "layers" / "SE" / "head.png").exists()
    assert not (project / "source" / "layers" / "SE" / "torso.png").exists()
    assert not (project / LAYER_MANIFEST_FILENAME).exists()
    _assert_no_staging_remnants(project)


def test_preexisting_immutable_target_is_preserved_on_conflict(tmp_path: Path) -> None:
    incoming = tmp_path / "incoming"
    _write_rgba_layer(incoming / "head.png")
    project = tmp_path / "project"
    target = project / "source" / "layers" / "SE" / "head.png"
    target.parent.mkdir(parents=True)
    sentinel = b"preexisting immutable bytes"
    target.write_bytes(sentinel)
    importer = FolderLayerImporter(JsonProjectRepository())

    with pytest.raises(AssetImportError, match="already exists with different content"):
        importer.import_layers(_request(project, incoming, ("head.png", "head")))

    assert target.read_bytes() == sentinel
    assert not (project / LAYER_MANIFEST_FILENAME).exists()
    _assert_no_staging_remnants(project)


def test_oversized_existing_target_is_rejected_before_content_comparison(
    tmp_path: Path,
) -> None:
    incoming = tmp_path / "incoming"
    source_bytes = _write_rgba_layer(incoming / "head.png")
    project = tmp_path / "project"
    target = project / "source" / "layers" / "SE" / "head.png"
    target.parent.mkdir(parents=True)
    max_file_bytes = len(source_bytes) + 16
    sentinel = b"x" * (max_file_bytes + 1)
    target.write_bytes(sentinel)
    importer = FolderLayerImporter(
        JsonProjectRepository(),
        limits=ImportLimits(max_file_bytes=max_file_bytes),
    )

    with pytest.raises(AssetImportError, match="already exists with different content"):
        importer.import_layers(_request(project, incoming, ("head.png", "head")))

    assert target.read_bytes() == sentinel
    assert not (project / LAYER_MANIFEST_FILENAME).exists()
    _assert_no_staging_remnants(project)


def test_existing_canonical_source_can_bootstrap_catalog_idempotently(tmp_path: Path) -> None:
    project = tmp_path / "project"
    source = project / "source" / "layers" / "SE"
    target = source / "head.png"
    original = _write_rgba_layer(target, full_canvas=True)
    importer = FolderLayerImporter(JsonProjectRepository())
    request = _request(project, source, ("head.png", "head"), trim=False)

    first = importer.import_layers(request)
    first_manifest = (project / LAYER_MANIFEST_FILENAME).read_bytes()
    second = importer.import_layers(request)

    assert target.read_bytes() == original
    assert (project / LAYER_MANIFEST_FILENAME).read_bytes() == first_manifest
    assert first.imported_assets == second.imported_assets
    assert first.catalog_assets == second.catalog_assets
    assert first.catalog_assets[0].path == "source/layers/SE/head.png"
    _assert_no_staging_remnants(project)
