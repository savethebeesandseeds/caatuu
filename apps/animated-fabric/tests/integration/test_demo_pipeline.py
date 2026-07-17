"""End-to-end and golden coverage for the AF-023 owned neutral fixture."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from animated_fabric.domain.project import Direction
from scripts.run_demo_pipeline import run_demo_pipeline

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
GOLDEN_ROOT = REPOSITORY_ROOT / "tests" / "golden"
GOLDEN_NAMES = {
    Direction.SE: "af023_stick_humanoid_neutral_se.png",
    Direction.NE: "af023_stick_humanoid_neutral_ne.png",
}


def _rgba(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        assert image.format == "PNG"
        assert image.mode == "RGBA"
        assert image.size == (192, 192)
        return np.asarray(image, dtype=np.uint8).copy()


def test_demo_pipeline_produces_byte_deterministic_authored_frames(tmp_path: Path) -> None:
    first = run_demo_pipeline(tmp_path / "first")
    second = run_demo_pipeline(tmp_path / "second")

    assert tuple(first) == (Direction.SE, Direction.NE)
    assert tuple(second) == (Direction.SE, Direction.NE)
    for direction, expected_name in GOLDEN_NAMES.items():
        assert first[direction].name == expected_name.removeprefix("af023_")
        assert first[direction].read_bytes() == second[direction].read_bytes()
        frame = _rgba(first[direction])
        assert int(frame[..., 3].min()) == 0
        assert int(frame[..., 3].max()) == 255
        assert np.count_nonzero(frame[..., 3]) > 0

    assert not tuple(tmp_path.rglob("*.tmp"))


def test_demo_script_renders_both_authored_directions(tmp_path: Path) -> None:
    output_root = tmp_path / "demo-cli"

    completed = subprocess.run(
        [
            sys.executable,
            str(REPOSITORY_ROOT / "scripts" / "run_demo_pipeline.py"),
            "--out",
            str(output_root),
        ],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert "Rendered neutral SE fixture" in completed.stdout
    assert "Rendered neutral NE fixture" in completed.stdout
    for expected_name in GOLDEN_NAMES.values():
        assert (output_root / "frames" / expected_name.removeprefix("af023_")).is_file()


@pytest.mark.parametrize("direction", (Direction.SE, Direction.NE))
def test_neutral_fixture_matches_reviewed_golden(
    tmp_path: Path,
    direction: Direction,
) -> None:
    expected_path = GOLDEN_ROOT / GOLDEN_NAMES[direction]
    assert expected_path.is_file(), (
        f"Missing reviewed AF-023 golden: {expected_path}. "
        "Generate a candidate through the demo pipeline and review it before committing."
    )
    actual_path = run_demo_pipeline(tmp_path / direction.value.lower())[direction]

    expected = _rgba(expected_path)
    actual = _rgba(actual_path)
    difference = np.abs(actual.astype(np.int16) - expected.astype(np.int16))
    pixels_outside_tolerance = np.any(difference > 2, axis=2)

    assert int(difference.max()) <= 2
    assert (
        float(np.count_nonzero(pixels_outside_tolerance)) / pixels_outside_tolerance.size <= 0.001
    )
    np.testing.assert_array_equal(actual[..., 3], expected[..., 3])
    np.testing.assert_array_equal(actual[..., 3] > 0, expected[..., 3] > 0)
