"""OpenCV affine compositor using premultiplied source-over RGBA math."""

from __future__ import annotations

import math
from pathlib import Path
from typing import cast

import cv2
import numpy as np
import numpy.typing as npt

from animated_fabric.application.rendering import (
    ClippingEdges,
    CompositedFrame,
    CompositeRequest,
    FrameCompositor,
    RenderQuality,
)
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.geometry import IntSize
from animated_fabric.domain.transforms import Matrix3
from animated_fabric.infrastructure.imaging.alpha import (
    PremultipliedRgbaImage,
    UInt8RgbaImage,
    apply_opacity,
    sanitize_premultiplied,
    source_over,
    to_straight_rgba,
)
from animated_fabric.infrastructure.imaging.image_store import (
    AssetFileUnavailableError,
    RgbaAssetCache,
)

type OpenCvAffineMatrix = npt.NDArray[np.float32]

_INTERPOLATION_FLAGS = {
    RenderQuality.NEAREST: cv2.INTER_NEAREST,
    RenderQuality.LINEAR: cv2.INTER_LINEAR,
    RenderQuality.CUBIC: cv2.INTER_CUBIC,
}


def affine_matrix_for_opencv(matrix: Matrix3) -> OpenCvAffineMatrix:
    """Convert one finite column-vector source-to-canvas matrix to OpenCV 2x3 form."""
    bottom = matrix.rows[2]
    if not (
        math.isclose(bottom[0], 0.0, abs_tol=1e-12)
        and math.isclose(bottom[1], 0.0, abs_tol=1e-12)
        and math.isclose(bottom[2], 1.0, abs_tol=1e-12)
    ):
        raise RenderError("The part transform must be affine.")

    with np.errstate(over="ignore", invalid="ignore"):
        affine = np.asarray(matrix.rows[:2], dtype=np.float32)
    if affine.shape != (2, 3) or not np.isfinite(affine).all():
        raise RenderError("The part transform cannot be represented as finite float32 values.")
    return cast(OpenCvAffineMatrix, np.ascontiguousarray(affine))


def warp_premultiplied_rgba(
    image: PremultipliedRgbaImage,
    matrix: Matrix3,
    canvas_size: IntSize,
    quality: RenderQuality = RenderQuality.CUBIC,
) -> PremultipliedRgbaImage:
    """Warp premultiplied RGBA into a transparent fixed-size canvas."""
    source = sanitize_premultiplied(image)
    try:
        interpolation = _INTERPOLATION_FLAGS[quality]
    except KeyError as exc:  # pragma: no cover - strict enum contract normally prevents this
        raise RenderError(f"Unsupported render quality '{quality}'.") from exc
    try:
        warped = cv2.warpAffine(
            source,
            affine_matrix_for_opencv(matrix),
            (canvas_size.width, canvas_size.height),
            flags=interpolation,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0.0, 0.0, 0.0, 0.0),
        )
    except cv2.error as exc:
        raise RenderError("OpenCV could not apply the part transform.") from exc
    if warped.shape != (canvas_size.height, canvas_size.width, 4) or warped.dtype != np.float32:
        raise RenderError("OpenCV returned an unexpected warped-image shape.")
    warped_float32 = cast(PremultipliedRgbaImage, warped)
    return sanitize_premultiplied(warped_float32)


def detect_clipping(
    image: UInt8RgbaImage,
    alpha_threshold: int = 0,
) -> ClippingEdges:
    """Report final-frame edges containing alpha strictly above ``alpha_threshold``."""
    if (
        isinstance(alpha_threshold, bool)
        or not isinstance(alpha_threshold, int)
        or not 0 <= alpha_threshold <= 255
    ):
        raise RenderError("The clipping alpha threshold must be an integer from 0 through 255.")
    if not isinstance(image, np.ndarray) or image.dtype != np.uint8:
        raise RenderError("Clipping detection requires a uint8 RGBA image.")
    if image.ndim != 3 or image.shape[2] != 4 or image.shape[0] == 0 or image.shape[1] == 0:
        raise RenderError("Clipping detection requires a non-empty H x W x 4 image.")

    alpha = image[:, :, 3]
    return ClippingEdges(
        top=bool(np.any(alpha[0, :] > alpha_threshold)),
        right=bool(np.any(alpha[:, -1] > alpha_threshold)),
        bottom=bool(np.any(alpha[-1, :] > alpha_threshold)),
        left=bool(np.any(alpha[:, 0] > alpha_threshold)),
    )


class OpenCvFrameCompositor(FrameCompositor):
    """Compose a preplanned authored-direction frame from cached project assets."""

    def __init__(
        self,
        project_root: Path,
        *,
        asset_cache: RgbaAssetCache | None = None,
    ) -> None:
        self._project_root = project_root
        self._asset_cache = asset_cache or RgbaAssetCache()

    @property
    def asset_cache(self) -> RgbaAssetCache:
        """Expose cache lifecycle controls without exposing its mutable mapping."""
        return self._asset_cache

    def compose(self, request: CompositeRequest) -> CompositedFrame:
        """Warp and source-over all planned layers from bottom to top."""
        canvas = np.zeros(
            (request.canvas_size.height, request.canvas_size.width, 4),
            dtype=np.float32,
        )
        canvas.setflags(write=False)

        for layer in request.layers:
            try:
                cached = self._asset_cache.load_premultiplied(
                    self._project_root,
                    layer.asset,
                )
            except AssetFileUnavailableError:
                if layer.asset.optional:
                    continue
                raise
            source = apply_opacity(cached, layer.opacity)
            warped = warp_premultiplied_rgba(
                source,
                layer.matrix,
                request.canvas_size,
                request.quality,
            )
            canvas = source_over(warped, canvas)

        rgba = to_straight_rgba(canvas)
        clipping = detect_clipping(rgba, request.alpha_threshold)
        return CompositedFrame(
            canvas_size=request.canvas_size,
            rgba=rgba.tobytes(order="C"),
            clipping=clipping,
        )


__all__ = [
    "OpenCvFrameCompositor",
    "affine_matrix_for_opencv",
    "detect_clipping",
    "warp_premultiplied_rgba",
]
