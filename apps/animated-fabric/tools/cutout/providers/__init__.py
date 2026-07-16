"""Cutout provider registry and licensing metadata."""

from __future__ import annotations

from dataclasses import dataclass

from tools.cutout import DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION


@dataclass(frozen=True, slots=True)
class ModelInfo:
    """Human-readable provider and licensing information."""

    key: str
    label: str
    license: str
    role: str
    notes: str


MODEL_INFOS = (
    ModelInfo(
        key="classic",
        label="Classic border flood-fill",
        license="MIT-derived local implementation; see LICENSE.tukevejtso",
        role="Offline fallback for flat or studio backgrounds",
        notes="Uses Pillow and NumPy only; it is not a learned matting model.",
    ),
    ModelInfo(
        key="birefnet",
        label="BiRefNet",
        license="MIT; see LICENSE.birefnet and verify weight terms before redistribution",
        role="Optional high-quality foreground segmentation",
        notes=(
            f"Default {DEFAULT_MODEL_ID}@{DEFAULT_MODEL_REVISION}; weights are not bundled. "
            "Remote code is provisioned explicitly and loaded offline at the pinned revision."
        ),
    ),
)
