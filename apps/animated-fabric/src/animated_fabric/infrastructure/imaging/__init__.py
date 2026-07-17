"""Image decoding, caching, and compositing infrastructure."""

from animated_fabric.infrastructure.imaging.alpha import (
    PremultipliedRgbaImage,
    UInt8RgbaImage,
    apply_opacity,
    sanitize_premultiplied,
    source_over,
    to_premultiplied_rgba,
    to_straight_rgba,
)
from animated_fabric.infrastructure.imaging.image_store import (
    AssetFileUnavailableError,
    CachedAssetImage,
    RgbaAssetCache,
)
from animated_fabric.infrastructure.imaging.opencv_compositor import (
    OpenCvFrameCompositor,
    affine_matrix_for_opencv,
    detect_clipping,
    warp_premultiplied_rgba,
)
from animated_fabric.infrastructure.imaging.opencv_renderer import OpenCvRenderer
from animated_fabric.infrastructure.imaging.png_writer import PngFrameWriter

__all__ = [
    "AssetFileUnavailableError",
    "CachedAssetImage",
    "OpenCvFrameCompositor",
    "OpenCvRenderer",
    "PngFrameWriter",
    "PremultipliedRgbaImage",
    "RgbaAssetCache",
    "UInt8RgbaImage",
    "affine_matrix_for_opencv",
    "apply_opacity",
    "detect_clipping",
    "sanitize_premultiplied",
    "source_over",
    "to_premultiplied_rgba",
    "to_straight_rgba",
    "warp_premultiplied_rgba",
]
