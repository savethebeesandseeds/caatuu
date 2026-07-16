"""Tests for deterministic parent-before-child bone ordering."""

from __future__ import annotations

import pytest

from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.domain.hierarchy import topological_bone_order
from animated_fabric.domain.rig import BoneDefinition, RigDefinition


def make_rig(*bones: BoneDefinition) -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id="humanoid_v1",
        bones=bones,
    )


def test_single_root_is_a_complete_topological_order() -> None:
    rig = make_rig(BoneDefinition(bone_id="root"))

    assert topological_bone_order(rig) == ("root",)


def test_parent_precedes_children_even_when_declared_later() -> None:
    rig = make_rig(
        BoneDefinition(bone_id="hand", parent_id="arm"),
        BoneDefinition(bone_id="leg", parent_id="root"),
        BoneDefinition(bone_id="arm", parent_id="root"),
        BoneDefinition(bone_id="root"),
    )

    order = topological_bone_order(rig)

    assert order == ("root", "leg", "arm", "hand")
    positions = {bone_id: index for index, bone_id in enumerate(order)}
    assert positions["root"] < positions["leg"]
    assert positions["root"] < positions["arm"] < positions["hand"]


def test_declaration_index_prioritizes_every_set_of_ready_bones() -> None:
    rig = make_rig(
        BoneDefinition(bone_id="finger", parent_id="arm"),
        BoneDefinition(bone_id="arm", parent_id="root"),
        BoneDefinition(bone_id="leg", parent_id="root"),
        BoneDefinition(bone_id="root"),
    )

    assert topological_bone_order(rig) == ("root", "arm", "finger", "leg")


def test_sibling_ties_preserve_declaration_order() -> None:
    rig = make_rig(
        BoneDefinition(bone_id="root"),
        BoneDefinition(bone_id="right", parent_id="root"),
        BoneDefinition(bone_id="left", parent_id="root"),
        BoneDefinition(bone_id="head", parent_id="root"),
    )

    first = topological_bone_order(rig)
    second = topological_bone_order(rig)

    assert first == ("root", "right", "left", "head")
    assert second == first


def test_empty_rig_is_rejected() -> None:
    with pytest.raises(RigDefinitionError, match="at least one bone"):
        topological_bone_order(make_rig())


def test_duplicate_bone_id_is_rejected_before_ordering() -> None:
    rig = make_rig(
        BoneDefinition(bone_id="root"),
        BoneDefinition(bone_id="arm", parent_id="root"),
        BoneDefinition(bone_id="arm", parent_id="root"),
    )

    with pytest.raises(RigDefinitionError, match="duplicate bone ID 'arm'"):
        topological_bone_order(rig)


def test_missing_parent_is_rejected_before_ordering() -> None:
    rig = make_rig(
        BoneDefinition(bone_id="root"),
        BoneDefinition(bone_id="arm", parent_id="missing"),
    )

    with pytest.raises(RigDefinitionError, match="references missing parent 'missing'"):
        topological_bone_order(rig)


@pytest.mark.parametrize(
    ("bones", "message"),
    [
        (
            (
                BoneDefinition(bone_id="arm", parent_id="hand"),
                BoneDefinition(bone_id="hand", parent_id="arm"),
            ),
            "found none",
        ),
        (
            (
                BoneDefinition(bone_id="root"),
                BoneDefinition(bone_id="other"),
            ),
            "found 'root', 'other'",
        ),
        ((BoneDefinition(bone_id="pelvis"),), "must be named 'root'"),
    ],
)
def test_invalid_root_configuration_is_rejected(
    bones: tuple[BoneDefinition, ...],
    message: str,
) -> None:
    with pytest.raises(RigDefinitionError, match=message):
        topological_bone_order(make_rig(*bones))


def test_cycle_is_rejected_without_returning_a_partial_order() -> None:
    rig = make_rig(
        BoneDefinition(bone_id="root"),
        BoneDefinition(bone_id="arm", parent_id="hand"),
        BoneDefinition(bone_id="hand", parent_id="arm"),
        BoneDefinition(bone_id="finger", parent_id="hand"),
    )

    with pytest.raises(RigDefinitionError, match="bone cycle") as captured:
        topological_bone_order(rig)

    assert "'arm', 'hand', 'finger'" in str(captured.value)
