"""Ports implemented by Animated Fabric infrastructure adapters."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import RigDefinition

PROJECT_MANIFEST_FILENAME = "project.animated-fabric.json"


class ProjectRepository(Protocol):
    """Load and save the canonical project manifest within an approved root."""

    def load(self, root: Path) -> ProjectManifest:
        """Load the canonical manifest from ``root``."""
        ...

    def save(self, root: Path, project: ProjectManifest) -> None:
        """Atomically save the canonical manifest beneath ``root``."""
        ...

    def load_rig(self, root: Path, path: ProjectPath) -> RigDefinition:
        """Load one rig document beneath ``root``."""
        ...

    def save_rig(self, root: Path, path: ProjectPath, rig: RigDefinition) -> None:
        """Atomically save one rig document beneath ``root``."""
        ...

    def load_animation(self, root: Path, path: ProjectPath) -> AnimationClip:
        """Load one animation document beneath ``root``."""
        ...

    def save_animation(
        self,
        root: Path,
        path: ProjectPath,
        clip: AnimationClip,
    ) -> None:
        """Atomically save one animation document beneath ``root``."""
        ...


__all__ = ["PROJECT_MANIFEST_FILENAME", "ProjectRepository"]
