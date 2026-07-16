"""Shared value objects for cutout providers and the CLI."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from tools.cutout import (
    DEFAULT_MODEL_CACHE,
    DEFAULT_MODEL_ID,
    DEFAULT_MODEL_REVISION,
    MODEL_CACHE_ENV,
)

if TYPE_CHECKING:
    from PIL.Image import Image as PillowImage

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]


def configured_model_cache(explicit: Path | None = None) -> Path:
    """Return the cache directory shared by provisioning and offline runtime."""
    if explicit is not None:
        return explicit.expanduser()
    configured = os.environ.get(MODEL_CACHE_ENV)
    if configured:
        return Path(configured).expanduser()
    hugging_face_cache = os.environ.get("HF_HUB_CACHE")
    if hugging_face_cache:
        return Path(hugging_face_cache).expanduser()
    hugging_face_home = os.environ.get("HF_HOME")
    if hugging_face_home:
        return Path(hugging_face_home).expanduser() / "hub"
    return DEFAULT_MODEL_CACHE


@dataclass(slots=True)
class CutoutOptions:
    """Provider-neutral cutout settings."""

    engine: str = "auto"
    preset: str = "balanced"
    device: str = "auto"
    model_name: str = DEFAULT_MODEL_ID
    model_revision: str = DEFAULT_MODEL_REVISION
    model_cache: Path = field(default_factory=configured_model_cache)
    input_size: int = 1024
    tolerance: float | None = None
    edge_softness: float | None = None
    bg_palette_size: int = 4
    alpha_floor: int = 24
    alpha_ceiling: int = 250
    decontaminate: bool = True


def _atomic_png(image: PillowImage, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        image.save(temporary_path, format="PNG")
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)


@dataclass(slots=True)
class CutoutResult:
    """Images and structured diagnostics returned by one provider."""

    rgba: PillowImage
    alpha: PillowImage
    hard_mask: PillowImage | None
    diagnostics: dict[str, JsonValue] = field(default_factory=dict)

    def save(
        self,
        output: Path,
        *,
        alpha_output: Path | None = None,
        mask_output: Path | None = None,
    ) -> None:
        """Atomically persist transparent PNG output and optional sidecars."""
        _atomic_png(self.rgba, output)
        if alpha_output is not None:
            _atomic_png(self.alpha, alpha_output)
        if mask_output is not None and self.hard_mask is not None:
            _atomic_png(self.hard_mask, mask_output)
