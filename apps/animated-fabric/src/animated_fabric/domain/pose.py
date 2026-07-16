"""Direction-aware resolution of rig transforms into immutable world-space poses."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.domain.geometry import Transform2D, Vec2
from animated_fabric.domain.hierarchy import topological_bone_order
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import PartBinding, RigDefinition
from animated_fabric.domain.transforms import (
    Matrix3,
    multiply_matrices,
    transform_matrix,
    translation_matrix,
)


@dataclass(frozen=True, slots=True)
class ResolvedPose:
    """Read-only bone, part, and socket matrices for one authored direction."""

    bone_order: tuple[str, ...]
    bone_world_matrices: Mapping[str, Matrix3]
    part_matrices: Mapping[str, Matrix3]
    socket_matrices: Mapping[str, Matrix3]


def combine_bone_transform(
    rest_transform: Transform2D,
    animation_delta: Transform2D | None = None,
) -> Transform2D:
    """Apply additive position/rotation and multiplicative scale to a rest transform."""
    delta = animation_delta or Transform2D()
    return Transform2D(
        position=Vec2(
            x=rest_transform.position.x + delta.position.x,
            y=rest_transform.position.y + delta.position.y,
        ),
        rotation_deg=rest_transform.rotation_deg + delta.rotation_deg,
        scale=Vec2(
            x=rest_transform.scale.x * delta.scale.x,
            y=rest_transform.scale.y * delta.scale.y,
        ),
    )


def bone_local_matrix(
    rest_transform: Transform2D,
    animation_delta: Transform2D | None = None,
) -> Matrix3:
    """Compose one normative local bone matrix as ``T · R · S``."""
    return transform_matrix(combine_bone_transform(rest_transform, animation_delta))


def part_to_canvas_matrix(
    bone_world_matrix: Matrix3,
    part: PartBinding,
    pivot: Vec2,
) -> Matrix3:
    """Compose ``world_bone · bind_transform · T(-pivot_in_image)``."""
    return multiply_matrices(
        bone_world_matrix,
        transform_matrix(part.bind_transform),
        translation_matrix(Vec2(x=-pivot.x, y=-pivot.y)),
    )


def socket_to_canvas_matrix(
    bone_world_matrix: Matrix3,
    local_transform: Transform2D,
) -> Matrix3:
    """Compose a socket's local transform beneath its owning bone."""
    return multiply_matrices(bone_world_matrix, transform_matrix(local_transform))


def part_pivot_for_direction(
    part: PartBinding,
    direction: Direction,
    rig: RigDefinition,
) -> Vec2:
    """Resolve one part pivot from a direction override or its authored binding."""
    profile = rig.direction_profiles.get(direction)
    if profile is not None and part.part_id in profile.pivots:
        return profile.pivots[part.part_id]
    return part.pivot_by_direction.get(direction, Vec2(x=0.0, y=0.0))


class PoseResolver:
    """Resolve a validated rig and explicit animation deltas without IO or mutation."""

    def resolve(
        self,
        rig: RigDefinition,
        direction: Direction,
        animation_deltas: Mapping[str, Transform2D] | None = None,
    ) -> ResolvedPose:
        """Return immutable world matrices for bones, bound parts, and sockets."""
        bone_order = topological_bone_order(rig)
        bones_by_id = {bone.bone_id: bone for bone in rig.bones}
        bone_ids = frozenset(bones_by_id)
        deltas = animation_deltas or {}
        profile = rig.direction_profiles.get(direction)

        self._reject_unknown_ids("animation delta", deltas, bone_ids)
        if profile is not None:
            self._reject_unknown_ids(
                "direction-profile rest transform",
                profile.bone_rest_transforms,
                bone_ids,
            )

        bone_world_matrices: dict[str, Matrix3] = {}
        for bone_id in bone_order:
            bone = bones_by_id[bone_id]
            rest_transform = bone.rest_transform
            if profile is not None:
                rest_transform = profile.bone_rest_transforms.get(bone_id, rest_transform)
            local_matrix = bone_local_matrix(rest_transform, deltas.get(bone_id))
            if bone.parent_id is None:
                world_matrix = local_matrix
            else:
                world_matrix = multiply_matrices(
                    bone_world_matrices[bone.parent_id],
                    local_matrix,
                )
            bone_world_matrices[bone_id] = world_matrix

        part_matrices: dict[str, Matrix3] = {}
        seen_part_ids: set[str] = set()
        for part in rig.parts:
            if part.part_id in seen_part_ids:
                raise RigDefinitionError(f"Duplicate part ID '{part.part_id}' cannot be resolved.")
            seen_part_ids.add(part.part_id)
            bone_world_matrix = bone_world_matrices.get(part.bone_id)
            if bone_world_matrix is None:
                raise RigDefinitionError(
                    f"Part '{part.part_id}' references missing bone '{part.bone_id}'."
                )
            pivot = part_pivot_for_direction(part, direction, rig)
            part_matrices[part.part_id] = part_to_canvas_matrix(
                bone_world_matrix,
                part,
                pivot,
            )

        socket_matrices: dict[str, Matrix3] = {}
        seen_socket_ids: set[str] = set()
        for socket in rig.sockets:
            if socket.socket_id in seen_socket_ids:
                raise RigDefinitionError(
                    f"Duplicate socket ID '{socket.socket_id}' cannot be resolved."
                )
            seen_socket_ids.add(socket.socket_id)
            bone_world_matrix = bone_world_matrices.get(socket.bone_id)
            if bone_world_matrix is None:
                raise RigDefinitionError(
                    f"Socket '{socket.socket_id}' references missing bone '{socket.bone_id}'."
                )
            socket_matrices[socket.socket_id] = socket_to_canvas_matrix(
                bone_world_matrix,
                socket.local_transform,
            )

        return ResolvedPose(
            bone_order=bone_order,
            bone_world_matrices=MappingProxyType(bone_world_matrices),
            part_matrices=MappingProxyType(part_matrices),
            socket_matrices=MappingProxyType(socket_matrices),
        )

    @staticmethod
    def _reject_unknown_ids(
        kind: str,
        values: Mapping[str, object],
        bone_ids: frozenset[str],
    ) -> None:
        unknown_ids = sorted(set(values) - bone_ids)
        if unknown_ids:
            formatted = ", ".join(f"'{bone_id}'" for bone_id in unknown_ids)
            raise RigDefinitionError(f"Unknown bone IDs in {kind}: {formatted}.")


__all__ = [
    "PoseResolver",
    "ResolvedPose",
    "bone_local_matrix",
    "combine_bone_transform",
    "part_pivot_for_direction",
    "part_to_canvas_matrix",
    "socket_to_canvas_matrix",
]
