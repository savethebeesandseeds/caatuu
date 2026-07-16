"""Integrity verification for the committed BiRefNet runtime manifest."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from tools.cutout import DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION
from tools.cutout.errors import ModelIntegrityError

MANIFEST_PATH = Path(__file__).with_name("model-manifest.json")


@dataclass(frozen=True, slots=True)
class ModelIntegrityReport:
    """Result of checking every expected runtime file in one model snapshot."""

    snapshot: Path
    missing: tuple[str, ...]
    mismatched: tuple[str, ...]
    verified: tuple[str, ...]

    @property
    def valid(self) -> bool:
        return not self.missing and not self.mismatched

    def detail(self) -> str:
        if self.missing:
            return f"missing: {', '.join(self.missing)}"
        if self.mismatched:
            return f"SHA-256 mismatch: {', '.join(self.mismatched)}"
        return f"verified {len(self.verified)} files in {self.snapshot}"


def _manifest() -> tuple[str, str, dict[str, str]]:
    payload: object = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ModelIntegrityError("Cutout model manifest must be a JSON object.")
    model_id = payload.get("model_id")
    revision = payload.get("revision")
    raw_files = payload.get("files")
    if not isinstance(model_id, str) or not isinstance(revision, str):
        raise ModelIntegrityError("Cutout model manifest identity is invalid.")
    if not isinstance(raw_files, dict) or not raw_files:
        raise ModelIntegrityError("Cutout model manifest has no file hashes.")

    files: dict[str, str] = {}
    for raw_path, raw_hash in raw_files.items():
        if not isinstance(raw_path, str) or not isinstance(raw_hash, str):
            raise ModelIntegrityError("Cutout model manifest file entries must be strings.")
        path = Path(raw_path)
        if path.is_absolute() or ".." in path.parts or len(path.parts) != 1:
            raise ModelIntegrityError(f"Unsafe model manifest path: {raw_path}")
        if len(raw_hash) != 64 or any(
            character not in "0123456789abcdef" for character in raw_hash
        ):
            raise ModelIntegrityError(f"Invalid SHA-256 for model file: {raw_path}")
        files[raw_path] = raw_hash
    return model_id, revision, files


def model_snapshot_path(model_name: str, revision: str, cache_dir: Path) -> Path:
    """Return the standard Hugging Face snapshot path for a model revision."""
    repository_directory = f"models--{model_name.replace('/', '--')}"
    return cache_dir / repository_directory / "snapshots" / revision


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_snapshot(
    snapshot: Path,
    *,
    model_name: str = DEFAULT_MODEL_ID,
    model_revision: str = DEFAULT_MODEL_REVISION,
) -> ModelIntegrityReport:
    """Verify an exact snapshot against the committed runtime-file manifest."""
    expected_model, expected_revision, expected_files = _manifest()
    if model_name != expected_model or model_revision != expected_revision:
        raise ModelIntegrityError(
            f"No committed integrity manifest for {model_name}@{model_revision}."
        )

    missing: list[str] = []
    mismatched: list[str] = []
    verified: list[str] = []
    for relative_path, expected_hash in sorted(expected_files.items()):
        candidate = snapshot / relative_path
        if not candidate.is_file():
            missing.append(relative_path)
        elif _sha256(candidate) != expected_hash:
            mismatched.append(relative_path)
        else:
            verified.append(relative_path)
    return ModelIntegrityReport(
        snapshot=snapshot,
        missing=tuple(missing),
        mismatched=tuple(mismatched),
        verified=tuple(verified),
    )


def require_valid_model_snapshot(
    snapshot: Path,
    *,
    model_name: str = DEFAULT_MODEL_ID,
    model_revision: str = DEFAULT_MODEL_REVISION,
) -> ModelIntegrityReport:
    """Return a valid report or reject missing/tampered model files."""
    report = verify_model_snapshot(
        snapshot,
        model_name=model_name,
        model_revision=model_revision,
    )
    if not report.valid:
        raise ModelIntegrityError(f"Pinned model integrity check failed: {report.detail()}")
    return report
