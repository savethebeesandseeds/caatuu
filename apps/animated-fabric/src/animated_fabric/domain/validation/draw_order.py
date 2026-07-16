"""Draw-slot validation and deterministic part ordering."""

from __future__ import annotations

from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.project import Direction, DirectionMode
from animated_fabric.domain.rig import PartBinding, RigDefinition
from animated_fabric.domain.validation.models import (
    ValidationCode,
    ValidationInput,
    diagnostic_sort_key,
)


def _is_visible(part: PartBinding, rig: RigDefinition, direction: Direction) -> bool:
    profile = rig.direction_profiles.get(direction)
    if profile is None:
        return part.visible
    return profile.part_visibility.get(part.part_id, part.visible)


def _slot_order(part: PartBinding, rig: RigDefinition, direction: Direction) -> int:
    profile = rig.direction_profiles.get(direction)
    if profile is None:
        return part.slot_order
    return profile.slot_order.get(part.part_id, part.slot_order)


def resolve_draw_order(rig: RigDefinition, direction: Direction) -> tuple[str, ...]:
    """Return visible part IDs in stable slot, tie-breaker, then ID order."""
    slots = rig.draw_slot_profiles.get(direction, ())
    slot_indexes = {slot: index for index, slot in enumerate(slots)}
    visible_parts = [part for part in rig.parts if _is_visible(part, rig, direction)]
    visible_parts.sort(
        key=lambda part: (
            slot_indexes.get(part.draw_slot, len(slots)),
            _slot_order(part, rig, direction),
            part.part_id,
        )
    )
    return tuple(part.part_id for part in visible_parts)


def validate_draw_order(value: ValidationInput) -> tuple[Diagnostic, ...]:
    """Validate authored-direction slot profiles and socket slot references."""
    rig = value.rig
    rig_path = value.manifest.rig_path
    diagnostics: list[Diagnostic] = []

    for direction in sorted(rig.draw_slot_profiles, key=lambda item: item.value):
        seen_slots: set[str] = set()
        for slot_index, slot in enumerate(rig.draw_slot_profiles[direction]):
            if slot in seen_slots:
                diagnostics.append(
                    Diagnostic(
                        code=ValidationCode.DUPLICATE_DRAW_SLOT,
                        severity=Severity.ERROR,
                        message=(
                            f"Direction '{direction.value}' lists draw slot '{slot}' "
                            "more than once."
                        ),
                        path=rig_path,
                        location=f"draw_slot_profiles.{direction.value}[{slot_index}]",
                        suggestion="Keep each draw slot exactly once per direction profile.",
                    )
                )
            seen_slots.add(slot)

    authored_directions = sorted(
        (
            direction
            for direction, definition in value.manifest.directions.items()
            if definition.mode is DirectionMode.AUTHORED
        ),
        key=lambda item: item.value,
    )
    for direction in authored_directions:
        slots = rig.draw_slot_profiles.get(direction)
        for part_index, part in enumerate(rig.parts):
            if not _is_visible(part, rig, direction):
                continue
            if slots is None:
                diagnostics.append(
                    Diagnostic(
                        code=ValidationCode.VISIBLE_PART_WITHOUT_ORDER,
                        severity=Severity.ERROR,
                        message=(
                            f"Visible part '{part.part_id}' has no draw-order profile for "
                            f"direction '{direction.value}'."
                        ),
                        path=rig_path,
                        location=f"parts[{part_index}].draw_slot",
                        suggestion=(
                            f"Add draw_slot_profiles.{direction.value} or hide the part in "
                            "that direction."
                        ),
                    )
                )
            elif part.draw_slot not in slots:
                diagnostics.append(
                    Diagnostic(
                        code=ValidationCode.UNKNOWN_DRAW_SLOT,
                        severity=Severity.ERROR,
                        message=(
                            f"Part '{part.part_id}' uses unknown draw slot '{part.draw_slot}' "
                            f"in direction '{direction.value}'."
                        ),
                        path=rig_path,
                        location=f"parts[{part_index}].draw_slot",
                        suggestion=(
                            f"Add '{part.draw_slot}' to draw_slot_profiles.{direction.value} "
                            "or select a known slot."
                        ),
                    )
                )

    known_slots = {
        slot for profile_slots in rig.draw_slot_profiles.values() for slot in profile_slots
    }
    for socket_index, socket in enumerate(rig.sockets):
        if socket.default_draw_slot not in known_slots:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.UNKNOWN_DRAW_SLOT,
                    severity=Severity.ERROR,
                    message=(
                        f"Socket '{socket.socket_id}' uses unknown draw slot "
                        f"'{socket.default_draw_slot}'."
                    ),
                    path=rig_path,
                    location=f"sockets[{socket_index}].default_draw_slot",
                    suggestion="Choose a slot declared by at least one draw-order profile.",
                )
            )

        if value.used_socket_ids is not None and socket.socket_id not in value.used_socket_ids:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.UNUSED_SOCKET,
                    severity=Severity.WARNING,
                    message=f"Socket '{socket.socket_id}' is not used by the current project.",
                    path=rig_path,
                    location=f"sockets[{socket_index}].socket_id",
                    suggestion="Remove the socket or attach equipment that uses it.",
                )
            )

    return tuple(sorted(diagnostics, key=diagnostic_sort_key))


__all__ = ["resolve_draw_order", "validate_draw_order"]
