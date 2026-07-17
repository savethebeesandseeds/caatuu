"""Safe project-local PNG loading with bounded decoded and premultiplied caches."""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from threading import RLock
from typing import cast

import numpy as np
from PIL import Image, UnidentifiedImageError

from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.infrastructure.imaging.alpha import (
    PremultipliedRgbaImage,
    UInt8RgbaImage,
    to_premultiplied_rgba,
)

DEFAULT_MAX_CACHE_ENTRIES = 500
DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
DEFAULT_MAX_LAYER_DIMENSION = 2048


class AssetFileUnavailableError(RenderError):
    """Raised when an otherwise valid asset file is absent during rendering."""


@dataclass(frozen=True, slots=True)
class CachedAssetImage:
    """One immutable decoded image and its reusable premultiplied representation."""

    rgba: UInt8RgbaImage
    premultiplied: PremultipliedRgbaImage


@dataclass(frozen=True, slots=True)
class _AssetCacheKey:
    """Project-scoped image revision and decode-relevant metadata."""

    project_root: str
    resolved_path: str
    asset_id: str
    sha256: str
    source_width: int
    source_height: int
    trim_x: int
    trim_y: int
    trim_width: int
    trim_height: int


class RgbaAssetCache:
    """Load validated project PNGs and retain a bounded project-scoped LRU."""

    def __init__(
        self,
        *,
        max_entries: int = DEFAULT_MAX_CACHE_ENTRIES,
        max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
        max_layer_dimension: int = DEFAULT_MAX_LAYER_DIMENSION,
    ) -> None:
        self._max_entries = self._positive_int(max_entries, "max_entries")
        self._max_file_bytes = self._positive_int(max_file_bytes, "max_file_bytes")
        self._max_layer_dimension = self._positive_int(
            max_layer_dimension,
            "max_layer_dimension",
        )
        self._entries: OrderedDict[_AssetCacheKey, CachedAssetImage] = OrderedDict()
        self._lock = RLock()

    @property
    def entry_count(self) -> int:
        """Return the current number of retained asset revisions."""
        with self._lock:
            return len(self._entries)

    def load(
        self,
        project_root: Path,
        asset: AssetLayer,
    ) -> CachedAssetImage:
        """Return a cached immutable RGBA/premultiplied pair for ``asset``."""
        resolved_root, candidate = self._resolve_asset_path(project_root, asset)
        key = self._cache_key(resolved_root, candidate, asset)
        with self._lock:
            cached = self._entries.get(key)
            if cached is not None:
                self._entries.move_to_end(key)
                return cached

        loaded = self._load_uncached(candidate, asset)
        with self._lock:
            cached = self._entries.get(key)
            if cached is not None:
                self._entries.move_to_end(key)
                return cached
            self._entries[key] = loaded
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)
        return loaded

    def load_rgba(self, project_root: Path, asset: AssetLayer) -> UInt8RgbaImage:
        """Return the immutable straight-alpha RGBA cache entry."""
        return self.load(project_root, asset).rgba

    def load_premultiplied(
        self,
        project_root: Path,
        asset: AssetLayer,
    ) -> PremultipliedRgbaImage:
        """Return the immutable premultiplied float32 cache entry."""
        return self.load(project_root, asset).premultiplied

    def invalidate(self, asset_id: str) -> None:
        """Discard every retained revision for one semantic asset ID."""
        with self._lock:
            keys = tuple(key for key in self._entries if key.asset_id == asset_id)
            for key in keys:
                del self._entries[key]

    def clear(self) -> None:
        """Discard all decoded and premultiplied images."""
        with self._lock:
            self._entries.clear()

    def _load_uncached(
        self,
        candidate: Path,
        asset: AssetLayer,
    ) -> CachedAssetImage:
        encoded = self._read_asset(candidate, asset)
        digest = hashlib.sha256(encoded).hexdigest()
        if digest != asset.sha256:
            raise RenderError(
                f"Asset '{asset.asset_id}' does not match its recorded SHA-256 digest."
            )

        rgba = self._freeze_uint8(self._decode_png(encoded, asset))
        premultiplied = self._freeze_float32(to_premultiplied_rgba(rgba))
        return CachedAssetImage(
            rgba=rgba,
            premultiplied=premultiplied,
        )

    def _resolve_asset_path(
        self,
        project_root: Path,
        asset: AssetLayer,
    ) -> tuple[Path, Path]:
        if Path(asset.path).suffix.lower() != ".png":
            raise RenderError(f"Asset '{asset.asset_id}' must reference a PNG file.")
        try:
            resolved_root = project_root.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise RenderError("The approved project root is unavailable.") from exc
        if not resolved_root.is_dir():
            raise RenderError("The approved project root is not a directory.")

        relative_path = Path(*asset.path.split("/"))
        try:
            candidate = (resolved_root / relative_path).resolve(strict=True)
        except FileNotFoundError as exc:
            raise AssetFileUnavailableError(
                f"Asset file for '{asset.asset_id}' is unavailable at '{asset.path}'."
            ) from exc
        except (OSError, RuntimeError) as exc:
            raise RenderError(
                f"Asset path for '{asset.asset_id}' cannot be resolved safely."
            ) from exc
        if not candidate.is_relative_to(resolved_root):
            raise RenderError(
                f"Asset path for '{asset.asset_id}' resolves outside the approved project root."
            )
        if not candidate.is_file():
            raise RenderError(f"Asset path for '{asset.asset_id}' is not a regular file.")
        return resolved_root, candidate

    @staticmethod
    def _cache_key(
        resolved_root: Path,
        candidate: Path,
        asset: AssetLayer,
    ) -> _AssetCacheKey:
        return _AssetCacheKey(
            project_root=str(resolved_root),
            resolved_path=str(candidate),
            asset_id=asset.asset_id,
            sha256=asset.sha256,
            source_width=asset.source_canvas_size.width,
            source_height=asset.source_canvas_size.height,
            trim_x=asset.trim_origin.x,
            trim_y=asset.trim_origin.y,
            trim_width=asset.trim_size.width,
            trim_height=asset.trim_size.height,
        )

    def _read_asset(self, candidate: Path, asset: AssetLayer) -> bytes:
        try:
            file_size = candidate.stat().st_size
        except FileNotFoundError as exc:
            raise AssetFileUnavailableError(
                f"Asset file for '{asset.asset_id}' became unavailable."
            ) from exc
        except OSError as exc:
            raise RenderError(f"Asset file for '{asset.asset_id}' cannot be inspected.") from exc
        if file_size > self._max_file_bytes:
            raise RenderError(f"Asset '{asset.asset_id}' exceeds the configured file-size limit.")
        try:
            encoded = candidate.read_bytes()
        except FileNotFoundError as exc:
            raise AssetFileUnavailableError(
                f"Asset file for '{asset.asset_id}' became unavailable."
            ) from exc
        except OSError as exc:
            raise RenderError(f"Asset file for '{asset.asset_id}' cannot be read.") from exc
        if len(encoded) > self._max_file_bytes:
            raise RenderError(f"Asset '{asset.asset_id}' exceeds the configured file-size limit.")
        return encoded

    def _decode_png(self, encoded: bytes, asset: AssetLayer) -> UInt8RgbaImage:
        try:
            with Image.open(BytesIO(encoded)) as source:
                if source.format != "PNG":
                    raise RenderError(f"Asset '{asset.asset_id}' is not a PNG image.")
                width, height = source.size
                if width > self._max_layer_dimension or height > self._max_layer_dimension:
                    raise RenderError(
                        f"Asset '{asset.asset_id}' exceeds the configured dimension limit."
                    )
                if (width, height) != (asset.trim_size.width, asset.trim_size.height):
                    raise RenderError(
                        f"Asset '{asset.asset_id}' dimensions do not match its recorded trim size."
                    )
                rgba = np.array(source.convert("RGBA"), dtype=np.uint8, copy=True)
        except RenderError:
            raise
        except (Image.DecompressionBombError, OSError, UnidentifiedImageError) as exc:
            raise RenderError(f"Asset '{asset.asset_id}' is not a readable PNG image.") from exc

        if rgba.shape != (asset.trim_size.height, asset.trim_size.width, 4):
            raise RenderError(f"Asset '{asset.asset_id}' did not decode as RGBA pixels.")
        return rgba

    @staticmethod
    def _positive_int(value: int, name: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"{name} must be a positive integer")
        return value

    @staticmethod
    def _freeze_uint8(image: UInt8RgbaImage) -> UInt8RgbaImage:
        frozen = np.frombuffer(image.tobytes(order="C"), dtype=np.uint8).reshape(image.shape)
        return cast(UInt8RgbaImage, frozen)

    @staticmethod
    def _freeze_float32(image: PremultipliedRgbaImage) -> PremultipliedRgbaImage:
        frozen = np.frombuffer(image.tobytes(order="C"), dtype=np.float32).reshape(image.shape)
        return cast(PremultipliedRgbaImage, frozen)


__all__ = [
    "AssetFileUnavailableError",
    "CachedAssetImage",
    "DEFAULT_MAX_CACHE_ENTRIES",
    "DEFAULT_MAX_FILE_BYTES",
    "DEFAULT_MAX_LAYER_DIMENSION",
    "RgbaAssetCache",
]
