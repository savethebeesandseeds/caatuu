"""Generate and render the AF-042 humanoid walk animation on the owned fixture."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from animated_fabric.domain.exceptions import AnimatedFabricError
from animated_fabric.domain.project import Direction
from animated_fabric.generators import HumanoidWalkV1Generator, HumanoidWalkV1Parameters

if __package__:
    from scripts._humanoid_animation_demo import run_quarter_phase_animation_demo
else:
    from _humanoid_animation_demo import run_quarter_phase_animation_demo


def walk_frame_name(direction: Direction, time_ms: int) -> str:
    """Return the stable candidate filename for one rendered walk sample."""
    return f"af042_humanoid_walk_{direction.value.lower()}_t{time_ms:04d}.png"


def run_walk_animation_demo(output_root: Path) -> dict[tuple[Direction, int], Path]:
    """Build the owned full rig and render the default walk clip without publishing it."""
    return run_quarter_phase_animation_demo(
        output_root,
        ticket_id="AF-042",
        animation_name="walk",
        clip_factory=lambda rig: HumanoidWalkV1Generator().generate(
            rig, HumanoidWalkV1Parameters()
        ),
        frame_name=walk_frame_name,
        include_events=True,
    )


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser for the visible walk proof."""
    parser = argparse.ArgumentParser(
        description="Generate and render the deterministic AF-042 humanoid walk demo."
    )
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Fresh output directory for the imported project and walk frames.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Render the visible proof and report every authored quarter-phase frame."""
    arguments = build_parser().parse_args(argv)
    try:
        outputs = run_walk_animation_demo(arguments.out)
    except AnimatedFabricError as error:
        print(f"AF-042 walk demo failed: {error}")
        return 3
    for (direction, time_ms), destination in outputs.items():
        print(f"Rendered walk {direction.value} at {time_ms} ms to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
