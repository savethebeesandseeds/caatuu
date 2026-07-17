"""Import, rig, render, and visualize the AF-032 humanoid fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

from animated_fabric.application import (
    ApplyRigTemplate,
    ApplyRigTemplateRequest,
    ImportLayerSet,
    LayerAssignment,
    LayerImportRequest,
    RenderFrame,
    RenderProject,
    RenderRequest,
)
from animated_fabric.domain.exceptions import AssetImportError, RenderError, RigDefinitionError
from animated_fabric.domain.geometry import Vec2
from animated_fabric.domain.pose import PoseResolver
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.transforms import transform_point
from animated_fabric.domain.validation import ProjectValidator, ValidationInput
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.imaging import OpenCvRenderer, PngFrameWriter
from animated_fabric.infrastructure.importing import FolderLayerImporter
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from animated_fabric.templates import JsonRigTemplateRegistry

if __package__:
    from scripts.generate_fixture_assets import generate_fixture_assets
else:
    from generate_fixture_assets import generate_fixture_assets


@dataclass(frozen=True, slots=True)
class RigDemoOutput:
    """Rendered neutral frame and its deterministic rig overlay."""

    frame: Path
    overlay: Path


def run_rig_application_demo(output_root: Path) -> dict[Direction, RigDemoOutput]:
    """Exercise import, template application, validation, and rendering end to end."""
    try:
        output_root.mkdir(parents=True, exist_ok=False)
        output_root = output_root.resolve(strict=True)
    except FileExistsError as error:
        raise AssetImportError("The AF-032 demo needs a fresh output root.") from error
    except (OSError, RuntimeError) as error:
        raise AssetImportError("The AF-032 demo output root is not accessible.") from error
    project_root = output_root / "imported_project"
    generated_root = generate_fixture_assets(output_root / "generated_source")
    repository = JsonProjectRepository()
    repository.save(project_root, build_stick_humanoid_manifest())
    importer = FolderLayerImporter(repository)
    for direction in (Direction.SE, Direction.NE):
        _import_fixture_direction(
            importer,
            repository,
            project_root,
            generated_root,
            direction,
        )

    applied = ApplyRigTemplate(
        repository,
        repository,
        JsonRigTemplateRegistry(),
        ProjectValidator(),
    ).execute(ApplyRigTemplateRequest(project_root=project_root))
    if applied.value is None:
        detail = applied.diagnostics[0].message if applied.diagnostics else "no rig returned"
        raise RigDefinitionError(f"AF-032 demo rig application failed: {detail}")

    project_manifest = repository.load(project_root)
    rig = repository.load_rig(project_root, project_manifest.rig_path)
    layer_manifest = repository.load_layer_manifest(project_root)
    validation = ProjectValidator().validate(
        ValidationInput(
            manifest=project_manifest,
            rig=rig,
            assets=layer_manifest.layers,
        )
    )
    errors = tuple(item for item in validation if item.severity.value == "error")
    if errors:
        raise RigDefinitionError(f"AF-032 demo rig validation failed: {errors[0].message}")

    project = RenderProject(
        root=project_root,
        manifest=project_manifest,
        assets={asset.asset_id: asset for asset in layer_manifest.layers},
    )
    renderer = RenderFrame(OpenCvRenderer())
    writer = PngFrameWriter()
    outputs: dict[Direction, RigDemoOutput] = {}
    summary: dict[str, object] = {
        "format": "animated-fabric.af032-demo.v1",
        "bones": len(rig.bones),
        "parts": len(rig.parts),
        "sockets": len(rig.sockets),
        "directions": {},
    }

    for direction in (Direction.SE, Direction.NE):
        rendered = renderer.execute(
            RenderRequest(
                project=project,
                rig=rig,
                clip=None,
                direction=direction,
                time_ms=0.0,
            )
        )
        if rendered.value is None:
            detail = (
                rendered.diagnostics[0].message if rendered.diagnostics else "no frame returned"
            )
            raise RenderError(f"AF-032 demo rendering failed: {detail}")

        frame_path = output_root / "frames" / f"imported_rig_neutral_{direction.value.lower()}.png"
        overlay_path = (
            output_root / "frames" / f"imported_rig_overlay_{direction.value.lower()}.png"
        )
        writer.write_project_frame(frame_path, rendered.value, project)
        _write_rig_overlay(overlay_path, rendered.value.rgba, rig, direction)
        outputs[direction] = RigDemoOutput(frame=frame_path, overlay=overlay_path)
        direction_summary = summary["directions"]
        assert isinstance(direction_summary, dict)
        direction_summary[direction.value] = {
            "frame": frame_path.relative_to(output_root).as_posix(),
            "frame_sha256": _sha256(frame_path),
            "overlay": overlay_path.relative_to(output_root).as_posix(),
            "overlay_sha256": _sha256(overlay_path),
        }

    _write_json(output_root / "af032_demo_manifest.json", summary)
    return outputs


def _import_fixture_direction(
    importer: FolderLayerImporter,
    repository: JsonProjectRepository,
    project_root: Path,
    generated_root: Path,
    direction: Direction,
) -> None:
    source = generated_root / "source" / "layers" / direction.value
    inspection = importer.inspect(source)
    if inspection.has_errors:
        raise AssetImportError(inspection.diagnostics[0].message)
    assignments = tuple(
        LayerAssignment(
            source_name=layer.source_name,
            semantic_part=_require_proposed_part(layer.source_name, layer.proposed_semantic_part),
        )
        for layer in inspection.layers
    )
    imported = ImportLayerSet(importer, repository).execute(
        LayerImportRequest(
            project_root=project_root,
            source=source,
            direction=direction,
            assignments=assignments,
            trim=True,
        )
    )
    if imported.value is None:
        detail = imported.diagnostics[0].message if imported.diagnostics else "no catalog returned"
        raise AssetImportError(f"AF-032 demo import failed: {detail}")


def _require_proposed_part(source_name: str, proposed_part: str | None) -> str:
    if proposed_part is None:
        raise AssetImportError(f"Fixture layer '{source_name}' has no semantic proposal.")
    return proposed_part


def _write_rig_overlay(
    destination: Path,
    rgba: bytes,
    rig: RigDefinition,
    direction: Direction,
) -> None:
    pose = PoseResolver().resolve(rig, direction)
    image = Image.frombytes("RGBA", (192, 192), rgba)
    draw = ImageDraw.Draw(image)
    origin = Vec2(x=0.0, y=0.0)
    joint_points = {
        bone_id: transform_point(matrix, origin)
        for bone_id, matrix in pose.bone_world_matrices.items()
    }
    for bone in rig.bones:
        if bone.parent_id is None:
            continue
        parent = joint_points[bone.parent_id]
        child = joint_points[bone.bone_id]
        draw.line((parent.x, parent.y, child.x, child.y), fill=(0, 240, 255, 255), width=2)
    for bone_id, point in joint_points.items():
        radius = 3 if bone_id == "root" else 2
        fill = (90, 255, 120, 255) if bone_id == "root" else (255, 245, 90, 255)
        draw.ellipse(
            (point.x - radius, point.y - radius, point.x + radius, point.y + radius),
            fill=fill,
            outline=(20, 25, 30, 255),
            width=1,
        )
    for matrix in pose.socket_matrices.values():
        point = transform_point(matrix, origin)
        draw.rectangle(
            (point.x - 2, point.y - 2, point.x + 2, point.y + 2),
            fill=(255, 70, 220, 255),
            outline=(20, 25, 30, 255),
            width=1,
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".png.tmp")
    image.save(temporary, format="PNG", optimize=False, compress_level=9, pnginfo=None)
    temporary.replace(destination)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_json(path: Path, document: dict[str, object]) -> None:
    payload = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(payload, encoding="utf-8", newline="\n")
    temporary.replace(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import, rig, render, and visualize the deterministic AF-032 fixture."
    )
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Fresh output directory for the imported project and rendered proof.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        outputs = run_rig_application_demo(arguments.out)
    except (AssetImportError, RenderError, RigDefinitionError) as error:
        print(f"AF-032 demo failed: {error}")
        return 3
    for direction in (Direction.SE, Direction.NE):
        output = outputs[direction]
        print(
            f"Rendered imported {direction.value} rig to {output.frame} "
            f"with overlay {output.overlay}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
