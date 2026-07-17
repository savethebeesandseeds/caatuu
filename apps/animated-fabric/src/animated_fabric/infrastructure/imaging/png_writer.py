"""Atomic PNG publication for rendered RGBA frames."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from PIL import Image

from animated_fabric.application.rendering import RenderedFrame, RenderProject
from animated_fabric.domain.exceptions import RenderError


class PngFrameWriter:
    """Encode one rendered frame and atomically replace its destination."""

    def write_project_frame(
        self,
        destination: Path,
        frame: RenderedFrame,
        project: RenderProject,
    ) -> None:
        """Publish a frame while protecting every immutable input in ``project``."""
        if not isinstance(project, RenderProject):
            raise TypeError("Project frame publication requires a RenderProject.")
        asset_paths = tuple(
            project.root.joinpath(*asset.path.split("/")) for asset in project.assets.values()
        )
        self.write(
            destination,
            frame,
            immutable_roots=(project.root / "source",),
            immutable_paths=asset_paths,
        )

    def write(
        self,
        destination: Path,
        frame: RenderedFrame,
        *,
        immutable_roots: tuple[Path, ...] = (),
        immutable_paths: tuple[Path, ...] = (),
    ) -> None:
        """Write ``frame`` as deterministic RGBA PNG through a sibling temporary file."""
        if not isinstance(destination, Path):
            raise TypeError("PNG destination must be a pathlib.Path.")
        if destination.suffix.lower() != ".png":
            raise RenderError("Rendered frame destinations must use the '.png' extension.")
        if not isinstance(frame, RenderedFrame):
            raise TypeError("PNG publication requires a RenderedFrame.")
        if not isinstance(immutable_roots, tuple) or not isinstance(immutable_paths, tuple):
            raise TypeError("Immutable output guards must be tuples of pathlib.Path values.")
        if any(not isinstance(path, Path) for path in (*immutable_roots, *immutable_paths)):
            raise TypeError("Immutable output guards must contain pathlib.Path values.")
        self._reject_immutable_destination(destination, immutable_roots, immutable_paths)

        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise RenderError("The rendered frame destination is not writable.") from error
        if destination.is_dir():
            raise RenderError("The rendered frame destination is a directory, not a PNG file.")

        descriptor = -1
        temporary_path: Path | None = None
        write_error: OSError | ValueError | None = None
        try:
            descriptor, temporary_name = tempfile.mkstemp(
                dir=destination.parent,
                prefix=f".{destination.name}.",
                suffix=".tmp",
            )
            temporary_path = Path(temporary_name)
            stream = os.fdopen(descriptor, "w+b")
            descriptor = -1
            with stream:
                image = Image.frombytes(
                    "RGBA",
                    (frame.canvas_size.width, frame.canvas_size.height),
                    frame.rgba,
                )
                image.save(
                    stream,
                    format="PNG",
                    optimize=False,
                    compress_level=9,
                    pnginfo=None,
                )
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, destination)
        except (OSError, ValueError) as error:
            write_error = error
        finally:
            if descriptor >= 0:
                try:
                    os.close(descriptor)
                except OSError as error:
                    if write_error is None:
                        write_error = error
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError as error:
                    if write_error is None:
                        write_error = error

        if write_error is not None:
            raise RenderError("Unable to atomically write the rendered PNG frame.") from write_error

    @staticmethod
    def _reject_immutable_destination(
        destination: Path,
        immutable_roots: tuple[Path, ...],
        immutable_paths: tuple[Path, ...],
    ) -> None:
        try:
            candidate = destination.resolve(strict=False)
            protected_roots = tuple(path.resolve(strict=False) for path in immutable_roots)
            protected_paths = tuple(path.resolve(strict=False) for path in immutable_paths)
        except (OSError, RuntimeError) as error:
            raise RenderError(
                "The rendered frame destination cannot be resolved safely."
            ) from error

        if any(candidate.is_relative_to(root) for root in protected_roots):
            raise RenderError("Rendered frames cannot overwrite immutable source assets.")
        if candidate in protected_paths:
            raise RenderError("Rendered frames cannot overwrite a referenced project asset.")


__all__ = ["PngFrameWriter"]
