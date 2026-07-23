"""Isolated local image-to-3D research tooling."""

from __future__ import annotations

from pathlib import Path

__version__ = "0.1.0"

TRIPOSR_SOURCE_REVISION = "d26e33181947bbbc4c6fc0f5734e1ec6c080956e"
PYMCUBES_VERSION = "0.1.6"
PYMCUBES_WHEEL_SHA256 = "ea366a2064af0846093e0ad3f9035e375f4b14b62bb565c95dcc8dcaf78308a5"
TRIPOSR_MODEL_ID = "stabilityai/TripoSR"
TRIPOSR_MODEL_REVISION = "5b521936b01fbe1890f6f9baed0254ab6351c04a"
DINO_MODEL_ID = "facebook/dino-vitb16"
DINO_MODEL_REVISION = "f205d5d8e640a89a2b8ef0369670dfc37cc07fc2"


def configured_model_cache(explicit: Path | None = None) -> Path:
    """Return the project-owned Hugging Face cache root."""
    if explicit is not None:
        return explicit
    import os

    return Path(os.environ.get("ANIMATED_FABRIC_MODEL_CACHE", "/models/huggingface/hub"))
