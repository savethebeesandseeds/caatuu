"""Safe preprocessing and immutable candidate publication."""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image

from tools.reconstruction import (
    DINO_MODEL_ID,
    DINO_MODEL_REVISION,
    PYMCUBES_VERSION,
    PYMCUBES_WHEEL_SHA256,
    TRIPOSR_MODEL_ID,
    TRIPOSR_MODEL_REVISION,
    TRIPOSR_SOURCE_REVISION,
)
from tools.reconstruction.errors import (
    CandidateExistsError,
    ReconstructionError,
    UnsafePathError,
)
from tools.reconstruction.integrity import require_all_models, sha256_file

if TYPE_CHECKING:
    from collections.abc import Mapping

CANDIDATE_ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
MAX_INPUT_BYTES = 50 * 1024 * 1024
MAX_INPUT_DIMENSION = 4096


@dataclass(frozen=True, slots=True)
class SourceIdentity:
    """Stable source facts captured before expensive inference begins."""

    relative_path: str
    bytes: int
    sha256: str


def canonical_json_bytes(payload: Mapping[str, Any]) -> bytes:
    """Encode canonical, human-readable JSON for evidence files."""
    return (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _contained_regular_file(path: Path, root: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise UnsafePathError(f"Input must be one regular file: {path}")
    resolved_root = root.resolve(strict=True)
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise UnsafePathError(f"Input escapes the read-only root: {path}") from exc
    return resolved


def _safe_output_root(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise UnsafePathError(f"Output root must be one real directory: {path}")
    return path.resolve(strict=True)


def _capture_source_identity(source: Path, input_root: Path) -> SourceIdentity:
    size = source.stat().st_size
    if size > MAX_INPUT_BYTES:
        raise ReconstructionError("Input image exceeds the 50 MiB research limit.")
    digest = sha256_file(source)
    if source.stat().st_size != size:
        raise ReconstructionError("Input changed while its identity was captured.")
    relative_path = source.relative_to(input_root.resolve(strict=True)).as_posix()
    return SourceIdentity(relative_path=relative_path, bytes=size, sha256=digest)


def _require_source_unchanged(source: Path, identity: SourceIdentity) -> None:
    if source.stat().st_size != identity.bytes or sha256_file(source) != identity.sha256:
        raise ReconstructionError("Input changed while the reconstruction candidate was running.")


def validate_candidate_id(candidate_id: str) -> str:
    """Require a portable single-component candidate identifier."""
    if CANDIDATE_ID_PATTERN.fullmatch(candidate_id) is None:
        raise UnsafePathError(
            "Candidate ID must contain 1-64 lowercase letters, digits, hyphens, or underscores."
        )
    return candidate_id


def normalize_cutout(
    source: Path,
    destination: Path,
    *,
    canvas_size: int = 512,
    foreground_ratio: float = 0.85,
) -> dict[str, int | float]:
    """Center an RGBA cutout on the gray square expected by TripoSR."""
    if not 64 <= canvas_size <= 1024:
        raise ReconstructionError("Canvas size must be between 64 and 1024.")
    if not 0.5 <= foreground_ratio <= 0.95:
        raise ReconstructionError("Foreground ratio must be between 0.5 and 0.95.")
    if source.stat().st_size > MAX_INPUT_BYTES:
        raise ReconstructionError("Input image exceeds the 50 MiB research limit.")

    with Image.open(source) as opened:
        if opened.width > MAX_INPUT_DIMENSION or opened.height > MAX_INPUT_DIMENSION:
            raise ReconstructionError("Input image exceeds the 4096 px research limit.")
        opened.load()
        rgba = opened.convert("RGBA")

    alpha = rgba.getchannel("A")
    alpha_bounds = alpha.getbbox()
    if alpha_bounds is None:
        raise ReconstructionError("Input cutout has no visible foreground.")
    if alpha.getextrema() == (255, 255):
        raise ReconstructionError(
            "Input is fully opaque; run the self-contained cutout stage before reconstruction."
        )

    foreground = rgba.crop(alpha_bounds)
    target_extent = max(1, round(canvas_size * foreground_ratio))
    scale = min(target_extent / foreground.width, target_extent / foreground.height)
    resized_width = max(1, round(foreground.width * scale))
    resized_height = max(1, round(foreground.height * scale))
    foreground = foreground.resize(
        (resized_width, resized_height),
        resample=Image.Resampling.LANCZOS,
    )

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (128, 128, 128, 255))
    offset_x = (canvas_size - resized_width) // 2
    offset_y = (canvas_size - resized_height) // 2
    canvas.alpha_composite(foreground, (offset_x, offset_y))
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(destination, format="PNG", compress_level=9)
    return {
        "canvas_size": canvas_size,
        "foreground_ratio": foreground_ratio,
        "source_width": rgba.width,
        "source_height": rgba.height,
        "alpha_left": alpha_bounds[0],
        "alpha_top": alpha_bounds[1],
        "alpha_right": alpha_bounds[2],
        "alpha_bottom": alpha_bounds[3],
        "normalized_width": resized_width,
        "normalized_height": resized_height,
        "offset_x": offset_x,
        "offset_y": offset_y,
    }


def _write_bytes_atomic(path: Path, payload: bytes) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


@contextmanager
def _translate_cuda_oom(torch_module: Any) -> Iterator[None]:
    """Turn CUDA exhaustion into the typed, actionable lab failure contract."""
    try:
        yield
    except torch_module.cuda.OutOfMemoryError as exc:
        torch_module.cuda.empty_cache()
        raise ReconstructionError(
            "CUDA ran out of memory. Retry in a fresh container with a new "
            "candidate ID and a smaller allowed --chunk-size."
        ) from exc


def run_triposr(
    *,
    input_path: Path,
    input_root: Path,
    output_root: Path,
    candidate_id: str,
    model_cache: Path,
    chunk_size: int = 4096,
    mc_resolution: int = 256,
    foreground_ratio: float = 0.85,
) -> Path:
    """Create one immutable, provenance-bound TripoSR candidate."""
    candidate_id = validate_candidate_id(candidate_id)
    if chunk_size not in {1024, 2048, 4096, 8192}:
        raise ReconstructionError("Chunk size must be 1024, 2048, 4096, or 8192.")
    if mc_resolution not in {128, 192, 256}:
        raise ReconstructionError("Marching-cubes resolution must be 128, 192, or 256.")

    source = _contained_regular_file(input_path, input_root)
    source_identity = _capture_source_identity(source, input_root)
    destination_root = _safe_output_root(output_root)
    destination = destination_root / candidate_id
    if destination.exists() or destination.is_symlink():
        raise CandidateExistsError(f"Candidate already exists: {candidate_id}")

    snapshots = require_all_models(model_cache)
    triposr_snapshot = snapshots[TRIPOSR_MODEL_ID]

    stage = Path(tempfile.mkdtemp(dir=destination_root, prefix=f".{candidate_id}."))
    normalized = stage / "input.png"
    mesh_path = stage / "mesh.glb"
    started = time.perf_counter()
    try:
        preprocessing = normalize_cutout(
            source,
            normalized,
            foreground_ratio=foreground_ratio,
        )

        try:
            import torch
            from tsr.system import TSR
        except ImportError as exc:
            raise ReconstructionError(
                "TripoSR inference requires the reconstruction CUDA image."
            ) from exc
        if not torch.cuda.is_available():
            raise ReconstructionError("CUDA is unavailable inside the reconstruction container.")

        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
        with _translate_cuda_oom(torch):
            model = TSR.from_pretrained(
                str(triposr_snapshot),
                config_name="config.yaml",
                weight_name="model.ckpt",
            )
            model.renderer.set_chunk_size(chunk_size)
            model.to("cuda:0")
            with Image.open(normalized) as opened:
                image = opened.convert("RGB")
            with torch.inference_mode():
                scene_codes = model([image], device="cuda:0")
                meshes = model.extract_mesh(
                    scene_codes,
                    True,
                    resolution=mc_resolution,
                )
        if len(meshes) != 1:
            raise ReconstructionError("TripoSR returned an unexpected mesh count.")
        mesh = meshes[0]
        if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
            raise ReconstructionError("TripoSR returned an empty mesh.")
        mesh.export(mesh_path, file_type="glb")
        if not mesh_path.is_file() or mesh_path.stat().st_size <= 0:
            raise ReconstructionError("TripoSR did not publish a GLB candidate.")

        _require_source_unchanged(source, source_identity)
        elapsed_seconds = round(time.perf_counter() - started, 3)
        manifest: dict[str, Any] = {
            "schema_version": "1.0.0",
            "format": "animated-fabric.reconstruction-candidate.v1",
            "candidate_id": candidate_id,
            "status": "proposal",
            "source": {
                "path": source_identity.relative_path,
                "bytes": source_identity.bytes,
                "sha256": source_identity.sha256,
            },
            "preprocessing": {
                **preprocessing,
                "output": "input.png",
                "output_bytes": normalized.stat().st_size,
                "output_sha256": sha256_file(normalized),
            },
            "provider": {
                "id": "triposr",
                "source_revision": TRIPOSR_SOURCE_REVISION,
                "model_id": TRIPOSR_MODEL_ID,
                "model_revision": TRIPOSR_MODEL_REVISION,
                "dino_model_id": DINO_MODEL_ID,
                "dino_model_revision": DINO_MODEL_REVISION,
                "pymcubes_version": PYMCUBES_VERSION,
                "pymcubes_wheel_sha256": PYMCUBES_WHEEL_SHA256,
            },
            "parameters": {
                "chunk_size": chunk_size,
                "device": "cuda:0",
                "foreground_ratio": foreground_ratio,
                "mc_resolution": mc_resolution,
                "vertex_colors": True,
            },
            "mesh": {
                "path": "mesh.glb",
                "media_type": "model/gltf-binary",
                "bytes": mesh_path.stat().st_size,
                "sha256": sha256_file(mesh_path),
                "vertices": int(len(mesh.vertices)),
                "triangles": int(len(mesh.faces)),
            },
            "runtime": {
                "cuda_version": str(torch.version.cuda),
                "elapsed_seconds": elapsed_seconds,
                "gpu_name": torch.cuda.get_device_name(0),
                "peak_cuda_bytes": int(torch.cuda.max_memory_allocated()),
                "torch_version": str(torch.__version__),
            },
            "review": {
                "decision": "pending",
                "notes": "Generated geometry is a proposal, not recovered hidden truth.",
            },
        }
        _write_bytes_atomic(stage / "candidate.json", canonical_json_bytes(manifest))
        os.replace(stage, destination)
        return destination
    except Exception:
        for child in sorted(stage.glob("*"), reverse=True):
            if child.is_file() or child.is_symlink():
                child.unlink(missing_ok=True)
        stage.rmdir()
        raise
