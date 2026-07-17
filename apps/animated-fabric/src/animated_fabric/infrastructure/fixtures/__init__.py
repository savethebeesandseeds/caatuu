"""Owned deterministic fixture adapters used by vertical-slice tests and demos."""

from animated_fabric.infrastructure.fixtures.stick_humanoid import (
    CANVAS_SIZE,
    DIRECTIONS,
    FIXTURE_ID,
    GROUND_ANCHOR,
    PART_NAMES,
    LoadedFixtureProject,
    build_stick_humanoid_manifest,
    build_stick_humanoid_rig,
    load_stick_humanoid_project,
    write_stick_humanoid_project,
)

__all__ = [
    "CANVAS_SIZE",
    "DIRECTIONS",
    "FIXTURE_ID",
    "GROUND_ANCHOR",
    "PART_NAMES",
    "LoadedFixtureProject",
    "build_stick_humanoid_manifest",
    "build_stick_humanoid_rig",
    "load_stick_humanoid_project",
    "write_stick_humanoid_project",
]
