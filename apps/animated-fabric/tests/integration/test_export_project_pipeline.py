"""AF-050/AF-051 acceptance coverage for the real project export pipeline."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from animated_fabric.application.export_service import ExportProject, ExportProjectRequest
from animated_fabric.application.generate_animation import (
    GenerateAnimation,
    GenerateAnimationRequest,
)
from animated_fabric.domain.export import (
    FRAME_SEQUENCE_FORMAT,
    FRAME_SEQUENCE_SCHEMA_VERSION,
    FrameSequenceMetadata,
    GridSpritesheetMetadata,
)
from animated_fabric.domain.geometry import IntSize
from animated_fabric.domain.project import Direction
from animated_fabric.domain.validation import ProjectValidator
from animated_fabric.generators import BuiltinAnimationGeneratorRegistry
from animated_fabric.infrastructure.exporters import (
    FrameSequenceExporter,
    GridSpritesheetExporter,
)
from animated_fabric.infrastructure.imaging import OpenCvRenderer
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from scripts.run_rig_application_demo import run_rig_application_demo


def _export_tree(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file())
    }


def test_real_project_generates_and_exports_deterministic_idle_sequences(
    tmp_path: Path,
) -> None:
    demo_root = tmp_path / "rig_demo"
    run_rig_application_demo(demo_root)
    project_root = demo_root / "imported_project"
    repository = JsonProjectRepository()
    validator = ProjectValidator()

    generated = GenerateAnimation(
        repository,
        BuiltinAnimationGeneratorRegistry(),
        validator,
    ).execute(
        GenerateAnimationRequest(
            project_root=project_root,
            generator_id="humanoid_idle_v1",
            clip_id="short_idle",
            parameters={"duration_ms": 200},
        )
    )

    assert generated.value is not None, generated.diagnostics
    assert not generated.has_errors
    assert generated.value.clip.duration_ms == 200

    exporter = ExportProject(
        repository,
        repository,
        validator,
        FrameSequenceExporter(OpenCvRenderer()),
    )
    destinations = (tmp_path / "published_a", tmp_path / "published_b")
    results = tuple(
        exporter.execute(
            ExportProjectRequest(
                project_root=project_root,
                destination=destination,
                animation_ids=("short_idle",),
                directions=(Direction.SE, Direction.NE),
                fps=10,
                allow_clipping=True,
            )
        )
        for destination in destinations
    )

    assert all(result.value is not None for result in results), tuple(
        result.diagnostics for result in results
    )
    assert all(not result.has_errors for result in results)
    expected_files = {
        "short_idle/animation.json",
        "short_idle/SE/000.png",
        "short_idle/SE/001.png",
        "short_idle/NE/000.png",
        "short_idle/NE/001.png",
    }
    first_tree = _export_tree(destinations[0])
    second_tree = _export_tree(destinations[1])
    assert set(first_tree) == expected_files
    assert second_tree == first_tree

    metadata = FrameSequenceMetadata.model_validate_json(first_tree["short_idle/animation.json"])
    project = repository.load(project_root)
    assert metadata.format == FRAME_SEQUENCE_FORMAT
    assert metadata.schema_version == FRAME_SEQUENCE_SCHEMA_VERSION
    assert metadata.project == project.slug
    assert metadata.animation == "short_idle"
    assert metadata.frame_size == IntSize(width=192, height=192)
    assert metadata.origin == project.canvas.ground_anchor
    assert metadata.fps == 10
    assert metadata.duration_ms == 200
    assert metadata.directions == (Direction.SE, Direction.NE)
    assert metadata.frames_per_direction == 2
    assert len(metadata.frames) == 4
    assert sum(frame.duration_ms for frame in metadata.frames[:2]) == 200
    assert sum(frame.duration_ms for frame in metadata.frames[2:]) == 200

    for relative_path in sorted(expected_files - {"short_idle/animation.json"}):
        with Image.open(destinations[0] / relative_path) as frame:
            frame.load()
            assert frame.format == "PNG"
            assert frame.mode == "RGBA"
            assert frame.size == (192, 192)


def test_real_grid_cells_match_shared_renderer_frame_export_exactly(tmp_path: Path) -> None:
    demo_root = tmp_path / "rig_demo"
    run_rig_application_demo(demo_root)
    project_root = demo_root / "imported_project"
    repository = JsonProjectRepository()
    validator = ProjectValidator()
    generated = GenerateAnimation(
        repository,
        BuiltinAnimationGeneratorRegistry(),
        validator,
    ).execute(
        GenerateAnimationRequest(
            project_root=project_root,
            generator_id="humanoid_idle_v1",
            clip_id="short_idle",
            parameters={"duration_ms": 200},
        )
    )
    assert generated.value is not None, generated.diagnostics

    sequence_destination = tmp_path / "sequences"
    grid_destination = tmp_path / "grids"
    request_values = {
        "project_root": project_root,
        "animation_ids": ("short_idle",),
        "directions": (Direction.NE, Direction.SE),
        "fps": 10,
        "allow_clipping": True,
    }
    sequence = ExportProject(
        repository,
        repository,
        validator,
        FrameSequenceExporter(OpenCvRenderer()),
    ).execute(ExportProjectRequest(destination=sequence_destination, **request_values))
    grid = ExportProject(
        repository,
        repository,
        validator,
        GridSpritesheetExporter(OpenCvRenderer()),
    ).execute(ExportProjectRequest(destination=grid_destination, **request_values))

    assert sequence.value is not None, sequence.diagnostics
    assert grid.value is not None, grid.diagnostics
    sequence_metadata = FrameSequenceMetadata.model_validate_json(
        (sequence_destination / "short_idle" / "animation.json").read_bytes()
    )
    grid_metadata = GridSpritesheetMetadata.model_validate_json(
        (grid_destination / "short_idle.spritesheet.json").read_bytes()
    )
    assert grid_metadata.directions == sequence_metadata.directions
    assert grid_metadata.frames_per_direction == sequence_metadata.frames_per_direction
    assert [frame.duration_ms for frame in grid_metadata.frames] == [
        frame.duration_ms for frame in sequence_metadata.frames
    ]
    assert [frame.events for frame in grid_metadata.frames] == [
        frame.events for frame in sequence_metadata.frames
    ]

    with Image.open(grid_destination / "short_idle.png") as sheet:
        sheet.load()
        for grid_frame, sequence_frame in zip(
            grid_metadata.frames,
            sequence_metadata.frames,
            strict=True,
        ):
            x, y, width, height = grid_frame.rect
            with Image.open(sequence_destination / "short_idle" / sequence_frame.image) as frame:
                frame.load()
                assert sheet.crop((x, y, x + width, y + height)).tobytes() == frame.tobytes()
