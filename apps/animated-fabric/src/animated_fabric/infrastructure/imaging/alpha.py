"""Immutable premultiplied-alpha operations for the OpenCV rendering boundary."""

from __future__ import annotations

import math
from numbers import Real

import numpy as np
from numpy.typing import NDArray

from animated_fabric.domain.exceptions import RenderError

type UInt8RgbaImage = NDArray[np.uint8]
type PremultipliedRgbaImage = NDArray[np.float32]

_ZERO = np.float32(0.0)
_ONE = np.float32(1.0)
_UINT8_MAX = np.float32(255.0)
_ALPHA_EPSILON = np.finfo(np.float32).eps


def _validate_rgba_shape(image: NDArray[np.generic], label: str) -> None:
    if image.ndim != 3 or image.shape[2] != 4:
        raise RenderError(f"{label} must have shape (height, width, 4).")
    if image.shape[0] <= 0 or image.shape[1] <= 0:
        raise RenderError(f"{label} dimensions must be positive.")


def _require_uint8_rgba(image: UInt8RgbaImage, label: str) -> UInt8RgbaImage:
    if not isinstance(image, np.ndarray):
        raise RenderError(f"{label} must be a NumPy array.")
    _validate_rgba_shape(image, label)
    if image.dtype != np.dtype(np.uint8):
        raise RenderError(f"{label} must use uint8 RGBA values.")
    return image


def _require_premultiplied(
    image: PremultipliedRgbaImage,
    label: str,
) -> PremultipliedRgbaImage:
    if not isinstance(image, np.ndarray):
        raise RenderError(f"{label} must be a NumPy array.")
    _validate_rgba_shape(image, label)
    if image.dtype != np.dtype(np.float32):
        raise RenderError(f"{label} must use normalized float32 RGBA values.")
    if not bool(np.isfinite(image).all()):
        raise RenderError(f"{label} must contain only finite values.")
    return image


def _readonly(image: PremultipliedRgbaImage) -> PremultipliedRgbaImage:
    image.flags.writeable = False
    return image


def _readonly_uint8(image: UInt8RgbaImage) -> UInt8RgbaImage:
    image.flags.writeable = False
    return image


def to_premultiplied_rgba(image: UInt8RgbaImage) -> PremultipliedRgbaImage:
    """Convert straight uint8 RGBA into normalized premultiplied float32 RGBA."""
    source = _require_uint8_rgba(image, "RGBA image")
    result = source.astype(np.float32, copy=True) / _UINT8_MAX
    result[..., :3] *= result[..., 3:4]
    return _readonly(result)


def sanitize_premultiplied(
    image: PremultipliedRgbaImage,
) -> PremultipliedRgbaImage:
    """Clamp finite interpolation overshoot while preserving premultiplied invariants."""
    source = _require_premultiplied(image, "Premultiplied image")
    result = source.copy(order="C")
    alpha = result[..., 3]
    rgb = result[..., :3]
    np.clip(alpha, _ZERO, _ONE, out=alpha)
    np.clip(rgb, _ZERO, _ONE, out=rgb)
    np.minimum(rgb, alpha[..., np.newaxis], out=rgb)
    return _readonly(result)


def apply_opacity(
    image: PremultipliedRgbaImage,
    opacity: float,
) -> PremultipliedRgbaImage:
    """Apply normalized opacity to every premultiplied channel."""
    if isinstance(opacity, bool) or not isinstance(opacity, Real):
        raise RenderError("Opacity must be a finite number between 0 and 1.")
    try:
        normalized_opacity = float(opacity)
    except (OverflowError, TypeError, ValueError) as exc:
        raise RenderError("Opacity must be a finite number between 0 and 1.") from exc
    if not math.isfinite(normalized_opacity) or not 0.0 <= normalized_opacity <= 1.0:
        raise RenderError("Opacity must be a finite number between 0 and 1.")

    source = sanitize_premultiplied(image)
    result = source * np.float32(normalized_opacity)
    return _readonly(result)


def source_over(
    source: PremultipliedRgbaImage,
    destination: PremultipliedRgbaImage,
) -> PremultipliedRgbaImage:
    """Composite ``source`` over ``destination`` using premultiplied source-over."""
    clean_source = sanitize_premultiplied(source)
    clean_destination = sanitize_premultiplied(destination)
    if clean_source.shape != clean_destination.shape:
        raise RenderError("Source and destination images must have identical dimensions.")

    inverse_source_alpha = _ONE - clean_source[..., 3:4]
    result = clean_source + clean_destination * inverse_source_alpha
    return sanitize_premultiplied(result)


def to_straight_rgba(image: PremultipliedRgbaImage) -> UInt8RgbaImage:
    """Convert premultiplied float32 RGBA to safe straight uint8 RGBA."""
    source = sanitize_premultiplied(image)
    straight = np.zeros(source.shape, dtype=np.float32)
    alpha = source[..., 3:4]
    np.divide(
        source[..., :3],
        alpha,
        out=straight[..., :3],
        where=alpha > _ALPHA_EPSILON,
    )
    straight[..., 3:4] = alpha

    result = np.rint(np.clip(straight, _ZERO, _ONE) * _UINT8_MAX).astype(np.uint8)
    transparent = result[..., 3] == 0
    result[..., :3][transparent] = 0
    return _readonly_uint8(result)


__all__ = [
    "PremultipliedRgbaImage",
    "UInt8RgbaImage",
    "apply_opacity",
    "sanitize_premultiplied",
    "source_over",
    "to_premultiplied_rgba",
    "to_straight_rgba",
]
