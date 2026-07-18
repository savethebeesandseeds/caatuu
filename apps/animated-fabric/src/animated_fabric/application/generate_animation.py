"""Application use case for validated animation generation and publication."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from animated_fabric.application.animation_clip_builder import (
    AnimationClipBuilder,
    AnimationClipBuildRequest,
)
from animated_fabric.application.ports import AnimationGeneratorRegistry, ProjectRepository
from animated_fabric.domain._base import ProjectPath, SemanticId
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import (
    AnimationError,
    ProjectValidationError,
    ProjectValidationKind,
    ProjectVersionError,
)
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationInput
from animated_fabric.domain.validation.models import AnimationDocument, diagnostic_sort_key

ANIMATION_GENERATION_FAILURE_CODE = "AFG001"
ANIMATION_PUBLICATION_FAILURE_CODE = "AFG002"
ANIMATION_REPLACEMENT_REQUIRED_CODE = "AFG003"

_SEMANTIC_ID_ADAPTER = TypeAdapter(SemanticId)


@dataclass(frozen=True, slots=True)
class GenerateAnimationRequest:
    """Identify one built-in generator invocation and publication policy."""

    project_root: Path
    generator_id: SemanticId
    clip_id: SemanticId
    parameters: Mapping[str, object]
    replace_existing: bool = False


@dataclass(frozen=True, slots=True)
class GenerateAnimationResult:
    """Persisted animation state returned by a successful generation."""

    clip: AnimationClip
    animation_path: ProjectPath
    replaced_existing: bool
    manifest_changed: bool


class GenerateAnimation:
    """Generate, validate, and safely publish one editable animation clip."""

    def __init__(
        self,
        projects: ProjectRepository,
        generators: AnimationGeneratorRegistry,
        validator: ProjectValidator,
        builder: AnimationClipBuilder | None = None,
    ) -> None:
        self._projects = projects
        self._generators = generators
        self._validator = validator
        self._builder = builder or AnimationClipBuilder()

    def execute(
        self,
        request: GenerateAnimationRequest,
    ) -> OperationResult[GenerateAnimationResult]:
        """Publish only a complete candidate with explicit replacement semantics."""
        request_failure = _validate_request(request)
        if request_failure is not None:
            return OperationResult[GenerateAnimationResult](diagnostics=(request_failure,))

        try:
            project = self._projects.load(request.project_root)
            rig = self._projects.load_rig(request.project_root, project.rig_path)
        except (ProjectValidationError, ProjectVersionError) as error:
            return _generation_failure(
                str(error) or "The project and rig could not be loaded for animation generation.",
                path=getattr(error, "path", None),
                suggestion="Open a valid rigged Animated Fabric project and retry.",
            )

        compatibility_failure = _compatibility_failure(
            project,
            rig,
            request.generator_id,
            self._generators,
        )
        if compatibility_failure is not None:
            return OperationResult[GenerateAnimationResult](diagnostics=(compatibility_failure,))

        loaded = _load_registered_animations(self._projects, request.project_root, project)
        if loaded.failure is not None:
            return OperationResult[GenerateAnimationResult](diagnostics=(loaded.failure,))

        target = _publication_target(project, loaded.documents, request.clip_id)
        if target.failure is not None:
            return OperationResult[GenerateAnimationResult](diagnostics=(target.failure,))
        assert target.path is not None

        if target.registered and not request.replace_existing:
            return OperationResult[GenerateAnimationResult](
                diagnostics=(_replacement_required(target.path),)
            )

        try:
            generated = self._generators.generate(
                request.generator_id,
                rig,
                request.parameters,
            )
        except AnimationError as error:
            return _generation_failure(
                str(error) or "The animation generator rejected the supplied parameters.",
                path=target.path,
                suggestion="Choose a compatible generator and correct its named parameters.",
            )

        provenance = generated.generator_provenance
        if (
            generated.template_id != rig.template_id
            or provenance is None
            or provenance.generator_id != request.generator_id
        ):
            return _generation_failure(
                "The animation generator returned incompatible clip metadata.",
                path=target.path,
                suggestion="Use a registered generator compatible with the project rig.",
            )

        build = self._builder.build(
            AnimationClipBuildRequest(
                rig=rig,
                diagnostic_path=target.path,
                clip_id=request.clip_id,
                display_name=_display_name(request.clip_id),
                duration_ms=generated.duration_ms,
                loop=generated.loop,
                fps_hint=generated.fps_hint,
                tracks=generated.tracks,
                events=generated.events,
                generator_provenance=provenance,
            )
        )
        if build.has_errors or build.value is None:
            return OperationResult[GenerateAnimationResult](diagnostics=build.diagnostics)
        candidate = build.value

        candidate_manifest = (
            project
            if target.registered
            else _with_animation_paths(project, (*project.animation_paths, target.path))
        )
        candidate_documents = _with_candidate_document(
            loaded.documents,
            target.path,
            candidate,
        )
        diagnostics = tuple(
            sorted(
                self._validator.validate(
                    ValidationInput(
                        manifest=candidate_manifest,
                        rig=rig,
                        animations=candidate_documents,
                    )
                ),
                key=diagnostic_sort_key,
            )
        )
        if any(item.severity is Severity.ERROR for item in diagnostics):
            return OperationResult[GenerateAnimationResult](diagnostics=diagnostics)

        if target.registered:
            try:
                self._projects.save_animation(
                    request.project_root,
                    target.path,
                    candidate,
                    replace_existing=True,
                )
            except (ProjectValidationError, ProjectVersionError) as error:
                return _publication_failure(
                    str(error) or "The generated animation clip could not be replaced.",
                    path=getattr(error, "path", None) or target.path,
                    suggestion="Check the animation path and filesystem permissions.",
                    diagnostics=diagnostics,
                )
            return OperationResult[GenerateAnimationResult](
                value=GenerateAnimationResult(
                    clip=candidate,
                    animation_path=target.path,
                    replaced_existing=True,
                    manifest_changed=False,
                ),
                diagnostics=diagnostics,
            )

        try:
            self._projects.save_animation(
                request.project_root,
                target.path,
                candidate,
                replace_existing=False,
            )
        except (ProjectValidationError, ProjectVersionError) as error:
            message = (
                f"An unregistered animation file already exists at '{target.path}'."
                if isinstance(error, ProjectValidationError)
                and error.kind is ProjectValidationKind.DOCUMENT_EXISTS
                else str(error) or "The generated animation clip could not be created."
            )
            return _publication_failure(
                message,
                path=getattr(error, "path", None) or target.path,
                suggestion=(
                    "Review and relocate the unregistered file; it will not be overwritten."
                    if isinstance(error, ProjectValidationError)
                    and error.kind is ProjectValidationKind.DOCUMENT_EXISTS
                    else "Check the animation path and filesystem permissions."
                ),
                diagnostics=diagnostics,
            )

        try:
            self._projects.save(request.project_root, candidate_manifest)
        except (ProjectValidationError, ProjectVersionError) as error:
            publication = _publication_diagnostic(
                (
                    "The project manifest could not register the generated animation. "
                    f"The generated clip remains unregistered at '{target.path}' and was "
                    "not deleted."
                ),
                path=getattr(error, "path", None) or "project.animated-fabric.json",
                suggestion=(
                    "Review the unregistered clip and project manifest before retrying; "
                    "do not remove a clip that another writer has registered."
                ),
            )
            return OperationResult[GenerateAnimationResult](
                diagnostics=tuple(sorted((*diagnostics, publication), key=diagnostic_sort_key))
            )

        return OperationResult[GenerateAnimationResult](
            value=GenerateAnimationResult(
                clip=candidate,
                animation_path=target.path,
                replaced_existing=False,
                manifest_changed=True,
            ),
            diagnostics=diagnostics,
        )


@dataclass(frozen=True, slots=True)
class _LoadedAnimations:
    documents: tuple[AnimationDocument, ...] = ()
    failure: Diagnostic | None = None


@dataclass(frozen=True, slots=True)
class _PublicationTarget:
    path: ProjectPath | None = None
    registered: bool = False
    failure: Diagnostic | None = None


def _validate_request(request: GenerateAnimationRequest) -> Diagnostic | None:
    for field_name, value in (
        ("generator_id", request.generator_id),
        ("clip_id", request.clip_id),
    ):
        try:
            _SEMANTIC_ID_ADAPTER.validate_python(value)
        except (ValidationError, TypeError, ValueError, RecursionError):
            return _generation_diagnostic(
                f"Animation generation request field '{field_name}' is invalid.",
                location=field_name,
                suggestion="Use a lowercase snake_case semantic identifier.",
            )
    if type(request.replace_existing) is not bool:
        return _generation_diagnostic(
            "Animation generation request field 'replace_existing' is invalid.",
            location="replace_existing",
            suggestion="Use a boolean replacement confirmation.",
        )
    return None


def _compatibility_failure(
    project: ProjectManifest,
    rig: RigDefinition,
    generator_id: str,
    generators: AnimationGeneratorRegistry,
) -> Diagnostic | None:
    if rig.template_id != project.template_id:
        return _generation_diagnostic(
            "The project manifest and rig use different anatomical templates.",
            path=project.rig_path,
            location="template_id",
            suggestion="Restore a rig matching the project's configured template.",
        )
    summaries = generators.list_generators(project.template_id)
    matches = tuple(summary for summary in summaries if summary.generator_id == generator_id)
    if len(matches) != 1 or matches[0].template_id != project.template_id:
        return _generation_diagnostic(
            "The requested animation generator is not available for this project template.",
            location="generator_id",
            suggestion="List generators compatible with the project's template and choose one.",
        )
    return None


def _load_registered_animations(
    projects: ProjectRepository,
    root: Path,
    project: ProjectManifest,
) -> _LoadedAnimations:
    if len(project.animation_paths) != len(set(project.animation_paths)):
        return _LoadedAnimations(
            failure=_generation_diagnostic(
                "The project manifest registers the same animation path more than once.",
                path="project.animated-fabric.json",
                location="animation_paths",
                suggestion="Keep each registered animation path exactly once.",
            )
        )

    documents: list[AnimationDocument] = []
    clip_paths: dict[str, ProjectPath] = {}
    for path in project.animation_paths:
        try:
            clip = projects.load_animation(root, path)
        except (ProjectValidationError, ProjectVersionError) as error:
            return _LoadedAnimations(
                failure=_generation_diagnostic(
                    str(error) or "A registered animation clip could not be loaded.",
                    path=getattr(error, "path", None) or path,
                    suggestion="Restore or remove the invalid registered animation document.",
                )
            )
        if clip.template_id != project.template_id:
            return _LoadedAnimations(
                failure=_generation_diagnostic(
                    f"Registered animation '{path}' does not match the project template.",
                    path=path,
                    location="template_id",
                    suggestion="Regenerate the clip for this project's anatomical template.",
                )
            )
        previous_path = clip_paths.get(clip.clip_id)
        if previous_path is not None:
            return _LoadedAnimations(
                failure=_generation_diagnostic(
                    "The project registers more than one animation with the same clip ID.",
                    path="project.animated-fabric.json",
                    location="animation_paths",
                    suggestion="Keep exactly one registered path for each clip ID.",
                )
            )
        clip_paths[clip.clip_id] = path
        documents.append(AnimationDocument(path=path, clip=clip))
    return _LoadedAnimations(documents=tuple(documents))


def _publication_target(
    project: ProjectManifest,
    documents: tuple[AnimationDocument, ...],
    clip_id: str,
) -> _PublicationTarget:
    matches = tuple(document for document in documents if document.clip.clip_id == clip_id)
    if len(matches) == 1:
        return _PublicationTarget(path=matches[0].path, registered=True)
    if len(matches) > 1:
        return _PublicationTarget(
            failure=_generation_diagnostic(
                "The requested clip ID is registered at more than one project path.",
                path="project.animated-fabric.json",
                location="animation_paths",
                suggestion="Keep exactly one registered path for this clip ID.",
            )
        )

    path = f"animations/{clip_id}.animated-clip.json"
    if path in project.animation_paths:
        return _PublicationTarget(
            failure=_generation_diagnostic(
                "The canonical animation path is registered to a different clip ID.",
                path=path,
                location="clip_id",
                suggestion="Resolve the registered path conflict before generating this clip.",
            )
        )
    return _PublicationTarget(path=path, registered=False)


def _with_candidate_document(
    documents: tuple[AnimationDocument, ...],
    path: ProjectPath,
    clip: AnimationClip,
) -> tuple[AnimationDocument, ...]:
    candidate = AnimationDocument(path=path, clip=clip)
    replaced = tuple(candidate if document.path == path else document for document in documents)
    if any(document.path == path for document in documents):
        return replaced
    return (*documents, candidate)


def _with_animation_paths(
    project: ProjectManifest,
    animation_paths: tuple[ProjectPath, ...],
) -> ProjectManifest:
    return ProjectManifest(
        format=project.format,
        schema_version=project.schema_version,
        project_id=project.project_id,
        slug=project.slug,
        display_name=project.display_name,
        template_id=project.template_id,
        canvas=project.canvas,
        directions=dict(project.directions),
        rig_path=project.rig_path,
        animation_paths=animation_paths,
        export_profiles=tuple(project.export_profiles),
        selection_ellipse=project.selection_ellipse,
    )


def _display_name(clip_id: str) -> str:
    return clip_id.replace("_", " ").title()


def _replacement_required(path: ProjectPath) -> Diagnostic:
    return Diagnostic(
        code=ANIMATION_REPLACEMENT_REQUIRED_CODE,
        severity=Severity.ERROR,
        message=f"Animation clip '{path}' already exists and was not replaced.",
        path=path,
        location="clip_id",
        suggestion="Review the existing clip, then confirm replacement explicitly.",
    )


def _generation_failure(
    message: str,
    *,
    path: str | None,
    suggestion: str,
) -> OperationResult[GenerateAnimationResult]:
    return OperationResult[GenerateAnimationResult](
        diagnostics=(
            _generation_diagnostic(
                message,
                path=path,
                suggestion=suggestion,
            ),
        )
    )


def _publication_failure(
    message: str,
    *,
    path: str,
    suggestion: str,
    diagnostics: tuple[Diagnostic, ...],
) -> OperationResult[GenerateAnimationResult]:
    failure = _publication_diagnostic(message, path=path, suggestion=suggestion)
    return OperationResult[GenerateAnimationResult](
        diagnostics=tuple(sorted((*diagnostics, failure), key=diagnostic_sort_key))
    )


def _generation_diagnostic(
    message: str,
    *,
    path: str | None = None,
    location: str | None = None,
    suggestion: str,
) -> Diagnostic:
    return Diagnostic(
        code=ANIMATION_GENERATION_FAILURE_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        location=location,
        suggestion=suggestion,
    )


def _publication_diagnostic(
    message: str,
    *,
    path: str,
    suggestion: str,
) -> Diagnostic:
    return Diagnostic(
        code=ANIMATION_PUBLICATION_FAILURE_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        suggestion=suggestion,
    )


__all__ = [
    "ANIMATION_GENERATION_FAILURE_CODE",
    "ANIMATION_PUBLICATION_FAILURE_CODE",
    "ANIMATION_REPLACEMENT_REQUIRED_CODE",
    "GenerateAnimation",
    "GenerateAnimationRequest",
    "GenerateAnimationResult",
]
