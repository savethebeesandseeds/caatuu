"""Visible AF-041 proof on the owned, fully applied humanoid fixture."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from animated_fabric.application.rendering import RenderedFrame, RenderProject, RenderRequest
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.animation_evaluator import AnimationEvaluator
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import AnimationError
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationInput
from animated_fabric.domain.validation.models import AnimationDocument
from animated_fabric.generators import HumanoidIdleV1Generator, HumanoidIdleV1Parameters
from animated_fabric.infrastructure.imaging import OpenCvRenderer
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from scripts.run_idle_animation_demo import idle_frame_name, run_idle_animation_demo

_DURATION_MS = 2000
_QUARTER_TIMES = (0, 500, 1000, 1500)
_GOLDEN_ROOT = Path(__file__).parents[1] / "golden"
_GOLDEN_NAMES = {
    (Direction.SE, 0): "af041_humanoid_idle_se_t0000.png",
    (Direction.SE, 500): "af041_humanoid_idle_se_t0500.png",
    (Direction.NE, 0): "af041_humanoid_idle_ne_t0000.png",
    (Direction.NE, 500): "af041_humanoid_idle_ne_t0500.png",
}


@dataclass(frozen=True, slots=True)
class _IdleDemo:
    output_root: Path
    project: RenderProject
    rig: RigDefinition
    assets: tuple[AssetLayer, ...]
    clip: AnimationClip
    outputs: dict[tuple[Direction, int], Path]


@pytest.fixture(scope="module")
def idle_demo(tmp_path_factory: pytest.TempPathFactory) -> _IdleDemo:
    output_root = tmp_path_factory.mktemp("af041") / "idle_demo"
    outputs = run_idle_animation_demo(output_root)
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
    clip = HumanoidIdleV1Generator().generate(rig, HumanoidIdleV1Parameters())
    return _IdleDemo(
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
    demo: _IdleDemo,
    direction: Direction,
    time_ms: float,
    clip: AnimationClip | None,
) -> RenderedFrame:
    return renderer.render(
        RenderRequest(
            project=demo.project,
            rig=demo.rig,
            clip=clip,
            direction=direction,
            time_ms=time_ms,
        )
    )


def _assert_matches_reviewed_golden(actual: np.ndarray, expected_path: Path) -> None:
    assert expected_path.is_file(), (
        f"Missing reviewed AF-041 golden: {expected_path}. "
        "Run `python scripts/run_idle_animation_demo.py --out .tmp/af041-idle`, "
        "inspect the candidate, and copy it deliberately."
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


def test_idle_demo_renders_all_authored_quarters_without_publishing_clip(
    idle_demo: _IdleDemo,
) -> None:
    expected_keys = {
        (direction, time_ms)
        for direction in (Direction.SE, Direction.NE)
        for time_ms in _QUARTER_TIMES
    }

    assert set(idle_demo.outputs) == expected_keys
    for (direction, time_ms), path in idle_demo.outputs.items():
        assert path.name == idle_frame_name(direction, time_ms)
        rgba = _png_rgba(path)
        assert int(rgba[..., 3].min()) == 0
        assert int(rgba[..., 3].max()) == 255
        assert np.count_nonzero(rgba[..., 3]) > 0

    assert idle_demo.project.manifest.animation_paths == ()
    assert not tuple(idle_demo.project.root.rglob("*.animated-clip.json"))


def test_idle_demo_rejects_any_project_file_change(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_root = tmp_path / "idle_demo_tampered"
    original_generate = HumanoidIdleV1Generator.generate

    def generate_and_tamper(
        generator: HumanoidIdleV1Generator,
        rig: RigDefinition,
        parameters: HumanoidIdleV1Parameters,
    ) -> AnimationClip:
        clip = original_generate(generator, rig, parameters)
        manifest_path = output_root / "imported_project/project.animated-fabric.json"
        manifest_path.write_bytes(manifest_path.read_bytes() + b"\n")
        return clip

    monkeypatch.setattr(HumanoidIdleV1Generator, "generate", generate_and_tamper)

    with pytest.raises(AnimationError, match="unexpectedly changed project files"):
        run_idle_animation_demo(output_root)


def test_default_idle_is_valid_deterministic_and_project_read_only(
    idle_demo: _IdleDemo,
) -> None:
    before = _project_bytes(idle_demo.project.root)
    repeated = HumanoidIdleV1Generator().generate(
        idle_demo.rig,
        HumanoidIdleV1Parameters(),
    )

    assert repeated == idle_demo.clip
    assert repeated.model_dump_json() == idle_demo.clip.model_dump_json()
    diagnostics = ProjectValidator().validate(
        ValidationInput(
            manifest=idle_demo.project.manifest,
            rig=idle_demo.rig,
            animations=(
                AnimationDocument(
                    path="animations/idle.animated-clip.json",
                    clip=idle_demo.clip,
                ),
            ),
            assets=idle_demo.assets,
        )
    )
    assert not [item for item in diagnostics if item.severity.value == "error"]
    assert idle_demo.clip.events == ()
    assert _project_bytes(idle_demo.project.root) == before


def test_default_idle_renders_deterministically_periodically_and_without_clipping(
    idle_demo: _IdleDemo,
) -> None:
    assert idle_demo.clip.duration_ms == _DURATION_MS
    renderer = OpenCvRenderer()

    for direction in (Direction.SE, Direction.NE):
        neutral = _render(renderer, idle_demo, direction, 0.0, None)
        frames = {
            time_ms: _render(
                renderer,
                idle_demo,
                direction,
                float(time_ms),
                idle_demo.clip,
            )
            for time_ms in (*_QUARTER_TIMES, 1750, 2000, 2500)
        }

        assert frames[0] == frames[2000]
        assert frames[500] == frames[2500]
        assert _render(renderer, idle_demo, direction, 500.0, idle_demo.clip) == frames[500]
        assert frames[0].rgba != neutral.rgba
        assert frames[500].rgba != neutral.rgba
        assert frames[1750].rgba != frames[1500].rgba
        assert frames[1750].rgba != frames[0].rgba

        for time_ms in (*_QUARTER_TIMES, 1750):
            frame = frames[time_ms]
            assert len(frame.rgba) == 192 * 192 * 4
            assert not frame.clipping.is_clipped
            assert frame.active_events == ()
        for time_ms in _QUARTER_TIMES:
            np.testing.assert_array_equal(
                _frame_rgba(frames[time_ms]),
                _png_rgba(idle_demo.outputs[direction, time_ms]),
            )

    closing = AnimationEvaluator().evaluate(
        idle_demo.clip,
        idle_demo.rig,
        Direction.SE,
        1750.0,
    )
    assert closing.bone_deltas["torso"].position.y == pytest.approx(-0.75)


@pytest.mark.parametrize(
    ("direction", "time_ms", "golden_name"),
    tuple(
        (direction, time_ms, golden_name)
        for (direction, time_ms), golden_name in _GOLDEN_NAMES.items()
    ),
)
def test_default_idle_matches_reviewed_golden(
    idle_demo: _IdleDemo,
    direction: Direction,
    time_ms: int,
    golden_name: str,
) -> None:
    actual = _png_rgba(idle_demo.outputs[direction, time_ms])
    _assert_matches_reviewed_golden(actual, _GOLDEN_ROOT / golden_name)
