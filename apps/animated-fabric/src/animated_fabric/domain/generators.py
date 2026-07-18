"""Stable metadata contracts for discoverable animation generators."""

from __future__ import annotations

from enum import StrEnum
from typing import Self

from pydantic import model_validator

from animated_fabric.domain._base import DomainModel, SemanticId

type GeneratorParameterNumber = int | float


class GeneratorParameterValueType(StrEnum):
    """Scalar value kinds supported by the built-in generator registry."""

    INTEGER = "integer"
    NUMBER = "number"


class GeneratorParameterSummary(DomainModel):
    """Stable presentation metadata for one generator parameter."""

    parameter_id: SemanticId
    value_type: GeneratorParameterValueType
    default: GeneratorParameterNumber
    minimum: GeneratorParameterNumber | None = None
    maximum: GeneratorParameterNumber | None = None
    recommended_minimum: GeneratorParameterNumber | None = None
    recommended_maximum: GeneratorParameterNumber | None = None

    @model_validator(mode="after")
    def validate_numeric_contract(self) -> Self:
        """Keep integer schemas integral and every declared interval ordered."""
        values = (
            self.default,
            self.minimum,
            self.maximum,
            self.recommended_minimum,
            self.recommended_maximum,
        )
        if self.value_type is GeneratorParameterValueType.INTEGER and any(
            value is not None and (not isinstance(value, int) or isinstance(value, bool))
            for value in values
        ):
            raise ValueError("integer parameter metadata must use integer values")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("minimum must be less than or equal to maximum")
        if (
            self.recommended_minimum is not None
            and self.recommended_maximum is not None
            and self.recommended_minimum > self.recommended_maximum
        ):
            raise ValueError(
                "recommended_minimum must be less than or equal to recommended_maximum"
            )
        return self


class GeneratorSummary(DomainModel):
    """Immutable discovery metadata for one registered animation generator."""

    generator_id: SemanticId
    template_id: SemanticId
    parameters: tuple[GeneratorParameterSummary, ...]

    @model_validator(mode="after")
    def validate_unique_parameters(self) -> Self:
        """Reject ambiguous duplicate parameter identifiers."""
        parameter_ids = tuple(parameter.parameter_id for parameter in self.parameters)
        if len(parameter_ids) != len(set(parameter_ids)):
            raise ValueError("generator parameter IDs must be unique")
        return self


__all__ = [
    "GeneratorParameterSummary",
    "GeneratorParameterValueType",
    "GeneratorSummary",
]
