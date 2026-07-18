"""Deterministic built-in animation generators."""

from animated_fabric.generators.humanoid_idle_v1 import (
    HumanoidIdleV1Generator,
    HumanoidIdleV1Parameters,
)
from animated_fabric.generators.humanoid_walk_v1 import (
    HumanoidWalkV1Generator,
    HumanoidWalkV1Parameters,
)
from animated_fabric.generators.registry import BuiltinAnimationGeneratorRegistry

__all__ = [
    "BuiltinAnimationGeneratorRegistry",
    "HumanoidIdleV1Generator",
    "HumanoidIdleV1Parameters",
    "HumanoidWalkV1Generator",
    "HumanoidWalkV1Parameters",
]
