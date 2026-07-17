"""Deterministic hierarchy primitives for rig evaluation."""

from __future__ import annotations

import heapq

from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.domain.rig import RigDefinition


def topological_bone_order(rig: RigDefinition) -> tuple[str, ...]:
    """Return a stable parent-before-child order for a valid bone hierarchy.

    Original declaration index is the priority whenever more than one bone is ready.
    Invalid graphs raise before a partial order can escape this boundary.
    """
    if not rig.bones:
        raise RigDefinitionError("The rig must contain at least one bone.")

    declaration_index: dict[str, int] = {}
    for index, bone in enumerate(rig.bones):
        if bone.bone_id in declaration_index:
            raise RigDefinitionError(f"The rig contains duplicate bone ID '{bone.bone_id}'.")
        declaration_index[bone.bone_id] = index

    for bone in rig.bones:
        if bone.parent_id is not None and bone.parent_id not in declaration_index:
            raise RigDefinitionError(
                f"Bone '{bone.bone_id}' references missing parent '{bone.parent_id}'."
            )

    roots = tuple(bone.bone_id for bone in rig.bones if bone.parent_id is None)
    if len(roots) != 1:
        found = ", ".join(f"'{bone_id}'" for bone_id in roots) or "none"
        raise RigDefinitionError(
            f"The rig must contain exactly one parentless bone named 'root'; found {found}."
        )
    if roots[0] != "root":
        raise RigDefinitionError(
            f"The only parentless bone must be named 'root'; found '{roots[0]}'."
        )

    children: dict[str, list[str]] = {bone_id: [] for bone_id in declaration_index}
    incoming_edges = {bone_id: 0 for bone_id in declaration_index}
    for bone in rig.bones:
        if bone.parent_id is None:
            continue
        children[bone.parent_id].append(bone.bone_id)
        incoming_edges[bone.bone_id] += 1

    ready = [
        (declaration_index[bone_id], bone_id)
        for bone_id, edge_count in incoming_edges.items()
        if edge_count == 0
    ]
    heapq.heapify(ready)
    order: list[str] = []
    while ready:
        _index, bone_id = heapq.heappop(ready)
        order.append(bone_id)
        for child_id in children[bone_id]:
            incoming_edges[child_id] -= 1
            if incoming_edges[child_id] == 0:
                heapq.heappush(ready, (declaration_index[child_id], child_id))

    if len(order) != len(rig.bones):
        unresolved = tuple(bone.bone_id for bone in rig.bones if incoming_edges[bone.bone_id] > 0)
        unresolved_text = ", ".join(f"'{bone_id}'" for bone_id in unresolved)
        raise RigDefinitionError(
            "The rig contains a bone cycle; topological ordering left unresolved bones: "
            f"{unresolved_text}."
        )

    return tuple(order)


def validate_topological_bone_order(
    rig: RigDefinition,
    bone_order: tuple[str, ...],
) -> tuple[str, ...]:
    """Validate and return a complete parent-before-child order for ``rig``."""
    if not isinstance(bone_order, tuple) or any(
        not isinstance(bone_id, str) for bone_id in bone_order
    ):
        raise RigDefinitionError("A cached bone order must be an immutable tuple of IDs.")

    declared_ids = tuple(bone.bone_id for bone in rig.bones)
    if len(set(declared_ids)) != len(declared_ids):
        duplicate = next(
            bone_id for index, bone_id in enumerate(declared_ids) if bone_id in declared_ids[:index]
        )
        raise RigDefinitionError(f"The rig contains duplicate bone ID '{duplicate}'.")
    if len(bone_order) != len(declared_ids) or set(bone_order) != set(declared_ids):
        raise RigDefinitionError("A cached bone order must contain every rig bone exactly once.")

    resolved: set[str] = set()
    bones_by_id = {bone.bone_id: bone for bone in rig.bones}
    roots = tuple(bone.bone_id for bone in rig.bones if bone.parent_id is None)
    if roots != ("root",):
        raise RigDefinitionError(
            "A cached bone order requires exactly one parentless bone named 'root'."
        )
    for bone in rig.bones:
        if bone.parent_id is not None and bone.parent_id not in bones_by_id:
            raise RigDefinitionError(
                f"Bone '{bone.bone_id}' references missing parent '{bone.parent_id}'."
            )
    for bone_id in bone_order:
        bone = bones_by_id[bone_id]
        if bone.parent_id is not None and bone.parent_id not in resolved:
            raise RigDefinitionError(
                f"Cached bone order places '{bone_id}' before parent '{bone.parent_id}'."
            )
        resolved.add(bone_id)

    if not bone_order or bone_order[0] != "root":
        raise RigDefinitionError("A cached bone order must begin with the root bone.")
    return bone_order


__all__ = ["topological_bone_order", "validate_topological_bone_order"]
