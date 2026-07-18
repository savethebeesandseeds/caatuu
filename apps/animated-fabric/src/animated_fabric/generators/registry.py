"""Fixed registry for package-owned animation generators."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import cast

from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.exceptions import AnimationError
from animated_fabric.domain.generators import (
    GeneratorParameterSummary,
    GeneratorParameterValueType,
    GeneratorSummary,
)
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.generators._support import GeneratorParameters
from animated_fabric.generators.humanoid_idle_v1 import (
    HumanoidIdleV1Generator,
    HumanoidIdleV1Parameters,
)
from animated_fabric.generators.humanoid_walk_v1 import (
    HumanoidWalkV1Generator,
    HumanoidWalkV1Parameters,
)

_SCHEMA_FAILURE_MESSAGE = "Built-in animation generator metadata is invalid."
_UNKNOWN_GENERATOR_MESSAGE = "Unknown animation generator ID."

type _GenerateCallback = Callable[
    [RigDefinition, Mapping[str, object]],
    AnimationClip,
]


@dataclass(frozen=True, slots=True)
class _GeneratorDefinition:
    summary: GeneratorSummary
    generate: _GenerateCallback


def _generate_idle(
    rig: RigDefinition,
    parameters: Mapping[str, object],
) -> AnimationClip:
    generator = HumanoidIdleV1Generator()
    return generator.generate(rig, generator.validate_parameters(parameters))


def _generate_walk(
    rig: RigDefinition,
    parameters: Mapping[str, object],
) -> AnimationClip:
    generator = HumanoidWalkV1Generator()
    return generator.generate(rig, generator.validate_parameters(parameters))


def _summary(
    *,
    generator_id: str,
    template_id: str,
    parameter_model: type[GeneratorParameters],
) -> GeneratorSummary:
    try:
        schema = cast(Mapping[str, object], parameter_model.model_json_schema())
        properties = _require_mapping(schema.get("properties"))
        parameters = tuple(
            _parameter_summary(parameter_id, _require_mapping(properties.get(parameter_id)))
            for parameter_id in parameter_model.model_fields
        )
        return GeneratorSummary(
            generator_id=generator_id,
            template_id=template_id,
            parameters=parameters,
        )
    except (KeyError, TypeError, ValueError, OverflowError):
        raise AnimationError(_SCHEMA_FAILURE_MESSAGE) from None


def _parameter_summary(
    parameter_id: str,
    schema: Mapping[str, object],
) -> GeneratorParameterSummary:
    raw_type = schema.get("type")
    if type(raw_type) is not str:
        raise ValueError("parameter schema type must be a string")
    value_type = GeneratorParameterValueType(raw_type)
    return GeneratorParameterSummary(
        parameter_id=parameter_id,
        value_type=value_type,
        default=_required_number(schema, "default"),
        minimum=_optional_number(schema, "minimum"),
        maximum=_optional_number(schema, "maximum"),
        recommended_minimum=_optional_number(schema, "x-recommended-minimum"),
        recommended_maximum=_optional_number(schema, "x-recommended-maximum"),
    )


def _require_mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("parameter schema entry must be an object")
    if not all(type(key) is str for key in value):
        raise ValueError("parameter schema keys must be strings")
    return cast(Mapping[str, object], value)


def _required_number(schema: Mapping[str, object], key: str) -> int | float:
    if key not in schema:
        raise ValueError(f"parameter schema is missing {key}")
    value = schema[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"parameter schema {key} must be numeric")
    return value


def _optional_number(schema: Mapping[str, object], key: str) -> int | float | None:
    if key not in schema:
        return None
    return _required_number(schema, key)


_DEFINITIONS = tuple(
    sorted(
        (
            _GeneratorDefinition(
                summary=_summary(
                    generator_id=HumanoidIdleV1Generator.generator_id,
                    template_id=HumanoidIdleV1Generator.template_id,
                    parameter_model=HumanoidIdleV1Parameters,
                ),
                generate=_generate_idle,
            ),
            _GeneratorDefinition(
                summary=_summary(
                    generator_id=HumanoidWalkV1Generator.generator_id,
                    template_id=HumanoidWalkV1Generator.template_id,
                    parameter_model=HumanoidWalkV1Parameters,
                ),
                generate=_generate_walk,
            ),
        ),
        key=lambda definition: definition.summary.generator_id,
    )
)
_DEFINITIONS_BY_ID: Mapping[str, _GeneratorDefinition] = MappingProxyType(
    {definition.summary.generator_id: definition for definition in _DEFINITIONS}
)


class BuiltinAnimationGeneratorRegistry:
    """Discover and invoke the fixed package-owned generator set."""

    def list_generators(self, template_id: str) -> tuple[GeneratorSummary, ...]:
        """Return summaries for one template in stable generator-ID order."""
        if type(template_id) is not str:
            return ()
        return tuple(
            definition.summary
            for definition in _DEFINITIONS
            if definition.summary.template_id == template_id
        )

    def generate(
        self,
        generator_id: str,
        rig: RigDefinition,
        parameters: Mapping[str, object],
    ) -> AnimationClip:
        """Validate parameters and generate a clip through one registered implementation."""
        if type(generator_id) is not str:
            raise AnimationError(_UNKNOWN_GENERATOR_MESSAGE)
        definition = _DEFINITIONS_BY_ID.get(generator_id)
        if definition is None:
            raise AnimationError(_UNKNOWN_GENERATOR_MESSAGE)
        return definition.generate(rig, parameters)


__all__ = ["BuiltinAnimationGeneratorRegistry"]
