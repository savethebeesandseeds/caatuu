"""Offline dependency and model-cache diagnostics."""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path

from tools.cutout import DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION
from tools.cutout.errors import ModelIntegrityError
from tools.cutout.integrity import model_snapshot_path, verify_model_snapshot
from tools.cutout.types import configured_model_cache


@dataclass(frozen=True, slots=True)
class DependencyStatus:
    """One doctor check result."""

    name: str
    available: bool
    detail: str


def module_available(name: str) -> bool:
    """Check import availability without importing heavyweight modules."""
    return importlib.util.find_spec(name) is not None


def collect_status(
    *,
    model_name: str = DEFAULT_MODEL_ID,
    model_revision: str = DEFAULT_MODEL_REVISION,
    model_cache: Path | None = None,
) -> tuple[DependencyStatus, ...]:
    """Collect core, optional ML, and pinned snapshot status without network IO."""
    modules = (
        ("PIL", "Pillow image IO and previews"),
        ("numpy", "classic fallback and postprocessing"),
        ("torch", "optional PyTorch model provider"),
        ("torchvision", "optional BiRefNet preprocessing"),
        ("transformers", "optional pinned BiRefNet loading"),
        ("huggingface_hub", "explicit model prefetch"),
    )
    cache_dir = configured_model_cache(model_cache)
    snapshot = model_snapshot_path(model_name, model_revision, cache_dir)
    statuses = [DependencyStatus("python", True, sys.version.split()[0])]
    statuses.extend(
        DependencyStatus(name, module_available(name), detail) for name, detail in modules
    )
    snapshot_exists = snapshot.is_dir()
    statuses.append(
        DependencyStatus(
            "birefnet-cache",
            snapshot_exists,
            f"{model_name}@{model_revision} in {cache_dir}",
        )
    )
    try:
        report = verify_model_snapshot(
            snapshot,
            model_name=model_name,
            model_revision=model_revision,
        )
        statuses.append(DependencyStatus("birefnet-hashes", report.valid, report.detail()))
    except ModelIntegrityError as exc:
        statuses.append(DependencyStatus("birefnet-hashes", False, str(exc)))
    return tuple(statuses)
