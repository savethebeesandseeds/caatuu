"""Unit coverage for AF-043 animation generation and publication policy."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from animated_fabric.application.generate_animation import (
    ANIMATION_GENERATION_FAILURE_CODE,
    ANIMATION_PUBLICATION_FAILURE_CODE,
    ANIMATION_REPLACEMENT_REQUIRED_CODE,
    GenerateAnimation,
    GenerateAnimationRequest,
)
from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationTrack,
    GeneratorProvenance,
    Interpolation,
    Keyframe,
    TargetType,
    TrackProperty,
    ValueMode,
)
from animated_fabric.domain.exceptions import (
    AnimationError,
    ProjectValidationError,
    ProjectValidationKind,
)
from animated_fabric.domain.generators import GeneratorSummary
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import BoneDefinition, RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationCode


def _project(*animation_paths: str, template_id: str = "humanoid_v1") -> ProjectManifest:
    return ProjectManifest.model_validate_json(
        json.dumps(
            {
                "format": "animated-fabric.project.v1",
                "schema_version": "0.1.0",
                "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
                "slug": "test_actor",
                "display_name": "Test actor",
                "template_id": template_id,
                "canvas": {
                    "width": 192,
                    "height": 192,
                    "ground_anchor": [96.0, 160.0],
                    "pixel_snap": "none",
                },
                "directions": {
                    "SE": {"mode": "authored"},
                    "SW": {"mode": "mirror", "source": "SE"},
                    "NE": {"mode": "authored"},
                    "NW": {"mode": "mirror", "source": "NE"},
                },
                "rig_path": "rig/main.animated-rig.json",
                "animation_paths": animation_paths,
                "export_profiles": ["default_grid"],
                "selection_ellipse": {
                    "center_offset": [0.0, -2.0],
                    "radius_x": 20.0,
                    "radius_y": 9.0,
                },
            }
        )
    )


def _rig(template_id: str = "humanoid_v1") -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id=template_id,
        bones=(BoneDefinition(bone_id="root"),),
    )


def _track(*, target_id: str = "root") -> AnimationTrack:
    return AnimationTrack(
        target_type=TargetType.BONE,
        target_id=target_id,
        property=TrackProperty.POSITION_Y,
        value_mode=ValueMode.DELTA,
        keys=(
            Keyframe(time_ms=0, value=0.0, interpolation=Interpolation.SMOOTH),
            Keyframe(time_ms=500, value=1.0, interpolation=Interpolation.SMOOTH),
            Keyframe(time_ms=1000, value=0.0, interpolation=Interpolation.SMOOTH),
        ),
    )


def _clip(
    clip_id: str = "generated_default",
    *,
    generator_id: str = "test_generator",
    template_id: str = "humanoid_v1",
    tracks: tuple[AnimationTrack, ...] | None = None,
) -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id=clip_id,
        display_name="Generator default",
        template_id=template_id,
        duration_ms=1000,
        loop=True,
        fps_hint=12,
        tracks=(_track(),) if tracks is None else tracks,
        generator_provenance=GeneratorProvenance(
            generator_id=generator_id,
            parameters={"duration_ms": 1000},
        ),
    )


class FakeGeneratorRegistry:
    def __init__(
        self,
        clip: AnimationClip | None = None,
        *,
        error: AnimationError | None = None,
    ) -> None:
        self.clip = clip or _clip()
        self.error = error
        self.generate_calls: list[tuple[str, RigDefinition, Mapping[str, object]]] = []

    def list_generators(self, template_id: str) -> Sequence[GeneratorSummary]:
        if template_id != "humanoid_v1":
            return ()
        return (
            GeneratorSummary(
                generator_id="test_generator",
                template_id="humanoid_v1",
                parameters=(),
            ),
        )

    def generate(
        self,
        generator_id: str,
        rig: RigDefinition,
        parameters: Mapping[str, object],
    ) -> AnimationClip:
        self.generate_calls.append((generator_id, rig, parameters))
        if self.error is not None:
            raise self.error
        return self.clip


class FakeProjectRepository:
    def __init__(
        self,
        project: ProjectManifest,
        *,
        rig: RigDefinition | None = None,
        animations: Mapping[str, AnimationClip] | None = None,
    ) -> None:
        self.project = project
        self.rig = rig or _rig()
        self.animations = dict(animations or {})
        self.saved_manifests: list[ProjectManifest] = []
        self.animation_saves: list[tuple[ProjectPath, AnimationClip, bool]] = []
        self.animation_save_error: ProjectValidationError | None = None
        self.manifest_save_error: ProjectValidationError | None = None

    def load(self, root: Path) -> ProjectManifest:
        return self.project

    def save(self, root: Path, project: ProjectManifest) -> None:
        if self.manifest_save_error is not None:
            raise self.manifest_save_error
        self.project = project
        self.saved_manifests.append(project)

    def load_rig(self, root: Path, path: ProjectPath) -> RigDefinition:
        return self.rig

    def save_rig(
        self,
        root: Path,
        path: ProjectPath,
        rig: RigDefinition,
        *,
        replace_existing: bool = True,
    ) -> None:
        raise AssertionError("GenerateAnimation must not save the rig")

    def load_animation(self, root: Path, path: ProjectPath) -> AnimationClip:
        try:
            return self.animations[path]
        except KeyError as error:
            raise ProjectValidationError(
                f"Missing animation clip '{path}'.",
                kind=ProjectValidationKind.MISSING_DOCUMENT,
                path=path,
            ) from error

    def save_animation(
        self,
        root: Path,
        path: ProjectPath,
        clip: AnimationClip,
        *,
        replace_existing: bool = True,
    ) -> None:
        self.animation_saves.append((path, clip, replace_existing))
        if self.animation_save_error is not None:
            raise self.animation_save_error
        if not replace_existing and path in self.animations:
            raise ProjectValidationError(
                f"Refusing to replace existing animation clip '{path}'.",
                kind=ProjectValidationKind.DOCUMENT_EXISTS,
                path=path,
            )
        self.animations[path] = clip


def _use_case(
    repository: FakeProjectRepository,
    registry: FakeGeneratorRegistry | None = None,
) -> GenerateAnimation:
    return GenerateAnimation(repository, registry or FakeGeneratorRegistry(), ProjectValidator())


def _request(
    *,
    clip_id: str = "slow_idle",
    parameters: Mapping[str, object] | None = None,
    replace_existing: bool = False,
) -> GenerateAnimationRequest:
    return GenerateAnimationRequest(
        project_root=Path("/project"),
        generator_id="test_generator",
        clip_id=clip_id,
        parameters={} if parameters is None else parameters,
        replace_existing=replace_existing,
    )


def test_new_clip_is_rebuilt_validated_created_and_registered() -> None:
    repository = FakeProjectRepository(_project())
    registry = FakeGeneratorRegistry()

    result = _use_case(repository, registry).execute(_request(parameters={"duration_ms": 1000}))

    assert result.value is not None, result.diagnostics
    assert not result.has_errors
    assert result.value.animation_path == "animations/slow_idle.animated-clip.json"
    assert result.value.clip.clip_id == "slow_idle"
    assert result.value.clip.display_name == "Slow Idle"
    assert result.value.clip.generator_provenance == registry.clip.generator_provenance
    assert not result.value.replaced_existing
    assert result.value.manifest_changed
    assert repository.project.animation_paths == ("animations/slow_idle.animated-clip.json",)
    assert repository.animation_saves[0][2] is False
    assert registry.generate_calls[0][2] == {"duration_ms": 1000}


def test_registered_clip_retains_its_path_and_requires_explicit_replacement() -> None:
    path = "animations/custom_location.animated-clip.json"
    original = _clip("slow_idle")
    repository = FakeProjectRepository(_project(path), animations={path: original})
    use_case = _use_case(repository)

    blocked = use_case.execute(_request())

    assert blocked.value is None
    assert [item.code for item in blocked.diagnostics] == [ANIMATION_REPLACEMENT_REQUIRED_CODE]
    assert repository.animation_saves == []

    replaced = use_case.execute(_request(replace_existing=True))

    assert replaced.value is not None, replaced.diagnostics
    assert replaced.value.animation_path == path
    assert replaced.value.replaced_existing
    assert not replaced.value.manifest_changed
    assert repository.animation_saves[-1][0::2] == (path, True)
    assert repository.saved_manifests == []


def test_unregistered_existing_file_is_never_replaced_even_with_confirmation() -> None:
    path = "animations/slow_idle.animated-clip.json"
    existing = _clip("orphan")
    repository = FakeProjectRepository(_project(), animations={path: existing})

    result = _use_case(repository).execute(_request(replace_existing=True))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ANIMATION_PUBLICATION_FAILURE_CODE]
    assert repository.animations[path] == existing
    assert repository.animation_saves[0][2] is False
    assert repository.saved_manifests == []


@pytest.mark.parametrize(
    "project",
    [
        _project(
            "animations/idle.animated-clip.json",
            "animations/idle.animated-clip.json",
        ),
        _project(
            "animations/first.animated-clip.json",
            "animations/second.animated-clip.json",
        ),
    ],
    ids=("duplicate-path", "duplicate-clip-id"),
)
def test_duplicate_registered_path_or_clip_id_blocks_before_generation(
    project: ProjectManifest,
) -> None:
    shared = _clip("existing")
    animations = {path: shared for path in project.animation_paths}
    repository = FakeProjectRepository(project, animations=animations)
    registry = FakeGeneratorRegistry()

    result = _use_case(repository, registry).execute(_request())

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ANIMATION_GENERATION_FAILURE_CODE]
    assert registry.generate_calls == []
    assert repository.animation_saves == []


def test_canonical_path_registered_to_another_clip_id_is_rejected() -> None:
    path = "animations/slow_idle.animated-clip.json"
    repository = FakeProjectRepository(
        _project(path),
        animations={path: _clip("different_clip")},
    )

    result = _use_case(repository).execute(_request())

    assert result.value is None
    assert result.diagnostics[0].code == ANIMATION_GENERATION_FAILURE_CODE
    assert "different clip ID" in result.diagnostics[0].message
    assert repository.animation_saves == []


def test_complete_candidate_validation_blocks_an_invalid_registered_animation() -> None:
    path = "animations/broken.animated-clip.json"
    broken = _clip("broken", tracks=(_track(target_id="missing_bone"),))
    repository = FakeProjectRepository(_project(path), animations={path: broken})

    result = _use_case(repository).execute(_request())

    assert result.value is None
    assert ValidationCode.TRACK_TARGET_MISSING in {item.code for item in result.diagnostics}
    assert repository.animation_saves == []


def test_warning_only_candidate_is_published_once_without_duplicate_diagnostics() -> None:
    repository = FakeProjectRepository(_project())
    registry = FakeGeneratorRegistry(_clip(tracks=()))

    result = _use_case(repository, registry).execute(_request())

    assert result.value is not None, result.diagnostics
    assert [item.code for item in result.diagnostics] == [ValidationCode.CLIP_WITHOUT_TRACKS]


def test_generator_parameter_failure_remains_sanitized_and_write_free() -> None:
    secret = "do-not-echo-this-value"
    repository = FakeProjectRepository(_project())
    registry = FakeGeneratorRegistry(
        error=AnimationError("Invalid test_generator parameter 'duration_ms'.")
    )

    result = _use_case(repository, registry).execute(_request(parameters={"duration_ms": secret}))

    assert result.value is None
    assert result.diagnostics[0].code == ANIMATION_GENERATION_FAILURE_CODE
    assert "duration_ms" in result.diagnostics[0].message
    assert secret not in result.diagnostics[0].message
    assert repository.animation_saves == []


def test_template_and_provenance_mismatches_fail_before_publication() -> None:
    mismatched_repository = FakeProjectRepository(
        _project(),
        rig=_rig("other_template"),
    )
    mismatch = _use_case(mismatched_repository).execute(_request())
    assert mismatch.value is None
    assert mismatch.diagnostics[0].code == ANIMATION_GENERATION_FAILURE_CODE

    provenance_repository = FakeProjectRepository(_project())
    provenance_registry = FakeGeneratorRegistry(_clip(generator_id="different_generator"))
    provenance = _use_case(provenance_repository, provenance_registry).execute(_request())
    assert provenance.value is None
    assert provenance.diagnostics[0].code == ANIMATION_GENERATION_FAILURE_CODE
    assert provenance_repository.animation_saves == []


def test_animation_save_failure_never_changes_the_manifest() -> None:
    repository = FakeProjectRepository(_project())
    repository.animation_save_error = ProjectValidationError(
        "Injected animation save failure.",
        kind=ProjectValidationKind.FILESYSTEM,
    )

    result = _use_case(repository).execute(_request())

    assert result.value is None
    assert result.diagnostics[0].code == ANIMATION_PUBLICATION_FAILURE_CODE
    assert repository.project.animation_paths == ()
    assert repository.saved_manifests == []


def test_manifest_save_failure_leaves_one_reported_unregistered_clip() -> None:
    repository = FakeProjectRepository(_project())
    repository.manifest_save_error = ProjectValidationError(
        "Injected manifest save failure.",
        kind=ProjectValidationKind.FILESYSTEM,
    )
    path = "animations/slow_idle.animated-clip.json"

    result = _use_case(repository).execute(_request())

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ANIMATION_PUBLICATION_FAILURE_CODE]
    assert repository.animations[path].clip_id == "slow_idle"
    assert repository.project.animation_paths == ()
    diagnostic = result.diagnostics[0]
    assert path in diagnostic.message
    assert "remains unregistered" in diagnostic.message
    assert diagnostic.suggestion is not None
    assert "another writer" in diagnostic.suggestion


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("clip_id", "Not-Semantic"),
        ("generator_id", "../generator"),
        ("replace_existing", 1),
    ],
)
def test_invalid_request_fields_return_sanitized_generation_diagnostics(
    field: str,
    value: object,
) -> None:
    request = _request()
    object.__setattr__(request, field, value)
    repository = FakeProjectRepository(_project())

    result = _use_case(repository).execute(request)

    assert result.value is None
    assert result.diagnostics[0].code == ANIMATION_GENERATION_FAILURE_CODE
    assert str(value) not in result.diagnostics[0].message
    assert repository.animation_saves == []
