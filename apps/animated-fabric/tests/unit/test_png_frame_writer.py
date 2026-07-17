"""AF-023 tests for deterministic, atomic PNG frame publication."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from animated_fabric.application.rendering import (
    ClippingEdges,
    RenderedFrame,
    RenderProject,
)
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.geometry import IntPoint, IntSize, Vec2
from animated_fabric.domain.project import Direction
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.imaging import PngFrameWriter
from animated_fabric.infrastructure.imaging import png_writer as png_writer_module


def _frame() -> RenderedFrame:
    return RenderedFrame(
        canvas_size=IntSize(width=2, height=1),
        rgba=bytes((255, 0, 0, 255, 0, 255, 0, 128)),
        ground_anchor=Vec2(x=1.0, y=1.0),
        resolved_sockets={},
        active_events=(),
        clipping=ClippingEdges(),
    )


def test_writer_publishes_exact_rgba_png_and_leaves_no_temporary(tmp_path: Path) -> None:
    destination = tmp_path / "nested" / "frame.png"

    PngFrameWriter().write(destination, _frame())

    with Image.open(destination) as image:
        assert image.format == "PNG"
        assert image.mode == "RGBA"
        assert image.size == (2, 1)
        assert image.tobytes() == _frame().rgba
    assert list(destination.parent.glob(f".{destination.name}.*.tmp")) == []


def test_failed_atomic_replace_preserves_existing_destination_and_cleans_temp_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "frame.png"
    destination.write_bytes(b"existing-output")

    def fail_replace(source: Path, target: Path) -> None:
        del source, target
        raise OSError("simulated replacement failure")

    monkeypatch.setattr(png_writer_module.os, "replace", fail_replace)

    with pytest.raises(RenderError, match="atomically write"):
        PngFrameWriter().write(destination, _frame())

    assert destination.read_bytes() == b"existing-output"
    assert list(tmp_path.glob(f".{destination.name}.*.tmp")) == []


def test_writer_rejects_non_png_and_directory_destinations(tmp_path: Path) -> None:
    with pytest.raises(RenderError, match=r"\.png"):
        PngFrameWriter().write(tmp_path / "frame.jpg", _frame())

    directory = tmp_path / "directory.png"
    directory.mkdir()
    with pytest.raises(RenderError, match="directory"):
        PngFrameWriter().write(directory, _frame())


def test_project_writer_preserves_a_referenced_asset_outside_source(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    asset_path = project_root / "assets/layer.png"
    asset_path.parent.mkdir(parents=True)
    asset_path.write_bytes(b"immutable-layer")
    asset = AssetLayer(
        asset_id="se_layer",
        direction=Direction.SE,
        semantic_part="layer",
        path="assets/layer.png",
        source_canvas_size=IntSize(width=1, height=1),
        trim_origin=IntPoint(x=0, y=0),
        trim_size=IntSize(width=1, height=1),
        sha256="0" * 64,
    )
    project = RenderProject(
        root=project_root,
        manifest=build_stick_humanoid_manifest(),
        assets={asset.asset_id: asset},
    )

    with pytest.raises(RenderError, match="referenced project asset"):
        PngFrameWriter().write_project_frame(asset_path, _frame(), project)

    assert asset_path.read_bytes() == b"immutable-layer"


def test_writer_resolves_symlinked_parents_before_immutable_root_check(
    tmp_path: Path,
) -> None:
    source_root = tmp_path / "project/source"
    source_root.mkdir(parents=True)
    alias = tmp_path / "output-alias"
    alias.symlink_to(source_root, target_is_directory=True)

    with pytest.raises(RenderError, match="immutable source assets"):
        PngFrameWriter().write(
            alias / "frame.png",
            _frame(),
            immutable_roots=(source_root,),
        )

    assert not (source_root / "frame.png").exists()


def test_immutable_root_is_rejected_before_creating_destination_directories(
    tmp_path: Path,
) -> None:
    source_root = tmp_path / "project/source"
    source_root.mkdir(parents=True)
    destination = source_root / "new-output/frame.png"

    with pytest.raises(RenderError, match="immutable source assets"):
        PngFrameWriter().write(
            destination,
            _frame(),
            immutable_roots=(source_root,),
        )

    assert not destination.parent.exists()
