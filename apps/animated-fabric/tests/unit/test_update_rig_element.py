"""Unit coverage for AF-033 detached rig-element editing orchestration."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import cast

import pytest

from animated_fabric.application.update_rig_element import (
    RIG_UPDATE_FAILURE_CODE,
    RIG_UPDATE_REJECTED_CODE,
    RIG_UPDATE_TARGET_CODE,
    AssignPart,
    ChangeDrawSlot,
    MoveBone,
    MovePivot,
    RigElementUpdate,
    UpdateRigElement,
    UpdateRigElementRequest,
)
from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.assets import AssetLayer, LayerManifest
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.exceptions import ProjectValidationError, ProjectVersionError
from animated_fabric.domain.geometry import IntPoint, IntSize, Transform2D, Vec2
from animated_fabric.domain.project import Direction, ProjectManifest
from animated_fabric.domain.rig import (
    BoneDefinition,
    DirectionProfile,
    PartBinding,
    RigDefinition,
)
from animated_fabric.domain.validation import ProjectValidator, ValidationCode, ValidationInput
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest

_DIGEST = "0" * 64


class FakeProjectRepository:
    """In-memory project port that records the single rig publication boundary."""

    def __init__(
        self,
        project: ProjectManifest,
        rig: RigDefinition,
        *,
        project_error: ProjectValidationError | ProjectVersionError | None = None,
        rig_error: ProjectValidationError | ProjectVersionError | None = None,
        save_error: ProjectValidationError | ProjectVersionError | None = None,
    ) -> None:
        self.project = project
        self.rig = rig
        self.project_error = project_error
        self.rig_error = rig_error
        self.save_error = save_error
        self.save_calls: list[tuple[Path, ProjectPath, RigDefinition, bool]] = []

    def load(self, root: Path) -> ProjectManifest:
        del root
        if self.project_error is not None:
            raise self.project_error
        return self.project

    def load_rig(self, root: Path, path: ProjectPath) -> RigDefinition:
        del root, path
        if self.rig_error is not None:
            raise self.rig_error
        return self.rig

    def save_rig(
        self,
        root: Path,
        path: ProjectPath,
        rig: RigDefinition,
        *,
        replace_existing: bool = True,
    ) -> None:
        if self.save_error is not None:
            raise self.save_error
        self.save_calls.append((root, path, rig, replace_existing))


class FakeLayerRepository:
    """In-memory layer-catalog port with controllable expected failure."""

    def __init__(
        self,
        manifest: LayerManifest,
        *,
        error: ProjectValidationError | ProjectVersionError | None = None,
    ) -> None:
        self.manifest = manifest
        self.error = error
        self.load_count = 0

    def load_layer_manifest(self, root: Path) -> LayerManifest:
        del root
        self.load_count += 1
        if self.error is not None:
            raise self.error
        return self.manifest


class StubValidator(ProjectValidator):
    """Return controlled diagnostics while retaining the concrete validator API."""

    def __init__(self, diagnostics: Sequence[Diagnostic] = ()) -> None:
        self.diagnostics = tuple(diagnostics)
        self.inputs: list[ValidationInput] = []

    def validate(self, value: ValidationInput) -> tuple[Diagnostic, ...]:
        self.inputs.append(value)
        return self.diagnostics


def _project() -> ProjectManifest:
    return build_stick_humanoid_manifest()


def _asset(asset_id: str, direction: Direction) -> AssetLayer:
    return AssetLayer(
        asset_id=asset_id,
        direction=direction,
        semantic_part="torso",
        path=f"source/layers/{direction.value}/torso.png",
        source_canvas_size=IntSize(width=192, height=192),
        trim_origin=IntPoint(x=10, y=20),
        trim_size=IntSize(width=80, height=100),
        sha256=_DIGEST,
    )


def _layers() -> LayerManifest:
    return LayerManifest(
        format="animated-fabric.layer-manifest.v1",
        schema_version="0.1.0",
        layers=(_asset("ne_torso", Direction.NE), _asset("se_torso", Direction.SE)),
    )


def _root_bone() -> BoneDefinition:
    return BoneDefinition(
        bone_id="root",
        rest_transform=Transform2D(position=Vec2(x=1.0, y=2.0)),
    )


def _arm_bone(*, locked: bool = False) -> BoneDefinition:
    return BoneDefinition(
        bone_id="arm",
        parent_id="root",
        rest_transform=Transform2D(
            position=Vec2(x=3.0, y=4.0),
            rotation_deg=7.0,
            scale=Vec2(x=0.8, y=1.1),
        ),
        length_hint=20.0,
        locked=locked,
    )


def _part(
    *,
    bone_id: str = "root",
    assets_by_direction: dict[Direction, str] | None = None,
) -> PartBinding:
    return PartBinding(
        part_id="torso",
        semantic_part="torso",
        bone_id=bone_id,
        assets_by_direction=(
            {Direction.SE: "se_torso", Direction.NE: "ne_torso"}
            if assets_by_direction is None
            else assets_by_direction
        ),
        pivot_by_direction={
            Direction.SE: Vec2(x=10.0, y=20.0),
            Direction.NE: Vec2(x=12.0, y=22.0),
        },
        bind_transform=Transform2D(
            position=Vec2(x=0.5, y=1.5),
            rotation_deg=3.0,
            scale=Vec2(x=0.9, y=0.95),
        ),
        draw_slot="torso",
        slot_order=3,
        opacity=0.75,
    )


def _profile(
    direction: Direction,
    *,
    asset_selection: dict[str, str] | None = None,
) -> DirectionProfile:
    position = Vec2(x=4.0, y=5.0) if direction is Direction.SE else Vec2(x=6.0, y=7.0)
    pivot = Vec2(x=11.0, y=21.0) if direction is Direction.SE else Vec2(x=13.0, y=23.0)
    return DirectionProfile(
        bone_rest_transforms={
            "arm": Transform2D(
                position=position,
                rotation_deg=17.0,
                scale=Vec2(x=1.2, y=0.9),
            )
        },
        part_visibility={"torso": True},
        asset_selection=(
            {"torso": f"{direction.value.lower()}_torso"}
            if asset_selection is None
            else asset_selection
        ),
        pivots={"torso": pivot},
        slot_order={"torso": 2},
        track_multipliers={"arm.rotation_deg": 0.8},
    )


def _rig(
    *,
    bones: tuple[BoneDefinition, ...] | None = None,
    parts: tuple[PartBinding, ...] | None = None,
    direction_profiles: dict[Direction, DirectionProfile] | None = None,
    draw_slot_profiles: dict[Direction, tuple[str, ...]] | None = None,
) -> RigDefinition:
    return RigDefinition(
        format="animated-fabric.rig.v1",
        schema_version="0.1.0",
        rig_id="main",
        template_id="humanoid_v1",
        bones=(_root_bone(), _arm_bone()) if bones is None else bones,
        parts=(_part(),) if parts is None else parts,
        direction_profiles=(
            {
                Direction.SE: _profile(Direction.SE),
                Direction.NE: _profile(Direction.NE),
            }
            if direction_profiles is None
            else direction_profiles
        ),
        draw_slot_profiles=(
            {
                Direction.SE: ("torso", "fx_front"),
                Direction.NE: ("torso", "fx_front"),
            }
            if draw_slot_profiles is None
            else draw_slot_profiles
        ),
    )


def _execute(
    update: RigElementUpdate,
    *,
    rig: RigDefinition | None = None,
    project: ProjectManifest | None = None,
    layers: LayerManifest | None = None,
    validator: ProjectValidator | None = None,
    project_error: ProjectValidationError | ProjectVersionError | None = None,
    rig_error: ProjectValidationError | ProjectVersionError | None = None,
    layer_error: ProjectValidationError | ProjectVersionError | None = None,
    save_error: ProjectValidationError | ProjectVersionError | None = None,
):
    resolved_project = project or _project()
    projects = FakeProjectRepository(
        resolved_project,
        rig or _rig(),
        project_error=project_error,
        rig_error=rig_error,
        save_error=save_error,
    )
    layer_repository = FakeLayerRepository(layers or _layers(), error=layer_error)
    result = UpdateRigElement(
        projects,
        layer_repository,
        validator or ProjectValidator(),
    ).execute(UpdateRigElementRequest(project_root=Path("/project"), update=update))
    return result, projects, layer_repository


def test_move_bone_updates_only_selected_profile_and_preserves_transform_channels() -> None:
    source = _rig()
    before = source.model_dump(mode="json")

    result, projects, _ = _execute(
        MoveBone(
            bone_id="arm",
            direction=Direction.SE,
            local_position=Vec2(x=30.0, y=40.0),
        ),
        rig=source,
    )

    assert result.value is not None, result.diagnostics
    assert result.value.changed
    assert result.value.project_revision_delta == 1
    assert len(projects.save_calls) == 1
    assert projects.save_calls[0][2] is result.value.rig
    assert projects.save_calls[0][3] is True
    moved = result.value.rig.direction_profiles[Direction.SE].bone_rest_transforms["arm"]
    assert moved == Transform2D(
        position=Vec2(x=30.0, y=40.0),
        rotation_deg=17.0,
        scale=Vec2(x=1.2, y=0.9),
    )
    assert (
        result.value.rig.direction_profiles[Direction.NE] == source.direction_profiles[Direction.NE]
    )
    assert result.value.rig.bones == source.bones
    assert source.model_dump(mode="json") == before
    assert result.value.rig.direction_profiles is not source.direction_profiles
    assert (
        result.value.rig.direction_profiles[Direction.NE].bone_rest_transforms
        is not source.direction_profiles[Direction.NE].bone_rest_transforms
    )


def test_effective_bone_position_noop_still_validates_but_does_not_save() -> None:
    validator = StubValidator()

    result, projects, _ = _execute(
        MoveBone(
            bone_id="arm",
            direction=Direction.SE,
            local_position=Vec2(x=4.0, y=5.0),
        ),
        validator=validator,
    )

    assert result.value is not None
    assert not result.value.changed
    assert result.value.project_revision_delta == 0
    assert projects.save_calls == []
    assert len(validator.inputs) == 1


@pytest.mark.parametrize("direction", [Direction.SW, Direction.NW])
def test_move_rejects_mirrored_direction_before_validation(direction: Direction) -> None:
    validator = StubValidator()
    rig = _rig(
        direction_profiles={
            Direction.SE: _profile(Direction.SE),
            Direction.NE: _profile(Direction.NE),
            direction: DirectionProfile(),
        }
    )

    result, projects, _ = _execute(
        MoveBone(
            bone_id="arm",
            direction=direction,
            local_position=Vec2(x=1.0, y=1.0),
        ),
        rig=rig,
        validator=validator,
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_UPDATE_REJECTED_CODE]
    assert "not authored" in result.diagnostics[0].message
    assert validator.inputs == []
    assert projects.save_calls == []


@pytest.mark.parametrize(
    "update",
    [
        MoveBone(
            bone_id="arm",
            direction=Direction.SE,
            local_position=Vec2(x=1.0, y=1.0),
        ),
        MovePivot(part_id="torso", direction=Direction.SE, pivot=Vec2(x=1.0, y=1.0)),
    ],
)
def test_direction_edit_rejects_missing_authored_rig_profile(
    update: MoveBone | MovePivot,
) -> None:
    rig = _rig(direction_profiles={Direction.NE: _profile(Direction.NE)})

    result, projects, _ = _execute(update, rig=rig, validator=StubValidator())

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_UPDATE_REJECTED_CODE]
    assert "no rig direction profile" in result.diagnostics[0].message
    assert projects.save_calls == []


def test_locked_bone_is_rejected_without_validation_or_save() -> None:
    validator = StubValidator()
    rig = _rig(bones=(_root_bone(), _arm_bone(locked=True)))

    result, projects, _ = _execute(
        MoveBone(
            bone_id="arm",
            direction=Direction.SE,
            local_position=Vec2(x=8.0, y=9.0),
        ),
        rig=rig,
        validator=validator,
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_UPDATE_REJECTED_CODE]
    assert "locked" in result.diagnostics[0].message
    assert validator.inputs == []
    assert projects.save_calls == []


def test_locked_bone_identical_effective_position_is_a_validated_noop() -> None:
    validator = StubValidator()
    rig = _rig(bones=(_root_bone(), _arm_bone(locked=True)))

    result, projects, _ = _execute(
        MoveBone(
            bone_id="arm",
            direction=Direction.SE,
            local_position=Vec2(x=4.0, y=5.0),
        ),
        rig=rig,
        validator=validator,
    )

    assert result.value is not None
    assert not result.value.changed
    assert result.value.project_revision_delta == 0
    assert result.diagnostics == ()
    assert len(validator.inputs) == 1
    assert projects.save_calls == []


@pytest.mark.parametrize(
    ("bones", "expected_fragment"),
    [
        ((_root_bone(),), "does not exist"),
        ((_root_bone(), _arm_bone(), _arm_bone()), "appears 2 times"),
    ],
)
def test_move_bone_rejects_missing_and_ambiguous_targets(
    bones: tuple[BoneDefinition, ...],
    expected_fragment: str,
) -> None:
    result, projects, _ = _execute(
        MoveBone(
            bone_id="arm",
            direction=Direction.SE,
            local_position=Vec2(x=8.0, y=9.0),
        ),
        rig=_rig(bones=bones),
        validator=StubValidator(),
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_UPDATE_TARGET_CODE]
    assert expected_fragment in result.diagnostics[0].message
    assert projects.save_calls == []


def test_sparse_profile_move_uses_base_rotation_and_scale_for_new_override() -> None:
    source = _rig(
        direction_profiles={
            Direction.SE: DirectionProfile(
                part_visibility={"torso": True},
                asset_selection={"torso": "se_torso"},
                pivots={"torso": Vec2(x=11.0, y=21.0)},
                slot_order={"torso": 2},
                track_multipliers={"arm.rotation_deg": 0.8},
            ),
            Direction.NE: _profile(Direction.NE),
        }
    )

    result, projects, _ = _execute(
        MoveBone(
            bone_id="arm",
            direction=Direction.SE,
            local_position=Vec2(x=30.0, y=40.0),
        ),
        rig=source,
    )

    assert result.value is not None, result.diagnostics
    selected_profile = result.value.rig.direction_profiles[Direction.SE]
    assert selected_profile.bone_rest_transforms == {
        "arm": Transform2D(
            position=Vec2(x=30.0, y=40.0),
            rotation_deg=7.0,
            scale=Vec2(x=0.8, y=1.1),
        )
    }
    assert selected_profile.track_multipliers == {"arm.rotation_deg": 0.8}
    assert result.value.rig.bones[1].rest_transform == source.bones[1].rest_transform
    assert len(projects.save_calls) == 1


def test_move_pivot_updates_only_selected_profile_and_preserves_base_and_other_profile() -> None:
    source = _rig()
    before = source.model_dump(mode="json")

    result, projects, _ = _execute(
        MovePivot(
            part_id="torso",
            direction=Direction.SE,
            pivot=Vec2(x=31.0, y=41.0),
        ),
        rig=source,
    )

    assert result.value is not None, result.diagnostics
    assert len(projects.save_calls) == 1
    assert result.value.rig.direction_profiles[Direction.SE].pivots["torso"] == Vec2(
        x=31.0,
        y=41.0,
    )
    assert (
        result.value.rig.direction_profiles[Direction.NE] == source.direction_profiles[Direction.NE]
    )
    assert result.value.rig.parts[0].pivot_by_direction == source.parts[0].pivot_by_direction
    assert (
        result.value.rig.direction_profiles[Direction.SE].bone_rest_transforms
        == source.direction_profiles[Direction.SE].bone_rest_transforms
    )
    assert source.model_dump(mode="json") == before
    assert result.value.rig.parts[0].pivot_by_direction is not source.parts[0].pivot_by_direction
    assert (
        result.value.rig.direction_profiles[Direction.SE].pivots
        is not source.direction_profiles[Direction.SE].pivots
    )
    assert (
        result.value.rig.direction_profiles[Direction.NE].asset_selection
        is not source.direction_profiles[Direction.NE].asset_selection
    )


@pytest.mark.parametrize(
    "profile",
    [
        _profile(Direction.SE, asset_selection={}),
        _profile(Direction.SE, asset_selection={"torso": "ne_torso"}),
        _profile(Direction.SE, asset_selection={"torso": "missing_asset"}),
    ],
)
def test_move_pivot_requires_an_effective_same_direction_catalog_asset(
    profile: DirectionProfile,
) -> None:
    part = _part(assets_by_direction={Direction.NE: "ne_torso"})
    rig = _rig(
        parts=(part,),
        direction_profiles={
            Direction.SE: profile,
            Direction.NE: _profile(Direction.NE),
        },
    )

    result, projects, _ = _execute(
        MovePivot(
            part_id="torso",
            direction=Direction.SE,
            pivot=Vec2(x=5.0, y=6.0),
        ),
        rig=rig,
        validator=StubValidator(),
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_UPDATE_REJECTED_CODE]
    assert "no effective catalog asset" in result.diagnostics[0].message
    assert projects.save_calls == []


def test_move_pivot_accepts_profile_selected_se_asset_when_base_binding_lacks_se() -> None:
    source = _rig(
        parts=(_part(assets_by_direction={Direction.NE: "ne_torso"}),),
        direction_profiles={
            Direction.SE: _profile(
                Direction.SE,
                asset_selection={"torso": "se_torso"},
            ),
            Direction.NE: _profile(Direction.NE),
        },
    )

    result, projects, _ = _execute(
        MovePivot(
            part_id="torso",
            direction=Direction.SE,
            pivot=Vec2(x=15.0, y=25.0),
        ),
        rig=source,
    )

    assert result.value is not None, result.diagnostics
    assert result.value.rig.parts[0].assets_by_direction == {Direction.NE: "ne_torso"}
    assert result.value.rig.direction_profiles[Direction.SE].asset_selection == {
        "torso": "se_torso"
    }
    assert result.value.rig.direction_profiles[Direction.SE].pivots["torso"] == Vec2(
        x=15.0,
        y=25.0,
    )
    assert len(projects.save_calls) == 1


def test_effective_pivot_noop_does_not_create_a_redundant_override() -> None:
    profile = _profile(Direction.SE)
    profile_without_pivot = DirectionProfile(
        bone_rest_transforms=dict(profile.bone_rest_transforms),
        part_visibility=dict(profile.part_visibility),
        asset_selection=dict(profile.asset_selection),
        slot_order=dict(profile.slot_order),
        track_multipliers=dict(profile.track_multipliers),
    )
    rig = _rig(
        direction_profiles={
            Direction.SE: profile_without_pivot,
            Direction.NE: _profile(Direction.NE),
        }
    )

    result, projects, _ = _execute(
        MovePivot(
            part_id="torso",
            direction=Direction.SE,
            pivot=Vec2(x=10.0, y=20.0),
        ),
        rig=rig,
    )

    assert result.value is not None
    assert not result.value.changed
    assert "torso" not in result.value.rig.direction_profiles[Direction.SE].pivots
    assert projects.save_calls == []


def test_assign_part_rebinds_existing_part_without_changing_other_fields() -> None:
    source = _rig()

    result, projects, _ = _execute(AssignPart(part_id="torso", bone_id="arm"), rig=source)

    assert result.value is not None, result.diagnostics
    assert result.value.rig.parts[0].bone_id == "arm"
    expected = source.parts[0].model_dump(mode="json")
    actual = result.value.rig.parts[0].model_dump(mode="json")
    assert actual == {**expected, "bone_id": "arm"}
    assert len(projects.save_calls) == 1


def test_assign_part_reports_both_ambiguous_part_and_missing_bone_stably() -> None:
    duplicate_parts = (_part(), _part())

    result, projects, _ = _execute(
        AssignPart(part_id="torso", bone_id="missing"),
        rig=_rig(parts=duplicate_parts),
        validator=StubValidator(),
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [
        RIG_UPDATE_TARGET_CODE,
        RIG_UPDATE_TARGET_CODE,
    ]
    assert [item.location for item in result.diagnostics] == ["bones", "parts"]
    assert projects.save_calls == []


def test_change_draw_slot_uses_authored_inventory_and_preserves_part_fields() -> None:
    source = _rig()

    result, projects, _ = _execute(
        ChangeDrawSlot(part_id="torso", draw_slot="fx_front"),
        rig=source,
    )

    assert result.value is not None, result.diagnostics
    assert result.value.rig.parts[0].draw_slot == "fx_front"
    expected = source.parts[0].model_dump(mode="json")
    actual = result.value.rig.parts[0].model_dump(mode="json")
    assert actual == {**expected, "draw_slot": "fx_front"}
    assert len(projects.save_calls) == 1


def test_draw_slot_declared_only_by_mirrored_profile_is_rejected() -> None:
    rig = _rig(
        draw_slot_profiles={
            Direction.SE: ("torso", "fx_front"),
            Direction.NE: ("torso", "fx_front"),
            Direction.SW: ("mirrored_only",),
        }
    )

    result, projects, _ = _execute(
        ChangeDrawSlot(part_id="torso", draw_slot="mirrored_only"),
        rig=rig,
        validator=StubValidator(),
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ValidationCode.UNKNOWN_DRAW_SLOT]
    assert projects.save_calls == []


def test_real_validator_blocks_slot_missing_from_one_authored_profile() -> None:
    rig = _rig(
        draw_slot_profiles={
            Direction.SE: ("torso", "fx_front"),
            Direction.NE: ("torso",),
        }
    )

    result, projects, _ = _execute(
        ChangeDrawSlot(part_id="torso", draw_slot="fx_front"),
        rig=rig,
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [ValidationCode.UNKNOWN_DRAW_SLOT]
    assert result.diagnostics[0].location == "parts[0].draw_slot"
    assert "direction 'NE'" in result.diagnostics[0].message
    assert projects.save_calls == []


def test_unsupported_runtime_update_is_rejected_without_validation() -> None:
    validator = StubValidator()
    unsupported = cast(RigElementUpdate, object())

    result, projects, _ = _execute(unsupported, validator=validator)

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_UPDATE_REJECTED_CODE]
    assert validator.inputs == []
    assert projects.save_calls == []


@pytest.mark.parametrize("severity", [Severity.ERROR, Severity.WARNING])
def test_full_validator_blocks_errors_but_allows_warning_only_save(severity: Severity) -> None:
    diagnostic = Diagnostic(
        code="AFV999",
        severity=severity,
        message="Controlled validator result.",
    )
    validator = StubValidator((diagnostic,))

    result, projects, _ = _execute(
        AssignPart(part_id="torso", bone_id="arm"),
        validator=validator,
    )

    assert result.diagnostics == (diagnostic,)
    assert len(validator.inputs) == 1
    if severity is Severity.ERROR:
        assert result.value is None
        assert projects.save_calls == []
    else:
        assert result.value is not None
        assert len(projects.save_calls) == 1


def test_save_failure_preserves_warnings_and_adds_stably_sorted_afu001() -> None:
    warning = Diagnostic(
        code="AFV403",
        severity=Severity.WARNING,
        message="Unused socket warning.",
    )
    save_error = ProjectValidationError("Rig destination is read-only.", path="rig/main.json")

    result, projects, _ = _execute(
        AssignPart(part_id="torso", bone_id="arm"),
        validator=StubValidator((warning,)),
        save_error=save_error,
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_UPDATE_FAILURE_CODE, "AFV403"]
    assert projects.save_calls == []


@pytest.mark.parametrize("stage", ["project", "rig", "layers"])
def test_expected_load_failures_map_to_afu001_without_downstream_save(stage: str) -> None:
    error = ProjectVersionError("Unsupported document version.")
    keyword = {
        "project": {"project_error": error},
        "rig": {"rig_error": error},
        "layers": {"layer_error": error},
    }[stage]

    result, projects, layer_repository = _execute(
        AssignPart(part_id="torso", bone_id="arm"),
        validator=StubValidator(),
        **keyword,
    )

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_UPDATE_FAILURE_CODE]
    assert projects.save_calls == []
    assert layer_repository.load_count == (1 if stage == "layers" else 0)
