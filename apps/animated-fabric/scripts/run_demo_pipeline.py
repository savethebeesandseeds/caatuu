"""Generate and render the owned neutral-pose fixture through the production pipeline."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from animated_fabric.application import RenderFrame, RenderRequest
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.project import Direction
from animated_fabric.infrastructure.fixtures import load_stick_humanoid_project
from animated_fabric.infrastructure.imaging import OpenCvRenderer, PngFrameWriter

if __package__:
    from scripts.generate_fixture_assets import generate_fixture_assets
else:
    from generate_fixture_assets import generate_fixture_assets


def run_demo_pipeline(output_root: Path) -> dict[Direction, Path]:
    """Generate the fixture and atomically render its authored neutral directions."""
    fixture_root = generate_fixture_assets(output_root)
    loaded = load_stick_humanoid_project(fixture_root)
    use_case = RenderFrame(OpenCvRenderer())
    writer = PngFrameWriter()
    frames_root = output_root / "frames"
    outputs: dict[Direction, Path] = {}

    for direction in (Direction.SE, Direction.NE):
        result = use_case.execute(
            RenderRequest(
                project=loaded.project,
                rig=loaded.rig,
                clip=None,
                direction=direction,
                time_ms=0.0,
            )
        )
        if result.value is None:
            message = (
                result.diagnostics[0].message
                if result.diagnostics
                else "The renderer returned no frame."
            )
            raise RenderError(message)
        destination = frames_root / f"stick_humanoid_neutral_{direction.value.lower()}.png"
        writer.write_project_frame(destination, result.value, loaded.project)
        outputs[direction] = destination
    return outputs


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate and render the deterministic Animated Fabric demo fixture."
    )
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Output directory for generated fixture files and rendered frames.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        outputs = run_demo_pipeline(arguments.out)
    except RenderError as error:
        print(f"Render failed: {error}")
        return 4
    for direction in (Direction.SE, Direction.NE):
        print(f"Rendered neutral {direction.value} fixture to {outputs[direction]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
