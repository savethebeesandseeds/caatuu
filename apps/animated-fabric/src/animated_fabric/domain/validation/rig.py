"""Pure structural validation for rig documents.

Unknown bone/part keys in direction-profile override maps are intentionally not
diagnosed here: the current stable codes describe missing parents, unbound existing
parts, or animation-track targets, none of which accurately names an orphan override.
Missing assets selected by a profile use AFV101 because that code is unambiguous.
"""

from __future__ import annotations

from collections.abc import Iterable

from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation.models import (
    ValidationCode,
    ValidationInput,
    diagnostic_sort_key,
)


def validate_rig(value: ValidationInput) -> tuple[Diagnostic, ...]:
    """Return deterministic structural diagnostics for one rig definition."""
    diagnostics: list[Diagnostic] = []
    rig = value.rig
    path = value.manifest.rig_path

    diagnostics.extend(_duplicate_id_diagnostics(rig, path))
    diagnostics.extend(_bone_graph_diagnostics(rig, path))
    diagnostics.extend(_binding_diagnostics(rig, path))
    diagnostics.extend(_socket_diagnostics(rig, path))

    if value.assets is not None:
        diagnostics.extend(_pivot_diagnostics(value, path))
        diagnostics.extend(_profile_asset_diagnostics(value, path))

    return tuple(sorted(diagnostics, key=diagnostic_sort_key))


def _duplicate_indices(ids: Iterable[str]) -> tuple[tuple[int, str], ...]:
    seen: set[str] = set()
    duplicates: list[tuple[int, str]] = []
    for index, item_id in enumerate(ids):
        if item_id in seen:
            duplicates.append((index, item_id))
        else:
            seen.add(item_id)
    return tuple(duplicates)


def _duplicate_id_diagnostics(rig: RigDefinition, path: str) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    collections = (
        ("bone", "bones", tuple(item.bone_id for item in rig.bones)),
        ("part", "parts", tuple(item.part_id for item in rig.parts)),
        ("socket", "sockets", tuple(item.socket_id for item in rig.sockets)),
    )
    for kind, field, ids in collections:
        for index, item_id in _duplicate_indices(ids):
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.DUPLICATE_RIG_ID.value,
                    severity=Severity.ERROR,
                    message=f"Duplicate {kind} ID '{item_id}'.",
                    path=path,
                    location=f"{field}[{index}].{kind}_id",
                    suggestion=f"Rename this {kind} so every {kind} ID is unique.",
                )
            )
    return diagnostics


def _bone_graph_diagnostics(rig: RigDefinition, path: str) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    bone_ids = {bone.bone_id for bone in rig.bones}

    for index, bone in enumerate(rig.bones):
        if bone.parent_id is not None and bone.parent_id not in bone_ids:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.PARENT_MISSING.value,
                    severity=Severity.ERROR,
                    message=(
                        f"Bone '{bone.bone_id}' references missing parent '{bone.parent_id}'."
                    ),
                    path=path,
                    location=f"bones[{index}].parent_id",
                    suggestion=(
                        "Use an existing bone ID, or set parent_id to null for the single root."
                    ),
                )
            )

    diagnostics.extend(_cycle_diagnostics(rig, path))

    roots = [
        (index, bone.bone_id) for index, bone in enumerate(rig.bones) if bone.parent_id is None
    ]
    if len(roots) != 1:
        root_names = ", ".join(f"'{bone_id}'" for _index, bone_id in roots) or "none"
        diagnostics.append(
            Diagnostic(
                code=ValidationCode.ROOT_COUNT_INVALID.value,
                severity=Severity.ERROR,
                message=(
                    "The rig must contain exactly one parentless bone named 'root'; "
                    f"found {root_names}."
                ),
                path=path,
                location="bones",
                suggestion="Make 'root' the only bone whose parent_id is null.",
            )
        )
    elif roots[0][1] != "root":
        index, bone_id = roots[0]
        diagnostics.append(
            Diagnostic(
                code=ValidationCode.ROOT_COUNT_INVALID.value,
                severity=Severity.ERROR,
                message=f"Parentless bone '{bone_id}' must be named 'root'.",
                path=path,
                location=f"bones[{index}].bone_id",
                suggestion="Rename this bone to 'root'.",
            )
        )
    return diagnostics


def _cycle_diagnostics(rig: RigDefinition, path: str) -> list[Diagnostic]:
    parents: dict[str, str | None] = {}
    first_indices: dict[str, int] = {}
    for index, bone in enumerate(rig.bones):
        if bone.bone_id not in parents:
            parents[bone.bone_id] = bone.parent_id
            first_indices[bone.bone_id] = index

    complete: set[str] = set()
    diagnostics: list[Diagnostic] = []
    for start in parents:
        if start in complete:
            continue
        path_ids: list[str] = []
        positions: dict[str, int] = {}
        current = start
        while current in parents and current not in complete:
            if current in positions:
                cycle = path_ids[positions[current] :]
                canonical = _canonical_cycle(cycle)
                cycle_text = " -> ".join((*canonical, canonical[0]))
                first_id = canonical[0]
                diagnostics.append(
                    Diagnostic(
                        code=ValidationCode.BONE_CYCLE.value,
                        severity=Severity.ERROR,
                        message=f"Bone cycle detected: {cycle_text}.",
                        path=path,
                        location=f"bones[{first_indices[first_id]}].parent_id",
                        suggestion="Change one parent_id so the bone hierarchy is acyclic.",
                    )
                )
                break
            positions[current] = len(path_ids)
            path_ids.append(current)
            parent_id = parents[current]
            if parent_id is None or parent_id not in parents:
                break
            current = parent_id
        complete.update(path_ids)
    return diagnostics


def _canonical_cycle(cycle: list[str]) -> tuple[str, ...]:
    first_position = min(range(len(cycle)), key=lambda index: cycle[index])
    return tuple(cycle[first_position:] + cycle[:first_position])


def _binding_diagnostics(rig: RigDefinition, path: str) -> list[Diagnostic]:
    bone_ids = {bone.bone_id for bone in rig.bones}
    return [
        Diagnostic(
            code=ValidationCode.BINDING_BONE_MISSING.value,
            severity=Severity.ERROR,
            message=f"Part '{part.part_id}' references missing bone '{part.bone_id}'.",
            path=path,
            location=f"parts[{index}].bone_id",
            suggestion="Bind the part to an existing bone or add the required bone.",
        )
        for index, part in enumerate(rig.parts)
        if part.bone_id not in bone_ids
    ]


def _socket_diagnostics(rig: RigDefinition, path: str) -> list[Diagnostic]:
    bone_ids = {bone.bone_id for bone in rig.bones}
    return [
        Diagnostic(
            code=ValidationCode.SOCKET_BONE_MISSING.value,
            severity=Severity.ERROR,
            message=f"Socket '{socket.socket_id}' references missing bone '{socket.bone_id}'.",
            path=path,
            location=f"sockets[{index}].bone_id",
            suggestion="Attach the socket to an existing bone or add the required bone.",
        )
        for index, socket in enumerate(rig.sockets)
        if socket.bone_id not in bone_ids
    ]


def _pivot_diagnostics(value: ValidationInput, path: str) -> list[Diagnostic]:
    assert value.assets is not None
    assets_by_id = {asset.asset_id: asset for asset in reversed(value.assets)}
    diagnostics: list[Diagnostic] = []
    for part_index, part in enumerate(value.rig.parts):
        profile_pivot_directions = {
            direction
            for direction, profile in value.rig.direction_profiles.items()
            if part.part_id in profile.pivots
        }
        pivot_directions = set(part.pivot_by_direction) | profile_pivot_directions
        for direction in sorted(pivot_directions, key=lambda item: item.value):
            profile = value.rig.direction_profiles.get(direction)
            has_profile_pivot = profile is not None and part.part_id in profile.pivots
            if has_profile_pivot:
                assert profile is not None
                pivot = profile.pivots[part.part_id]
                location = f"direction_profiles.{direction.value}.pivots.{part.part_id}"
            else:
                pivot = part.pivot_by_direction[direction]
                location = f"parts[{part_index}].pivot_by_direction.{direction.value}"

            asset_id = (
                profile.asset_selection.get(part.part_id)
                if profile is not None and part.part_id in profile.asset_selection
                else part.assets_by_direction.get(direction)
            )
            asset = assets_by_id.get(asset_id) if asset_id is not None else None
            if asset is None:
                continue
            width = asset.trim_size.width
            height = asset.trim_size.height
            if -width <= pivot.x <= 2 * width and -height <= pivot.y <= 2 * height:
                continue
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.PIVOT_FAR_OUTSIDE_ASSET.value,
                    severity=Severity.WARNING,
                    message=(
                        f"Part '{part.part_id}' pivot for direction '{direction.value}' is far "
                        f"outside asset '{asset.asset_id}' ({width} x {height})."
                    ),
                    path=path,
                    location=location,
                    suggestion=(
                        f"Keep pivot x within [{-width}, {2 * width}] and y within "
                        f"[{-height}, {2 * height}], or correct the asset binding."
                    ),
                )
            )
    return diagnostics


def _profile_asset_diagnostics(value: ValidationInput, path: str) -> list[Diagnostic]:
    assert value.assets is not None
    asset_ids = {asset.asset_id for asset in value.assets}
    diagnostics: list[Diagnostic] = []
    for direction, profile in value.rig.direction_profiles.items():
        for part_id, asset_id in profile.asset_selection.items():
            if asset_id in asset_ids:
                continue
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.ASSET_MISSING.value,
                    severity=Severity.ERROR,
                    message=(
                        f"Direction profile '{direction.value}' selects missing asset "
                        f"'{asset_id}' for part '{part_id}'."
                    ),
                    path=path,
                    location=(f"direction_profiles.{direction.value}.asset_selection.{part_id}"),
                    suggestion="Select an existing asset or import the required asset.",
                )
            )
    return diagnostics


__all__ = ["validate_rig"]
