"""Application use case for loading and structurally validating a project."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from animated_fabric.application.ports import PROJECT_MANIFEST_FILENAME, ProjectRepository
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import (
    ProjectValidationError,
    ProjectValidationKind,
    ProjectVersionError,
)
from animated_fabric.domain.validation.engine import ProjectValidator
from animated_fabric.domain.validation.models import (
    AnimationDocument,
    ValidationCode,
    ValidationInput,
    diagnostic_sort_key,
)


@dataclass(frozen=True, slots=True)
class ValidateProjectRequest:
    """Identify the approved project root to validate."""

    root: Path


class ValidateProject:
    """Load available project documents and return structured diagnostics."""

    def __init__(self, repository: ProjectRepository, validator: ProjectValidator) -> None:
        self._repository = repository
        self._validator = validator

    def execute(self, request: ValidateProjectRequest) -> OperationResult[None]:
        """Validate one project without printing, mutating, or opening GUI state."""
        try:
            manifest = self._repository.load(request.root)
        except ProjectVersionError as error:
            return self._failure(project_version_diagnostic(error, PROJECT_MANIFEST_FILENAME))
        except ProjectValidationError as error:
            return self._failure(
                project_validation_diagnostic(error, PROJECT_MANIFEST_FILENAME, is_manifest=True)
            )

        try:
            rig = self._repository.load_rig(request.root, manifest.rig_path)
        except ProjectVersionError as error:
            return self._failure(project_version_diagnostic(error, manifest.rig_path))
        except ProjectValidationError as error:
            return self._failure(project_validation_diagnostic(error, manifest.rig_path))

        diagnostics: list[Diagnostic] = []
        animations: list[AnimationDocument] = []
        for path in manifest.animation_paths:
            try:
                clip = self._repository.load_animation(request.root, path)
            except ProjectVersionError as error:
                diagnostics.append(project_version_diagnostic(error, path))
            except ProjectValidationError as error:
                diagnostics.append(project_validation_diagnostic(error, path))
            else:
                animations.append(AnimationDocument(path=path, clip=clip))

        validation_input = ValidationInput(
            manifest=manifest,
            rig=rig,
            animations=tuple(animations),
        )
        diagnostics.extend(self._validator.validate(validation_input))
        return OperationResult[None](
            diagnostics=tuple(sorted(diagnostics, key=diagnostic_sort_key))
        )

    @staticmethod
    def _failure(diagnostic: Diagnostic) -> OperationResult[None]:
        return OperationResult[None](diagnostics=(diagnostic,))


def project_version_diagnostic(error: ProjectVersionError, fallback_path: str) -> Diagnostic:
    """Map one repository schema failure to the shared project-validation wire contract."""
    return Diagnostic(
        code=ValidationCode.INCOMPATIBLE_SCHEMA,
        severity=Severity.ERROR,
        message=str(error),
        path=error.path or fallback_path,
        suggestion="Open the project with a compatible Animated Fabric version.",
    )


def project_validation_diagnostic(
    error: ProjectValidationError,
    fallback_path: str,
    *,
    is_manifest: bool = False,
) -> Diagnostic:
    """Map one repository document failure consistently across application use cases."""
    if error.kind is ProjectValidationKind.UNSAFE_PATH:
        code = ValidationCode.PATH_OUTSIDE_PROJECT
        suggestion = "Keep every project path inside the selected root."
    elif error.kind is ProjectValidationKind.MISSING_DOCUMENT and is_manifest:
        code = ValidationCode.MANIFEST_MISSING
        suggestion = "Select a project containing project.animated-fabric.json."
    else:
        code = ValidationCode.INVALID_PROJECT_DOCUMENT
        suggestion = "Restore or recreate the referenced project JSON document."
    return Diagnostic(
        code=code,
        severity=Severity.ERROR,
        message=str(error),
        path=error.path or fallback_path,
        suggestion=suggestion,
    )


__all__ = [
    "ValidateProject",
    "ValidateProjectRequest",
    "project_validation_diagnostic",
    "project_version_diagnostic",
]
