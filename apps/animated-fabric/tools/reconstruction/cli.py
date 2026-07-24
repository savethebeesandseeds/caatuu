"""CLI for the isolated local reconstruction research plane."""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import sys
from pathlib import Path

from tools.reconstruction import __version__, configured_model_cache
from tools.reconstruction.errors import ReconstructionError
from tools.reconstruction.integrity import (
    load_model_specs,
    model_snapshot_path,
    verify_snapshot,
)
from tools.reconstruction.prefetch import prefetch_all_models


def build_parser() -> argparse.ArgumentParser:
    """Build the complete command tree without importing CUDA libraries."""
    parser = argparse.ArgumentParser(
        prog="animated-fabric-reconstruction",
        description="Offline local image-to-3D feasibility tooling.",
    )
    parser.add_argument("--version", action="version", version=f"reconstruction {__version__}")
    subcommands = parser.add_subparsers(dest="command", required=True)

    doctor = subcommands.add_parser("doctor", help="check dependencies, CUDA, and model cache")
    doctor.add_argument("--model-cache", type=Path)

    prefetch = subcommands.add_parser(
        "prefetch",
        help="download and verify the exact model snapshots",
    )
    prefetch.add_argument("--model-cache", type=Path)

    reconstruct = subcommands.add_parser(
        "reconstruct",
        help="create one immutable GLB proposal from a prepared RGBA cutout",
    )
    reconstruct.add_argument("input", type=Path)
    reconstruct.add_argument("--candidate-id", required=True)
    reconstruct.add_argument("--model-cache", type=Path)
    reconstruct.add_argument("--chunk-size", type=int, default=4096)
    reconstruct.add_argument("--mc-resolution", type=int, default=256)
    reconstruct.add_argument("--foreground-ratio", type=float, default=0.85)
    return parser


def _dependency_status() -> tuple[tuple[str, bool], ...]:
    return tuple(
        (name, importlib.util.find_spec(module) is not None)
        for name, module in (
            ("Pillow", "PIL"),
            ("PyTorch", "torch"),
            ("PyMCubes", "mcubes"),
            ("Transformers", "transformers"),
            ("Trimesh", "trimesh"),
        )
    )


def _triposr_runtime_status() -> tuple[bool, str]:
    """Import the exact inference entry point without loading model weights."""
    try:
        module = importlib.import_module("tsr.system")
        if not hasattr(module, "TSR"):
            raise ImportError("tsr.system does not expose TSR")
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
    return True, "imported tsr.system.TSR"


def cmd_doctor(args: argparse.Namespace) -> int:
    """Report offline runtime readiness and return nonzero when incomplete."""
    healthy = True
    for name, available in _dependency_status():
        print(f"{'ok' if available else 'missing':8} dependency {name}")
        healthy = healthy and available

    triposr_available, triposr_detail = _triposr_runtime_status()
    print(f"{'ok' if triposr_available else 'missing':8} dependency TripoSR ({triposr_detail})")
    healthy = healthy and triposr_available

    try:
        import torch
    except ImportError:
        print("missing  cuda       PyTorch is unavailable")
        healthy = False
    else:
        cuda_available = torch.cuda.is_available()
        detail = torch.cuda.get_device_name(0) if cuda_available else "no CUDA device"
        print(f"{'ok' if cuda_available else 'missing':8} cuda       {detail}")
        healthy = healthy and cuda_available

    cache_dir = configured_model_cache(args.model_cache)
    for spec in load_model_specs():
        report = verify_snapshot(model_snapshot_path(cache_dir, spec), spec)
        print(
            f"{'ok' if report.valid else 'missing':8} model      "
            f"{spec.model_id}@{spec.revision}: {report.detail()}"
        )
        healthy = healthy and report.valid
    return 0 if healthy else 2


def cmd_prefetch(args: argparse.Namespace) -> int:
    """Provision the only two immutable snapshots used at runtime."""
    cache_dir = configured_model_cache(args.model_cache)
    for snapshot in prefetch_all_models(cache_dir):
        print(f"Prefetched and verified: {snapshot}")
    return 0


def cmd_reconstruct(args: argparse.Namespace) -> int:
    """Run one offline TripoSR proposal."""
    from tools.reconstruction.candidate import run_triposr

    destination = run_triposr(
        input_path=args.input,
        input_root=Path("/input"),
        output_root=Path("/output"),
        candidate_id=args.candidate_id,
        model_cache=configured_model_cache(args.model_cache),
        chunk_size=args.chunk_size,
        mc_resolution=args.mc_resolution,
        foreground_ratio=args.foreground_ratio,
    )
    print(f"Candidate: {destination}")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Translate expected lab failures into a concise exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "doctor":
            return cmd_doctor(args)
        if args.command == "prefetch":
            return cmd_prefetch(args)
        if args.command == "reconstruct":
            return cmd_reconstruct(args)
    except (ReconstructionError, OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    parser.error(f"Unknown command: {args.command}")
    return 2
