"""Narrow validation helpers shared by deterministic built-in generators."""

from __future__ import annotations

import math
from collections.abc import Collection

from pydantic import BaseModel, ConfigDict, ValidationError

from animated_fabric.domain.exceptions import AnimationError
from animated_fabric.domain.rig import RigDefinition


class GeneratorParameters(BaseModel):
    """Shared strict immutable configuration for built-in generator parameters."""

    model_config = ConfigDict(
        allow_inf_nan=False,
        extra="forbid",
        frozen=True,
        strict=True,
        validate_default=True,
    )


def canonical_nonnegative_float(value: object) -> float:
    """Return a finite non-negative float with one canonical zero representation."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("must be a finite non-negative number")
    try:
        normalized = int.__float__(value) if isinstance(value, int) else float.__float__(value)
    except (OverflowError, TypeError, ValueError) as error:
        raise ValueError("must be a finite non-negative number") from error
    if not math.isfinite(normalized) or normalized < 0.0:
        raise ValueError("must be a finite non-negative number")
    return 0.0 if normalized == 0.0 else normalized


def parameter_failure_message(
    error: ValidationError,
    *,
    generator_id: str,
    allowed_fields: Collection[str],
) -> str:
    """Describe a rejected parameter without echoing untrusted submitted values."""
    field: str | None = None
    try:
        errors = error.errors(include_url=False, include_input=False)
    except Exception:
        return f"Invalid {generator_id} parameters."
    if errors:
        location = errors[0]["loc"]
        top_level = location[0] if location else None
        if isinstance(top_level, str) and top_level in allowed_fields:
            field = top_level
    if field is None:
        return f"Invalid {generator_id} parameters."
    return f"Invalid {generator_id} parameter '{field}'."


def detached_compatible_rig(
    rig: object,
    *,
    generator_id: str,
    template_id: str,
) -> RigDefinition:
    """Revalidate and detach a rig while exposing only a fixed compatibility error."""
    failure_message = f"{generator_id} requires a rig using the {template_id} template."
    if type(rig) is not RigDefinition:
        raise AnimationError(failure_message)
    try:
        effective_rig = RigDefinition.model_validate(
            RigDefinition.model_dump(
                rig,
                mode="python",
                round_trip=True,
                warnings=False,
            )
        )
    except Exception:
        raise AnimationError(failure_message) from None
    if effective_rig.template_id != template_id:
        raise AnimationError(failure_message)
    return effective_rig


__all__ = [
    "GeneratorParameters",
    "canonical_nonnegative_float",
    "detached_compatible_rig",
    "parameter_failure_message",
]
