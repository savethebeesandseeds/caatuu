"""AF-040 integration proofs for normalized clips, persistence, and rendering."""

from __future__ import annotations

from pathlib import Path

import pytest

from animated_fabric.application.animation_clip_builder import (
    AnimationClipBuilder,
    AnimationClipBuildRequest,
)
from animated_fabric.application.rendering import RenderedFrame, RenderRequest
from animated_fabric.domain.animation import (
    AnimationClip,
    AnimationEvent,
    AnimationTrack,
    GeneratorProvenance,
    Interpolation,
    Keyframe,
    TargetType,
    TrackProperty,
)
from animated_fabric.domain.animation_evaluator import AnimationEvaluator
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationInput
from animated_fabric.domain.validation.models import AnimationDocument
from animated_fabric.infrastructure.fixtures import (
    LoadedFixtureProject,
    load_stick_humanoid_project,
)
from animated_fabric.infrastructure.imaging import OpenCvRenderer
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from scripts.generate_fixture_assets import generate_fixture_assets

_CLIP_PATH = "animations/loop_probe.animated-clip.json"


@pytest.fixture()
def fixture_project(tmp_path: Path) -> LoadedFixtureProject:
    root = generate_fixture_assets(tmp_path / "generated")
    return load_stick_humanoid_project(root)


def _key(time_ms: int, value: float) -> Keyframe:
    return Keyframe(
        time_ms=time_ms,
        value=value,
        interpolation=Interpolation.LINEAR,
    )


def _request(
    rig: RigDefinition,
    keys: tuple[Keyframe, ...],
    *,
    events: tuple[AnimationEvent, ...] = (),
) -> AnimationClipBuildRequest:
    return AnimationClipBuildRequest(
        rig=rig,
        diagnostic_path=_CLIP_PATH,
        clip_id="loop_probe",
        display_name="Loop probe",
        duration_ms=1000,
        loop=True,
        fps_hint=12,
        tracks=(
            AnimationTrack(
                target_type=TargetType.BONE,
                target_id="root",
                property=TrackProperty.POSITION_X,
                keys=keys,
            ),
        ),
        events=events,
        generator_provenance=GeneratorProvenance(
            generator_id="loop_probe_v1",
            parameters={"amplitude_px": 8.0, "duration_ms": 1000},
        ),
    )


def _build(request: AnimationClipBuildRequest) -> AnimationClip:
    result = AnimationClipBuilder().build(request)

    assert result.value is not None, result.diagnostics
    assert not result.has_errors
    return result.value


def _unordered_keys() -> tuple[Keyframe, ...]:
    return (_key(750, 8.0), _key(0, 0.0))


def _ordered_keys() -> tuple[Keyframe, ...]:
    return (_key(0, 0.0), _key(750, 8.0))


def _events() -> tuple[AnimationEvent, ...]:
    return (
        AnimationEvent(time_ms=750, event="foot_contact_r"),
        AnimationEvent(time_ms=250, event="blink"),
        AnimationEvent(time_ms=750, event="foot_contact_l"),
    )


def _file_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def test_builder_normalizes_generator_keys_and_passes_existing_project_validation(
    fixture_project: LoadedFixtureProject,
) -> None:
    source_keys = _unordered_keys()
    source_dump = tuple(key.model_dump(mode="json") for key in source_keys)

    clip = _build(_request(fixture_project.rig, source_keys, events=_events()))

    assert tuple(key.time_ms for key in clip.tracks[0].keys) == (0, 750, 1000)
    assert clip.tracks[0].keys[-1].value == clip.tracks[0].keys[0].value
    assert tuple((event.time_ms, event.event) for event in clip.events) == (
        (250, "blink"),
        (750, "foot_contact_r"),
        (750, "foot_contact_l"),
    )
    assert tuple(key.model_dump(mode="json") for key in source_keys) == source_dump

    diagnostics = ProjectValidator().validate(
        ValidationInput(
            manifest=fixture_project.project.manifest,
            rig=fixture_project.rig,
            animations=(AnimationDocument(path=_CLIP_PATH, clip=clip),),
            assets=tuple(fixture_project.project.assets.values()),
        )
    )
    assert diagnostics == ()

    final_quarter = AnimationEvaluator().evaluate(
        clip,
        fixture_project.rig,
        Direction.SE,
        875.0,
    )
    assert final_quarter.bone_deltas["root"].position.x == pytest.approx(4.0)


def test_built_clip_round_trips_canonically_without_changing_project_inputs(
    fixture_project: LoadedFixtureProject,
) -> None:
    first = _build(_request(fixture_project.rig, _unordered_keys(), events=_events()))
    equivalent = _build(_request(fixture_project.rig, _ordered_keys(), events=_events()))
    assert first == equivalent

    root = fixture_project.project.root
    repository = JsonProjectRepository()
    before = _file_bytes(root)
    first_path = _CLIP_PATH
    equivalent_path = "animations/loop_probe_equivalent.animated-clip.json"

    repository.save_animation(root, first_path, first)
    first_bytes = (root / first_path).read_bytes()
    repository.save_animation(root, equivalent_path, equivalent)

    assert repository.load_animation(root, first_path) == first
    assert repository.load_animation(root, equivalent_path) == equivalent
    assert (root / equivalent_path).read_bytes() == first_bytes

    repository.save_animation(root, first_path, repository.load_animation(root, first_path))
    assert (root / first_path).read_bytes() == first_bytes
    assert not list((root / "animations").glob(".*.tmp"))

    after = _file_bytes(root)
    assert set(after) == set(before) | {first_path, equivalent_path}
    assert {path: after[path] for path in before} == before


def test_built_clip_renders_repeatably_and_exposes_stable_requested_events(
    fixture_project: LoadedFixtureProject,
) -> None:
    clip = _build(_request(fixture_project.rig, _unordered_keys(), events=_events()))
    equivalent = _build(_request(fixture_project.rig, _ordered_keys(), events=_events()))
    eventless = _build(_request(fixture_project.rig, _ordered_keys()))
    renderer = OpenCvRenderer()

    def render(
        animation: AnimationClip | None,
        time_ms: float,
        *,
        include_events: bool = True,
    ) -> RenderedFrame:
        return renderer.render(
            RenderRequest(
                project=fixture_project.project,
                rig=fixture_project.rig,
                clip=animation,
                direction=Direction.SE,
                time_ms=time_ms,
                include_events=include_events,
            )
        )

    neutral = render(None, 750.0)
    animated = render(clip, 750.0)
    repeated = render(clip, 750.0)
    equivalent_frame = render(equivalent, 750.0)
    eventless_frame = render(eventless, 750.0)
    events_hidden = render(clip, 750.0, include_events=False)

    assert animated.rgba != neutral.rgba
    assert repeated == animated
    assert equivalent_frame == animated
    assert animated.active_events == ("foot_contact_r", "foot_contact_l")
    assert eventless_frame.active_events == ()
    assert eventless_frame.rgba == animated.rgba
    assert events_hidden.active_events == ()
    assert events_hidden.rgba == animated.rgba

    at_zero = render(clip, 0.0)
    at_duration = render(clip, 1000.0)
    assert at_duration == at_zero
