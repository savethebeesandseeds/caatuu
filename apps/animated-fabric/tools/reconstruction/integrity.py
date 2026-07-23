"""Integrity verification for pinned reconstruction model snapshots."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from tools.reconstruction.errors import ModelIntegrityError

MANIFEST_PATH = Path(__file__).with_name("model-manifest.json")


@dataclass(frozen=True, slots=True)
class ExpectedFile:
    """One immutable file expected in a model snapshot."""

    path: str
    bytes: int
    sha256: str


@dataclass(frozen=True, slots=True)
class ModelSpec:
    """One immutable Hugging Face model identity."""

    model_id: str
    revision: str
    files: tuple[ExpectedFile, ...]


@dataclass(frozen=True, slots=True)
class SnapshotReport:
    """Result of checking one snapshot against its committed identity."""

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
            return f"size or SHA-256 mismatch: {', '.join(self.mismatched)}"
        return f"verified {len(self.verified)} files"


def sha256_file(path: Path) -> str:
    """Hash a file without loading model-sized data into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_hex_digest(value: object, *, label: str) -> str:
    if not isinstance(value, str):
        raise ModelIntegrityError(f"{label} must be a lowercase SHA-256 string.")
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ModelIntegrityError(f"{label} must be a lowercase SHA-256 string.")
    return value


def load_model_specs(manifest_path: Path = MANIFEST_PATH) -> tuple[ModelSpec, ...]:
    """Load and strictly validate the committed model manifest."""
    payload: object = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schema_version") != "1.0.0":
        raise ModelIntegrityError("Unsupported reconstruction model manifest.")
    raw_models = payload.get("models")
    if not isinstance(raw_models, list) or not raw_models:
        raise ModelIntegrityError("Reconstruction model manifest has no models.")

    specs: list[ModelSpec] = []
    seen: set[tuple[str, str]] = set()
    for raw_model in raw_models:
        if not isinstance(raw_model, dict):
            raise ModelIntegrityError("Model manifest entries must be objects.")
        model_id = raw_model.get("model_id")
        revision = raw_model.get("revision")
        raw_files = raw_model.get("files")
        if not isinstance(model_id, str) or model_id.count("/") != 1:
            raise ModelIntegrityError("Model IDs must use owner/name form.")
        if (
            not isinstance(revision, str)
            or len(revision) != 40
            or any(character not in "0123456789abcdef" for character in revision)
        ):
            raise ModelIntegrityError(f"Model revision for {model_id} is not immutable.")
        identity = (model_id, revision)
        if identity in seen:
            raise ModelIntegrityError(f"Duplicate model identity: {model_id}@{revision}")
        seen.add(identity)
        if not isinstance(raw_files, dict) or not raw_files:
            raise ModelIntegrityError(f"Model {model_id} has no runtime files.")

        files: list[ExpectedFile] = []
        for raw_path, raw_identity in sorted(raw_files.items()):
            if not isinstance(raw_path, str) or not isinstance(raw_identity, dict):
                raise ModelIntegrityError(f"Invalid file record for {model_id}.")
            relative = Path(raw_path)
            if relative.is_absolute() or ".." in relative.parts or len(relative.parts) != 1:
                raise ModelIntegrityError(f"Unsafe model file path: {raw_path}")
            byte_count = raw_identity.get("bytes")
            if not isinstance(byte_count, int) or isinstance(byte_count, bool) or byte_count <= 0:
                raise ModelIntegrityError(f"Invalid byte count for {model_id}/{raw_path}.")
            digest = _require_hex_digest(
                raw_identity.get("sha256"),
                label=f"{model_id}/{raw_path}",
            )
            files.append(ExpectedFile(path=raw_path, bytes=byte_count, sha256=digest))
        specs.append(ModelSpec(model_id=model_id, revision=revision, files=tuple(files)))
    return tuple(specs)


def model_snapshot_path(cache_dir: Path, spec: ModelSpec) -> Path:
    """Return the standard Hugging Face snapshot path for a pinned model."""
    repository_directory = f"models--{spec.model_id.replace('/', '--')}"
    return cache_dir / repository_directory / "snapshots" / spec.revision


def verify_snapshot(snapshot: Path, spec: ModelSpec) -> SnapshotReport:
    """Verify all runtime files for one exact model snapshot."""
    missing: list[str] = []
    mismatched: list[str] = []
    verified: list[str] = []
    for expected in spec.files:
        candidate = snapshot / expected.path
        if not candidate.is_file():
            missing.append(expected.path)
            continue
        if candidate.stat().st_size != expected.bytes or sha256_file(candidate) != expected.sha256:
            mismatched.append(expected.path)
            continue
        verified.append(expected.path)
    return SnapshotReport(
        snapshot=snapshot,
        missing=tuple(missing),
        mismatched=tuple(mismatched),
        verified=tuple(verified),
    )


def require_valid_snapshot(cache_dir: Path, spec: ModelSpec) -> Path:
    """Return the pinned snapshot path or reject missing/tampered model data."""
    snapshot = model_snapshot_path(cache_dir, spec)
    report = verify_snapshot(snapshot, spec)
    if not report.valid:
        raise ModelIntegrityError(
            f"Pinned model integrity failed for {spec.model_id}@{spec.revision}: {report.detail()}"
        )
    return snapshot


def require_all_models(cache_dir: Path) -> dict[str, Path]:
    """Verify every committed model identity and return paths by model ID."""
    return {spec.model_id: require_valid_snapshot(cache_dir, spec) for spec in load_model_specs()}
