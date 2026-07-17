"""Typer command-line interface for Animated Fabric use cases."""

from __future__ import annotations

import importlib.util
import json
import logging
import sys
from pathlib import Path
from typing import Annotated

import typer

from animated_fabric import __version__
from animated_fabric.application.render_frame import RenderFrame, render_failure
from animated_fabric.application.rendering import RenderQuality, RenderRequest
from animated_fabric.application.validation_service import (
    ValidateProject,
    ValidateProjectRequest,
)
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.exceptions import (
    ProjectValidationError,
    ProjectVersionError,
    RenderError,
)
from animated_fabric.domain.project import Direction
from animated_fabric.domain.validation import ProjectValidator
from animated_fabric.infrastructure.fixtures import load_stick_humanoid_project
from animated_fabric.infrastructure.imaging import OpenCvRenderer, PngFrameWriter
from animated_fabric.infrastructure.persistence import JsonProjectRepository

MINIMUM_PYTHON = (3, 12)
REQUIRED_MODULES = (
    ("pydantic", "Pydantic"),
    ("numpy", "NumPy"),
    ("cv2", "OpenCV"),
    ("PIL", "Pillow"),
    ("PySide6", "PySide6"),
    ("typer", "Typer"),
    ("rich", "Rich"),
    ("platformdirs", "platformdirs"),
)

HUMAN_SEVERITY = {
    Severity.INFO: "INFO",
    Severity.WARNING: "WARNING",
    Severity.ERROR: "ERROR",
}
LOGGER = logging.getLogger(__name__)
CLI_INTERNAL_FAILURE_CODE = "AFC010"

app = typer.Typer(
    name="animated-fabric",
    help="Animated Fabric development and diagnostic tools.",
    add_completion=False,
    no_args_is_help=True,
)


def collect_doctor_diagnostics() -> tuple[Diagnostic, ...]:
    """Inspect the minimum runtime without importing optional presentation code."""
    diagnostics: list[Diagnostic] = []

    if sys.version_info[:2] < MINIMUM_PYTHON:
        detected = f"{sys.version_info.major}.{sys.version_info.minor}"
        diagnostics.append(
            Diagnostic(
                code="AFD001",
                severity=Severity.ERROR,
                message=f"Python {detected} is not supported.",
                location="python",
                suggestion="Use Python 3.12 or later.",
            )
        )

    for module_name, display_name in REQUIRED_MODULES:
        if importlib.util.find_spec(module_name) is None:
            diagnostics.append(
                Diagnostic(
                    code="AFD002",
                    severity=Severity.ERROR,
                    message=f"The {display_name} dependency was not found.",
                    location=module_name,
                    suggestion="Install the package with its runtime dependencies.",
                )
            )

    return tuple(diagnostics)


def diagnostic_to_payload(diagnostic: Diagnostic) -> dict[str, str | None]:
    """Convert a diagnostic to the stable CLI JSON shape from the specification."""
    return {
        "code": diagnostic.code,
        "severity": diagnostic.severity.value,
        "message": diagnostic.message,
        "path": diagnostic.path,
        "location": diagnostic.location,
        "suggestion": diagnostic.suggestion,
    }


def format_diagnostic(diagnostic: Diagnostic) -> str:
    """Format one diagnostic for a person while preserving actionable context."""
    lines = [f"{HUMAN_SEVERITY[diagnostic.severity]} {diagnostic.code}: {diagnostic.message}"]
    if diagnostic.path is not None:
        lines.append(f"  File: {diagnostic.path}")
    if diagnostic.location is not None:
        lines.append(f"  Location: {diagnostic.location}")
    if diagnostic.suggestion is not None:
        lines.append(f"  Suggestion: {diagnostic.suggestion}")
    return "\n".join(lines)


def create_validate_project() -> ValidateProject:
    """Compose the shared validation use case with filesystem infrastructure."""
    return ValidateProject(JsonProjectRepository(), ProjectValidator())


def load_requested_clip(
    repository: JsonProjectRepository,
    root: Path,
    paths: tuple[str, ...],
    clip_id: str | None,
) -> AnimationClip | None:
    """Load one uniquely identified clip from project paths when requested."""
    if clip_id is None:
        return None
    matches: list[AnimationClip] = []
    try:
        for path in paths:
            clip = repository.load_animation(root, path)
            if clip.clip_id == clip_id:
                matches.append(clip)
    except (ProjectValidationError, ProjectVersionError) as error:
        raise RenderError(str(error)) from error
    if not matches:
        raise RenderError(f"Project does not contain animation clip '{clip_id}'.")
    if len(matches) > 1:
        raise RenderError(f"Project contains more than one animation clip named '{clip_id}'.")
    return matches[0]


def emit_diagnostics(
    diagnostics: tuple[Diagnostic, ...],
    *,
    as_json: bool,
    success_message: str,
) -> None:
    """Write stable human or JSON diagnostics for a CLI command."""
    if as_json:
        payload = [diagnostic_to_payload(item) for item in diagnostics]
        typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
    elif diagnostics:
        typer.echo("\n".join(format_diagnostic(item) for item in diagnostics))
    else:
        typer.echo(success_message)


@app.command("version")
def version_command() -> None:
    """Show the installed version."""
    typer.echo(f"Animated Fabric {__version__}")


@app.command()
def doctor(
    as_json: Annotated[
        bool,
        typer.Option(
            "--json",
            help="Emit diagnostics as structured JSON.",
        ),
    ] = False,
) -> None:
    """Check that the minimum runtime is available."""
    diagnostics = collect_doctor_diagnostics()
    emit_diagnostics(
        diagnostics,
        as_json=as_json,
        success_message="Diagnostic complete: no problems found.",
    )

    if any(item.severity is Severity.ERROR for item in diagnostics):
        raise typer.Exit(code=2)


@app.command("validate")
def validate_command(
    root: Annotated[
        Path,
        typer.Argument(help="Project root containing project.animated-fabric.json."),
    ],
    as_json: Annotated[
        bool,
        typer.Option("--json", help="Emit diagnostics as structured JSON."),
    ] = False,
) -> None:
    """Load and structurally validate an Animated Fabric project."""
    try:
        result = create_validate_project().execute(ValidateProjectRequest(root=root))
    except Exception as error:
        LOGGER.error(
            "%s: validation failed with exception type %s.",
            CLI_INTERNAL_FAILURE_CODE,
            type(error).__name__,
        )
        emit_diagnostics(
            (
                Diagnostic(
                    code=CLI_INTERNAL_FAILURE_CODE,
                    severity=Severity.ERROR,
                    message="Unexpected internal failure while validating the project.",
                    suggestion="Review the application logs and retry.",
                ),
            ),
            as_json=as_json,
            success_message="",
        )
        raise typer.Exit(code=10) from None
    emit_diagnostics(
        result.diagnostics,
        as_json=as_json,
        success_message="Validation complete: no problems found.",
    )
    if result.has_errors:
        raise typer.Exit(code=2)


@app.command("render-frame")
def render_frame_command(
    root: Annotated[
        Path,
        typer.Argument(help="Generated fixture project root to render."),
    ],
    direction: Annotated[
        Direction,
        typer.Option("--direction", help="Logical direction to render (SE, NE, SW, or NW)."),
    ],
    out: Annotated[
        Path,
        typer.Option("--out", help="Destination RGBA PNG path."),
    ],
    clip_id: Annotated[
        str | None,
        typer.Option("--clip", help="Animation clip ID; omit for the neutral pose."),
    ] = None,
    time_ms: Annotated[
        float,
        typer.Option("--time-ms", help="Clip-relative render time in milliseconds."),
    ] = 0.0,
    quality: Annotated[
        RenderQuality,
        typer.Option("--quality", help="Affine sampling quality."),
    ] = RenderQuality.CUBIC,
    as_json: Annotated[
        bool,
        typer.Option("--json", help="Emit diagnostics as structured JSON."),
    ] = False,
) -> None:
    """Render one owned-fixture frame through the shared application renderer."""
    try:
        repository = JsonProjectRepository()
        loaded = load_stick_humanoid_project(root, repository)
        clip = load_requested_clip(
            repository,
            root,
            loaded.project.manifest.animation_paths,
            clip_id,
        )
        request = RenderRequest(
            project=loaded.project,
            rig=loaded.rig,
            clip=clip,
            direction=direction,
            time_ms=time_ms,
            quality=quality,
        )
        result = RenderFrame(OpenCvRenderer()).execute(request)
        if result.has_errors or result.value is None:
            emit_diagnostics(result.diagnostics, as_json=as_json, success_message="")
            raise typer.Exit(code=4)
        try:
            PngFrameWriter().write_project_frame(out, result.value, loaded.project)
        except RenderError as error:
            failure = render_failure(error)
            emit_diagnostics(failure.diagnostics, as_json=as_json, success_message="")
            raise typer.Exit(code=4) from None
    except typer.Exit:
        raise
    except RenderError as error:
        failure = render_failure(error)
        emit_diagnostics(failure.diagnostics, as_json=as_json, success_message="")
        raise typer.Exit(code=4) from None
    except Exception as error:
        LOGGER.error(
            "%s: rendering failed with exception type %s.",
            CLI_INTERNAL_FAILURE_CODE,
            type(error).__name__,
        )
        emit_diagnostics(
            (
                Diagnostic(
                    code=CLI_INTERNAL_FAILURE_CODE,
                    severity=Severity.ERROR,
                    message="Unexpected internal failure while rendering the frame.",
                    suggestion="Review the application logs and retry.",
                ),
            ),
            as_json=as_json,
            success_message="",
        )
        raise typer.Exit(code=10) from None

    description = clip_id or "neutral"
    emit_diagnostics(
        (),
        as_json=as_json,
        success_message=(f"Rendered {description} {direction.value} frame to {out}."),
    )


def main() -> None:
    """Run the command-line entry point."""
    app()
