"""Exact and visual regression tests for the AF-022 OpenCV compositor."""

from __future__ import annotations

import hashlib
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from animated_fabric.application.rendering import (
    ClippingEdges,
    CompositeRequest,
    FrameCompositor,
    PlannedRenderLayer,
    RenderQuality,
)
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.geometry import IntPoint, IntSize, Vec2
from animated_fabric.domain.project import Direction
from animated_fabric.domain.transforms import (
    Matrix3,
    multiply_matrices,
    rotation_matrix,
    translation_matrix,
)
from animated_fabric.infrastructure.imaging.alpha import to_premultiplied_rgba
from animated_fabric.infrastructure.imaging.opencv_compositor import (
    OpenCvFrameCompositor,
    affine_matrix_for_opencv,
    detect_clipping,
    warp_premultiplied_rgba,
)


def _write_asset(
    root: Path,
    asset_id: str,
    pixels: np.ndarray,
) -> AssetLayer:
    relative_path = f"source/{asset_id}.png"
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, mode="RGBA").save(path, format="PNG")
    height, width, _ = pixels.shape
    return AssetLayer(
        asset_id=asset_id,
        direction=Direction.SE,
        semantic_part="body",
        path=relative_path,
        source_canvas_size=IntSize(width=width, height=height),
        trim_origin=IntPoint(x=0, y=0),
        trim_size=IntSize(width=width, height=height),
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
    )


def _layer(
    part_id: str,
    asset: AssetLayer,
    matrix: Matrix3,
    *,
    opacity: float = 1.0,
    effective_order: int = 0,
) -> PlannedRenderLayer:
    return PlannedRenderLayer(
        part_id=part_id,
        asset=asset,
        matrix=matrix,
        opacity=opacity,
        draw_slot="torso",
        slot_index=0,
        effective_slot_order=effective_order,
    )


def _pixels(frame_bytes: bytes, size: IntSize) -> np.ndarray:
    return np.frombuffer(frame_bytes, dtype=np.uint8).reshape(size.height, size.width, 4)


def test_compositor_matches_owned_source_over_golden(tmp_path: Path) -> None:
    bottom = _write_asset(
        tmp_path,
        "bottom",
        np.full((2, 2, 4), (0, 0, 255, 255), dtype=np.uint8),
    )
    top = _write_asset(
        tmp_path,
        "top",
        np.full((1, 2, 4), (255, 0, 0, 128), dtype=np.uint8),
    )
    size = IntSize(width=4, height=3)
    request = CompositeRequest(
        canvas_size=size,
        direction=Direction.SE,
        layers=(
            _layer("bottom", bottom, translation_matrix(Vec2(x=1.0, y=1.0))),
            _layer("top", top, translation_matrix(Vec2(x=2.0, y=1.0)), effective_order=1),
        ),
        quality=RenderQuality.NEAREST,
    )

    compositor = OpenCvFrameCompositor(tmp_path)
    frame = compositor.compose(request)
    expected_path = Path(__file__).resolve().parents[1] / "golden/af022_compositor.png"
    with Image.open(expected_path) as expected_image:
        expected = np.array(expected_image.convert("RGBA"), dtype=np.uint8)

    np.testing.assert_array_equal(_pixels(frame.rgba, size), expected)
    assert frame.clipping == ClippingEdges(right=True, bottom=True)
    assert isinstance(compositor, FrameCompositor)
    assert compositor.asset_cache.entry_count == 2


def test_layer_sequence_is_bottom_to_top_and_opacity_scales_all_channels(
    tmp_path: Path,
) -> None:
    blue = _write_asset(
        tmp_path,
        "blue",
        np.array([[[0, 0, 255, 255]]], dtype=np.uint8),
    )
    red = _write_asset(
        tmp_path,
        "red",
        np.array([[[255, 0, 0, 255]]], dtype=np.uint8),
    )
    size = IntSize(width=1, height=1)
    compositor = OpenCvFrameCompositor(tmp_path)

    frame = compositor.compose(
        CompositeRequest(
            canvas_size=size,
            direction=Direction.SE,
            layers=(
                _layer("blue", blue, Matrix3.from_rows((1, 0, 0), (0, 1, 0), (0, 0, 1))),
                _layer(
                    "red",
                    red,
                    Matrix3.from_rows((1, 0, 0), (0, 1, 0), (0, 0, 1)),
                    opacity=0.5,
                    effective_order=1,
                ),
            ),
            quality=RenderQuality.NEAREST,
        )
    )

    np.testing.assert_array_equal(_pixels(frame.rgba, size)[0, 0], [128, 0, 128, 255])


def test_missing_optional_asset_is_skipped_but_required_asset_remains_fatal(
    tmp_path: Path,
) -> None:
    asset = _write_asset(
        tmp_path,
        "optional",
        np.array([[[255, 0, 0, 255]]], dtype=np.uint8),
    )
    (tmp_path / asset.path).unlink()
    optional = asset.model_copy(update={"optional": True})
    size = IntSize(width=2, height=2)
    compositor = OpenCvFrameCompositor(tmp_path)

    frame = compositor.compose(
        CompositeRequest(
            canvas_size=size,
            direction=Direction.SE,
            layers=(
                _layer("optional", optional, Matrix3.from_rows((1, 0, 0), (0, 1, 0), (0, 0, 1))),
            ),
            quality=RenderQuality.NEAREST,
        )
    )

    assert frame.rgba == bytes(size.width * size.height * 4)
    assert frame.clipping == ClippingEdges()
    with pytest.raises(RenderError, match="unavailable"):
        compositor.compose(
            CompositeRequest(
                canvas_size=size,
                direction=Direction.SE,
                layers=(
                    _layer("required", asset, Matrix3.from_rows((1, 0, 0), (0, 1, 0), (0, 0, 1))),
                ),
                quality=RenderQuality.NEAREST,
            )
        )


def test_default_cubic_warp_uses_width_height_forward_matrix_and_transparent_border(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: dict[str, object] = {}

    def fake_warp(
        image: np.ndarray,
        matrix: np.ndarray,
        dsize: tuple[int, int],
        *,
        flags: int,
        borderMode: int,
        borderValue: tuple[float, float, float, float],
    ) -> np.ndarray:
        calls.update(
            matrix=matrix.copy(),
            dsize=dsize,
            flags=flags,
            border_mode=borderMode,
            border_value=borderValue,
        )
        return np.zeros((dsize[1], dsize[0], 4), dtype=np.float32)

    monkeypatch.setattr(cv2, "warpAffine", fake_warp)
    source = to_premultiplied_rgba(np.array([[[255, 255, 255, 255]]], dtype=np.uint8))
    matrix = translation_matrix(Vec2(x=2.0, y=3.0))

    warped = warp_premultiplied_rgba(source, matrix, IntSize(width=7, height=5))

    assert warped.shape == (5, 7, 4)
    assert calls["dsize"] == (7, 5)
    assert calls["flags"] == cv2.INTER_CUBIC
    assert calls["border_mode"] == cv2.BORDER_CONSTANT
    assert calls["border_value"] == (0.0, 0.0, 0.0, 0.0)
    np.testing.assert_array_equal(
        calls["matrix"],
        np.array([[1, 0, 2], [0, 1, 3]], dtype=np.float32),
    )


def test_rotated_soft_white_edge_stays_white_after_unpremultiplication(tmp_path: Path) -> None:
    pixels = np.full((3, 3, 4), (255, 255, 255, 0), dtype=np.uint8)
    pixels[1, 1] = (255, 255, 255, 255)
    asset = _write_asset(tmp_path, "white_dot", pixels)
    matrix = multiply_matrices(
        translation_matrix(Vec2(x=3.0, y=3.0)),
        rotation_matrix(27.0),
        translation_matrix(Vec2(x=-1.0, y=-1.0)),
    )
    size = IntSize(width=7, height=7)

    frame = OpenCvFrameCompositor(tmp_path).compose(
        CompositeRequest(
            canvas_size=size,
            direction=Direction.SE,
            layers=(_layer("white_dot", asset, matrix),),
        )
    )
    rgba = _pixels(frame.rgba, size)
    soft = (rgba[:, :, 3] > 0) & (rgba[:, :, 3] < 255)

    assert np.any(soft)
    assert np.all(rgba[:, :, :3][soft] >= 254)


def test_clipping_reports_each_edge_and_honors_strict_threshold() -> None:
    image = np.zeros((3, 3, 4), dtype=np.uint8)
    image[0, 1, 3] = 11
    image[1, 2, 3] = 20
    image[2, 1, 3] = 10

    assert detect_clipping(image, 10) == ClippingEdges(top=True, right=True)
    assert detect_clipping(image, 255) == ClippingEdges()


@pytest.mark.parametrize(
    "matrix",
    [
        Matrix3.from_rows((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.1, 0.0, 1.0)),
        Matrix3.from_rows((1e100, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
    ],
)
def test_non_affine_or_non_float32_transform_is_rejected(matrix: Matrix3) -> None:
    with pytest.raises(RenderError, match="affine|finite float32"):
        affine_matrix_for_opencv(matrix)


def test_clipping_rejects_invalid_buffers_and_thresholds() -> None:
    with pytest.raises(RenderError, match="uint8"):
        detect_clipping(np.zeros((1, 1, 4), dtype=np.float32))  # type: ignore[arg-type]
    with pytest.raises(RenderError, match="H x W x 4"):
        detect_clipping(np.zeros((1, 1, 3), dtype=np.uint8))  # type: ignore[arg-type]
    with pytest.raises(RenderError, match="0 through 255"):
        detect_clipping(np.zeros((1, 1, 4), dtype=np.uint8), -1)
