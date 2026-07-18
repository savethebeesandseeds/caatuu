"""Generate and render the AF-041 humanoid idle animation on the owned fixture."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from animated_fabric.domain.exceptions import AnimatedFabricError
from animated_fabric.domain.project import Direction
from animated_fabric.generators import HumanoidIdleV1Generator, HumanoidIdleV1Parameters

if __package__:
    from scripts._humanoid_animation_demo import run_quarter_phase_animation_demo
else:
    from _humanoid_animation_demo import run_quarter_phase_animation_demo


def idle_frame_name(direction: Direction, time_ms: int) -> str:
    """Return the stable candidate filename for one rendered idle sample."""
    return f"af041_humanoid_idle_{direction.value.lower()}_t{time_ms:04d}.png"


def run_idle_animation_demo(output_root: Path) -> dict[tuple[Direction, int], Path]:
    """Build the owned full rig and render the default idle clip without publishing it."""
    return run_quarter_phase_animation_demo(
        output_root,
        ticket_id="AF-041",
        animation_name="idle",
        clip_factory=lambda rig: HumanoidIdleV1Generator().generate(
            rig, HumanoidIdleV1Parameters()
        ),
        frame_name=idle_frame_name,
    )


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser for the visible idle proof."""
    parser = argparse.ArgumentParser(
        description="Generate and render the deterministic AF-041 humanoid idle demo."
    )
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Fresh output directory for the imported project and idle frames.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Render the visible proof and report every authored quarter-phase frame."""
    arguments = build_parser().parse_args(argv)
    try:
        outputs = run_idle_animation_demo(arguments.out)
    except AnimatedFabricError as error:
        print(f"AF-041 idle demo failed: {error}")
        return 3
    for (direction, time_ms), destination in outputs.items():
        print(f"Rendered idle {direction.value} at {time_ms} ms to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
