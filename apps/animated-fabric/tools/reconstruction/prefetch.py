"""Explicit network-enabled provisioning for pinned reconstruction models."""

from __future__ import annotations

import inspect
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
    download_arguments: dict[str, object] = {
        "repo_id": spec.model_id,
        "revision": spec.revision,
        "repo_type": "model",
        "allow_patterns": [expected.path for expected in spec.files],
        "cache_dir": str(cache_dir),
        "local_files_only": False,
        "max_workers": 2,
    }
    signature = inspect.signature(download)
    if "etag_timeout" in signature.parameters or any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    ):
        download_arguments["etag_timeout"] = 30
    if "resume_download" in signature.parameters or any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    ):
        download_arguments["resume_download"] = True
    snapshot = Path(download(**download_arguments))
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
