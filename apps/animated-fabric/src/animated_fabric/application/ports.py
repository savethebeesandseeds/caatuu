"""Ports implemented by Animated Fabric infrastructure adapters."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Protocol, runtime_checkable

from animated_fabric.application.exporting import (
    AnimationArtifactResult,
    ExportRequest,
    ExportResult,
)
from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.assets import LayerManifest
from animated_fabric.domain.generators import GeneratorSummary
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.templates import RigTemplate, RigTemplateSummary

PROJECT_MANIFEST_FILENAME = "project.animated-fabric.json"
LAYER_MANIFEST_FILENAME = "layers.manifest.json"


class AnimationGeneratorRegistry(Protocol):
    """Discover and invoke animation generators through application-owned types."""

    def list_generators(self, template_id: str) -> Sequence[GeneratorSummary]:
        """Return stable generator metadata compatible with ``template_id``."""
        ...

    def generate(
        self,
        generator_id: str,
        rig: RigDefinition,
        parameters: Mapping[str, object],
    ) -> AnimationClip:
        """Generate one explicit clip from validated built-in parameters."""
        ...


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

    def save_rig(
        self,
        root: Path,
        path: ProjectPath,
        rig: RigDefinition,
        *,
        replace_existing: bool = True,
    ) -> None:
        """Atomically create or explicitly replace one rig beneath ``root``."""
        ...

    def load_animation(self, root: Path, path: ProjectPath) -> AnimationClip:
        """Load one animation document beneath ``root``."""
        ...

    def save_animation(
        self,
        root: Path,
        path: ProjectPath,
        clip: AnimationClip,
        *,
        replace_existing: bool = True,
    ) -> None:
        """Atomically create or explicitly replace one animation beneath ``root``."""
        ...


class LayerManifestRepository(Protocol):
    """Load and save the canonical layer catalog within an approved root."""

    def load_layer_manifest(self, root: Path) -> LayerManifest:
        """Load the canonical layer catalog from ``root``."""
        ...

    def save_layer_manifest(self, root: Path, manifest: LayerManifest) -> None:
        """Atomically save the canonical layer catalog beneath ``root``."""
        ...


class RigTemplateRegistry(Protocol):
    """List and retrieve validated built-in anatomical templates."""

    def list_templates(self) -> Sequence[RigTemplateSummary]:
        """Return stable metadata for every available template."""
        ...

    def get(self, template_id: str) -> RigTemplate:
        """Return one validated template or raise a typed definition error."""
        ...


@runtime_checkable
class ProjectExporter[ExportArtifactT_co: AnimationArtifactResult](Protocol):
    """Publish a validated project export through one concrete profile adapter."""

    exporter_id: str

    def export(self, request: ExportRequest) -> ExportResult[ExportArtifactT_co]:
        """Render and atomically publish one complete export request."""
        ...


__all__ = [
    "AnimationGeneratorRegistry",
    "LAYER_MANIFEST_FILENAME",
    "PROJECT_MANIFEST_FILENAME",
    "LayerManifestRepository",
    "ProjectExporter",
    "ProjectRepository",
    "RigTemplateRegistry",
]
