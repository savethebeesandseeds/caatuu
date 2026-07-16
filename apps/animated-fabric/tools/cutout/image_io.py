"""Image loading helpers with optional-dependency errors."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from tools.cutout.errors import MissingDependencyError

if TYPE_CHECKING:
    from PIL.Image import Image as PillowImage


def require_pillow_numpy() -> None:
    """Require only the lightweight classic-provider dependency set."""
    try:
        import numpy as np  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError as exc:
        raise MissingDependencyError(
            "Cutout needs Pillow and NumPy. Build the Dockerfile.cutout core target."
        ) from exc


def default_output_path(input_path: Path, suffix: str, extension: str) -> Path:
    """Build a sibling output filename without modifying the input."""
    return input_path.with_name(f"{input_path.stem}{suffix}.{extension}")


def open_rgba(path: Path) -> PillowImage:
    """Open an image as a detached RGBA Pillow image."""
    require_pillow_numpy()
    from PIL import Image

    with Image.open(path) as image:
        return image.convert("RGBA")
