"""AF-050 tests for deterministic frame sampling and export transports."""

from __future__ import annotations

from pathlib import Path

import pytest

from animated_fabric.application.exporting import (
    MAX_EXPORT_FPS,
    MAX_EXPORT_FRAMES,
    MAX_EXPORT_RAW_BYTES,
    AnimationExportResult,
    CancellationToken,
    ExportRequest,
    ExportResult,
    FrameSample,
    build_frame_schedule,
)
from animated_fabric.application.rendering import RenderProject
from animated_fabric.domain.animation import AnimationClip, AnimationEvent
from animated_fabric.domain.geometry import Vec2
from animated_fabric.domain.project import CanvasDefinition, Direction
from animated_fabric.infrastructure.fixtures import (
    build_stick_humanoid_manifest,
    build_stick_humanoid_rig,
)


def _clip(
    *,
    duration_ms: int = 1000,
    loop: bool = True,
    events: tuple[AnimationEvent, ...] = (),
    clip_id: str = "walk",
) -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id=clip_id,
        display_name=clip_id.title(),
        template_id="humanoid_v1",
        duration_ms=duration_ms,
        loop=loop,
        fps_hint=12,
        events=events,
    )


@pytest.mark.parametrize(
    ("duration_ms", "expected_count"),
    [(10, 1), (30, 2), (50, 2)],
)
def test_frame_count_uses_exact_half_to_even_rounding(
    duration_ms: int,
    expected_count: int,
) -> None:
    assert len(build_frame_schedule(_clip(duration_ms=duration_ms), 50)) == expected_count


def test_schedule_has_no_duplicate_endpoint_and_durations_sum_exactly() -> None:
    schedule = build_frame_schedule(_clip(), 3)

    assert [sample.index for sample in schedule] == [0, 1, 2]
    assert [sample.time_ms for sample in schedule] == pytest.approx(
        [0.0, 1000.0 / 3.0, 2000.0 / 3.0]
    )
    assert all(sample.time_ms < 1000.0 for sample in schedule)
    assert [sample.duration_ms for sample in schedule] == [333, 333, 334]
    assert sum(sample.duration_ms for sample in schedule) == 1000


def test_events_are_binned_into_half_open_frame_intervals_in_authored_order() -> None:
    events = tuple(
        AnimationEvent(time_ms=time_ms, event=event)
        for time_ms, event in (
            (0, "start"),
            (249, "before_boundary"),
            (250, "at_boundary"),
            (999, "before_end"),
            (1000, "at_end"),
            (1001, "after_end"),
        )
    )

    schedule = build_frame_schedule(_clip(events=events), 4)

    assert [sample.events for sample in schedule] == [
        ("start", "before_boundary", "at_end"),
        ("at_boundary",),
        (),
        ("before_end",),
    ]


def test_non_looping_endpoint_event_belongs_to_last_frame() -> None:
    schedule = build_frame_schedule(
        _clip(
            loop=False,
            events=(AnimationEvent(time_ms=1000, event="at_end"),),
        ),
        4,
    )

    assert schedule[-1].events == ("at_end",)


@pytest.mark.parametrize("fps", [0, -1, MAX_EXPORT_FPS + 1])
def test_schedule_rejects_fps_outside_resource_limit(fps: int) -> None:
    with pytest.raises(ValueError, match="FPS"):
        build_frame_schedule(_clip(), fps)


def test_schedule_rejects_boolean_fps_and_excessive_frame_count() -> None:
    with pytest.raises(TypeError, match="FPS"):
        build_frame_schedule(_clip(), True)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match=str(MAX_EXPORT_FRAMES)):
        build_frame_schedule(_clip(duration_ms=20_000), MAX_EXPORT_FPS)


def test_frame_sample_normalizes_time_and_rejects_mutable_events() -> None:
    sample = FrameSample(index=0, time_ms=5, duration_ms=10, events=("blink",))

    assert sample.time_ms == 5.0
    assert type(sample.time_ms) is float
    with pytest.raises(TypeError, match="immutable tuple"):
        FrameSample(index=0, time_ms=0.0, duration_ms=1, events=["blink"])  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "arguments",
    [
        {"index": -1, "time_ms": 0.0, "duration_ms": 1},
        {"index": 0, "time_ms": float("nan"), "duration_ms": 1},
        {"index": 0, "time_ms": 0.0, "duration_ms": 0},
    ],
)
def test_frame_sample_rejects_invalid_scalar_values(arguments: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        FrameSample(**arguments)  # type: ignore[arg-type]


class _Cancellation:
    def is_cancelled(self) -> bool:
        return False


def _request(
    tmp_path: Path,
    *,
    animations: tuple[AnimationClip, ...] | None = None,
    directions: tuple[Direction, ...] = (Direction.SE,),
    fps: int = 12,
    canvas: CanvasDefinition | None = None,
) -> ExportRequest:
    manifest = build_stick_humanoid_manifest()
    if canvas is not None:
        manifest = manifest.model_copy(update={"canvas": canvas})
    return ExportRequest(
        project=RenderProject(root=tmp_path, manifest=manifest, assets={}),
        rig=build_stick_humanoid_rig(),
        animations=(_clip(),) if animations is None else animations,
        directions=directions,
        fps=fps,
        destination=tmp_path / "exports" / "actor",
        cancellation=_Cancellation(),
    )


def test_export_request_accepts_typed_cancellation_and_stable_order(tmp_path: Path) -> None:
    request = _request(
        tmp_path,
        animations=(_clip(clip_id="idle"), _clip(clip_id="walk")),
        directions=(Direction.SE, Direction.NE),
    )

    assert isinstance(request.cancellation, CancellationToken)
    assert tuple(clip.clip_id for clip in request.animations) == ("idle", "walk")
    assert request.directions == (Direction.SE, Direction.NE)


def test_export_request_rejects_mutable_collections_and_untyped_options(tmp_path: Path) -> None:
    valid = _request(tmp_path)

    with pytest.raises(TypeError, match="animations.*tuple"):
        ExportRequest(
            project=valid.project,
            rig=valid.rig,
            animations=[_clip()],  # type: ignore[arg-type]
            directions=valid.directions,
            fps=valid.fps,
            destination=valid.destination,
        )
    with pytest.raises(TypeError, match="directions.*tuple"):
        ExportRequest(
            project=valid.project,
            rig=valid.rig,
            animations=valid.animations,
            directions=[Direction.SE],  # type: ignore[arg-type]
            fps=valid.fps,
            destination=valid.destination,
        )
    with pytest.raises(TypeError, match="destination"):
        ExportRequest(
            project=valid.project,
            rig=valid.rig,
            animations=valid.animations,
            directions=valid.directions,
            fps=valid.fps,
            destination="exports/actor",  # type: ignore[arg-type]
        )
    with pytest.raises(TypeError, match="allow_clipping"):
        ExportRequest(
            project=valid.project,
            rig=valid.rig,
            animations=valid.animations,
            directions=valid.directions,
            fps=valid.fps,
            destination=valid.destination,
            allow_clipping=1,  # type: ignore[arg-type]
        )
    with pytest.raises(TypeError, match="CancellationToken"):
        ExportRequest(
            project=valid.project,
            rig=valid.rig,
            animations=valid.animations,
            directions=valid.directions,
            fps=valid.fps,
            destination=valid.destination,
            cancellation=object(),  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    ("animations", "directions", "message"),
    [
        ((), (Direction.SE,), "non-empty"),
        ((_clip(),), (), "non-empty"),
        ((_clip(), _clip()), (Direction.SE,), "duplicate clip"),
        ((_clip(),), (Direction.SE, Direction.SE), "duplicates"),
    ],
)
def test_export_request_rejects_empty_or_duplicate_selections(
    tmp_path: Path,
    animations: tuple[AnimationClip, ...],
    directions: tuple[Direction, ...],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        _request(tmp_path, animations=animations, directions=directions)


def test_export_request_limits_total_frames(tmp_path: Path) -> None:
    clips = tuple(_clip(duration_ms=10_000, clip_id=f"clip_{index}") for index in range(2))

    with pytest.raises(ValueError, match="total frames"):
        _request(
            tmp_path,
            animations=clips,
            directions=(Direction.SE, Direction.NE),
            fps=120,
        )


def test_export_request_limits_raw_rgba_size(tmp_path: Path) -> None:
    large_canvas = CanvasDefinition(
        width=2048,
        height=2048,
        ground_anchor=Vec2(x=1024.0, y=1800.0),
    )

    with pytest.raises(ValueError, match=str(MAX_EXPORT_RAW_BYTES)):
        _request(tmp_path, fps=33, canvas=large_canvas)


def test_export_results_require_typed_non_empty_paths(tmp_path: Path) -> None:
    animation = AnimationExportResult(
        animation="walk",
        frame_count=1,
        metadata_path=tmp_path / "walk" / "animation.json",
        frame_paths=(tmp_path / "walk" / "SE" / "000.png",),
    )
    result = ExportResult(destination=tmp_path, animations=(animation,))

    assert result.animations == (animation,)
    with pytest.raises(ValueError, match="at least one"):
        ExportResult(destination=tmp_path, animations=())


def test_export_results_reject_invalid_transport_values(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="animation ID"):
        AnimationExportResult(
            animation="",
            frame_count=1,
            metadata_path=tmp_path / "animation.json",
            frame_paths=(tmp_path / "000.png",),
        )
    with pytest.raises(ValueError, match="frame count"):
        AnimationExportResult(
            animation="walk",
            frame_count=0,
            metadata_path=tmp_path / "animation.json",
            frame_paths=(tmp_path / "000.png",),
        )
    with pytest.raises(TypeError, match="frame paths.*tuple"):
        AnimationExportResult(
            animation="walk",
            frame_count=1,
            metadata_path=tmp_path / "animation.json",
            frame_paths=[tmp_path / "000.png"],  # type: ignore[arg-type]
        )
    with pytest.raises(TypeError, match="destination"):
        ExportResult(destination="exports", animations=())  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="animations.*tuple"):
        ExportResult(destination=tmp_path, animations=[])  # type: ignore[arg-type]
