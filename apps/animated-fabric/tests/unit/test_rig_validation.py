"""Tests for deterministic rig structural diagnostics."""

from __future__ import annotations

import json

import pytest

from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.geometry import IntPoint, IntSize, Transform2D, Vec2
from animated_fabric.domain.project import Direction, ProjectManifest
from animated_fabric.domain.rig import (
    BoneDefinition,
    DirectionProfile,
    PartBinding,
    RigDefinition,
    SocketDefinition,
)
from animated_fabric.domain.validation.models import (
    ValidationCode,
    ValidationInput,
    diagnostic_sort_key,
)
from animated_fabric.domain.validation.rig import validate_rig


def make_manifest() -> ProjectManifest:
    payload = {
        "format": "animated-fabric.project.v1",
        "schema_version": "0.1.0",
        "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
        "slug": "eva_mage",
        "display_name": "Eva, Forest Mage",
        "template_id": "humanoid_v1",
        "canvas": {
            "width": 192,
            "height": 192,
            "ground_anchor": [96.0, 160.0],
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


def make_rig(
    *,
    bones: tuple[BoneDefinition, ...] | None = None,
    parts: tuple[PartBinding, ...] = (),
    sockets: tuple[SocketDefinition, ...] = (),
    direction_profiles: dict[Direction, DirectionProfile] | None = None,
    draw_slot_profiles: dict[Direction, tuple[str, ...]] | None = None,
) -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id="humanoid_v1",
        bones=(BoneDefinition(bone_id="root"),) if bones is None else bones,
        parts=parts,
        sockets=sockets,
        direction_profiles={} if direction_profiles is None else direction_profiles,
        draw_slot_profiles={} if draw_slot_profiles is None else draw_slot_profiles,
    )


def make_input(
    rig: RigDefinition,
    *,
    assets: tuple[AssetLayer, ...] | None = None,
) -> ValidationInput:
    return ValidationInput(manifest=make_manifest(), rig=rig, assets=assets)


def make_part(
    *,
    part_id: str = "body_torso",
    bone_id: str = "root",
    pivot: Vec2 | None = None,
    asset_id: str = "se_torso",
    draw_slot: str = "torso",
) -> PartBinding:
    return PartBinding(
        part_id=part_id,
        semantic_part="torso",
        bone_id=bone_id,
        assets_by_direction={Direction.SE: asset_id},
        pivot_by_direction={} if pivot is None else {Direction.SE: pivot},
        draw_slot=draw_slot,
    )


def make_asset(
    asset_id: str = "se_torso",
    *,
    width: int = 10,
    height: int = 20,
    direction: Direction = Direction.SE,
) -> AssetLayer:
    return AssetLayer(
        asset_id=asset_id,
        direction=direction,
        semantic_part="torso",
        path=f"source/layers/{direction.value}/{asset_id}.png",
        source_canvas_size=IntSize(width=100, height=100),
        trim_origin=IntPoint(x=0, y=0),
        trim_size=IntSize(width=width, height=height),
        sha256="a" * 64,
    )


def test_valid_rig_has_no_structural_diagnostics() -> None:
    rig = make_rig(
        bones=(
            BoneDefinition(bone_id="root"),
            BoneDefinition(bone_id="torso", parent_id="root"),
        ),
        parts=(make_part(bone_id="torso"),),
        sockets=(
            SocketDefinition(socket_id="head_hat", bone_id="torso", default_draw_slot="head"),
        ),
    )

    assert validate_rig(make_input(rig)) == ()


def test_duplicate_bone_part_and_socket_ids_report_each_extra_occurrence() -> None:
    rig = make_rig(
        bones=(
            BoneDefinition(bone_id="root"),
            BoneDefinition(bone_id="arm", parent_id="root"),
            BoneDefinition(bone_id="arm", parent_id="root"),
        ),
        parts=(make_part(part_id="body"), make_part(part_id="body")),
        sockets=(
            SocketDefinition(socket_id="hand", bone_id="arm", default_draw_slot="arm_far"),
            SocketDefinition(socket_id="hand", bone_id="arm", default_draw_slot="arm_near"),
        ),
    )

    diagnostics = validate_rig(make_input(rig))

    assert [item.code for item in diagnostics] == [ValidationCode.DUPLICATE_RIG_ID] * 3
    assert [item.location for item in diagnostics] == [
        "bones[2].bone_id",
        "parts[1].part_id",
        "sockets[1].socket_id",
    ]
    assert [item.message for item in diagnostics] == [
        "Duplicate bone ID 'arm'.",
        "Duplicate part ID 'body'.",
        "Duplicate socket ID 'hand'.",
    ]


def test_missing_parent_binding_bone_and_socket_bone_are_actionable() -> None:
    rig = make_rig(
        bones=(
            BoneDefinition(bone_id="root"),
            BoneDefinition(bone_id="arm", parent_id="missing_parent"),
        ),
        parts=(make_part(bone_id="missing_binding"),),
        sockets=(
            SocketDefinition(
                socket_id="hand_weapon",
                bone_id="missing_socket_bone",
                default_draw_slot="weapon_front",
            ),
        ),
    )

    diagnostics = validate_rig(make_input(rig))

    assert [item.model_dump(mode="json") for item in diagnostics] == [
        {
            "code": "AFV202",
            "severity": "error",
            "message": "Bone 'arm' references missing parent 'missing_parent'.",
            "path": "rig/main.animated-rig.json",
            "location": "bones[1].parent_id",
            "suggestion": (
                "Use an existing bone ID, or set parent_id to null for the single root."
            ),
        },
        {
            "code": "AFV203",
            "severity": "error",
            "message": "Part 'body_torso' references missing bone 'missing_binding'.",
            "path": "rig/main.animated-rig.json",
            "location": "parts[0].bone_id",
            "suggestion": "Bind the part to an existing bone or add the required bone.",
        },
        {
            "code": "AFV208",
            "severity": "error",
            "message": ("Socket 'hand_weapon' references missing bone 'missing_socket_bone'."),
            "path": "rig/main.animated-rig.json",
            "location": "sockets[0].bone_id",
            "suggestion": "Attach the socket to an existing bone or add the required bone.",
        },
    ]


def test_each_bone_cycle_is_reported_exactly_once() -> None:
    rig = make_rig(
        bones=(
            BoneDefinition(bone_id="root"),
            BoneDefinition(bone_id="arm", parent_id="hand"),
            BoneDefinition(bone_id="hand", parent_id="arm"),
            BoneDefinition(bone_id="leg", parent_id="foot"),
            BoneDefinition(bone_id="foot", parent_id="leg"),
            BoneDefinition(bone_id="finger", parent_id="finger"),
            BoneDefinition(bone_id="sleeve", parent_id="arm"),
        )
    )

    cycles = [
        item for item in validate_rig(make_input(rig)) if item.code == ValidationCode.BONE_CYCLE
    ]

    assert len(cycles) == 3
    assert {item.message for item in cycles} == {
        "Bone cycle detected: arm -> hand -> arm.",
        "Bone cycle detected: finger -> finger.",
        "Bone cycle detected: foot -> leg -> foot.",
    }


@pytest.mark.parametrize(
    ("bones", "location", "message"),
    [
        ((), "bones", "found none"),
        (
            (BoneDefinition(bone_id="root"), BoneDefinition(bone_id="other")),
            "bones",
            "found 'root', 'other'",
        ),
        (
            (BoneDefinition(bone_id="pelvis"),),
            "bones[0].bone_id",
            "must be named 'root'",
        ),
    ],
)
def test_rig_requires_exactly_one_parentless_bone_named_root(
    bones: tuple[BoneDefinition, ...],
    location: str,
    message: str,
) -> None:
    diagnostics = validate_rig(make_input(make_rig(bones=bones)))
    roots = [item for item in diagnostics if item.code == ValidationCode.ROOT_COUNT_INVALID]

    assert len(roots) == 1
    assert roots[0].location == location
    assert message in roots[0].message
    assert roots[0].suggestion is not None


@pytest.mark.parametrize(
    ("pivot", "warned"),
    [
        (Vec2(x=-10.0, y=-20.0), False),
        (Vec2(x=20.0, y=40.0), False),
        (Vec2(x=-10.01, y=0.0), True),
        (Vec2(x=20.01, y=0.0), True),
        (Vec2(x=0.0, y=-20.01), True),
        (Vec2(x=0.0, y=40.01), True),
    ],
)
def test_pivot_uses_conservative_trimmed_asset_bounds(pivot: Vec2, warned: bool) -> None:
    rig = make_rig(parts=(make_part(pivot=pivot),))

    diagnostics = validate_rig(make_input(rig, assets=(make_asset(),)))
    pivot_diagnostics = [
        item for item in diagnostics if item.code == ValidationCode.PIVOT_FAR_OUTSIDE_ASSET
    ]

    assert bool(pivot_diagnostics) is warned
    if warned:
        assert pivot_diagnostics[0].severity.value == "warning"
        assert pivot_diagnostics[0].location == "parts[0].pivot_by_direction.SE"
        assert pivot_diagnostics[0].suggestion == (
            "Keep pivot x within [-10, 20] and y within [-20, 40], or correct the asset binding."
        )


def test_profile_pivot_override_uses_base_asset_and_profile_location() -> None:
    profile = DirectionProfile(pivots={"body_torso": Vec2(x=20.01, y=0.0)})
    rig = make_rig(
        parts=(make_part(pivot=Vec2(x=0.0, y=0.0)),),
        direction_profiles={Direction.SE: profile},
    )

    diagnostics = validate_rig(make_input(rig, assets=(make_asset(),)))
    pivot_diagnostics = [
        item for item in diagnostics if item.code == ValidationCode.PIVOT_FAR_OUTSIDE_ASSET
    ]

    assert len(pivot_diagnostics) == 1
    assert pivot_diagnostics[0].location == "direction_profiles.SE.pivots.body_torso"
    assert "asset 'se_torso' (10 x 20)" in pivot_diagnostics[0].message


def test_profile_asset_override_changes_bounds_for_base_pivot_fallback() -> None:
    profile = DirectionProfile(asset_selection={"body_torso": "se_torso_small"})
    rig = make_rig(
        parts=(make_part(pivot=Vec2(x=21.0, y=0.0), asset_id="se_torso_large"),),
        direction_profiles={Direction.SE: profile},
    )
    assets = (
        make_asset("se_torso_large", width=100, height=100),
        make_asset("se_torso_small", width=10, height=20),
    )

    diagnostics = validate_rig(make_input(rig, assets=assets))
    pivot_diagnostics = [
        item for item in diagnostics if item.code == ValidationCode.PIVOT_FAR_OUTSIDE_ASSET
    ]

    assert len(pivot_diagnostics) == 1
    assert pivot_diagnostics[0].location == "parts[0].pivot_by_direction.SE"
    assert "asset 'se_torso_small' (10 x 20)" in pivot_diagnostics[0].message


def test_profile_pivot_and_asset_overrides_define_the_effective_afv206_check() -> None:
    profile = DirectionProfile(
        asset_selection={"body_torso": "se_torso_small"},
        pivots={"body_torso": Vec2(x=20.01, y=0.0)},
    )
    rig = make_rig(
        parts=(
            make_part(
                pivot=Vec2(x=0.0, y=0.0),
                asset_id="se_torso_large",
            ),
        ),
        direction_profiles={Direction.SE: profile},
    )
    assets = (
        make_asset("se_torso_large", width=100, height=100),
        make_asset("se_torso_small", width=10, height=20),
    )

    diagnostics = validate_rig(make_input(rig, assets=assets))
    pivot_diagnostics = [
        item for item in diagnostics if item.code == ValidationCode.PIVOT_FAR_OUTSIDE_ASSET
    ]

    assert len(pivot_diagnostics) == 1
    assert pivot_diagnostics[0].location == "direction_profiles.SE.pivots.body_torso"
    assert "asset 'se_torso_small' (10 x 20)" in pivot_diagnostics[0].message
    assert pivot_diagnostics[0].suggestion == (
        "Keep pivot x within [-10, 20] and y within [-20, 40], or correct the asset binding."
    )


def test_profile_pivot_precedence_avoids_base_and_override_duplicates() -> None:
    profile = DirectionProfile(pivots={"body_torso": Vec2(x=1001.0, y=0.0)})
    rig = make_rig(
        parts=(make_part(pivot=Vec2(x=1000.0, y=0.0)),),
        direction_profiles={Direction.SE: profile},
    )

    diagnostics = validate_rig(make_input(rig, assets=(make_asset(),)))
    pivot_diagnostics = [
        item for item in diagnostics if item.code == ValidationCode.PIVOT_FAR_OUTSIDE_ASSET
    ]

    assert len(pivot_diagnostics) == 1
    assert pivot_diagnostics[0].location == "direction_profiles.SE.pivots.body_torso"


def test_in_bounds_profile_pivot_suppresses_far_outside_base_pivot() -> None:
    profile = DirectionProfile(pivots={"body_torso": Vec2(x=0.0, y=0.0)})
    rig = make_rig(
        parts=(make_part(pivot=Vec2(x=1000.0, y=0.0)),),
        direction_profiles={Direction.SE: profile},
    )

    diagnostics = validate_rig(make_input(rig, assets=(make_asset(),)))

    assert all(item.code != ValidationCode.PIVOT_FAR_OUTSIDE_ASSET for item in diagnostics)


def test_unknown_assets_skip_asset_dependent_pivot_checks() -> None:
    rig = make_rig(parts=(make_part(pivot=Vec2(x=1000.0, y=1000.0)),))

    assert validate_rig(make_input(rig, assets=None)) == ()


def test_profile_asset_selection_reports_a_known_missing_asset() -> None:
    profile = DirectionProfile(asset_selection={"body_torso": "missing_asset"})
    rig = make_rig(direction_profiles={Direction.SE: profile})

    diagnostics = validate_rig(make_input(rig, assets=(make_asset(),)))

    assert len(diagnostics) == 1
    assert diagnostics[0].model_dump(mode="json") == {
        "code": "AFV101",
        "severity": "error",
        "message": (
            "Direction profile 'SE' selects missing asset 'missing_asset' for part 'body_torso'."
        ),
        "path": "rig/main.animated-rig.json",
        "location": "direction_profiles.SE.asset_selection.body_torso",
        "suggestion": "Select an existing asset or import the required asset.",
    }


def test_orphan_profile_override_keys_wait_for_dedicated_codes() -> None:
    profile = DirectionProfile(
        bone_rest_transforms={"missing_bone": Transform2D()},
        part_visibility={"missing_part": False},
        asset_selection={"missing_part": "se_torso"},
        pivots={"missing_part": Vec2(x=0.0, y=0.0)},
        slot_order={"missing_part": 1},
        track_multipliers={"missing_bone.rotation_deg": 0.5},
    )
    rig = make_rig(direction_profiles={Direction.SE: profile})

    assert validate_rig(make_input(rig, assets=(make_asset(),))) == ()


def test_rig_diagnostics_use_the_shared_deterministic_order() -> None:
    rig = make_rig(
        bones=(
            BoneDefinition(bone_id="root"),
            BoneDefinition(bone_id="arm", parent_id="missing"),
            BoneDefinition(bone_id="arm", parent_id="missing"),
        ),
        parts=(make_part(bone_id="missing"),),
        sockets=(
            SocketDefinition(socket_id="hand", bone_id="missing", default_draw_slot="unknown"),
        ),
    )
    validation_input = make_input(rig)

    first = validate_rig(validation_input)
    second = validate_rig(validation_input)

    assert first == second
    assert first == tuple(sorted(first, key=diagnostic_sort_key))
    assert all(item.path == "rig/main.animated-rig.json" for item in first)
    assert all(item.location and item.suggestion for item in first)


def test_draw_slot_resolution_is_outside_the_rig_validator() -> None:
    rig = make_rig(
        parts=(make_part(draw_slot="not_a_known_slot"),),
        draw_slot_profiles={Direction.SE: ()},
    )

    assert validate_rig(make_input(rig)) == ()
