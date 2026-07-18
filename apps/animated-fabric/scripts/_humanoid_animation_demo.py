"""Shared private runner for owned humanoid animation demos."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from animated_fabric.application import RenderFrame, RenderProject, RenderRequest
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.exceptions import AnimationError, RenderError
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.infrastructure.imaging import OpenCvRenderer, PngFrameWriter
from animated_fabric.infrastructure.persistence import JsonProjectRepository

if __package__:
    from scripts.run_rig_application_demo import run_rig_application_demo
else:
    from run_rig_application_demo import run_rig_application_demo

_AUTHORED_DIRECTIONS = (Direction.SE, Direction.NE)
_QUARTER_PHASES = (0, 1, 2, 3)

type ClipFactory = Callable[[RigDefinition], AnimationClip]
type FrameNameFactory = Callable[[Direction, int], str]


def _file_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def run_quarter_phase_animation_demo(
    output_root: Path,
    *,
    ticket_id: str,
    animation_name: str,
    clip_factory: ClipFactory,
    frame_name: FrameNameFactory,
    include_events: bool = False,
) -> dict[tuple[Direction, int], Path]:
    """Render an in-memory clip over the owned full rig without changing its project."""
    run_rig_application_demo(output_root)
    project_root = output_root / "imported_project"
    repository = JsonProjectRepository()
    manifest = repository.load(project_root)
    if manifest.animation_paths:
        raise AnimationError(f"The {ticket_id} owned demo project must start without animations.")
    rig = repository.load_rig(project_root, manifest.rig_path)
    catalog = repository.load_layer_manifest(project_root)
    project = RenderProject(
        root=project_root,
        manifest=manifest,
        assets={asset.asset_id: asset for asset in catalog.layers},
    )
    project_files = _file_bytes(project_root)

    clip = clip_factory(rig)
    sample_times = tuple(clip.duration_ms * phase // 4 for phase in _QUARTER_PHASES)
    renderer = RenderFrame(OpenCvRenderer())
    writer = PngFrameWriter()
    outputs: dict[tuple[Direction, int], Path] = {}

    for direction in _AUTHORED_DIRECTIONS:
        for time_ms in sample_times:
            rendered = renderer.execute(
                RenderRequest(
                    project=project,
                    rig=rig,
                    clip=clip,
                    direction=direction,
                    time_ms=float(time_ms),
                    include_events=include_events,
                )
            )
            if rendered.value is None:
                detail = (
                    rendered.diagnostics[0].message if rendered.diagnostics else "no frame returned"
                )
                raise RenderError(f"{ticket_id} {animation_name} demo rendering failed: {detail}")
            destination = output_root / "frames" / frame_name(direction, time_ms)
            writer.write_project_frame(destination, rendered.value, project)
            outputs[(direction, time_ms)] = destination

    if _file_bytes(project_root) != project_files:
        raise AnimationError(f"The in-memory {ticket_id} demo unexpectedly changed project files.")
    return outputs


__all__ = ["run_quarter_phase_animation_demo"]
