"""Tests for safe bounded RGBA asset decoding and cache invalidation."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.geometry import IntPoint, IntSize
from animated_fabric.domain.project import Direction
from animated_fabric.infrastructure.imaging.image_store import RgbaAssetCache


def _asset(
    relative_path: str,
    encoded: bytes,
    *,
    asset_id: str = "layer",
    width: int = 2,
    height: int = 1,
    digest: str | None = None,
) -> AssetLayer:
    return AssetLayer(
        asset_id=asset_id,
        direction=Direction.SE,
        semantic_part="body",
        path=relative_path,
        source_canvas_size=IntSize(width=width, height=height),
        trim_origin=IntPoint(x=0, y=0),
        trim_size=IntSize(width=width, height=height),
        sha256=digest or hashlib.sha256(encoded).hexdigest(),
    )


def _write_png(
    root: Path,
    relative_path: str,
    pixels: np.ndarray,
) -> tuple[AssetLayer, Path]:
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, mode="RGBA").save(path, format="PNG")
    encoded = path.read_bytes()
    height, width, _ = pixels.shape
    return (
        _asset(relative_path, encoded, width=width, height=height),
        path,
    )


def test_load_preserves_rgba_order_and_caches_read_only_premultiplication(
    tmp_path: Path,
) -> None:
    pixels = np.array([[[255, 10, 20, 128], [1, 200, 3, 255]]], dtype=np.uint8)
    asset, _ = _write_png(tmp_path, "source/layers/SE/layer.png", pixels)
    cache = RgbaAssetCache()

    loaded = cache.load(tmp_path, asset)
    repeated = cache.load(tmp_path, asset)

    np.testing.assert_array_equal(loaded.rgba, pixels)
    assert loaded.rgba.dtype == np.uint8
    assert loaded.premultiplied.dtype == np.float32
    assert loaded.premultiplied[0, 0, 0] == pytest.approx(128 / 255)
    assert loaded is repeated
    assert cache.entry_count == 1
    with pytest.raises(ValueError, match="read-only"):
        loaded.rgba[0, 0, 0] = 0
    with pytest.raises(ValueError, match="read-only"):
        loaded.premultiplied[0, 0, 0] = 0.0
    with pytest.raises(ValueError, match="cannot set WRITEABLE flag"):
        loaded.rgba.setflags(write=True)
    with pytest.raises(ValueError, match="cannot set WRITEABLE flag"):
        loaded.premultiplied.setflags(write=True)


def test_indexed_png_transparency_is_converted_to_true_rgba(tmp_path: Path) -> None:
    path = tmp_path / "source/indexed.png"
    path.parent.mkdir(parents=True)
    indexed = Image.new("P", (2, 1))
    indexed.putpalette([255, 0, 0, 0, 255, 0] + [0, 0, 0] * 254)
    indexed.putdata([0, 1])
    indexed.info["transparency"] = 0
    indexed.save(path, format="PNG")
    encoded = path.read_bytes()
    asset = _asset("source/indexed.png", encoded)

    rgba = RgbaAssetCache().load_rgba(tmp_path, asset)

    np.testing.assert_array_equal(
        rgba,
        np.array([[[255, 0, 0, 0], [0, 255, 0, 255]]], dtype=np.uint8),
    )


def test_cache_hit_survives_file_removal_until_targeted_invalidation(tmp_path: Path) -> None:
    pixels = np.array([[[10, 20, 30, 255]]], dtype=np.uint8)
    asset, path = _write_png(tmp_path, "source/layer.png", pixels)
    cache = RgbaAssetCache()

    expected = cache.load_rgba(tmp_path, asset)
    path.unlink()

    assert cache.load_rgba(tmp_path, asset) is expected
    cache.invalidate(asset.asset_id)
    assert cache.entry_count == 0
    with pytest.raises(RenderError, match="unavailable"):
        cache.load_rgba(tmp_path, asset)


def test_changed_digest_creates_a_distinct_revision_and_invalidation_removes_both(
    tmp_path: Path,
) -> None:
    first, _ = _write_png(
        tmp_path,
        "source/layer.png",
        np.array([[[255, 0, 0, 255]]], dtype=np.uint8),
    )
    cache = RgbaAssetCache()
    first_pixels = cache.load_rgba(tmp_path, first)
    second, _ = _write_png(
        tmp_path,
        "source/layer.png",
        np.array([[[0, 0, 255, 255]]], dtype=np.uint8),
    )

    second_pixels = cache.load_rgba(tmp_path, second)

    assert first.sha256 != second.sha256
    np.testing.assert_array_equal(first_pixels[0, 0], [255, 0, 0, 255])
    np.testing.assert_array_equal(second_pixels[0, 0], [0, 0, 255, 255])
    assert cache.entry_count == 2
    cache.invalidate("layer")
    assert cache.entry_count == 0


def test_lru_capacity_evicts_the_least_recently_used_revision(tmp_path: Path) -> None:
    cache = RgbaAssetCache(max_entries=2)
    assets: list[tuple[AssetLayer, Path]] = []
    for index, color in enumerate((10, 20, 30)):
        asset, path = _write_png(
            tmp_path,
            f"source/layer_{index}.png",
            np.array([[[color, 0, 0, 255]]], dtype=np.uint8),
        )
        asset = asset.model_copy(update={"asset_id": f"layer_{index}"})
        assets.append((asset, path))

    cache.load(tmp_path, assets[0][0])
    cache.load(tmp_path, assets[1][0])
    cache.load(tmp_path, assets[0][0])
    cache.load(tmp_path, assets[2][0])
    assets[1][1].unlink()

    assert cache.entry_count == 2
    with pytest.raises(RenderError, match="unavailable"):
        cache.load(tmp_path, assets[1][0])
    cache.clear()
    assert cache.entry_count == 0


@pytest.mark.parametrize(
    ("cache", "message"),
    [
        (RgbaAssetCache(max_file_bytes=1), "file-size limit"),
        (RgbaAssetCache(max_layer_dimension=1), "dimension limit"),
    ],
)
def test_configured_file_and_dimension_limits_are_enforced(
    tmp_path: Path,
    cache: RgbaAssetCache,
    message: str,
) -> None:
    asset, _ = _write_png(
        tmp_path,
        "source/wide.png",
        np.zeros((1, 2, 4), dtype=np.uint8),
    )

    with pytest.raises(RenderError, match=message):
        cache.load(tmp_path, asset)


def test_hash_trim_size_extension_and_decode_failures_are_typed(tmp_path: Path) -> None:
    pixels = np.zeros((1, 2, 4), dtype=np.uint8)
    asset, path = _write_png(tmp_path, "source/layer.png", pixels)

    wrong_hash = asset.model_copy(update={"sha256": "0" * 64})
    with pytest.raises(RenderError, match="SHA-256"):
        RgbaAssetCache().load(tmp_path, wrong_hash)

    wrong_size = asset.model_copy(
        update={
            "source_canvas_size": IntSize(width=1, height=1),
            "trim_size": IntSize(width=1, height=1),
        }
    )
    with pytest.raises(RenderError, match="trim size"):
        RgbaAssetCache().load(tmp_path, wrong_size)

    renamed = tmp_path / "source/layer.dat"
    path.replace(renamed)
    wrong_extension = asset.model_copy(update={"path": "source/layer.dat"})
    with pytest.raises(RenderError, match="PNG file"):
        RgbaAssetCache().load(tmp_path, wrong_extension)

    corrupt_path = tmp_path / "source/corrupt.png"
    corrupt_path.write_bytes(b"not a png")
    corrupt = _asset("source/corrupt.png", b"not a png")
    with pytest.raises(RenderError, match="readable PNG"):
        RgbaAssetCache().load(tmp_path, corrupt)


def test_symlink_escape_is_rejected_before_decode(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    source = project_root / "source"
    source.mkdir(parents=True)
    outside = tmp_path / "outside.png"
    Image.new("RGBA", (1, 1), (255, 0, 0, 255)).save(outside, format="PNG")
    encoded = outside.read_bytes()
    (source / "escape.png").symlink_to(outside)
    asset = _asset("source/escape.png", encoded, width=1, height=1)

    with pytest.raises(RenderError, match="outside the approved project root"):
        RgbaAssetCache().load(project_root, asset)


def test_symlink_loop_project_root_raises_typed_render_error(tmp_path: Path) -> None:
    project_root = tmp_path / "loop"
    project_root.symlink_to(project_root.name)
    asset = _asset("source/layer.png", b"unused", width=1, height=1)

    with pytest.raises(RenderError, match="project root is unavailable"):
        RgbaAssetCache().load(project_root, asset)


@pytest.mark.parametrize("value", [0, -1, True])
def test_cache_limits_require_positive_integers(value: int) -> None:
    with pytest.raises(ValueError, match="positive integer"):
        RgbaAssetCache(max_entries=value)
