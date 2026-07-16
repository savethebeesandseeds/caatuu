"""CLI for self-contained classic and BiRefNet background cutout."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from tools.cutout import DEFAULT_MODEL_ID, DEFAULT_MODEL_REVISION, __version__
from tools.cutout.dependencies import collect_status
from tools.cutout.errors import CutoutError, UnsafePathError
from tools.cutout.image_io import default_output_path
from tools.cutout.pipeline import run_cutout
from tools.cutout.postprocess import save_previews
from tools.cutout.prefetch import prefetch_model
from tools.cutout.providers import MODEL_INFOS
from tools.cutout.types import CutoutOptions, JsonValue, configured_model_cache


def add_engine_options(parser: argparse.ArgumentParser) -> None:
    """Add options shared by single-image and batch inference."""
    parser.add_argument(
        "--engine",
        choices=("auto", "classic", "birefnet"),
        default="auto",
        help="auto tries cached BiRefNet and falls back to classic when unavailable",
    )
    parser.add_argument(
        "--preset",
        choices=("fast", "balanced", "pro"),
        default="balanced",
        help="quality/runtime preset",
    )
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "cuda"),
        default="auto",
        help="device for the optional ML provider",
    )
    parser.add_argument("--model-name", default=DEFAULT_MODEL_ID)
    parser.add_argument("--model-revision", default=DEFAULT_MODEL_REVISION)
    parser.add_argument("--model-cache", type=Path)
    parser.add_argument("--input-size", type=int, default=1024)
    parser.add_argument("--tolerance", type=float, default=None)
    parser.add_argument("--edge-softness", type=float, default=None)
    parser.add_argument("--bg-palette-size", type=int, default=4)
    parser.add_argument("--alpha-floor", type=int, default=24)
    parser.add_argument("--alpha-ceiling", type=int, default=250)
    parser.add_argument("--no-decontaminate", action="store_true")


def add_model_location_options(parser: argparse.ArgumentParser) -> None:
    """Add immutable model and shared-cache options."""
    parser.add_argument("--model-name", default=DEFAULT_MODEL_ID)
    parser.add_argument("--model-revision", default=DEFAULT_MODEL_REVISION)
    parser.add_argument("--model-cache", type=Path)


def build_parser() -> argparse.ArgumentParser:
    """Build the complete command tree without importing optional ML modules."""
    parser = argparse.ArgumentParser(
        prog="animated-fabric-cutout",
        description="Optional offline background removal and transparent PNG export.",
    )
    parser.add_argument("--version", action="version", version=f"cutout {__version__}")
    subcommands = parser.add_subparsers(dest="command", required=True)

    image = subcommands.add_parser("image", help="remove the background from one image")
    image.add_argument("input", type=Path)
    image.add_argument("output", type=Path, nargs="?")
    image.add_argument("--alpha-output", type=Path)
    image.add_argument("--mask-output", type=Path)
    image.add_argument("--diagnostics", type=Path)
    image.add_argument("--preview-dir", type=Path)
    add_engine_options(image)

    batch = subcommands.add_parser("batch", help="remove backgrounds from a directory")
    batch.add_argument("input_dir", type=Path)
    batch.add_argument("output_dir", type=Path)
    batch.add_argument("--glob", default="*.png")
    batch.add_argument("--recursive", action="store_true")
    batch.add_argument("--diagnostics", type=Path)
    batch.add_argument("--clean-output", action="store_true")
    batch.add_argument("--save-extras", action="store_true")
    add_engine_options(batch)

    subcommands.add_parser("models", help="list implemented providers and license notices")

    doctor = subcommands.add_parser("doctor", help="check dependencies and the pinned cache")
    add_model_location_options(doctor)

    prefetch = subcommands.add_parser(
        "prefetch",
        help="explicitly download one pinned model snapshot for offline runtime",
    )
    add_model_location_options(prefetch)
    return parser


def options_from_args(args: argparse.Namespace) -> CutoutOptions:
    """Normalize CLI values into provider-neutral options."""
    if not 64 <= args.input_size <= 4096:
        raise ValueError("Input size must be between 64 and 4096 pixels.")
    alpha_floor = max(0, min(255, args.alpha_floor))
    alpha_ceiling = max(0, min(255, args.alpha_ceiling))
    if alpha_floor >= alpha_ceiling:
        raise ValueError("Alpha floor must be lower than alpha ceiling.")
    return CutoutOptions(
        engine=args.engine,
        preset=args.preset,
        device=args.device,
        model_name=args.model_name,
        model_revision=args.model_revision,
        model_cache=configured_model_cache(args.model_cache),
        input_size=args.input_size,
        tolerance=args.tolerance,
        edge_softness=args.edge_softness,
        bg_palette_size=max(1, min(16, args.bg_palette_size)),
        alpha_floor=alpha_floor,
        alpha_ceiling=alpha_ceiling,
        decontaminate=not args.no_decontaminate,
    )


def write_json(path: Path, payload: JsonValue) -> None:
    """Atomically write deterministic UTF-8 JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _validate_png_output(path: Path) -> None:
    if path.suffix.lower() != ".png":
        raise CutoutError(f"Transparent cutout output must use a .png extension: {path}")


def _validate_image_destinations(
    input_path: Path,
    *,
    output: Path,
    alpha_output: Path | None,
    mask_output: Path | None,
    diagnostics: Path | None,
    preview_dir: Path | None,
) -> None:
    """Protect the source and reject destinations that alias one another."""
    _validate_png_output(output)
    if alpha_output is not None:
        _validate_png_output(alpha_output)
    if mask_output is not None:
        _validate_png_output(mask_output)

    source = input_path.resolve()
    destinations = {
        "output": output,
        "alpha output": alpha_output,
        "mask output": mask_output,
        "diagnostics": diagnostics,
        "preview directory": preview_dir,
    }
    resolved_destinations: dict[Path, str] = {}
    for label, destination in destinations.items():
        if destination is None:
            continue
        resolved = destination.resolve()
        if resolved == source:
            raise UnsafePathError(f"Refusing to replace the immutable input via {label}.")
        previous = resolved_destinations.get(resolved)
        if previous is not None:
            raise UnsafePathError(f"Destinations {previous} and {label} resolve to the same path.")
        resolved_destinations[resolved] = label


def _validate_batch_roots(output_dir: Path, input_dir: Path) -> tuple[Path, Path]:
    resolved_output = output_dir.resolve()
    resolved_input = input_dir.resolve()
    forbidden = {Path("/").resolve(), Path.cwd().resolve(), Path.home().resolve()}
    if resolved_output in forbidden:
        raise UnsafePathError(f"Refusing unsafe output directory: {output_dir}")
    if resolved_output == resolved_input:
        raise UnsafePathError("Input and output directories must be different.")
    if resolved_output.is_relative_to(resolved_input):
        raise UnsafePathError("Output directory must not be inside the input directory.")
    if resolved_input.is_relative_to(resolved_output):
        raise UnsafePathError("Output directory must not contain the input directory.")
    return resolved_output, resolved_input


def clean_output_dir(output_dir: Path, input_dir: Path) -> None:
    """Delete only a validated, independent, non-symlink batch output directory."""
    _validate_batch_roots(output_dir, input_dir)
    if output_dir.exists() and output_dir.is_symlink():
        raise UnsafePathError(f"Refusing to clean symlink output directory: {output_dir}")
    if output_dir.exists() and not output_dir.is_dir():
        raise CutoutError(f"Output path exists and is not a directory: {output_dir}")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)


def _batch_inputs(input_dir: Path, pattern: str, recursive: bool) -> list[Path]:
    resolved_input = input_dir.resolve()
    search_pattern = f"**/{pattern}" if recursive else pattern
    inputs: list[Path] = []
    for path in sorted(input_dir.glob(search_pattern)):
        if not path.is_file():
            continue
        try:
            path.resolve().relative_to(resolved_input)
        except ValueError as exc:
            raise UnsafePathError(f"Input link escapes the batch root: {path}") from exc
        inputs.append(path)
    if not inputs:
        raise CutoutError(f"No images matched {search_pattern} under {input_dir}")
    return inputs


def cmd_image(args: argparse.Namespace) -> int:
    """Run one cutout and optional sidecar export."""
    input_path = args.input
    if not input_path.is_file():
        raise CutoutError(f"Input file not found: {input_path}")

    output = args.output or default_output_path(input_path, "_cutout", "png")
    _validate_image_destinations(
        input_path,
        output=output,
        alpha_output=args.alpha_output,
        mask_output=args.mask_output,
        diagnostics=args.diagnostics,
        preview_dir=args.preview_dir,
    )
    result = run_cutout(input_path, options_from_args(args))
    result.save(output, alpha_output=args.alpha_output, mask_output=args.mask_output)
    if args.preview_dir is not None:
        save_previews(result.rgba, args.preview_dir)
    if args.diagnostics is not None:
        write_json(args.diagnostics, result.diagnostics)

    print(f"Output:      {output}")
    print(f"Engine:      {result.diagnostics.get('engine', 'unknown')}")
    if "auto_fallback_reason" in result.diagnostics:
        print(f"Fallback:    {result.diagnostics['auto_fallback_reason']}", file=sys.stderr)
    return 0


def cmd_batch(args: argparse.Namespace) -> int:
    """Run a stable, path-bounded batch in lexical input order."""
    if not args.input_dir.is_dir():
        raise CutoutError(f"Input directory not found: {args.input_dir}")
    _validate_batch_roots(args.output_dir, args.input_dir)
    if args.clean_output:
        clean_output_dir(args.output_dir, args.input_dir)
    else:
        args.output_dir.mkdir(parents=True, exist_ok=True)

    inputs = _batch_inputs(args.input_dir, args.glob, args.recursive)
    options = options_from_args(args)
    report: list[JsonValue] = []
    for input_path in inputs:
        relative = input_path.relative_to(args.input_dir)
        output = args.output_dir / relative.with_suffix(".png")
        alpha_output = None
        mask_output = None
        item_diagnostics = None
        preview_dir = None
        if args.save_extras:
            alpha_output = output.with_name(f"{output.stem}_alpha.png")
            mask_output = output.with_name(f"{output.stem}_mask.png")
            item_diagnostics = output.with_name(f"{output.stem}.json")
            preview_dir = output.with_name(f"{output.stem}_previews")

        result = run_cutout(input_path, options)
        result.save(output, alpha_output=alpha_output, mask_output=mask_output)
        if preview_dir is not None:
            save_previews(result.rgba, preview_dir)
        if item_diagnostics is not None:
            write_json(item_diagnostics, result.diagnostics)
        item: dict[str, JsonValue] = {
            "input": input_path.as_posix(),
            "output": output.as_posix(),
            **result.diagnostics,
        }
        report.append(item)
        print(f"{input_path} -> {output} [{item.get('engine', 'unknown')}]")

    if args.diagnostics is not None:
        write_json(args.diagnostics, report)
    return 0


def cmd_models() -> int:
    """Print only implemented provider and licensing information."""
    for model in MODEL_INFOS:
        print(model.key)
        print(f"  label:   {model.label}")
        print(f"  role:    {model.role}")
        print(f"  license: {model.license}")
        print(f"  notes:   {model.notes}")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """Print dependency and pinned-snapshot state without network access."""
    for status in collect_status(
        model_name=args.model_name,
        model_revision=args.model_revision,
        model_cache=args.model_cache,
    ):
        marker = "ok" if status.available else "missing"
        print(f"{marker:8} {status.name:18} {status.detail}")
    return 0


def cmd_prefetch(args: argparse.Namespace) -> int:
    """Provision an immutable snapshot; this is the only network-enabled command."""
    model_cache = configured_model_cache(args.model_cache)
    snapshot = prefetch_model(
        model_name=args.model_name,
        model_revision=args.model_revision,
        model_cache=model_cache,
    )
    print(f"Prefetched: {args.model_name}@{args.model_revision}")
    print(f"Snapshot:   {snapshot}")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Run the cutout CLI and translate boundary failures into exit code 2."""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "image":
            return cmd_image(args)
        if args.command == "batch":
            return cmd_batch(args)
        if args.command == "models":
            return cmd_models()
        if args.command == "doctor":
            return cmd_doctor(args)
        if args.command == "prefetch":
            return cmd_prefetch(args)
    except Exception as exc:  # CLI boundary: normalize optional provider/network errors.
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    parser.error(f"Unknown command: {args.command}")
    return 2
