"""Provider selection for the optional cutout tool."""

from __future__ import annotations

from pathlib import Path

from tools.cutout.errors import MissingDependencyError
from tools.cutout.postprocess import cleanup_alpha
from tools.cutout.types import CutoutOptions, CutoutResult


def _clean(result: CutoutResult, options: CutoutOptions) -> CutoutResult:
    return cleanup_alpha(
        result,
        floor=options.alpha_floor,
        ceiling=options.alpha_ceiling,
    )


def run_cutout(input_path: Path, options: CutoutOptions) -> CutoutResult:
    """Run the requested provider, with an explicit auto fallback to classic."""
    engine = options.engine.lower()
    if engine == "classic":
        from tools.cutout.providers import classic

        return _clean(classic.run(input_path, options), options)
    if engine == "birefnet":
        from tools.cutout.providers import birefnet

        return _clean(birefnet.run(input_path, options), options)
    if engine != "auto":
        raise ValueError(f"Unknown cutout engine: {options.engine}")

    try:
        from tools.cutout.providers import birefnet

        return _clean(birefnet.run(input_path, options), options)
    except MissingDependencyError as exc:
        from tools.cutout.providers import classic

        result = classic.run(input_path, options)
        result.diagnostics["auto_fallback"] = "birefnet"
        result.diagnostics["auto_fallback_reason"] = str(exc)
        return _clean(result, options)
