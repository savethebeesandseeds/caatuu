"""Deterministic built-in animation generators."""

from animated_fabric.generators.humanoid_idle_v1 import (
    HumanoidIdleV1Generator,
    HumanoidIdleV1Parameters,
)
from animated_fabric.generators.humanoid_walk_v1 import (
    HumanoidWalkV1Generator,
    HumanoidWalkV1Parameters,
)

__all__ = [
    "HumanoidIdleV1Generator",
    "HumanoidIdleV1Parameters",
    "HumanoidWalkV1Generator",
    "HumanoidWalkV1Parameters",
]
