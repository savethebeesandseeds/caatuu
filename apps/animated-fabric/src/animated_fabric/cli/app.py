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
from animated_fabric.application.apply_rig_template import (
    RIG_TEMPLATE_APPLICATION_FAILURE_CODE,
    ApplyRigTemplate,
    ApplyRigTemplateRequest,
)
from animated_fabric.application.import_layers import (
    IMPORT_MAPPING_PROPOSAL_CODE,
    ImportLayerSet,
    InspectLayerFolder,
    LayerAssignment,
    LayerImportRequest,
)
from animated_fabric.application.render_frame import RenderFrame, render_failure
from animated_fabric.application.rendering import RenderQuality, RenderRequest
from animated_fabric.application.validation_service import (
    ValidateProject,
    ValidateProjectRequest,
)
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.exceptions import (
    AssetImportError,
    ProjectValidationError,
    ProjectVersionError,
    RenderError,
)
from animated_fabric.domain.project import Direction
from animated_fabric.domain.validation import ProjectValidator
from animated_fabric.infrastructure.fixtures import load_stick_humanoid_project
from animated_fabric.infrastructure.imaging import OpenCvRenderer, PngFrameWriter
from animated_fabric.infrastructure.importing import FolderLayerImporter
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from animated_fabric.templates import JsonRigTemplateRegistry

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
rig_app = typer.Typer(
    help="Create and manage project rigs.",
    add_completion=False,
    no_args_is_help=True,
)
app.add_typer(rig_app, name="rig")


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


def create_folder_layer_importer() -> FolderLayerImporter:
    """Compose the shared layer importer with hardened project persistence."""
    return FolderLayerImporter(JsonProjectRepository())


def create_apply_rig_template() -> ApplyRigTemplate:
    """Compose template application with project-owned persistence and resources."""
    repository = JsonProjectRepository()
    return ApplyRigTemplate(
        repository,
        repository,
        JsonRigTemplateRegistry(),
        ProjectValidator(),
    )


def confirmed_layer_assignments(
    source_layers: tuple[tuple[str, str | None], ...],
    overrides: list[str] | None,
) -> tuple[LayerAssignment, ...]:
    """Apply explicit ``SOURCE=PART`` overrides to deterministic proposals."""
    parsed: dict[str, str] = {}
    for value in overrides or []:
        source_name, separator, semantic_part = value.partition("=")
        source_name = source_name.strip()
        semantic_part = semantic_part.strip()
        if not separator or not source_name or not semantic_part:
            raise AssetImportError(f"Invalid mapping '{value}'; expected SOURCE.png=semantic_part.")
        if source_name in parsed:
            raise AssetImportError(f"Source mapping '{source_name}' was provided more than once.")
        parsed[source_name] = semantic_part

    assignments: list[LayerAssignment] = []
    for source_name, proposed in source_layers:
        selected_part = parsed.pop(source_name) if source_name in parsed else proposed
        if selected_part is None:
            raise AssetImportError(
                f"Source PNG '{source_name}' needs an explicit --map SOURCE=PART value."
            )
        assignments.append(
            LayerAssignment(
                source_name=source_name,
                semantic_part=selected_part,
            )
        )
    if parsed:
        unknown = sorted(parsed, key=lambda value: (value.casefold(), value))[0]
        raise AssetImportError(f"Mapping references unknown source PNG '{unknown}'.")
    return tuple(assignments)


def layer_mapping_diagnostics(
    assignments: tuple[LayerAssignment, ...],
) -> tuple[Diagnostic, ...]:
    """Represent displayed import proposals in the stable JSON diagnostic shape."""
    return tuple(
        Diagnostic(
            code=IMPORT_MAPPING_PROPOSAL_CODE,
            severity=Severity.INFO,
            message=(
                f"Proposed semantic mapping: {assignment.source_name} -> "
                f"{assignment.semantic_part}."
            ),
            path=assignment.source_name,
            location=assignment.semantic_part,
        )
        for assignment in assignments
    )


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


@app.command("import-layers")
def import_layers_command(
    root: Annotated[
        Path,
        typer.Argument(help="Existing Animated Fabric project root."),
    ],
    direction: Annotated[
        Direction,
        typer.Option("--direction", help="Authored direction for the imported layers."),
    ],
    source: Annotated[
        Path,
        typer.Option("--source", help="Direction-specific folder of prepared PNG layers."),
    ],
    mappings: Annotated[
        list[str] | None,
        typer.Option(
            "--map",
            help="Override one proposal as SOURCE.png=semantic_part; repeat as needed.",
        ),
    ] = None,
    trim: Annotated[
        bool,
        typer.Option("--trim/--no-trim", help="Trim transparent borders while preserving origin."),
    ] = True,
    yes: Annotated[
        bool,
        typer.Option("--yes", help="Confirm every displayed semantic mapping non-interactively."),
    ] = False,
    as_json: Annotated[
        bool,
        typer.Option("--json", help="Emit diagnostics as structured JSON."),
    ] = False,
) -> None:
    """Inspect, confirm, and import one direction-specific PNG layer folder."""
    try:
        importer = create_folder_layer_importer()
        inspection_result = InspectLayerFolder(importer).execute(source)
        if inspection_result.has_errors or inspection_result.value is None:
            emit_diagnostics(
                inspection_result.diagnostics,
                as_json=as_json,
                success_message="",
            )
            raise typer.Exit(code=3)

        inspection = inspection_result.value
        assignments = confirmed_layer_assignments(
            tuple((layer.source_name, layer.proposed_semantic_part) for layer in inspection.layers),
            mappings,
        )
        mapping_diagnostics = layer_mapping_diagnostics(assignments)
        if not as_json:
            typer.echo("Proposed semantic mappings:")
            for assignment in assignments:
                typer.echo(f"  {assignment.source_name} -> {assignment.semantic_part}")
        if not yes:
            if as_json:
                emit_diagnostics(
                    mapping_diagnostics
                    + (
                        Diagnostic(
                            code="AFI004",
                            severity=Severity.ERROR,
                            message="JSON layer import requires explicit --yes confirmation.",
                            suggestion="Review mappings first, then rerun with --yes.",
                        ),
                    ),
                    as_json=True,
                    success_message="",
                )
                raise typer.Exit(code=3)
            if not typer.confirm("Import these mappings?", default=False):
                typer.echo("Layer import cancelled.")
                raise typer.Exit(code=3)

        result = ImportLayerSet(importer, JsonProjectRepository()).execute(
            LayerImportRequest(
                project_root=root,
                source=source,
                direction=direction,
                assignments=assignments,
                trim=trim,
            )
        )
        if result.has_errors or result.value is None:
            diagnostics = (
                mapping_diagnostics + result.diagnostics if as_json else result.diagnostics
            )
            emit_diagnostics(diagnostics, as_json=as_json, success_message="")
            raise typer.Exit(code=3)
    except typer.Exit:
        raise
    except AssetImportError as error:
        emit_diagnostics(
            (
                Diagnostic(
                    code="AFI001",
                    severity=Severity.ERROR,
                    message=str(error) or "Layer import could not continue.",
                    suggestion="Check the source folder and confirmed mappings.",
                ),
            ),
            as_json=as_json,
            success_message="",
        )
        raise typer.Exit(code=3) from None
    except Exception as error:
        LOGGER.error(
            "%s: layer import failed with exception type %s.",
            CLI_INTERNAL_FAILURE_CODE,
            type(error).__name__,
        )
        emit_diagnostics(
            (
                Diagnostic(
                    code=CLI_INTERNAL_FAILURE_CODE,
                    severity=Severity.ERROR,
                    message="Unexpected internal failure while importing layers.",
                    suggestion="Review the application logs and retry.",
                ),
            ),
            as_json=as_json,
            success_message="",
        )
        raise typer.Exit(code=10) from None

    imported = result.value.imported_assets
    diagnostics = mapping_diagnostics + result.diagnostics if as_json else result.diagnostics
    emit_diagnostics(
        diagnostics,
        as_json=as_json,
        success_message=(
            f"Imported {len(imported)} {direction.value} layer(s) into {root}; "
            f"catalog: {result.value.manifest_path}."
        ),
    )


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


@rig_app.command("apply-template")
def apply_rig_template_command(
    root: Annotated[
        Path,
        typer.Argument(help="Existing Animated Fabric project root."),
    ],
    replace_existing: Annotated[
        bool,
        typer.Option(
            "--replace-existing",
            help="Explicitly confirm replacement of the configured rig document.",
        ),
    ] = False,
    as_json: Annotated[
        bool,
        typer.Option("--json", help="Emit diagnostics as structured JSON."),
    ] = False,
) -> None:
    """Apply the project's built-in template to its imported layer catalog."""
    try:
        result = create_apply_rig_template().execute(
            ApplyRigTemplateRequest(
                project_root=root,
                replace_existing=replace_existing,
            )
        )
    except Exception as error:
        LOGGER.error(
            "%s: rig template application failed with exception type %s.",
            CLI_INTERNAL_FAILURE_CODE,
            type(error).__name__,
        )
        emit_diagnostics(
            (
                Diagnostic(
                    code=CLI_INTERNAL_FAILURE_CODE,
                    severity=Severity.ERROR,
                    message="Unexpected internal failure while applying the rig template.",
                    suggestion="Review the application logs and retry.",
                ),
            ),
            as_json=as_json,
            success_message="",
        )
        raise typer.Exit(code=10) from None

    if result.has_errors or result.value is None:
        emit_diagnostics(result.diagnostics, as_json=as_json, success_message="")
        exit_code = (
            3
            if any(
                item.code == RIG_TEMPLATE_APPLICATION_FAILURE_CODE for item in result.diagnostics
            )
            else 2
        )
        raise typer.Exit(code=exit_code)

    success_message = (
        f"Applied template '{result.value.rig.template_id}' with "
        f"{len(result.value.rig.bones)} bones, {result.value.bound_part_count} bound parts, "
        f"and {len(result.value.rig.sockets)} sockets to {result.value.rig_path}."
    )
    emit_diagnostics(
        result.diagnostics,
        as_json=as_json,
        success_message=success_message,
    )
    if result.diagnostics and not as_json:
        typer.echo(success_message)


def main() -> None:
    """Run the command-line entry point."""
    app()
