"""Path boundary shared by the fixed Blender worker and its normal test suite."""

from __future__ import annotations

from pathlib import Path


def resolve_output_path(raw_output: Path, output_root: Path) -> tuple[Path, Path]:
    """Resolve one non-symlink output below an existing approved root."""
    try:
        resolved_root = output_root.resolve(strict=True)
    except OSError as error:
        raise ValueError("The approved Blender output root does not exist.") from error
    if not resolved_root.is_dir():
        raise ValueError("The approved Blender output root must be a directory.")

    candidate = raw_output if raw_output.is_absolute() else resolved_root / raw_output
    if candidate.is_symlink():
        raise ValueError("Output must not be a symbolic link.")
    try:
        resolved_parent = candidate.parent.resolve(strict=True)
        resolved_parent.relative_to(resolved_root)
        destination = (resolved_parent / candidate.name).resolve(strict=False)
        destination.relative_to(resolved_root)
    except (OSError, ValueError) as error:
        raise ValueError(
            "Output must be a direct or nested child of the approved output root."
        ) from error
    if destination == resolved_root:
        raise ValueError("Output must be a child directory, not the output mount itself.")
    return resolved_root, destination
