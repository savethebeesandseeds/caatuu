"""Generate and render the AF-041 humanoid idle animation on the owned fixture."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from animated_fabric.application import RenderFrame, RenderProject, RenderRequest
from animated_fabric.domain.exceptions import AnimatedFabricError, AnimationError, RenderError
from animated_fabric.domain.project import Direction
from animated_fabric.generators import HumanoidIdleV1Generator, HumanoidIdleV1Parameters
from animated_fabric.infrastructure.imaging import OpenCvRenderer, PngFrameWriter
from animated_fabric.infrastructure.persistence import JsonProjectRepository

if __package__:
    from scripts.run_rig_application_demo import run_rig_application_demo
else:
    from run_rig_application_demo import run_rig_application_demo

AUTHORED_DIRECTIONS = (Direction.SE, Direction.NE)
QUARTER_PHASES = (0, 1, 2, 3)


def _file_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def idle_frame_name(direction: Direction, time_ms: int) -> str:
    """Return the stable candidate filename for one rendered idle sample."""
    return f"af041_humanoid_idle_{direction.value.lower()}_t{time_ms:04d}.png"


def run_idle_animation_demo(output_root: Path) -> dict[tuple[Direction, int], Path]:
    """Build the owned full rig and render the default idle clip without publishing it."""
    run_rig_application_demo(output_root)
    project_root = output_root / "imported_project"
    repository = JsonProjectRepository()
    manifest = repository.load(project_root)
    if manifest.animation_paths:
        raise AnimationError("The AF-041 owned demo project must start without animations.")
    rig = repository.load_rig(project_root, manifest.rig_path)
    catalog = repository.load_layer_manifest(project_root)
    project = RenderProject(
        root=project_root,
        manifest=manifest,
        assets={asset.asset_id: asset for asset in catalog.layers},
    )
    project_files = _file_bytes(project_root)

    parameters = HumanoidIdleV1Parameters()
    clip = HumanoidIdleV1Generator().generate(rig, parameters)
    sample_times = tuple(clip.duration_ms * phase // 4 for phase in QUARTER_PHASES)
    renderer = RenderFrame(OpenCvRenderer())
    writer = PngFrameWriter()
    outputs: dict[tuple[Direction, int], Path] = {}

    for direction in AUTHORED_DIRECTIONS:
        for time_ms in sample_times:
            rendered = renderer.execute(
                RenderRequest(
                    project=project,
                    rig=rig,
                    clip=clip,
                    direction=direction,
                    time_ms=float(time_ms),
                )
            )
            if rendered.value is None:
                detail = (
                    rendered.diagnostics[0].message if rendered.diagnostics else "no frame returned"
                )
                raise RenderError(f"AF-041 idle demo rendering failed: {detail}")
            destination = output_root / "frames" / idle_frame_name(direction, time_ms)
            writer.write_project_frame(destination, rendered.value, project)
            outputs[(direction, time_ms)] = destination

    if _file_bytes(project_root) != project_files:
        raise AnimationError("The in-memory AF-041 demo unexpectedly changed project files.")
    return outputs


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
