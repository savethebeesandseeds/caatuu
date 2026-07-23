"""Explicit network-enabled provisioning for pinned reconstruction models."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from tools.reconstruction.integrity import (
    ModelSpec,
    load_model_specs,
    require_valid_snapshot,
)

SnapshotDownload = Callable[..., str]


def _snapshot_download() -> SnapshotDownload:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise RuntimeError(
            "Model prefetch requires the reconstruction image with huggingface-hub."
        ) from exc
    return snapshot_download


def prefetch_model(
    spec: ModelSpec,
    *,
    cache_dir: Path,
    downloader: SnapshotDownload | None = None,
) -> Path:
    """Download only expected files from one immutable model snapshot."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    download = downloader or _snapshot_download()
    snapshot = Path(
        download(
            repo_id=spec.model_id,
            revision=spec.revision,
            repo_type="model",
            allow_patterns=[expected.path for expected in spec.files],
            cache_dir=str(cache_dir),
            local_files_only=False,
        )
    )
    expected_snapshot = require_valid_snapshot(cache_dir, spec)
    if snapshot.resolve() != expected_snapshot.resolve():
        raise RuntimeError(f"Unexpected snapshot path returned for {spec.model_id}.")
    return expected_snapshot


def prefetch_all_models(
    cache_dir: Path,
    *,
    downloader: SnapshotDownload | None = None,
) -> tuple[Path, ...]:
    """Provision and verify every model used by offline reconstruction."""
    return tuple(
        prefetch_model(spec, cache_dir=cache_dir, downloader=downloader)
        for spec in load_model_specs()
    )
