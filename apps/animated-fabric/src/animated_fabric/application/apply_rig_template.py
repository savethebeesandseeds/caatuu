"""Application boundary for applying a built-in rig template."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from animated_fabric.application.humanoid_rig import HumanoidRigBuilder
from animated_fabric.application.ports import (
    LayerManifestRepository,
    ProjectRepository,
    RigTemplateRegistry,
)
from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import (
    ProjectValidationError,
    ProjectValidationKind,
    ProjectVersionError,
    RigDefinitionError,
)
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationInput

RIG_TEMPLATE_APPLICATION_FAILURE_CODE = "AFT001"
RIG_TEMPLATE_REPLACEMENT_REQUIRED_CODE = "AFT003"


@dataclass(frozen=True, slots=True)
class ApplyRigTemplateRequest:
    """Inputs required to create or explicitly replace one project's rig."""

    project_root: Path
    replace_existing: bool = False


@dataclass(frozen=True, slots=True)
class ApplyRigTemplateResult:
    """Persisted rig facts returned after successful template application."""

    rig: RigDefinition
    rig_path: ProjectPath
    bound_part_count: int


class ApplyRigTemplate:
    """Create a validated humanoid rig from imported layer metadata."""

    def __init__(
        self,
        projects: ProjectRepository,
        layers: LayerManifestRepository,
        templates: RigTemplateRegistry,
        validator: ProjectValidator,
        builder: HumanoidRigBuilder | None = None,
    ) -> None:
        self._projects = projects
        self._layers = layers
        self._templates = templates
        self._validator = validator
        self._builder = builder or HumanoidRigBuilder()

    def execute(
        self,
        request: ApplyRigTemplateRequest,
    ) -> OperationResult[ApplyRigTemplateResult]:
        """Build and atomically publish a rig without silent replacement."""
        try:
            project = self._projects.load(request.project_root)
        except (ProjectValidationError, ProjectVersionError) as error:
            return _failed(error, suggestion="Open a valid Animated Fabric project and retry.")

        try:
            layer_manifest = self._layers.load_layer_manifest(request.project_root)
            template = self._templates.get(project.template_id)
            build = self._builder.build(project, template, layer_manifest)
        except (ProjectValidationError, ProjectVersionError, RigDefinitionError) as error:
            return _failed(
                error,
                path=getattr(error, "path", None),
                suggestion=("Check the project layer catalog and built-in template installation."),
            )

        if build.has_errors or build.value is None:
            return OperationResult[ApplyRigTemplateResult](diagnostics=build.diagnostics)

        rig = build.value
        validation = self._validator.validate(
            ValidationInput(
                manifest=project,
                rig=rig,
                assets=layer_manifest.layers,
            )
        )
        diagnostics = tuple(
            sorted(
                (*build.diagnostics, *validation),
                key=lambda item: (
                    item.code,
                    item.path or "",
                    item.location or "",
                    item.message,
                ),
            )
        )
        if any(item.severity is Severity.ERROR for item in diagnostics):
            return OperationResult[ApplyRigTemplateResult](diagnostics=diagnostics)

        try:
            self._projects.save_rig(
                request.project_root,
                project.rig_path,
                rig,
                replace_existing=request.replace_existing,
            )
        except (ProjectValidationError, ProjectVersionError) as error:
            failure = (
                _replacement_required(project.rig_path)
                if isinstance(error, ProjectValidationError)
                and error.kind is ProjectValidationKind.DOCUMENT_EXISTS
                else _application_failure(
                    str(error) or "The rig could not be saved.",
                    path=getattr(error, "path", None) or project.rig_path,
                    suggestion="Check the approved project path and filesystem permissions.",
                )
            )
            return OperationResult[ApplyRigTemplateResult](
                diagnostics=tuple(
                    sorted(
                        (*diagnostics, failure),
                        key=lambda item: (
                            item.code,
                            item.path or "",
                            item.location or "",
                            item.message,
                        ),
                    )
                )
            )

        return OperationResult[ApplyRigTemplateResult](
            value=ApplyRigTemplateResult(
                rig=rig,
                rig_path=project.rig_path,
                bound_part_count=len(rig.parts),
            ),
            diagnostics=diagnostics,
        )


def _replacement_required(rig_path: ProjectPath) -> Diagnostic:
    return Diagnostic(
        code=RIG_TEMPLATE_REPLACEMENT_REQUIRED_CODE,
        severity=Severity.ERROR,
        message=f"Rig '{rig_path}' already exists and was not replaced.",
        path=rig_path,
        location="rig_path",
        suggestion="Review the existing rig, then rerun with explicit replacement confirmation.",
    )


def _failed(
    error: Exception,
    *,
    path: str | None = None,
    suggestion: str,
) -> OperationResult[ApplyRigTemplateResult]:
    return OperationResult[ApplyRigTemplateResult](
        diagnostics=(
            _application_failure(
                str(error) or "Rig template application could not continue.",
                path=path or getattr(error, "path", None),
                suggestion=suggestion,
            ),
        )
    )


def _application_failure(
    message: str,
    *,
    path: str | None,
    suggestion: str,
) -> Diagnostic:
    return Diagnostic(
        code=RIG_TEMPLATE_APPLICATION_FAILURE_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        suggestion=suggestion,
    )


__all__ = [
    "ApplyRigTemplate",
    "ApplyRigTemplateRequest",
    "ApplyRigTemplateResult",
    "RIG_TEMPLATE_APPLICATION_FAILURE_CODE",
    "RIG_TEMPLATE_REPLACEMENT_REQUIRED_CODE",
]
