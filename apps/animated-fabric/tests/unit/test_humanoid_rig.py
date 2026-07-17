"""Unit tests for deterministic AF-032 humanoid rig construction."""

from __future__ import annotations

from animated_fabric.application.humanoid_rig import (
    RIG_TEMPLATE_AMBIGUOUS_PART_CODE,
    RIG_TEMPLATE_MISSING_PART_CODE,
    RIG_TEMPLATE_OPTIONAL_DIRECTION_CODE,
    HumanoidRigBuilder,
)
from animated_fabric.domain.assets import AssetLayer, LayerManifest
from animated_fabric.domain.geometry import IntPoint, IntSize, Vec2
from animated_fabric.domain.pose import PoseResolver
from animated_fabric.domain.project import Direction, ProjectManifest
from animated_fabric.domain.validation import resolve_draw_order
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.fixtures.stick_humanoid import (
    NE_DRAW_ORDER,
    SE_DRAW_ORDER,
)
from animated_fabric.templates import JsonRigTemplateRegistry

_DIGEST = "0" * 64


def _project(
    *,
    width: int = 192,
    height: int = 192,
    anchor: Vec2 | None = None,
) -> ProjectManifest:
    manifest = build_stick_humanoid_manifest()
    resolved_anchor = anchor or Vec2(x=96.0, y=160.0)
    canvas = manifest.canvas.model_copy(
        update={"width": width, "height": height, "ground_anchor": resolved_anchor}
    )
    return manifest.model_copy(update={"canvas": canvas})


def _asset(
    part_id: str,
    direction: Direction,
    project: ProjectManifest,
    *,
    semantic_part: str | None = None,
    optional: bool = False,
) -> AssetLayer:
    prefix = direction.value.lower()
    return AssetLayer(
        asset_id=f"{prefix}_{part_id}",
        direction=direction,
        semantic_part=semantic_part or part_id,
        path=f"source/layers/{direction.value}/{part_id}.png",
        source_canvas_size=IntSize(
            width=project.canvas.width,
            height=project.canvas.height,
        ),
        trim_origin=IntPoint(x=10, y=20),
        trim_size=IntSize(
            width=project.canvas.width - 10,
            height=project.canvas.height - 20,
        ),
        sha256=_DIGEST,
        optional=optional,
    )


def _catalog(
    project: ProjectManifest,
    *,
    additions: tuple[AssetLayer, ...] = (),
    omit: frozenset[tuple[str, Direction]] = frozenset(),
) -> LayerManifest:
    template = JsonRigTemplateRegistry().get("humanoid_v1")
    layers = [
        _asset(part.part_id, direction, project)
        for part in template.required_parts
        for direction in (Direction.SE, Direction.NE)
        if (part.part_id, direction) not in omit
    ]
    layers.extend(additions)
    return LayerManifest(
        format="animated-fabric.layer-manifest.v1",
        schema_version="0.1.0",
        layers=tuple(sorted(layers, key=lambda asset: asset.asset_id)),
    )


def _build(project: ProjectManifest, catalog: LayerManifest):
    template = JsonRigTemplateRegistry().get("humanoid_v1")
    return HumanoidRigBuilder().build(project, template, catalog)


def test_complete_catalog_builds_hierarchy_profiles_sockets_and_exact_neutral_pose() -> None:
    project = _project()
    catalog = _catalog(project)

    result = _build(project, catalog)

    assert result.value is not None
    assert not result.has_errors
    rig = result.value
    assert len(rig.bones) == 17
    assert tuple(bone.bone_id for bone in rig.bones) == (
        "root",
        "pelvis",
        "torso",
        "neck",
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
    assert len(rig.parts) == 14
    assert len(rig.sockets) == 8
    assert set(rig.direction_profiles) == {Direction.SE, Direction.NE}
    assert set(rig.draw_slot_profiles) == {Direction.SE, Direction.NE}
    assert resolve_draw_order(rig, Direction.SE) == SE_DRAW_ORDER
    assert resolve_draw_order(rig, Direction.NE) == NE_DRAW_ORDER

    assets = {asset.asset_id: asset for asset in catalog.layers}
    for direction in (Direction.SE, Direction.NE):
        pose = PoseResolver().resolve(rig, direction)
        for part in rig.parts:
            asset = assets[part.assets_by_direction[direction]]
            matrix = pose.part_matrices[part.part_id]
            assert matrix.rows[0][2] == asset.trim_origin.x
            assert matrix.rows[1][2] == asset.trim_origin.y


def test_reference_layout_scales_around_the_project_ground_anchor() -> None:
    project = _project(
        width=384,
        height=96,
        anchor=Vec2(x=180.0, y=80.0),
    )

    result = _build(project, _catalog(project))

    assert result.value is not None
    pose = PoseResolver().resolve(result.value, Direction.SE)
    assert pose.bone_world_matrices["root"].rows[0][2] == 180.0
    assert pose.bone_world_matrices["root"].rows[1][2] == 80.0
    assert pose.bone_world_matrices["hand_r"].rows[0][2] == 252.0
    assert pose.bone_world_matrices["hand_r"].rows[1][2] == 57.5
    sockets = {socket.socket_id: socket for socket in result.value.sockets}
    assert sockets["head_hat"].bone_id == "head"
    assert sockets["head_hat"].default_draw_slot == "hair_front"
    assert sockets["head_hat"].local_transform.position == Vec2(x=0.0, y=-11.0)
    assert sockets["head_face"].local_transform.position == Vec2(x=16.0, y=-4.0)
    assert sockets["hand_r_weapon"].local_transform.position == Vec2(x=0.0, y=0.0)


def test_missing_required_direction_blocks_rig_construction() -> None:
    project = _project()

    result = _build(
        project,
        _catalog(project, omit=frozenset({("head", Direction.NE)})),
    )

    assert result.value is None
    assert result.has_errors
    assert [item.code for item in result.diagnostics] == [RIG_TEMPLATE_MISSING_PART_CODE]
    assert result.diagnostics[0].location == "NE.head"


def test_one_direction_optional_part_is_bound_and_hidden_with_warning() -> None:
    project = _project()
    hair = _asset("hair_front", Direction.SE, project, optional=True)

    result = _build(project, _catalog(project, additions=(hair,)))

    assert result.value is not None
    assert [item.code for item in result.diagnostics] == [RIG_TEMPLATE_OPTIONAL_DIRECTION_CODE]
    hair_binding = next(part for part in result.value.parts if part.part_id == "hair_front")
    assert hair_binding.assets_by_direction == {Direction.SE: "se_hair_front"}
    assert result.value.direction_profiles[Direction.SE].part_visibility["hair_front"]
    assert not result.value.direction_profiles[Direction.NE].part_visibility["hair_front"]


def test_canonical_and_alias_assets_for_same_part_are_rejected_as_ambiguous() -> None:
    project = _project()
    alias = _asset(
        "left_upper_arm",
        Direction.SE,
        project,
        semantic_part="left_upper_arm",
    )

    result = _build(project, _catalog(project, additions=(alias,)))

    assert result.value is None
    assert result.has_errors
    assert [item.code for item in result.diagnostics] == [RIG_TEMPLATE_AMBIGUOUS_PART_CODE]
