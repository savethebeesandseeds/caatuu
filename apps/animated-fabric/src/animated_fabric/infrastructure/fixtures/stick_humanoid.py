"""Transient render adapter for the repository-owned geometric humanoid fixture."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError

from animated_fabric.application.rendering import RenderProject
from animated_fabric.domain._base import ProjectPath, Sha256Digest
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import (
    ProjectValidationError,
    ProjectVersionError,
    RenderError,
)
from animated_fabric.domain.geometry import IntPoint, IntSize
from animated_fabric.domain.project import Direction, ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.infrastructure.persistence import JsonProjectRepository

CANVAS_SIZE = (192, 192)
GROUND_ANCHOR = (96, 160)
FIXTURE_ID = "stick_humanoid"
TEMPLATE_ID = "humanoid_v1"
DIRECTIONS = ("SE", "NE")
PART_NAMES = (
    "torso",
    "head",
    "upper_arm_l",
    "lower_arm_l",
    "hand_l",
    "upper_arm_r",
    "lower_arm_r",
    "hand_r",
    "thigh_l",
    "shin_l",
    "foot_l",
    "thigh_r",
    "shin_r",
    "foot_r",
)
SE_DRAW_ORDER = (
    "thigh_l",
    "shin_l",
    "foot_l",
    "upper_arm_l",
    "lower_arm_l",
    "hand_l",
    "thigh_r",
    "shin_r",
    "foot_r",
    "torso",
    "upper_arm_r",
    "lower_arm_r",
    "hand_r",
    "head",
)
NE_DRAW_ORDER = (
    "thigh_r",
    "shin_r",
    "foot_r",
    "upper_arm_r",
    "lower_arm_r",
    "hand_r",
    "thigh_l",
    "shin_l",
    "foot_l",
    "torso",
    "upper_arm_l",
    "lower_arm_l",
    "hand_l",
    "head",
)
FIXTURE_MANIFEST_FILENAME = "fixture_manifest.json"

_FixturePart = Annotated[
    str,
    StringConstraints(strict=True, pattern=r"^[a-z][a-z0-9_]*$"),
]


class _FixtureCanvas(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    width: int
    height: int
    ground_anchor: tuple[int, int]


class _FixtureLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    direction: Literal["SE", "NE"]
    part: _FixturePart
    path: ProjectPath
    sha256: Sha256Digest


class _FixtureManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["0.1.0"]
    fixture_id: Literal["stick_humanoid"]
    template_id: Literal["humanoid_v1"]
    canvas: _FixtureCanvas
    directions: tuple[Literal["SE", "NE"], ...]
    layers: tuple[_FixtureLayer, ...]


@dataclass(frozen=True, slots=True)
class LoadedFixtureProject:
    """Runtime project aggregate and rig loaded for one owned fixture root."""

    project: RenderProject
    rig: RigDefinition


def build_stick_humanoid_manifest() -> ProjectManifest:
    """Build the canonical project document used by the generated fixture root."""
    payload = {
        "format": "animated-fabric.project.v1",
        "schema_version": "0.1.0",
        "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
        "slug": FIXTURE_ID,
        "display_name": "Stick Humanoid Fixture",
        "template_id": TEMPLATE_ID,
        "canvas": {
            "width": CANVAS_SIZE[0],
            "height": CANVAS_SIZE[1],
            "ground_anchor": list(GROUND_ANCHOR),
            "pixel_snap": "none",
        },
        "directions": {
            "SE": {"mode": "authored"},
            "SW": {"mode": "mirror", "source": "SE"},
            "NE": {"mode": "authored"},
            "NW": {"mode": "mirror", "source": "NE"},
        },
        "rig_path": "rig/main.animated-rig.json",
        "animation_paths": [],
        "export_profiles": [],
        "selection_ellipse": {
            "center_offset": [0.0, -2.0],
            "radius_x": 20.0,
            "radius_y": 9.0,
        },
    }
    return ProjectManifest.model_validate_json(json.dumps(payload))


def build_stick_humanoid_rig() -> RigDefinition:
    """Build the minimal identity rig used only to exercise the complete renderer."""
    se_order = {part_name: index for index, part_name in enumerate(SE_DRAW_ORDER)}
    ne_order = {part_name: index for index, part_name in enumerate(NE_DRAW_ORDER)}
    parts = [
        {
            "part_id": part_name,
            "semantic_part": part_name,
            "bone_id": "root",
            "assets_by_direction": {
                "SE": f"se_{part_name}",
                "NE": f"ne_{part_name}",
            },
            "pivot_by_direction": {"SE": [0.0, 0.0], "NE": [0.0, 0.0]},
            "draw_slot": "body",
            "slot_order": se_order[part_name],
        }
        for part_name in PART_NAMES
    ]
    payload = {
        "format": "animated-fabric.rig.v1",
        "schema_version": "0.1.0",
        "rig_id": "fixture_neutral",
        "template_id": TEMPLATE_ID,
        "bones": [{"bone_id": "root"}],
        "parts": parts,
        "sockets": [
            {
                "socket_id": "head_hat",
                "bone_id": "root",
                "local_transform": {"position": [96.0, 31.0]},
                "default_draw_slot": "body",
            },
            {
                "socket_id": "hand_r_weapon",
                "bone_id": "root",
                "local_transform": {"position": [132.0, 113.0]},
                "default_draw_slot": "body",
            },
        ],
        "direction_profiles": {"NE": {"slot_order": ne_order}},
        "draw_slot_profiles": {"SE": ["body"], "NE": ["body"]},
    }
    return RigDefinition.model_validate_json(json.dumps(payload))


def write_stick_humanoid_project(
    root: Path,
    repository: JsonProjectRepository | None = None,
) -> None:
    """Atomically publish canonical project and rig documents beside fixture assets."""
    adapter = repository or JsonProjectRepository()
    manifest = build_stick_humanoid_manifest()
    adapter.save(root, manifest)
    adapter.save_rig(root, manifest.rig_path, build_stick_humanoid_rig())


def load_stick_humanoid_project(
    root: Path,
    repository: JsonProjectRepository | None = None,
) -> LoadedFixtureProject:
    """Load the generated fixture as a transient render project without importer behavior."""
    adapter = repository or JsonProjectRepository()
    try:
        manifest = adapter.load(root)
        rig = adapter.load_rig(root, manifest.rig_path)
    except (ProjectValidationError, ProjectVersionError) as error:
        raise RenderError(str(error)) from error

    fixture = _load_fixture_manifest(root)
    _validate_fixture_identity(fixture, manifest, rig)
    assets = _build_asset_catalog(fixture)
    return LoadedFixtureProject(
        project=RenderProject(root=root, manifest=manifest, assets=assets),
        rig=rig,
    )


def _load_fixture_manifest(root: Path) -> _FixtureManifest:
    try:
        resolved_root = root.resolve(strict=True)
        candidate = (resolved_root / FIXTURE_MANIFEST_FILENAME).resolve(strict=True)
    except (FileNotFoundError, OSError, RuntimeError) as error:
        raise RenderError(
            "The project is not a generated stick_humanoid fixture; "
            f"'{FIXTURE_MANIFEST_FILENAME}' is unavailable."
        ) from error
    if (
        not resolved_root.is_dir()
        or not candidate.is_file()
        or not candidate.is_relative_to(resolved_root)
    ):
        raise RenderError("The owned fixture manifest is not a safe project-local file.")
    try:
        return _FixtureManifest.model_validate_json(candidate.read_bytes())
    except (OSError, ValidationError) as error:
        raise RenderError("The owned fixture manifest is invalid or unreadable.") from error


def _validate_fixture_identity(
    fixture: _FixtureManifest,
    manifest: ProjectManifest,
    rig: RigDefinition,
) -> None:
    if fixture.directions != DIRECTIONS:
        raise RenderError("The owned fixture must declare authored directions SE and NE.")
    if fixture.canvas.width != CANVAS_SIZE[0] or fixture.canvas.height != CANVAS_SIZE[1]:
        raise RenderError("The owned fixture canvas must be 192 x 192 pixels.")
    if fixture.canvas.ground_anchor != GROUND_ANCHOR:
        raise RenderError("The owned fixture ground anchor does not match its project.")
    if manifest.slug != FIXTURE_ID or manifest.template_id != fixture.template_id:
        raise RenderError(
            "The project document does not describe the owned stick_humanoid fixture."
        )
    if (
        manifest.canvas.width != fixture.canvas.width
        or manifest.canvas.height != fixture.canvas.height
        or manifest.canvas.ground_anchor.x != fixture.canvas.ground_anchor[0]
        or manifest.canvas.ground_anchor.y != fixture.canvas.ground_anchor[1]
    ):
        raise RenderError("The fixture manifest and project canvas metadata disagree.")
    if rig.template_id != fixture.template_id:
        raise RenderError("The fixture rig template does not match the generated project.")


def _build_asset_catalog(fixture: _FixtureManifest) -> dict[str, AssetLayer]:
    expected = {(direction, part_name) for direction in DIRECTIONS for part_name in PART_NAMES}
    records: dict[tuple[str, str], _FixtureLayer] = {}
    for record in fixture.layers:
        key = (record.direction, record.part)
        if key in records:
            raise RenderError(
                f"The owned fixture declares layer '{record.direction}/{record.part}' twice."
            )
        if key not in expected:
            raise RenderError(
                f"The owned fixture declares unexpected layer '{record.direction}/{record.part}'."
            )
        expected_path = f"source/layers/{record.direction}/{record.part}.png"
        if record.path != expected_path:
            raise RenderError(
                f"Fixture layer '{record.direction}/{record.part}' must use '{expected_path}'."
            )
        records[key] = record
    missing = sorted(expected - set(records))
    if missing:
        direction, part_name = missing[0]
        raise RenderError(f"The owned fixture is missing layer '{direction}/{part_name}'.")

    assets: dict[str, AssetLayer] = {}
    for direction_text in DIRECTIONS:
        direction = Direction(direction_text)
        for part_name in PART_NAMES:
            record = records[(direction_text, part_name)]
            asset_id = f"{direction_text.lower()}_{part_name}"
            assets[asset_id] = AssetLayer(
                asset_id=asset_id,
                direction=direction,
                semantic_part=part_name,
                path=record.path,
                source_canvas_size=IntSize(width=CANVAS_SIZE[0], height=CANVAS_SIZE[1]),
                trim_origin=IntPoint(x=0, y=0),
                trim_size=IntSize(width=CANVAS_SIZE[0], height=CANVAS_SIZE[1]),
                sha256=record.sha256,
            )
    return assets


__all__ = [
    "CANVAS_SIZE",
    "DIRECTIONS",
    "FIXTURE_ID",
    "GROUND_ANCHOR",
    "PART_NAMES",
    "LoadedFixtureProject",
    "build_stick_humanoid_manifest",
    "build_stick_humanoid_rig",
    "load_stick_humanoid_project",
    "write_stick_humanoid_project",
]
