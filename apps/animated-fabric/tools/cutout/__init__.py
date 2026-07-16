"""Optional, self-contained background cutout tooling for Animated Fabric."""

from pathlib import Path

__all__ = [
    "DEFAULT_MODEL_ID",
    "DEFAULT_MODEL_REVISION",
    "MODEL_CACHE_ENV",
    "__version__",
]

__version__ = "0.1.0"

DEFAULT_MODEL_ID = "ZhengPeng7/BiRefNet"
DEFAULT_MODEL_REVISION = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"
MODEL_CACHE_ENV = "ANIMATED_FABRIC_MODEL_CACHE"
DEFAULT_MODEL_CACHE = Path.home() / ".cache" / "huggingface" / "hub"
