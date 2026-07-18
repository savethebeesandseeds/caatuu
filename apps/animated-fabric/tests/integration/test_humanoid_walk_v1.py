"""Visible AF-042 proof on the owned, fully applied humanoid fixture."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from animated_fabric.application.rendering import RenderedFrame, RenderProject, RenderRequest
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.animation_evaluator import AnimationEvaluator, EvaluatedAnimation
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationInput
from animated_fabric.domain.validation.models import AnimationDocument
from animated_fabric.generators import HumanoidWalkV1Generator, HumanoidWalkV1Parameters
from animated_fabric.infrastructure.imaging import OpenCvRenderer
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from scripts.run_walk_animation_demo import run_walk_animation_demo, walk_frame_name

_DURATION_MS = 800
_QUARTER_TIMES = (0, 200, 400, 600)
_TRACKED_BONES = (
    "pelvis",
    "torso",
    "head",
    "upper_arm_l",
    "upper_arm_r",
    "thigh_l",
    "thigh_r",
    "shin_l",
    "shin_r",
    "foot_l",
    "foot_r",
)
_GOLDEN_ROOT = Path(__file__).parents[1] / "golden"
_GOLDEN_NAMES = {
    (Direction.SE, 0): "af042_humanoid_walk_se_t0000.png",
    (Direction.SE, 200): "af042_humanoid_walk_se_t0200.png",
    (Direction.SE, 400): "af042_humanoid_walk_se_t0400.png",
    (Direction.NE, 0): "af042_humanoid_walk_ne_t0000.png",
    (Direction.NE, 200): "af042_humanoid_walk_ne_t0200.png",
    (Direction.NE, 400): "af042_humanoid_walk_ne_t0400.png",
}


@dataclass(frozen=True, slots=True)
class _WalkDemo:
    output_root: Path
    project: RenderProject
    rig: RigDefinition
    assets: tuple[AssetLayer, ...]
    clip: AnimationClip
    outputs: dict[tuple[Direction, int], Path]


@pytest.fixture(scope="module")
def walk_demo(tmp_path_factory: pytest.TempPathFactory) -> _WalkDemo:
    output_root = tmp_path_factory.mktemp("af042") / "walk_demo"
    outputs = run_walk_animation_demo(output_root)
    project_root = output_root / "imported_project"
    repository = JsonProjectRepository()
    manifest = repository.load(project_root)
    rig = repository.load_rig(project_root, manifest.rig_path)
    catalog = repository.load_layer_manifest(project_root)
    project = RenderProject(
        root=project_root,
        manifest=manifest,
        assets={asset.asset_id: asset for asset in catalog.layers},
    )
    clip = HumanoidWalkV1Generator().generate(rig, HumanoidWalkV1Parameters())
    return _WalkDemo(
        output_root=output_root,
        project=project,
        rig=rig,
        assets=catalog.layers,
        clip=clip,
        outputs=outputs,
    )


def _project_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _png_rgba(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        assert image.format == "PNG"
        assert image.mode == "RGBA"
        assert image.size == (192, 192)
        return np.asarray(image, dtype=np.uint8).copy()


def _frame_rgba(frame: RenderedFrame) -> np.ndarray:
    return np.frombuffer(frame.rgba, dtype=np.uint8).reshape((192, 192, 4)).copy()


def _render(
    renderer: OpenCvRenderer,
    demo: _WalkDemo,
    direction: Direction,
    time_ms: float,
    *,
    include_events: bool = False,
) -> RenderedFrame:
    return renderer.render(
        RenderRequest(
            project=demo.project,
            rig=demo.rig,
            clip=demo.clip,
            direction=direction,
            time_ms=time_ms,
            include_events=include_events,
        )
    )


def _assert_delta(
    animation: EvaluatedAnimation,
    bone_id: str,
    *,
    x: float = 0.0,
    y: float = 0.0,
    rotation: float = 0.0,
) -> None:
    delta = animation.bone_deltas[bone_id]
    assert delta.position.x == pytest.approx(x)
    assert delta.position.y == pytest.approx(y)
    assert delta.rotation_deg == pytest.approx(rotation)
    assert delta.scale.x == pytest.approx(1.0)
    assert delta.scale.y == pytest.approx(1.0)


def _assert_matches_reviewed_golden(actual: np.ndarray, expected_path: Path) -> None:
    assert expected_path.is_file(), (
        f"Missing reviewed AF-042 golden: {expected_path}. "
        "Run `python scripts/run_walk_animation_demo.py --out .tmp/af042-walk`, "
        "inspect all eight candidates, and copy the six documented samples deliberately."
    )
    expected = _png_rgba(expected_path)
    difference = np.abs(actual.astype(np.int16) - expected.astype(np.int16))
    pixels_outside_tolerance = np.any(difference > 2, axis=2)

    assert int(difference.max()) <= 2
    changed_fraction = (
        float(np.count_nonzero(pixels_outside_tolerance)) / pixels_outside_tolerance.size
    )
    assert changed_fraction <= 0.001
    np.testing.assert_array_equal(actual[..., 3], expected[..., 3])
    np.testing.assert_array_equal(actual[..., 3] > 0, expected[..., 3] > 0)


def test_walk_demo_renders_all_authored_quarters_without_publishing_clip(
    walk_demo: _WalkDemo,
) -> None:
    expected_keys = {
        (direction, time_ms)
        for direction in (Direction.SE, Direction.NE)
        for time_ms in _QUARTER_TIMES
    }

    assert set(walk_demo.outputs) == expected_keys
    for (direction, time_ms), path in walk_demo.outputs.items():
        assert path.parent == walk_demo.output_root / "frames"
        assert path.name == walk_frame_name(direction, time_ms)
        rgba = _png_rgba(path)
        assert int(rgba[..., 3].min()) == 0
        assert int(rgba[..., 3].max()) == 255
        assert np.count_nonzero(rgba[..., 3]) > 0

    assert walk_demo.project.manifest.animation_paths == ()
    assert not tuple(walk_demo.project.root.rglob("*.animated-clip.json"))


def test_default_walk_is_valid_deterministic_and_project_read_only(
    walk_demo: _WalkDemo,
) -> None:
    before = _project_bytes(walk_demo.project.root)
    repeated = HumanoidWalkV1Generator().generate(
        walk_demo.rig,
        HumanoidWalkV1Parameters(),
    )

    assert repeated == walk_demo.clip
    assert repeated.model_dump_json() == walk_demo.clip.model_dump_json()
    diagnostics = ProjectValidator().validate(
        ValidationInput(
            manifest=walk_demo.project.manifest,
            rig=walk_demo.rig,
            animations=(
                AnimationDocument(
                    path="animations/walk.animated-clip.json",
                    clip=walk_demo.clip,
                ),
            ),
            assets=walk_demo.assets,
        )
    )
    assert not [item for item in diagnostics if item.severity.value == "error"]
    assert tuple((event.time_ms, event.event) for event in walk_demo.clip.events) == (
        (0, "foot_contact_l"),
        (400, "foot_contact_r"),
    )
    assert _project_bytes(walk_demo.project.root) == before


def test_default_walk_event_schedule_does_not_change_pixels(walk_demo: _WalkDemo) -> None:
    expected_events = {
        0: ("foot_contact_l",),
        200: (),
        400: ("foot_contact_r",),
        600: (),
        800: ("foot_contact_l",),
        1000: (),
        1200: ("foot_contact_r",),
    }
    renderer = OpenCvRenderer()

    for direction in (Direction.SE, Direction.NE):
        for time_ms, events in expected_events.items():
            included = _render(
                renderer,
                walk_demo,
                direction,
                float(time_ms),
                include_events=True,
            )
            hidden = _render(renderer, walk_demo, direction, float(time_ms))

            assert included.active_events == events
            assert hidden.active_events == ()
            np.testing.assert_array_equal(_frame_rgba(included), _frame_rgba(hidden))


def test_default_walk_is_periodic_distinct_and_unclipped(walk_demo: _WalkDemo) -> None:
    assert walk_demo.clip.duration_ms == _DURATION_MS
    before = _project_bytes(walk_demo.project.root)
    renderer = OpenCvRenderer()

    for direction in (Direction.SE, Direction.NE):
        frames = {
            time_ms: _render(
                renderer,
                walk_demo,
                direction,
                float(time_ms),
                include_events=True,
            )
            for time_ms in (*_QUARTER_TIMES, 700, 800, 1000, 1200)
        }

        assert frames[0] == frames[800]
        assert frames[200] == frames[1000]
        assert frames[400] == frames[1200]
        assert frames[200].rgba != frames[600].rgba
        assert frames[700].rgba != frames[600].rgba
        assert frames[700].rgba != frames[0].rgba

        for frame in frames.values():
            assert len(frame.rgba) == 192 * 192 * 4
            assert not frame.clipping.is_clipped
        for time_ms in _QUARTER_TIMES:
            np.testing.assert_array_equal(
                _frame_rgba(frames[time_ms]),
                _png_rgba(walk_demo.outputs[direction, time_ms]),
            )

    assert _project_bytes(walk_demo.project.root) == before


def test_default_walk_has_exact_gait_and_one_lifted_foot(walk_demo: _WalkDemo) -> None:
    evaluator = AnimationEvaluator()
    poses = {
        time_ms: evaluator.evaluate(
            walk_demo.clip,
            walk_demo.rig,
            Direction.SE,
            float(time_ms),
        )
        for time_ms in (*_QUARTER_TIMES, 700)
    }

    for time_ms in (0, 400):
        for bone_id in _TRACKED_BONES:
            _assert_delta(poses[time_ms], bone_id)

    first_lift = poses[200]
    _assert_delta(first_lift, "thigh_l", rotation=18.0)
    _assert_delta(first_lift, "thigh_r", rotation=-18.0)
    _assert_delta(first_lift, "upper_arm_l", rotation=-12.0)
    _assert_delta(first_lift, "upper_arm_r", rotation=12.0)
    _assert_delta(first_lift, "pelvis", x=1.0, rotation=2.0)
    _assert_delta(first_lift, "torso", y=-2.0)
    _assert_delta(first_lift, "head", rotation=-1.5)
    _assert_delta(first_lift, "shin_l", rotation=-12.0)
    _assert_delta(first_lift, "shin_r")
    _assert_delta(first_lift, "foot_l", y=-2.0)
    _assert_delta(first_lift, "foot_r")

    second_lift = poses[600]
    _assert_delta(second_lift, "thigh_l", rotation=-18.0)
    _assert_delta(second_lift, "thigh_r", rotation=18.0)
    _assert_delta(second_lift, "upper_arm_l", rotation=12.0)
    _assert_delta(second_lift, "upper_arm_r", rotation=-12.0)
    _assert_delta(second_lift, "pelvis", x=-1.0, rotation=-2.0)
    _assert_delta(second_lift, "torso", y=-2.0)
    _assert_delta(second_lift, "head", rotation=1.5)
    _assert_delta(second_lift, "shin_l")
    _assert_delta(second_lift, "shin_r", rotation=-12.0)
    _assert_delta(second_lift, "foot_l")
    _assert_delta(second_lift, "foot_r", y=-2.0)

    closing = poses[700]
    _assert_delta(closing, "thigh_l", rotation=-9.0)
    _assert_delta(closing, "thigh_r", rotation=9.0)
    _assert_delta(closing, "upper_arm_l", rotation=6.0)
    _assert_delta(closing, "upper_arm_r", rotation=-6.0)
    _assert_delta(closing, "pelvis", x=-0.5, rotation=-1.0)
    _assert_delta(closing, "torso", y=-1.0)
    _assert_delta(closing, "head", rotation=0.75)
    _assert_delta(closing, "shin_l")
    _assert_delta(closing, "shin_r", rotation=-6.0)
    _assert_delta(closing, "foot_l")
    _assert_delta(closing, "foot_r", y=-1.0)

    assert [
        foot_id
        for foot_id in ("foot_l", "foot_r")
        if first_lift.bone_deltas[foot_id].position.y < 0.0
    ] == ["foot_l"]
    assert [
        foot_id
        for foot_id in ("foot_l", "foot_r")
        if second_lift.bone_deltas[foot_id].position.y < 0.0
    ] == ["foot_r"]


@pytest.mark.parametrize(
    ("direction", "time_ms", "golden_name"),
    tuple(
        (direction, time_ms, golden_name)
        for (direction, time_ms), golden_name in _GOLDEN_NAMES.items()
    ),
)
def test_default_walk_matches_reviewed_golden(
    walk_demo: _WalkDemo,
    direction: Direction,
    time_ms: int,
    golden_name: str,
) -> None:
    actual = _png_rgba(walk_demo.outputs[direction, time_ms])
    _assert_matches_reviewed_golden(actual, _GOLDEN_ROOT / golden_name)
