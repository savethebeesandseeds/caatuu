"""AF-023 tests for complete neutral-frame OpenCV orchestration."""

from __future__ import annotations

from pathlib import Path

import pytest

from animated_fabric.application.rendering import Renderer, RenderRequest
from animated_fabric.domain.animation import AnimationClip, AnimationEvent
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.geometry import IntSize, Vec2
from animated_fabric.domain.project import Direction
from animated_fabric.domain.transforms import transform_point
from animated_fabric.infrastructure.fixtures import load_stick_humanoid_project
from animated_fabric.infrastructure.imaging import OpenCvRenderer
from scripts.generate_fixture_assets import generate_fixture_assets


@pytest.fixture()
def fixture_project(tmp_path: Path):  # type: ignore[no-untyped-def]
    root = generate_fixture_assets(tmp_path)
    return load_stick_humanoid_project(root)


def _request(fixture_project, direction: Direction, **updates: object) -> RenderRequest:  # type: ignore[no-untyped-def]
    arguments: dict[str, object] = {
        "project": fixture_project.project,
        "rig": fixture_project.rig,
        "clip": None,
        "direction": direction,
        "time_ms": 0,
    }
    arguments.update(updates)
    return RenderRequest(**arguments)  # type: ignore[arg-type]


def test_neutral_authored_frames_preserve_metadata_and_repeat_exact_pixels(
    fixture_project,
) -> None:  # type: ignore[no-untyped-def]
    renderer = OpenCvRenderer()

    first_se = renderer.render(_request(fixture_project, Direction.SE))
    second_se = renderer.render(_request(fixture_project, Direction.SE))
    ne = renderer.render(_request(fixture_project, Direction.NE))

    assert isinstance(renderer, Renderer)
    assert first_se == second_se
    assert first_se.canvas_size == IntSize(width=192, height=192)
    assert len(first_se.rgba) == 192 * 192 * 4
    assert first_se.ground_anchor == Vec2(x=96.0, y=160.0)
    assert set(first_se.resolved_sockets) == {"head_hat", "hand_r_weapon"}
    assert transform_point(
        first_se.resolved_sockets["head_hat"],
        Vec2(x=0.0, y=0.0),
    ) == Vec2(x=96.0, y=31.0)
    assert first_se.active_events == ()
    assert not first_se.clipping.is_clipped
    assert first_se.rgba != ne.rgba
    assert renderer.asset_cache.entry_count == 28
    assert renderer.computation_cache.topology_entry_count == 1


def test_renderer_rejects_complete_frame_mirroring_until_af052(fixture_project) -> None:  # type: ignore[no-untyped-def]
    renderer = OpenCvRenderer()

    with pytest.raises(RenderError, match="mirrored.*AF-052"):
        renderer.render(_request(fixture_project, Direction.SW))

    assert renderer.asset_cache.entry_count == 0


def test_renderer_reports_events_only_when_requested_at_normalized_time(
    fixture_project,
) -> None:  # type: ignore[no-untyped-def]
    clip = AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id="event_probe",
        display_name="Event probe",
        template_id="humanoid_v1",
        duration_ms=1000,
        loop=True,
        fps_hint=12,
        events=(
            AnimationEvent(time_ms=250, event="footstep"),
            AnimationEvent(time_ms=500, event="sound:step"),
        ),
    )
    renderer = OpenCvRenderer()

    included = renderer.render(
        _request(
            fixture_project,
            Direction.SE,
            clip=clip,
            time_ms=1250,
            include_events=True,
        )
    )
    excluded = renderer.render(
        _request(
            fixture_project,
            Direction.SE,
            clip=clip,
            time_ms=1250,
            include_events=False,
        )
    )

    assert included.active_events == ("footstep",)
    assert excluded.active_events == ()
    assert included.rgba == excluded.rgba
    assert renderer.computation_cache.evaluation_entry_count == 1
