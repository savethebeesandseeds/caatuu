"""Application use case for one validated, atomic rig-element edit."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from animated_fabric.application.ports import (
    LAYER_MANIFEST_FILENAME,
    LayerManifestRepository,
    ProjectRepository,
)
from animated_fabric.domain._base import ProjectPath, SemanticId
from animated_fabric.domain.assets import LayerManifest
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import ProjectValidationError, ProjectVersionError
from animated_fabric.domain.geometry import Transform2D, Vec2
from animated_fabric.domain.project import Direction, DirectionMode, ProjectManifest
from animated_fabric.domain.rig import (
    BoneDefinition,
    DirectionProfile,
    PartBinding,
    RigDefinition,
    SocketDefinition,
)
from animated_fabric.domain.validation import (
    ProjectValidator,
    ValidationCode,
    ValidationInput,
)
from animated_fabric.domain.validation.models import diagnostic_sort_key

RIG_UPDATE_FAILURE_CODE = "AFU001"
RIG_UPDATE_TARGET_CODE = "AFU002"
RIG_UPDATE_REJECTED_CODE = "AFU003"


@dataclass(frozen=True, slots=True)
class MoveBone:
    """Set one bone's local position in one authored direction profile."""

    bone_id: SemanticId
    direction: Direction
    local_position: Vec2


@dataclass(frozen=True, slots=True)
class MovePivot:
    """Set one part's trimmed-image pivot in one authored direction profile."""

    part_id: SemanticId
    direction: Direction
    pivot: Vec2


@dataclass(frozen=True, slots=True)
class AssignPart:
    """Rebind one existing visual part to one existing bone."""

    part_id: SemanticId
    bone_id: SemanticId


@dataclass(frozen=True, slots=True)
class ChangeDrawSlot:
    """Assign one existing visual part to a declared draw slot."""

    part_id: SemanticId
    draw_slot: SemanticId


type RigElementUpdate = MoveBone | MovePivot | AssignPart | ChangeDrawSlot


@dataclass(frozen=True, slots=True)
class UpdateRigElementRequest:
    """Identify a project and the single rig edit to apply."""

    project_root: Path
    update: RigElementUpdate


@dataclass(frozen=True, slots=True)
class UpdateRigElementResult:
    """Validated rig state and its transient cache-revision effect."""

    rig: RigDefinition
    rig_path: ProjectPath
    changed: bool
    project_revision_delta: Literal[0, 1]


@dataclass(frozen=True, slots=True)
class _EditOutcome:
    rig: RigDefinition | None
    changed: bool = False
    diagnostics: tuple[Diagnostic, ...] = ()


class UpdateRigElement:
    """Load, edit, validate, and atomically save one rig document."""

    def __init__(
        self,
        projects: ProjectRepository,
        layers: LayerManifestRepository,
        validator: ProjectValidator,
    ) -> None:
        self._projects = projects
        self._layers = layers
        self._validator = validator

    def execute(
        self,
        request: UpdateRigElementRequest,
    ) -> OperationResult[UpdateRigElementResult]:
        """Apply exactly one edit, publishing only a fully valid changed rig."""
        try:
            project = self._projects.load(request.project_root)
        except (ProjectValidationError, ProjectVersionError) as error:
            return _boundary_failure(
                error,
                fallback_path="project.animated-fabric.json",
                suggestion="Open a valid Animated Fabric project and retry the rig edit.",
            )

        try:
            rig = self._projects.load_rig(request.project_root, project.rig_path)
        except (ProjectValidationError, ProjectVersionError) as error:
            return _boundary_failure(
                error,
                fallback_path=project.rig_path,
                suggestion="Restore a valid rig document before editing it.",
            )

        try:
            layer_manifest = self._layers.load_layer_manifest(request.project_root)
        except (ProjectValidationError, ProjectVersionError) as error:
            return _boundary_failure(
                error,
                fallback_path=LAYER_MANIFEST_FILENAME,
                suggestion="Restore a valid layer catalog before editing the rig.",
            )

        edit = _apply_update(
            project,
            rig,
            layer_manifest,
            request.update,
        )
        if edit.rig is None:
            return OperationResult[UpdateRigElementResult](diagnostics=edit.diagnostics)

        diagnostics = tuple(
            sorted(
                self._validator.validate(
                    ValidationInput(
                        manifest=project,
                        rig=edit.rig,
                        assets=layer_manifest.layers,
                    )
                ),
                key=diagnostic_sort_key,
            )
        )
        if any(item.severity is Severity.ERROR for item in diagnostics):
            return OperationResult[UpdateRigElementResult](diagnostics=diagnostics)

        if edit.changed:
            try:
                self._projects.save_rig(
                    request.project_root,
                    project.rig_path,
                    edit.rig,
                    replace_existing=True,
                )
            except (ProjectValidationError, ProjectVersionError) as error:
                failure = _failure_diagnostic(
                    str(error) or "The edited rig could not be saved.",
                    path=getattr(error, "path", None) or project.rig_path,
                    suggestion="Check the approved project path and filesystem permissions.",
                )
                return OperationResult[UpdateRigElementResult](
                    diagnostics=tuple(sorted((*diagnostics, failure), key=diagnostic_sort_key))
                )

        revision_delta: Literal[0, 1] = 1 if edit.changed else 0
        return OperationResult[UpdateRigElementResult](
            value=UpdateRigElementResult(
                rig=edit.rig,
                rig_path=project.rig_path,
                changed=edit.changed,
                project_revision_delta=revision_delta,
            ),
            diagnostics=diagnostics,
        )


def _apply_update(
    project: ProjectManifest,
    source_rig: RigDefinition,
    layer_manifest: LayerManifest,
    update: RigElementUpdate,
) -> _EditOutcome:
    rig = _copy_rig(source_rig)
    if isinstance(update, MoveBone):
        return _move_bone(project, rig, update)
    if isinstance(update, MovePivot):
        return _move_pivot(project, rig, layer_manifest, update)
    if isinstance(update, AssignPart):
        return _assign_part(project, rig, update)
    if isinstance(update, ChangeDrawSlot):
        return _change_draw_slot(project, rig, update)
    return _EditOutcome(
        rig=None,
        diagnostics=(
            _rejected_diagnostic(
                "The requested rig edit type is not supported.",
                path=project.rig_path,
                location="update",
                suggestion="Use a supported AF-033 rig-element edit command.",
            ),
        ),
    )


def _move_bone(
    project: ProjectManifest,
    rig: RigDefinition,
    update: MoveBone,
) -> _EditOutcome:
    direction_failure = _authored_direction_failure(project, rig, update.direction)
    if direction_failure is not None:
        return _EditOutcome(rig=None, diagnostics=(direction_failure,))

    matches = tuple(bone for bone in rig.bones if bone.bone_id == update.bone_id)
    target_failure = _target_failure(
        "Bone",
        update.bone_id,
        len(matches),
        path=project.rig_path,
        location="bones",
    )
    if target_failure is not None:
        return _EditOutcome(rig=None, diagnostics=(target_failure,))

    bone = matches[0]
    profile = rig.direction_profiles[update.direction]
    effective_transform = profile.bone_rest_transforms.get(
        bone.bone_id,
        bone.rest_transform,
    )
    if effective_transform.position == update.local_position:
        return _EditOutcome(rig=rig)

    if bone.locked:
        return _EditOutcome(
            rig=None,
            diagnostics=(
                _rejected_diagnostic(
                    f"Bone '{bone.bone_id}' is locked and cannot be moved.",
                    path=project.rig_path,
                    location=f"bones.{bone.bone_id}.locked",
                    suggestion="Unlock the bone deliberately before moving it.",
                ),
            ),
        )

    transforms = {
        bone_id: _copy_transform(transform)
        for bone_id, transform in profile.bone_rest_transforms.items()
    }
    transforms[bone.bone_id] = Transform2D(
        position=_copy_vec(update.local_position),
        rotation_deg=effective_transform.rotation_deg,
        scale=_copy_vec(effective_transform.scale),
    )
    changed_profile = _profile_with_bone_transforms(profile, transforms)
    return _EditOutcome(
        rig=_rig_with_profile(rig, update.direction, changed_profile),
        changed=True,
    )


def _move_pivot(
    project: ProjectManifest,
    rig: RigDefinition,
    layer_manifest: LayerManifest,
    update: MovePivot,
) -> _EditOutcome:
    direction_failure = _authored_direction_failure(project, rig, update.direction)
    if direction_failure is not None:
        return _EditOutcome(rig=None, diagnostics=(direction_failure,))

    matches = tuple(part for part in rig.parts if part.part_id == update.part_id)
    target_failure = _target_failure(
        "Part",
        update.part_id,
        len(matches),
        path=project.rig_path,
        location="parts",
    )
    if target_failure is not None:
        return _EditOutcome(rig=None, diagnostics=(target_failure,))

    part = matches[0]
    profile = rig.direction_profiles[update.direction]
    selected_asset_id = profile.asset_selection.get(
        part.part_id,
        part.assets_by_direction.get(update.direction),
    )
    assets_by_id = {asset.asset_id: asset for asset in layer_manifest.layers}
    selected_asset = None if selected_asset_id is None else assets_by_id.get(selected_asset_id)
    if selected_asset is None or selected_asset.direction is not update.direction:
        return _EditOutcome(
            rig=None,
            diagnostics=(
                _rejected_diagnostic(
                    (
                        f"Part '{part.part_id}' has no effective catalog asset for authored "
                        f"direction '{update.direction.value}'."
                    ),
                    path=project.rig_path,
                    location=(f"direction_profiles.{update.direction.value}.pivots.{part.part_id}"),
                    suggestion="Assign a valid asset for this direction before moving its pivot.",
                ),
            ),
        )

    effective_pivot = profile.pivots.get(
        part.part_id,
        part.pivot_by_direction.get(update.direction, Vec2(x=0.0, y=0.0)),
    )
    if effective_pivot == update.pivot:
        return _EditOutcome(rig=rig)

    pivots = {part_id: _copy_vec(pivot) for part_id, pivot in profile.pivots.items()}
    pivots[part.part_id] = _copy_vec(update.pivot)
    changed_profile = _profile_with_pivots(profile, pivots)
    return _EditOutcome(
        rig=_rig_with_profile(rig, update.direction, changed_profile),
        changed=True,
    )


def _assign_part(
    project: ProjectManifest,
    rig: RigDefinition,
    update: AssignPart,
) -> _EditOutcome:
    part_matches = tuple(part for part in rig.parts if part.part_id == update.part_id)
    bone_matches = tuple(bone for bone in rig.bones if bone.bone_id == update.bone_id)
    failures = tuple(
        diagnostic
        for diagnostic in (
            _target_failure(
                "Part",
                update.part_id,
                len(part_matches),
                path=project.rig_path,
                location="parts",
            ),
            _target_failure(
                "Bone",
                update.bone_id,
                len(bone_matches),
                path=project.rig_path,
                location="bones",
            ),
        )
        if diagnostic is not None
    )
    if failures:
        return _EditOutcome(
            rig=None,
            diagnostics=tuple(sorted(failures, key=diagnostic_sort_key)),
        )

    part = part_matches[0]
    if part.bone_id == update.bone_id:
        return _EditOutcome(rig=rig)

    changed_parts = tuple(
        _part_with_bone(item, update.bone_id) if item.part_id == part.part_id else item
        for item in rig.parts
    )
    return _EditOutcome(rig=_rig_with_parts(rig, changed_parts), changed=True)


def _change_draw_slot(
    project: ProjectManifest,
    rig: RigDefinition,
    update: ChangeDrawSlot,
) -> _EditOutcome:
    matches = tuple(part for part in rig.parts if part.part_id == update.part_id)
    target_failure = _target_failure(
        "Part",
        update.part_id,
        len(matches),
        path=project.rig_path,
        location="parts",
    )
    if target_failure is not None:
        return _EditOutcome(rig=None, diagnostics=(target_failure,))

    authored_directions = {
        direction
        for direction, definition in project.directions.items()
        if definition.mode is DirectionMode.AUTHORED
    }
    known_slots = {
        slot
        for direction in authored_directions
        for slot in rig.draw_slot_profiles.get(direction, ())
    }
    if update.draw_slot not in known_slots:
        return _EditOutcome(
            rig=None,
            diagnostics=(
                Diagnostic(
                    code=ValidationCode.UNKNOWN_DRAW_SLOT,
                    severity=Severity.ERROR,
                    message=f"Draw slot '{update.draw_slot}' is not declared by this rig.",
                    path=project.rig_path,
                    location=f"parts.{update.part_id}.draw_slot",
                    suggestion="Choose a slot declared by an authored direction profile.",
                ),
            ),
        )

    part = matches[0]
    if part.draw_slot == update.draw_slot:
        return _EditOutcome(rig=rig)

    changed_parts = tuple(
        _part_with_draw_slot(item, update.draw_slot) if item.part_id == part.part_id else item
        for item in rig.parts
    )
    return _EditOutcome(rig=_rig_with_parts(rig, changed_parts), changed=True)


def _authored_direction_failure(
    project: ProjectManifest,
    rig: RigDefinition,
    direction: Direction,
) -> Diagnostic | None:
    definition = project.directions.get(direction)
    if definition is None or definition.mode is not DirectionMode.AUTHORED:
        return _rejected_diagnostic(
            f"Direction '{direction.value}' is not authored and cannot own rig edits.",
            path=project.rig_path,
            location=f"direction_profiles.{direction.value}",
            suggestion="Edit the authored source direction instead of a mirrored direction.",
        )
    if direction not in rig.direction_profiles:
        return _rejected_diagnostic(
            f"Authored direction '{direction.value}' has no rig direction profile to edit.",
            path=project.rig_path,
            location=f"direction_profiles.{direction.value}",
            suggestion="Restore or apply the authored rig direction profile before editing it.",
        )
    return None


def _target_failure(
    target_type: str,
    target_id: str,
    match_count: int,
    *,
    path: ProjectPath,
    location: str,
) -> Diagnostic | None:
    if match_count == 1:
        return None
    if match_count == 0:
        message = f"{target_type} '{target_id}' does not exist."
        suggestion = f"Choose an existing {target_type.lower()} ID."
    else:
        message = (
            f"{target_type} '{target_id}' is ambiguous because it appears {match_count} times."
        )
        suggestion = "Repair duplicate rig IDs before editing this target."
    return Diagnostic(
        code=RIG_UPDATE_TARGET_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        location=location,
        suggestion=suggestion,
    )


def _rejected_diagnostic(
    message: str,
    *,
    path: ProjectPath,
    location: str,
    suggestion: str,
) -> Diagnostic:
    return Diagnostic(
        code=RIG_UPDATE_REJECTED_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        location=location,
        suggestion=suggestion,
    )


def _boundary_failure(
    error: Exception,
    *,
    fallback_path: str,
    suggestion: str,
) -> OperationResult[UpdateRigElementResult]:
    return OperationResult[UpdateRigElementResult](
        diagnostics=(
            _failure_diagnostic(
                str(error) or "The rig edit could not continue.",
                path=getattr(error, "path", None) or fallback_path,
                suggestion=suggestion,
            ),
        )
    )


def _failure_diagnostic(message: str, *, path: str, suggestion: str) -> Diagnostic:
    return Diagnostic(
        code=RIG_UPDATE_FAILURE_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        suggestion=suggestion,
    )


def _copy_vec(value: Vec2) -> Vec2:
    return Vec2(x=value.x, y=value.y)


def _copy_transform(value: Transform2D) -> Transform2D:
    return Transform2D(
        position=_copy_vec(value.position),
        rotation_deg=value.rotation_deg,
        scale=_copy_vec(value.scale),
    )


def _copy_bone(value: BoneDefinition) -> BoneDefinition:
    return BoneDefinition(
        bone_id=value.bone_id,
        parent_id=value.parent_id,
        rest_transform=_copy_transform(value.rest_transform),
        length_hint=value.length_hint,
        locked=value.locked,
    )


def _copy_part(value: PartBinding) -> PartBinding:
    return PartBinding(
        part_id=value.part_id,
        semantic_part=value.semantic_part,
        bone_id=value.bone_id,
        assets_by_direction=dict(value.assets_by_direction),
        pivot_by_direction={
            direction: _copy_vec(pivot) for direction, pivot in value.pivot_by_direction.items()
        },
        bind_transform=_copy_transform(value.bind_transform),
        draw_slot=value.draw_slot,
        slot_order=value.slot_order,
        visible=value.visible,
        opacity=value.opacity,
    )


def _copy_socket(value: SocketDefinition) -> SocketDefinition:
    return SocketDefinition(
        socket_id=value.socket_id,
        bone_id=value.bone_id,
        local_transform=_copy_transform(value.local_transform),
        default_draw_slot=value.default_draw_slot,
    )


def _copy_profile(value: DirectionProfile) -> DirectionProfile:
    return DirectionProfile(
        bone_rest_transforms={
            bone_id: _copy_transform(transform)
            for bone_id, transform in value.bone_rest_transforms.items()
        },
        part_visibility=dict(value.part_visibility),
        asset_selection=dict(value.asset_selection),
        pivots={part_id: _copy_vec(pivot) for part_id, pivot in value.pivots.items()},
        slot_order=dict(value.slot_order),
        track_multipliers=dict(value.track_multipliers),
    )


def _copy_rig(value: RigDefinition) -> RigDefinition:
    return RigDefinition(
        format=value.format,
        schema_version=value.schema_version,
        rig_id=value.rig_id,
        template_id=value.template_id,
        bones=tuple(_copy_bone(bone) for bone in value.bones),
        parts=tuple(_copy_part(part) for part in value.parts),
        sockets=tuple(_copy_socket(socket) for socket in value.sockets),
        direction_profiles={
            direction: _copy_profile(profile)
            for direction, profile in value.direction_profiles.items()
        },
        draw_slot_profiles={
            direction: tuple(slots) for direction, slots in value.draw_slot_profiles.items()
        },
    )


def _profile_with_bone_transforms(
    profile: DirectionProfile,
    transforms: dict[str, Transform2D],
) -> DirectionProfile:
    return DirectionProfile(
        bone_rest_transforms=transforms,
        part_visibility=dict(profile.part_visibility),
        asset_selection=dict(profile.asset_selection),
        pivots={part_id: _copy_vec(pivot) for part_id, pivot in profile.pivots.items()},
        slot_order=dict(profile.slot_order),
        track_multipliers=dict(profile.track_multipliers),
    )


def _profile_with_pivots(
    profile: DirectionProfile,
    pivots: dict[str, Vec2],
) -> DirectionProfile:
    return DirectionProfile(
        bone_rest_transforms={
            bone_id: _copy_transform(transform)
            for bone_id, transform in profile.bone_rest_transforms.items()
        },
        part_visibility=dict(profile.part_visibility),
        asset_selection=dict(profile.asset_selection),
        pivots=pivots,
        slot_order=dict(profile.slot_order),
        track_multipliers=dict(profile.track_multipliers),
    )


def _rig_with_profile(
    rig: RigDefinition,
    direction: Direction,
    profile: DirectionProfile,
) -> RigDefinition:
    profiles = {
        item_direction: item_profile
        for item_direction, item_profile in rig.direction_profiles.items()
    }
    profiles[direction] = profile
    return RigDefinition(
        format=rig.format,
        schema_version=rig.schema_version,
        rig_id=rig.rig_id,
        template_id=rig.template_id,
        bones=rig.bones,
        parts=rig.parts,
        sockets=rig.sockets,
        direction_profiles=profiles,
        draw_slot_profiles=rig.draw_slot_profiles,
    )


def _rig_with_parts(
    rig: RigDefinition,
    parts: tuple[PartBinding, ...],
) -> RigDefinition:
    return RigDefinition(
        format=rig.format,
        schema_version=rig.schema_version,
        rig_id=rig.rig_id,
        template_id=rig.template_id,
        bones=rig.bones,
        parts=parts,
        sockets=rig.sockets,
        direction_profiles=rig.direction_profiles,
        draw_slot_profiles=rig.draw_slot_profiles,
    )


def _part_with_bone(part: PartBinding, bone_id: str) -> PartBinding:
    return PartBinding(
        part_id=part.part_id,
        semantic_part=part.semantic_part,
        bone_id=bone_id,
        assets_by_direction=dict(part.assets_by_direction),
        pivot_by_direction={
            direction: _copy_vec(pivot) for direction, pivot in part.pivot_by_direction.items()
        },
        bind_transform=_copy_transform(part.bind_transform),
        draw_slot=part.draw_slot,
        slot_order=part.slot_order,
        visible=part.visible,
        opacity=part.opacity,
    )


def _part_with_draw_slot(part: PartBinding, draw_slot: str) -> PartBinding:
    return PartBinding(
        part_id=part.part_id,
        semantic_part=part.semantic_part,
        bone_id=part.bone_id,
        assets_by_direction=dict(part.assets_by_direction),
        pivot_by_direction={
            direction: _copy_vec(pivot) for direction, pivot in part.pivot_by_direction.items()
        },
        bind_transform=_copy_transform(part.bind_transform),
        draw_slot=draw_slot,
        slot_order=part.slot_order,
        visible=part.visible,
        opacity=part.opacity,
    )


__all__ = [
    "AssignPart",
    "ChangeDrawSlot",
    "MoveBone",
    "MovePivot",
    "RIG_UPDATE_FAILURE_CODE",
    "RIG_UPDATE_REJECTED_CODE",
    "RIG_UPDATE_TARGET_CODE",
    "RigElementUpdate",
    "UpdateRigElement",
    "UpdateRigElementRequest",
    "UpdateRigElementResult",
]
