"""Deterministic orchestration for all structural project validators."""

from __future__ import annotations

from animated_fabric.domain.diagnostics import Diagnostic
from animated_fabric.domain.validation.animation import validate_animation
from animated_fabric.domain.validation.draw_order import validate_draw_order
from animated_fabric.domain.validation.models import ValidationInput, diagnostic_sort_key
from animated_fabric.domain.validation.project_assets import validate_project_and_assets
from animated_fabric.domain.validation.rig import validate_rig


class ProjectValidator:
    """Validate available project documents without performing IO or mutations."""

    def validate(self, value: ValidationInput) -> tuple[Diagnostic, ...]:
        """Return every diagnostic in stable code/path/location order."""
        diagnostics = [
            *validate_project_and_assets(value),
            *validate_rig(value),
            *validate_draw_order(value),
        ]
        bone_ids = frozenset(bone.bone_id for bone in value.rig.bones)
        part_ids = frozenset(part.part_id for part in value.rig.parts)
        for document in value.animations:
            diagnostics.extend(validate_animation(document, bone_ids=bone_ids, part_ids=part_ids))
        return tuple(sorted(diagnostics, key=diagnostic_sort_key))


__all__ = ["ProjectValidator"]
