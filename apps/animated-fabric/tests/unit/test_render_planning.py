"""Focused tests for image-neutral rendering contracts and layer planning."""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from types import MappingProxyType
from uuid import UUID

import pytest

from animated_fabric.application.rendering import (
    ClippingEdges,
    CompositedFrame,
    CompositeRequest,
    FrameCompositor,
    PlannedRenderLayer,
    RenderPlanner,
    RenderQuality,
)
from animated_fabric.domain.animation_evaluator import EvaluatedAnimation, EvaluatedPartState
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.geometry import IntPoint, IntSize, SelectionEllipse, Transform2D, Vec2
from animated_fabric.domain.pose import ResolvedPose, part_to_canvas_matrix
from animated_fabric.domain.project import (
    CanvasDefinition,
    Direction,
    DirectionDefinition,
    DirectionMode,
    PixelSnap,
    ProjectManifest,
)
from animated_fabric.domain.rig import (
    BoneDefinition,
    DirectionProfile,
    PartBinding,
    RigDefinition,
)
from animated_fabric.domain.transforms import Matrix3, identity_matrix, translation_matrix


def make_project(
    *,
    direction: Direction = Direction.SE,
    mode: DirectionMode = DirectionMode.AUTHORED,
    template_id: str = "humanoid_v1",
    pixel_snap: PixelSnap = PixelSnap.NONE,
) -> ProjectManifest:
    source = Direction.NE if mode is DirectionMode.MIRROR else None
    return ProjectManifest(
        format="animated-fabric.project.v1",
        schema_version="0.1.0",
        project_id=UUID("123e4567-e89b-42d3-a456-426614174000"),
        slug="render_test",
        display_name="Render test",
        template_id=template_id,
        canvas=CanvasDefinition(
            width=64,
            height=32,
            ground_anchor=Vec2(x=32.0, y=28.0),
            pixel_snap=pixel_snap,
        ),
        directions={direction: DirectionDefinition(mode=mode, source=source)},
        rig_path="rig/main.animated-rig.json",
        animation_paths=(),
        export_profiles=(),
        selection_ellipse=SelectionEllipse(
            center_offset=Vec2(x=0.0, y=0.0),
            radius_x=8.0,
            radius_y=4.0,
        ),
    )


def make_part(
    part_id: str,
    draw_slot: str,
    asset_id: str | None,
    *,
    slot_order: int = 0,
    visible: bool = True,
    opacity: float = 1.0,
) -> PartBinding:
    return PartBinding(
        part_id=part_id,
        semantic_part=part_id,
        bone_id="root",
        assets_by_direction={} if asset_id is None else {Direction.SE: asset_id},
        draw_slot=draw_slot,
        slot_order=slot_order,
        visible=visible,
        opacity=opacity,
    )


def make_asset(asset_id: str, *, direction: Direction = Direction.SE) -> AssetLayer:
    return AssetLayer(
        asset_id=asset_id,
        direction=direction,
        semantic_part="body",
        path=f"assets/{asset_id}.png",
        source_canvas_size=IntSize(width=8, height=8),
        trim_origin=IntPoint(x=0, y=0),
        trim_size=IntSize(width=8, height=8),
        sha256="a" * 64,
    )


def make_rig(
    *parts: PartBinding,
    slots: tuple[str, ...] | None = ("back", "front"),
    profile: DirectionProfile | None = None,
    template_id: str = "humanoid_v1",
) -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id=template_id,
        bones=(BoneDefinition(bone_id="root"),),
        parts=parts,
        direction_profiles={} if profile is None else {Direction.SE: profile},
        draw_slot_profiles={} if slots is None else {Direction.SE: slots},
    )


def make_pose(
    matrices: dict[str, Matrix3],
    *,
    bone_world: Matrix3 | None = None,
) -> ResolvedPose:
    return ResolvedPose(
        bone_order=("root",),
        bone_world_matrices=MappingProxyType({"root": bone_world or identity_matrix()}),
        part_matrices=MappingProxyType(matrices),
        socket_matrices=MappingProxyType({}),
    )


def make_animation(states: dict[str, EvaluatedPartState]) -> EvaluatedAnimation:
    return EvaluatedAnimation(
        clip_id="idle",
        time_ms=0.0,
        bone_deltas=MappingProxyType({}),
        part_states=MappingProxyType(states),
    )


def test_render_contracts_are_frozen_byte_oriented_and_library_neutral() -> None:
    clipping = ClippingEdges(top=True, left=True)
    frame = CompositedFrame(
        canvas_size=IntSize(width=2, height=1),
        rgba=bytes(range(8)),
        clipping=clipping,
    )
    request = CompositeRequest(
        canvas_size=IntSize(width=2, height=1),
        direction=Direction.SE,
        layers=(),
    )

    assert clipping.is_clipped
    assert request.quality is RenderQuality.CUBIC
    assert request.alpha_threshold == 0
    assert isinstance(frame.rgba, bytes)
    with pytest.raises(FrozenInstanceError):
        frame.rgba = b""  # type: ignore[misc]
    with pytest.raises(ValueError, match="exactly 8 bytes"):
        CompositedFrame(
            canvas_size=IntSize(width=2, height=1),
            rgba=b"short",
            clipping=ClippingEdges(),
        )
    with pytest.raises(ValueError, match="0 through 255"):
        CompositeRequest(
            canvas_size=IntSize(width=1, height=1),
            direction=Direction.SE,
            layers=(),
            alpha_threshold=256,
        )
    with pytest.raises(TypeError, match="planned render layers"):
        CompositeRequest(
            canvas_size=IntSize(width=1, height=1),
            direction=Direction.SE,
            layers=(object(),),  # type: ignore[arg-type]
        )


def test_frame_compositor_is_a_runtime_structural_protocol() -> None:
    class TransparentCompositor:
        def compose(self, request: CompositeRequest) -> CompositedFrame:
            byte_count = request.canvas_size.width * request.canvas_size.height * 4
            return CompositedFrame(request.canvas_size, bytes(byte_count), ClippingEdges())

    assert isinstance(TransparentCompositor(), FrameCompositor)


def test_planner_applies_overrides_and_orders_by_slot_effective_order_then_id() -> None:
    back_b = make_part("back_b", "back", "se_back_b", slot_order=4)
    front = make_part("front", "front", "se_front", slot_order=-100)
    back_a = make_part("back_a", "back", "se_back_a", slot_order=0)
    profile = DirectionProfile(
        asset_selection={"back_b": "se_back_b_alt"},
        slot_order={"back_b": -1},
    )
    rig = make_rig(back_b, front, back_a, profile=profile)
    matrices = {
        "back_b": translation_matrix(Vec2(x=2.0, y=0.0)),
        "front": translation_matrix(Vec2(x=3.0, y=0.0)),
        "back_a": translation_matrix(Vec2(x=1.0, y=0.0)),
    }
    animation = make_animation(
        {
            "back_b": EvaluatedPartState(visible=True, opacity=0.25, z_bias=2),
            "front": EvaluatedPartState(visible=True, opacity=0.75, z_bias=0),
            "back_a": EvaluatedPartState(visible=True, opacity=0.5, z_bias=1),
        }
    )
    assets = {
        asset_id: make_asset(asset_id) for asset_id in ("se_back_b_alt", "se_front", "se_back_a")
    }

    request = RenderPlanner().plan(
        make_project(),
        rig,
        Direction.SE,
        make_pose(matrices),
        animation,
        assets,
        quality=RenderQuality.LINEAR,
        alpha_threshold=7,
    )

    assert [layer.part_id for layer in request.layers] == ["back_a", "back_b", "front"]
    assert [layer.effective_slot_order for layer in request.layers] == [1, 1, -100]
    assert request.layers[1].asset.asset_id == "se_back_b_alt"
    assert request.layers[1].opacity == 0.25
    assert request.layers[0].matrix == matrices["back_a"]
    assert request.quality is RenderQuality.LINEAR
    assert request.alpha_threshold == 7
    assert request.canvas_size == IntSize(width=64, height=32)


def test_neutral_plan_uses_direction_visibility_and_base_opacity() -> None:
    hidden = make_part("hidden", "back", None, visible=True)
    shown = make_part("shown", "front", "se_shown", visible=False, opacity=0.4)
    profile = DirectionProfile(part_visibility={"hidden": False, "shown": True})
    rig = make_rig(hidden, shown, profile=profile)

    request = RenderPlanner().plan(
        make_project(),
        rig,
        Direction.SE,
        make_pose({"hidden": identity_matrix(), "shown": identity_matrix()}),
        None,
        {"se_shown": make_asset("se_shown")},
    )

    assert len(request.layers) == 1
    assert request.layers[0].part_id == "shown"
    assert request.layers[0].opacity == 0.4


def test_integer_pixel_snap_rounds_bone_world_translation_before_part_rasterization() -> None:
    part = make_part("body", "back", "se_body").model_copy(
        update={
            "bind_transform": Transform2D(position=Vec2(x=2.3, y=0.0)),
            "pivot_by_direction": {Direction.SE: Vec2(x=1.2, y=0.0)},
        }
    )
    rig = make_rig(part)
    subpixel = translation_matrix(Vec2(x=10.6, y=20.4))
    part_matrix = part_to_canvas_matrix(
        subpixel,
        part,
        part.pivot_by_direction[Direction.SE],
    )
    pose = make_pose({"body": part_matrix}, bone_world=subpixel)
    assets = {"se_body": make_asset("se_body")}

    unsnapped = RenderPlanner().plan(
        make_project(pixel_snap=PixelSnap.NONE),
        rig,
        Direction.SE,
        pose,
        None,
        assets,
    )
    snapped = RenderPlanner().plan(
        make_project(pixel_snap=PixelSnap.INTEGER),
        rig,
        Direction.SE,
        pose,
        None,
        assets,
    )

    assert unsnapped.layers[0].matrix.at(0, 2) == pytest.approx(11.7)
    assert unsnapped.layers[0].matrix.at(1, 2) == 20.4
    assert snapped.layers[0].matrix.at(0, 2) == pytest.approx(12.1)
    assert snapped.layers[0].matrix.at(1, 2) == 20.0


@pytest.mark.parametrize(
    ("project", "rig", "message"),
    [
        (
            make_project(mode=DirectionMode.MIRROR),
            make_rig(),
            "accepts authored directions only",
        ),
        (
            make_project(template_id="humanoid_v1"),
            make_rig(template_id="quadruped_v1"),
            "does not match rig template",
        ),
        (make_project(), make_rig(slots=None), "no draw-slot profile"),
        (make_project(), make_rig(slots=("back", "back")), "contains duplicates"),
    ],
)
def test_planner_rejects_incompatible_project_and_rig_state(
    project: ProjectManifest,
    rig: RigDefinition,
    message: str,
) -> None:
    with pytest.raises(RenderError, match=message):
        RenderPlanner().plan(project, rig, Direction.SE, make_pose({}), None, {})


def test_planner_requires_exact_pose_and_animation_part_coverage() -> None:
    part = make_part("body", "back", "se_body")
    rig = make_rig(part)
    state = EvaluatedPartState(visible=True, opacity=1.0, z_bias=0)

    with pytest.raises(RenderError, match="pose matrices.*missing: 'body'"):
        RenderPlanner().plan(
            make_project(),
            rig,
            Direction.SE,
            make_pose({}),
            make_animation({"body": state}),
            {"se_body": make_asset("se_body")},
        )
    with pytest.raises(RenderError, match="animation states.*extra: 'other'"):
        RenderPlanner().plan(
            make_project(),
            rig,
            Direction.SE,
            make_pose({"body": identity_matrix()}),
            make_animation({"body": state, "other": state}),
            {"se_body": make_asset("se_body")},
        )
    with pytest.raises(RenderError, match="opacity.*finite"):
        RenderPlanner().plan(
            make_project(),
            rig,
            Direction.SE,
            make_pose({"body": identity_matrix()}),
            make_animation(
                {"body": EvaluatedPartState(visible=True, opacity=float("nan"), z_bias=0)}
            ),
            {"se_body": make_asset("se_body")},
        )
    with pytest.raises(RenderError, match="opacity.*finite"):
        RenderPlanner().plan(
            make_project(),
            rig,
            Direction.SE,
            make_pose({"body": identity_matrix()}),
            make_animation({"body": EvaluatedPartState(visible=True, opacity=10**10000, z_bias=0)}),
            {"se_body": make_asset("se_body")},
        )


@pytest.mark.parametrize(
    ("part", "assets", "message"),
    [
        (
            make_part("body", "missing", "se_body"),
            {"se_body": make_asset("se_body")},
            "unknown draw slot",
        ),
        (make_part("body", "back", None), {}, "has no asset"),
        (make_part("body", "back", "se_body"), {}, "selects missing asset"),
        (
            make_part("body", "back", "se_body"),
            {"se_body": make_asset("se_body", direction=Direction.NE)},
            "belongs to direction 'NE'",
        ),
    ],
)
def test_planner_rejects_unrenderable_visible_parts(
    part: PartBinding,
    assets: dict[str, AssetLayer],
    message: str,
) -> None:
    rig = make_rig(part)

    with pytest.raises(RenderError, match=message):
        RenderPlanner().plan(
            make_project(),
            rig,
            Direction.SE,
            make_pose({"body": identity_matrix()}),
            None,
            assets,
        )


def test_planned_layer_rejects_invalid_render_metadata() -> None:
    with pytest.raises(ValueError, match="opacity"):
        PlannedRenderLayer(
            part_id="body",
            asset=make_asset("se_body"),
            matrix=identity_matrix(),
            opacity=float("nan"),
            draw_slot="back",
            slot_index=0,
            effective_slot_order=0,
        )
    with pytest.raises(ValueError, match="slot index"):
        PlannedRenderLayer(
            part_id="body",
            asset=make_asset("se_body"),
            matrix=identity_matrix(),
            opacity=1.0,
            draw_slot="back",
            slot_index=-1,
            effective_slot_order=0,
        )
    with pytest.raises(ValueError, match="opacity"):
        PlannedRenderLayer(
            part_id="body",
            asset=make_asset("se_body"),
            matrix=identity_matrix(),
            opacity=True,  # type: ignore[arg-type]
            draw_slot="back",
            slot_index=0,
            effective_slot_order=0,
        )
