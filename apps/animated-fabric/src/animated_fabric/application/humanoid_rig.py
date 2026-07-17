"""Deterministic construction of the built-in humanoid rig."""

from __future__ import annotations

from collections.abc import Mapping

from animated_fabric.domain.assets import AssetLayer, LayerManifest
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.domain.geometry import Transform2D, Vec2
from animated_fabric.domain.project import Direction, DirectionMode, ProjectManifest
from animated_fabric.domain.rig import (
    BoneDefinition,
    DirectionProfile,
    PartBinding,
    RigDefinition,
    SocketDefinition,
)
from animated_fabric.domain.templates import RigTemplate, TemplatePart

RIG_TEMPLATE_MISSING_PART_CODE = "AFT002"
RIG_TEMPLATE_OPTIONAL_DIRECTION_CODE = "AFT004"
RIG_TEMPLATE_AMBIGUOUS_PART_CODE = "AFT005"
RIG_TEMPLATE_VALIDATION_CODE = "AFT006"

_AUTHORED_DIRECTIONS = (Direction.SE, Direction.NE)
_REFERENCE_CANVAS_WIDTH = 192.0
_REFERENCE_CANVAS_HEIGHT = 192.0
_REFERENCE_GROUND_ANCHOR = Vec2(x=96.0, y=160.0)

# Absolute joint positions in the 192 x 192 reference canvas. Local transforms
# are derived from these values so the hierarchy remains the single authority.
_REFERENCE_WORLD_POSITIONS: Mapping[Direction, Mapping[str, Vec2]] = {
    Direction.SE: {
        "root": Vec2(x=96.0, y=160.0),
        "pelvis": Vec2(x=96.0, y=108.0),
        "torso": Vec2(x=96.0, y=94.0),
        "neck": Vec2(x=96.0, y=64.0),
        "head": Vec2(x=96.0, y=61.0),
        "upper_arm_l": Vec2(x=84.0, y=70.0),
        "lower_arm_l": Vec2(x=70.0, y=92.0),
        "hand_l": Vec2(x=61.0, y=115.0),
        "upper_arm_r": Vec2(x=108.0, y=69.0),
        "lower_arm_r": Vec2(x=122.0, y=92.0),
        "hand_r": Vec2(x=132.0, y=115.0),
        "thigh_l": Vec2(x=88.0, y=106.0),
        "shin_l": Vec2(x=82.0, y=130.0),
        "foot_l": Vec2(x=78.0, y=153.0),
        "thigh_r": Vec2(x=102.0, y=105.0),
        "shin_r": Vec2(x=112.0, y=130.0),
        "foot_r": Vec2(x=120.0, y=153.0),
    },
    Direction.NE: {
        "root": Vec2(x=96.0, y=160.0),
        "pelvis": Vec2(x=96.0, y=108.0),
        "torso": Vec2(x=96.0, y=94.0),
        "neck": Vec2(x=96.0, y=63.0),
        "head": Vec2(x=96.0, y=60.0),
        "upper_arm_l": Vec2(x=85.0, y=68.0),
        "lower_arm_l": Vec2(x=72.0, y=89.0),
        "hand_l": Vec2(x=61.0, y=112.0),
        "upper_arm_r": Vec2(x=108.0, y=68.0),
        "lower_arm_r": Vec2(x=122.0, y=90.0),
        "hand_r": Vec2(x=132.0, y=112.0),
        "thigh_l": Vec2(x=87.0, y=105.0),
        "shin_l": Vec2(x=81.0, y=130.0),
        "foot_l": Vec2(x=77.0, y=153.0),
        "thigh_r": Vec2(x=101.0, y=105.0),
        "shin_r": Vec2(x=111.0, y=131.0),
        "foot_r": Vec2(x=119.0, y=153.0),
    },
}

_PART_DRAW_SLOTS: Mapping[str, str] = {
    "torso": "torso",
    "head": "head",
    "upper_arm_l": "arm_far",
    "lower_arm_l": "arm_far",
    "hand_l": "arm_far",
    "upper_arm_r": "arm_near",
    "lower_arm_r": "arm_near",
    "hand_r": "arm_near",
    "thigh_l": "leg_far",
    "shin_l": "leg_far",
    "foot_l": "leg_far",
    "thigh_r": "leg_near",
    "shin_r": "leg_near",
    "foot_r": "leg_near",
    "pelvis_visual": "body_back",
    "neck_visual": "head_back",
    "hair_back": "head_back",
    "hair_front": "hair_front",
    "cape": "cape_back",
    "ground_shadow": "ground_shadow",
}

_PART_ORDERS: Mapping[Direction, tuple[str, ...]] = {
    Direction.SE: (
        "ground_shadow",
        "cape",
        "thigh_l",
        "shin_l",
        "foot_l",
        "upper_arm_l",
        "lower_arm_l",
        "hand_l",
        "thigh_r",
        "shin_r",
        "foot_r",
        "pelvis_visual",
        "torso",
        "neck_visual",
        "hair_back",
        "upper_arm_r",
        "lower_arm_r",
        "hand_r",
        "head",
        "hair_front",
    ),
    Direction.NE: (
        "ground_shadow",
        "cape",
        "thigh_r",
        "shin_r",
        "foot_r",
        "upper_arm_r",
        "lower_arm_r",
        "hand_r",
        "thigh_l",
        "shin_l",
        "foot_l",
        "pelvis_visual",
        "torso",
        "neck_visual",
        "hair_back",
        "upper_arm_l",
        "lower_arm_l",
        "hand_l",
        "head",
        "hair_front",
    ),
}

_DRAW_SLOT_PROFILES: Mapping[Direction, tuple[str, ...]] = {
    Direction.SE: (
        "ground_shadow",
        "cape_back",
        "weapon_back",
        "leg_far",
        "arm_far",
        "leg_near",
        "body_back",
        "torso",
        "head_back",
        "arm_near",
        "head",
        "hair_front",
        "shield_front",
        "weapon_front",
        "fx_front",
    ),
    Direction.NE: (
        "ground_shadow",
        "cape_back",
        "weapon_back",
        "leg_near",
        "arm_near",
        "leg_far",
        "body_back",
        "torso",
        "head_back",
        "arm_far",
        "head",
        "hair_front",
        "shield_front",
        "weapon_front",
        "fx_front",
    ),
}

_REFERENCE_SOCKET_OFFSETS: Mapping[str, Vec2] = {
    "head_hat": Vec2(x=0.0, y=-22.0),
    "head_face": Vec2(x=8.0, y=-8.0),
    "back_cape": Vec2(x=0.0, y=-22.0),
    "hand_l_item": Vec2(x=0.0, y=0.0),
    "hand_r_weapon": Vec2(x=0.0, y=0.0),
    "hand_l_shield": Vec2(x=0.0, y=0.0),
    "waist_item": Vec2(x=0.0, y=0.0),
    "root_shadow": Vec2(x=0.0, y=0.0),
}


class HumanoidRigBuilder:
    """Build ``humanoid_v1`` from validated project and layer records without IO."""

    def build(
        self,
        project: ProjectManifest,
        template: RigTemplate,
        layer_manifest: LayerManifest,
    ) -> OperationResult[RigDefinition]:
        """Return a complete rig or deterministic application diagnostics."""
        diagnostics = self._preflight(project, template, layer_manifest)
        selected, mapping_diagnostics = self._select_assets(template, layer_manifest)
        diagnostics.extend(mapping_diagnostics)

        required_parts = {part.part_id for part in template.required_parts}
        optional_parts = {part.part_id for part in template.optional_parts}
        for part_id in sorted(required_parts):
            for direction in _AUTHORED_DIRECTIONS:
                if (part_id, direction) not in selected:
                    diagnostics.append(
                        Diagnostic(
                            code=RIG_TEMPLATE_MISSING_PART_CODE,
                            severity=Severity.ERROR,
                            message=(
                                f"Required part '{part_id}' has no imported "
                                f"{direction.value} asset."
                            ),
                            path="layers.manifest.json",
                            location=f"{direction.value}.{part_id}",
                            suggestion=(
                                f"Import '{part_id}' for authored direction "
                                f"'{direction.value}' before applying the template."
                            ),
                        )
                    )

        for part_id in sorted(optional_parts):
            present = tuple(
                direction for direction in _AUTHORED_DIRECTIONS if (part_id, direction) in selected
            )
            if present and len(present) != len(_AUTHORED_DIRECTIONS):
                missing = next(
                    direction for direction in _AUTHORED_DIRECTIONS if direction not in present
                )
                diagnostics.append(
                    Diagnostic(
                        code=RIG_TEMPLATE_OPTIONAL_DIRECTION_CODE,
                        severity=Severity.WARNING,
                        message=(
                            f"Optional part '{part_id}' is absent from authored direction "
                            f"'{missing.value}'."
                        ),
                        path="layers.manifest.json",
                        location=f"{missing.value}.{part_id}",
                        suggestion=(
                            "Import the missing optional layer or keep the part hidden in "
                            "that direction."
                        ),
                    )
                )

        diagnostics.sort(key=_diagnostic_sort_key)
        if any(item.severity is Severity.ERROR for item in diagnostics):
            return OperationResult[RigDefinition](diagnostics=tuple(diagnostics))

        worlds = {
            direction: self._scaled_world_positions(project, direction)
            for direction in _AUTHORED_DIRECTIONS
        }
        local_transforms = {
            direction: self._local_bone_transforms(template, worlds[direction])
            for direction in _AUTHORED_DIRECTIONS
        }
        bones = tuple(
            BoneDefinition(
                bone_id=bone.bone_id,
                parent_id=bone.parent_id,
                rest_transform=local_transforms[Direction.SE][bone.bone_id],
            )
            for bone in template.bones
        )

        declared_parts = (*template.required_parts, *template.optional_parts)
        bound_parts = tuple(
            part
            for declaration in declared_parts
            if (
                part := self._build_part_binding(
                    declaration,
                    selected,
                    worlds,
                )
            )
            is not None
        )
        direction_profiles = {
            direction: self._build_direction_profile(
                direction,
                bound_parts,
                local_transforms[direction],
            )
            for direction in _AUTHORED_DIRECTIONS
        }

        scale_x = project.canvas.width / _REFERENCE_CANVAS_WIDTH
        scale_y = project.canvas.height / _REFERENCE_CANVAS_HEIGHT
        sockets = tuple(
            SocketDefinition(
                socket_id=socket.socket_id,
                bone_id=socket.bone_id,
                local_transform=Transform2D(
                    position=Vec2(
                        x=_socket_offset(socket.socket_id).x * scale_x,
                        y=_socket_offset(socket.socket_id).y * scale_y,
                    )
                ),
                default_draw_slot=socket.default_draw_slot,
            )
            for socket in template.default_sockets
        )

        rig = RigDefinition(
            format="animated-fabric.rig.v1",
            schema_version="0.1.0",
            rig_id="main",
            template_id=template.template_id,
            bones=bones,
            parts=bound_parts,
            sockets=sockets,
            direction_profiles=direction_profiles,
            draw_slot_profiles={
                direction: _DRAW_SLOT_PROFILES[direction] for direction in _AUTHORED_DIRECTIONS
            },
        )
        return OperationResult[RigDefinition](value=rig, diagnostics=tuple(diagnostics))

    @staticmethod
    def _preflight(
        project: ProjectManifest,
        template: RigTemplate,
        layer_manifest: LayerManifest,
    ) -> list[Diagnostic]:
        diagnostics: list[Diagnostic] = []
        if template.template_id != project.template_id or template.template_id != "humanoid_v1":
            diagnostics.append(
                _failure_diagnostic(
                    "The selected project and built-in humanoid template do not match.",
                    location="template_id",
                    suggestion="Use a project configured with template_id 'humanoid_v1'.",
                )
            )
        for direction in _AUTHORED_DIRECTIONS:
            definition = project.directions.get(direction)
            if definition is None or definition.mode is not DirectionMode.AUTHORED:
                diagnostics.append(
                    _failure_diagnostic(
                        f"Direction '{direction.value}' must be authored before rigging.",
                        location=f"directions.{direction.value}",
                        suggestion=(
                            f"Configure '{direction.value}' as an authored project direction."
                        ),
                    )
                )

        limits = {limit.value_id: limit for limit in template.limits}
        project_values = {
            "canvas_width_px": float(project.canvas.width),
            "canvas_height_px": float(project.canvas.height),
            "ground_anchor_x_px": project.canvas.ground_anchor.x,
            "ground_anchor_y_px": project.canvas.ground_anchor.y,
        }
        for value_id, value in project_values.items():
            limit = limits.get(value_id)
            if limit is not None and not limit.minimum <= value <= limit.maximum:
                diagnostics.append(
                    _failure_diagnostic(
                        f"Project value '{value_id}' is outside the template limits.",
                        location=f"canvas.{value_id}",
                        suggestion=(
                            f"Use a value between {limit.minimum:g} and {limit.maximum:g}."
                        ),
                    )
                )

        for asset in layer_manifest.layers:
            size = asset.source_canvas_size
            if size.width != project.canvas.width or size.height != project.canvas.height:
                diagnostics.append(
                    _failure_diagnostic(
                        (
                            f"Asset '{asset.asset_id}' uses canvas {size.width} x "
                            f"{size.height}; project canvas is {project.canvas.width} x "
                            f"{project.canvas.height}."
                        ),
                        path=asset.path,
                        location="source_canvas_size",
                        suggestion="Re-import the asset on the fixed project canvas.",
                    )
                )

        bone_ids = {bone.bone_id for bone in template.bones}
        for direction in _AUTHORED_DIRECTIONS:
            missing = bone_ids - set(_REFERENCE_WORLD_POSITIONS[direction])
            extra = set(_REFERENCE_WORLD_POSITIONS[direction]) - bone_ids
            if missing or extra:
                raise RigDefinitionError(
                    "The humanoid application layout and template bone set disagree."
                )
        declared_slots = set(template.draw_slots)
        declared_parts = {
            part.part_id for part in (*template.required_parts, *template.optional_parts)
        }
        if declared_parts != set(_PART_DRAW_SLOTS):
            raise RigDefinitionError(
                "The humanoid application slots and template part set disagree."
            )
        for direction in _AUTHORED_DIRECTIONS:
            if set(_DRAW_SLOT_PROFILES[direction]) != declared_slots:
                raise RigDefinitionError(
                    "The humanoid direction profile and template draw slots disagree."
                )
        socket_ids = {socket.socket_id for socket in template.default_sockets}
        if socket_ids != set(_REFERENCE_SOCKET_OFFSETS):
            raise RigDefinitionError("The humanoid socket layout and template socket set disagree.")
        return diagnostics

    @staticmethod
    def _select_assets(
        template: RigTemplate,
        layer_manifest: LayerManifest,
    ) -> tuple[dict[tuple[str, Direction], AssetLayer], list[Diagnostic]]:
        canonical_by_name = {
            part.part_id: part.part_id
            for part in (*template.required_parts, *template.optional_parts)
        }
        for alias_group in template.import_aliases:
            for alias in alias_group.aliases:
                canonical_by_name[alias] = alias_group.canonical_part

        selected: dict[tuple[str, Direction], AssetLayer] = {}
        diagnostics: list[Diagnostic] = []
        for asset in layer_manifest.layers:
            canonical = canonical_by_name.get(asset.semantic_part)
            if canonical is None:
                continue
            key = (canonical, asset.direction)
            previous = selected.get(key)
            if previous is not None:
                diagnostics.append(
                    Diagnostic(
                        code=RIG_TEMPLATE_AMBIGUOUS_PART_CODE,
                        severity=Severity.ERROR,
                        message=(
                            f"Assets '{previous.asset_id}' and '{asset.asset_id}' both map to "
                            f"'{canonical}' for direction '{asset.direction.value}'."
                        ),
                        path=asset.path,
                        location=f"{asset.direction.value}.{canonical}",
                        suggestion=(
                            "Keep one canonical or aliased asset for this part and direction."
                        ),
                    )
                )
                continue
            selected[key] = asset
        return selected, diagnostics

    @staticmethod
    def _scaled_world_positions(
        project: ProjectManifest,
        direction: Direction,
    ) -> dict[str, Vec2]:
        scale_x = project.canvas.width / _REFERENCE_CANVAS_WIDTH
        scale_y = project.canvas.height / _REFERENCE_CANVAS_HEIGHT
        anchor = project.canvas.ground_anchor
        return {
            bone_id: Vec2(
                x=anchor.x + (point.x - _REFERENCE_GROUND_ANCHOR.x) * scale_x,
                y=anchor.y + (point.y - _REFERENCE_GROUND_ANCHOR.y) * scale_y,
            )
            for bone_id, point in _REFERENCE_WORLD_POSITIONS[direction].items()
        }

    @staticmethod
    def _local_bone_transforms(
        template: RigTemplate,
        world_positions: Mapping[str, Vec2],
    ) -> dict[str, Transform2D]:
        transforms: dict[str, Transform2D] = {}
        for bone in template.bones:
            world = world_positions[bone.bone_id]
            parent = (
                Vec2(x=0.0, y=0.0) if bone.parent_id is None else world_positions[bone.parent_id]
            )
            transforms[bone.bone_id] = Transform2D(
                position=Vec2(x=world.x - parent.x, y=world.y - parent.y)
            )
        return transforms

    @staticmethod
    def _build_part_binding(
        declaration: TemplatePart,
        selected: Mapping[tuple[str, Direction], AssetLayer],
        worlds: Mapping[Direction, Mapping[str, Vec2]],
    ) -> PartBinding | None:
        assets = {
            direction: asset.asset_id
            for direction in _AUTHORED_DIRECTIONS
            if (asset := selected.get((declaration.part_id, direction))) is not None
        }
        if not assets:
            return None
        pivots = {
            direction: Vec2(
                x=worlds[direction][declaration.bone_id].x - asset.trim_origin.x,
                y=worlds[direction][declaration.bone_id].y - asset.trim_origin.y,
            )
            for direction in _AUTHORED_DIRECTIONS
            if (asset := selected.get((declaration.part_id, direction))) is not None
        }
        return PartBinding(
            part_id=declaration.part_id,
            semantic_part=declaration.part_id,
            bone_id=declaration.bone_id,
            assets_by_direction=assets,
            pivot_by_direction=pivots,
            draw_slot=_PART_DRAW_SLOTS[declaration.part_id],
            slot_order=_PART_ORDERS[Direction.SE].index(declaration.part_id),
        )

    @staticmethod
    def _build_direction_profile(
        direction: Direction,
        parts: tuple[PartBinding, ...],
        bone_transforms: Mapping[str, Transform2D],
    ) -> DirectionProfile:
        assets = {
            part.part_id: part.assets_by_direction[direction]
            for part in parts
            if direction in part.assets_by_direction
        }
        pivots = {
            part.part_id: part.pivot_by_direction[direction]
            for part in parts
            if direction in part.pivot_by_direction
        }
        return DirectionProfile(
            bone_rest_transforms=dict(bone_transforms),
            part_visibility={part.part_id: direction in part.assets_by_direction for part in parts},
            asset_selection=assets,
            pivots=pivots,
            slot_order={
                part.part_id: _PART_ORDERS[direction].index(part.part_id) for part in parts
            },
        )


def _socket_offset(socket_id: str) -> Vec2:
    try:
        return _REFERENCE_SOCKET_OFFSETS[socket_id]
    except KeyError as error:
        raise RigDefinitionError(
            f"The humanoid socket '{socket_id}' has no application layout."
        ) from error


def _failure_diagnostic(
    message: str,
    *,
    path: str | None = "project.animated-fabric.json",
    location: str | None = None,
    suggestion: str,
) -> Diagnostic:
    return Diagnostic(
        code=RIG_TEMPLATE_VALIDATION_CODE,
        severity=Severity.ERROR,
        message=message,
        path=path,
        location=location,
        suggestion=suggestion,
    )


def _diagnostic_sort_key(diagnostic: Diagnostic) -> tuple[str, str, str, str]:
    return (
        diagnostic.code,
        diagnostic.path or "",
        diagnostic.location or "",
        diagnostic.message,
    )


__all__ = [
    "HumanoidRigBuilder",
    "RIG_TEMPLATE_AMBIGUOUS_PART_CODE",
    "RIG_TEMPLATE_MISSING_PART_CODE",
    "RIG_TEMPLATE_OPTIONAL_DIRECTION_CODE",
    "RIG_TEMPLATE_VALIDATION_CODE",
]
