"""Private shared directory-transaction support for export adapters."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from animated_fabric.domain.exceptions import ExportError, ExportFailureKind


def validate_export_destination(destination: Path, project_root: Path) -> Path:
    """Resolve one safe actor-scoped export destination without creating it."""
    try:
        absolute_destination = destination.absolute()
        _reject_symlink_components(absolute_destination)
        if absolute_destination.exists() and not absolute_destination.is_dir():
            raise ExportError(
                "The export destination is a file, not a directory.",
                kind=ExportFailureKind.DESTINATION,
                path=str(absolute_destination),
            )
        resolved_destination = absolute_destination.resolve(strict=False)
        resolved_project_root = project_root.resolve(strict=False)
        exports_root = (resolved_project_root / "exports").resolve(strict=False)
    except ExportError:
        raise
    except (OSError, RuntimeError) as error:
        raise ExportError(
            "The export destination cannot be resolved safely.",
            kind=ExportFailureKind.DESTINATION,
            path=str(destination),
        ) from error

    if resolved_project_root == resolved_destination or resolved_project_root.is_relative_to(
        resolved_destination
    ):
        raise ExportError(
            "The export destination cannot contain the project root.",
            kind=ExportFailureKind.DESTINATION,
            path=str(absolute_destination),
        )
    if resolved_destination.is_relative_to(resolved_project_root) and (
        resolved_destination == exports_root
        or not resolved_destination.is_relative_to(exports_root)
    ):
        raise ExportError(
            "Project-local exports must use a named directory below 'exports'.",
            kind=ExportFailureKind.DESTINATION,
            path=str(absolute_destination),
        )
    return resolved_destination


def _reject_symlink_components(destination: Path) -> None:
    current = Path(destination.anchor)
    for part in destination.parts[1:]:
        current /= part
        try:
            is_link = current.is_symlink()
        except OSError as error:
            raise ExportError(
                "The export destination cannot be inspected safely.",
                kind=ExportFailureKind.DESTINATION,
                path=str(destination),
            ) from error
        if is_link:
            raise ExportError(
                "The export destination and its existing ancestors must not be symlinks.",
                kind=ExportFailureKind.DESTINATION,
                path=str(destination),
            )


def create_export_staging(destination: Path) -> Path:
    """Create a unique sibling staging directory on the destination filesystem."""
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        name = tempfile.mkdtemp(
            prefix=f".{destination.name}.stage-",
            dir=destination.parent,
        )
    except OSError as error:
        raise ExportError(
            "The export destination is not writable.",
            kind=ExportFailureKind.DESTINATION,
            path=str(destination),
        ) from error
    return Path(name)


def relative_export_files(root: Path) -> set[str]:
    """Return regular staged files while rejecting symbolic links."""
    files: set[str] = set()
    try:
        candidates = tuple(root.rglob("*"))
    except OSError as error:
        raise ExportError(
            "The staged export cannot be inspected.",
            kind=ExportFailureKind.VERIFICATION,
        ) from error
    for candidate in candidates:
        try:
            if candidate.is_symlink():
                raise ExportError(
                    "The staged export must not contain symbolic links.",
                    kind=ExportFailureKind.VERIFICATION,
                )
            if candidate.is_file():
                files.add(candidate.relative_to(root).as_posix())
        except OSError as error:
            raise ExportError(
                "The staged export cannot be inspected.",
                kind=ExportFailureKind.VERIFICATION,
            ) from error
    return files


def promote_export_staging(staging: Path, destination: Path) -> Path | None:
    """Publish verified staging and return any backup left after failed cleanup.

    A failure before the verified staging directory becomes authoritative restores
    the prior destination when possible. Once promotion succeeds, recursive backup
    deletion is cleanup rather than publication: a cleanup failure leaves the new
    destination in place and retains the remaining backup path for recovery. The
    backup may already be partially removed, so it must never replace the newly
    published export after cleanup has started.
    """
    backup: Path | None = None
    empty_backup: Path | None = None
    try:
        if destination.exists():
            backup_name = tempfile.mkdtemp(
                prefix=f".{destination.name}.backup-",
                dir=destination.parent,
            )
            empty_backup = Path(backup_name)
            empty_backup.rmdir()
            os.replace(destination, empty_backup)
            backup = empty_backup
            empty_backup = None
        os.replace(staging, destination)
    except OSError as error:
        if empty_backup is not None:
            discard_export_staging(empty_backup)
        rollback_error = _rollback_export_publication(staging, destination, backup)
        if rollback_error is not None:
            raise ExportError(
                "Export publication failed and the previous output could not be restored.",
                kind=ExportFailureKind.PUBLICATION,
                path=str(destination),
            ) from rollback_error
        raise ExportError(
            "Export publication failed; the previous output was restored.",
            kind=ExportFailureKind.PUBLICATION,
            path=str(destination),
        ) from error

    if backup is not None:
        try:
            shutil.rmtree(backup)
        except OSError:
            return backup
    return None


def _rollback_export_publication(
    staging: Path,
    destination: Path,
    backup: Path | None,
) -> OSError | None:
    try:
        if backup is None or not backup.exists():
            return None
        if destination.exists():
            os.replace(destination, staging)
        os.replace(backup, destination)
    except OSError as error:
        return error
    return None


def discard_export_staging(staging: Path) -> None:
    """Best-effort removal for an exporter-owned staging or empty backup path."""
    try:
        if staging.exists():
            shutil.rmtree(staging)
    except OSError:
        # Crash recovery and abandoned-transaction cleanup remain separate work.
        return


__all__ = [
    "create_export_staging",
    "discard_export_staging",
    "promote_export_staging",
    "relative_export_files",
    "validate_export_destination",
]
