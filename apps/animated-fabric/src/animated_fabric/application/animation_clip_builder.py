"""Safe deterministic construction of normalized animation clips."""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError

from animated_fabric.domain._base import JsonValue, ProjectPath, SemanticId
from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationEvent,
    AnimationTrack,
    GeneratorProvenance,
    Keyframe,
)
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation.animation import validate_animation
from animated_fabric.domain.validation.models import AnimationDocument

ANIMATION_BUILD_FAILURE_CODE = "AFB001"

_SAFE_STRICT_VALIDATION_FIELDS = frozenset(
    {
        "clip_id",
        "display_name",
        "duration_ms",
        "events",
        "format",
        "fps_hint",
        "generator_id",
        "generator_provenance",
        "loop",
        "parameters",
        "schema_version",
        "template_id",
        "tracks",
    }
)


@dataclass(frozen=True, slots=True)
class AnimationClipBuildRequest:
    """Typed source values for one detached normalized animation clip."""

    rig: RigDefinition
    diagnostic_path: ProjectPath
    clip_id: SemanticId
    display_name: str
    duration_ms: int
    loop: bool
    fps_hint: int
    tracks: tuple[AnimationTrack, ...]
    events: tuple[AnimationEvent, ...] = ()
    generator_provenance: GeneratorProvenance | None = None


class AnimationClipBuilder:
    """Construct one validatable clip without retaining mutable builder state."""

    def build(
        self,
        request: AnimationClipBuildRequest,
    ) -> OperationResult[AnimationClip]:
        """Normalize, detach, and validate one animation clip candidate."""
        metadata_failure = _validate_metadata(request)
        if metadata_failure is not None:
            return OperationResult[AnimationClip](diagnostics=(metadata_failure,))

        try:
            normalized_tracks = tuple(_copy_track(track) for track in request.tracks)
            events = tuple(
                sorted(
                    (_copy_event(event) for event in request.events),
                    key=lambda event: event.time_ms,
                )
            )
            provenance = _copy_provenance(request.generator_provenance)
            normalized_clip = _construct_clip(
                request,
                normalized_tracks,
                events,
                provenance,
            )
        except (ValidationError, TypeError, ValueError, OverflowError, RecursionError) as error:
            return OperationResult[AnimationClip](
                diagnostics=(_construction_failure(request.diagnostic_path, error),)
            )

        preliminary_diagnostics = _validate_clip(request, normalized_clip)
        if any(item.severity is Severity.ERROR for item in preliminary_diagnostics):
            return OperationResult[AnimationClip](diagnostics=preliminary_diagnostics)

        try:
            tracks = (
                tuple(
                    _with_loop_endpoint(track, request.duration_ms) for track in normalized_tracks
                )
                if request.loop
                else normalized_tracks
            )
            clip = _construct_clip(request, tracks, events, provenance)
        except (ValidationError, TypeError, ValueError, OverflowError, RecursionError) as error:
            return OperationResult[AnimationClip](
                diagnostics=(_construction_failure(request.diagnostic_path, error),)
            )
        final_diagnostics = _validate_clip(request, clip)
        if any(item.severity is Severity.ERROR for item in final_diagnostics):
            return OperationResult[AnimationClip](diagnostics=final_diagnostics)
        return OperationResult[AnimationClip](value=clip, diagnostics=final_diagnostics)


def _validate_metadata(request: AnimationClipBuildRequest) -> Diagnostic | None:
    try:
        AnimationClip(
            format="animated-fabric.animation-clip.v1",
            schema_version="0.1.0",
            clip_id=request.clip_id,
            display_name=request.display_name,
            template_id=request.rig.template_id,
            duration_ms=request.duration_ms,
            loop=request.loop,
            fps_hint=request.fps_hint,
        )
    except (ValidationError, TypeError, ValueError, OverflowError, RecursionError) as error:
        return _construction_failure(request.diagnostic_path, error)
    return None


def _construct_clip(
    request: AnimationClipBuildRequest,
    tracks: tuple[AnimationTrack, ...],
    events: tuple[AnimationEvent, ...],
    provenance: GeneratorProvenance | None,
) -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id=request.clip_id,
        display_name=request.display_name,
        template_id=request.rig.template_id,
        duration_ms=request.duration_ms,
        loop=request.loop,
        fps_hint=request.fps_hint,
        tracks=tracks,
        events=events,
        generator_provenance=provenance,
    )


def _validate_clip(
    request: AnimationClipBuildRequest,
    clip: AnimationClip,
) -> tuple[Diagnostic, ...]:
    return validate_animation(
        AnimationDocument(path=request.diagnostic_path, clip=clip),
        bone_ids=frozenset(bone.bone_id for bone in request.rig.bones),
        part_ids=frozenset(part.part_id for part in request.rig.parts),
    )


def _copy_track(track: AnimationTrack) -> AnimationTrack:
    keys = sorted((_copy_key(key) for key in track.keys), key=lambda key: key.time_ms)
    return AnimationTrack(
        target_type=track.target_type,
        target_id=track.target_id,
        property=track.property,
        value_mode=track.value_mode,
        keys=tuple(keys),
    )


def _with_loop_endpoint(track: AnimationTrack, duration_ms: int) -> AnimationTrack:
    if (
        not track.keys
        or any(key.time_ms == duration_ms for key in track.keys)
        or track.keys[-1].time_ms >= duration_ms
    ):
        return track
    first = track.keys[0]
    endpoint = Keyframe(
        time_ms=duration_ms,
        value=first.value,
        interpolation=first.interpolation,
    )
    return AnimationTrack(
        target_type=track.target_type,
        target_id=track.target_id,
        property=track.property,
        value_mode=track.value_mode,
        keys=(*track.keys, endpoint),
    )


def _copy_key(key: Keyframe) -> Keyframe:
    return Keyframe(
        time_ms=key.time_ms,
        value=key.value,
        interpolation=key.interpolation,
    )


def _copy_event(event: AnimationEvent) -> AnimationEvent:
    return AnimationEvent(time_ms=event.time_ms, event=event.event)


def _copy_provenance(
    provenance: GeneratorProvenance | None,
) -> GeneratorProvenance | None:
    if provenance is None:
        return None
    return GeneratorProvenance(
        generator_id=provenance.generator_id,
        parameters={
            key: _copy_json_value(provenance.parameters[key])
            for key in sorted(provenance.parameters)
        },
    )


def _copy_json_value(value: JsonValue) -> JsonValue:
    return _copy_json_value_guarded(value, set())


def _copy_json_value_guarded(value: JsonValue, active_containers: set[int]) -> JsonValue:
    if isinstance(value, list):
        marker = _enter_json_container(value, active_containers)
        try:
            return [_copy_json_value_guarded(item, active_containers) for item in value]
        finally:
            active_containers.remove(marker)
    if isinstance(value, dict):
        marker = _enter_json_container(value, active_containers)
        try:
            return {
                key: _copy_json_value_guarded(value[key], active_containers)
                for key in sorted(value)
            }
        finally:
            active_containers.remove(marker)
    return value


def _enter_json_container(value: list[JsonValue] | dict[str, JsonValue], active: set[int]) -> int:
    marker = id(value)
    if marker in active:
        raise ValueError("Generator provenance parameters must not contain cycles.")
    active.add(marker)
    return marker


def _construction_failure(path: ProjectPath, error: Exception) -> Diagnostic:
    if isinstance(error, RecursionError):
        detail = "Generator provenance parameter nesting is too deep."
    elif isinstance(error, ValidationError):
        detail = _strict_validation_detail(error)
    else:
        detail = str(error).strip() or "The supplied clip values are invalid."
    return Diagnostic(
        code=ANIMATION_BUILD_FAILURE_CODE,
        severity=Severity.ERROR,
        message=f"Animation clip construction failed: {detail}",
        path=path,
        location="clip",
        suggestion="Correct the clip metadata and typed animation values, then rebuild it.",
    )


def _strict_validation_detail(error: ValidationError) -> str:
    field = "clip"
    errors = error.errors(include_url=False, include_input=False)
    if errors:
        location = errors[0]["loc"]
        top_level = location[0] if location else None
        if isinstance(top_level, str) and top_level in _SAFE_STRICT_VALIDATION_FIELDS:
            field = top_level
    return f"Strict typed validation rejected the '{field}' field."


__all__ = [
    "ANIMATION_BUILD_FAILURE_CODE",
    "AnimationClipBuildRequest",
    "AnimationClipBuilder",
]
