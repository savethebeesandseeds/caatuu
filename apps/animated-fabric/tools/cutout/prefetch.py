"""Explicit network-enabled provisioning for pinned model snapshots."""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path

from tools.cutout.errors import MissingDependencyError
from tools.cutout.integrity import require_valid_model_snapshot

SnapshotDownload = Callable[..., str]
FULL_COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}")


def validate_model_revision(revision: str) -> str:
    """Require an immutable full commit before remote model code is downloaded."""
    normalized = revision.strip().lower()
    if FULL_COMMIT_PATTERN.fullmatch(normalized) is None:
        raise ValueError("Model revision must be a full 40-character hexadecimal commit.")
    return normalized


def _snapshot_download() -> SnapshotDownload:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise MissingDependencyError(
            "Model prefetch needs the ML image target with huggingface-hub installed."
        ) from exc
    return snapshot_download


def prefetch_model(
    *,
    model_name: str,
    model_revision: str,
    model_cache: Path,
    downloader: SnapshotDownload | None = None,
) -> Path:
    """Download one immutable model snapshot into the shared runtime cache."""
    revision = validate_model_revision(model_revision)
    model_cache.mkdir(parents=True, exist_ok=True)
    download = downloader or _snapshot_download()
    snapshot = download(
        repo_id=model_name,
        revision=revision,
        repo_type="model",
        cache_dir=str(model_cache),
        local_files_only=False,
    )
    snapshot_path = Path(snapshot)
    require_valid_model_snapshot(
        snapshot_path,
        model_name=model_name,
        model_revision=revision,
    )
    return snapshot_path
