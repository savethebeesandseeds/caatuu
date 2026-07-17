"""Application-layer protocols and use-case boundaries."""

from animated_fabric.application.ports import (
    LAYER_MANIFEST_FILENAME,
    PROJECT_MANIFEST_FILENAME,
    LayerManifestRepository,
    ProjectRepository,
)
from animated_fabric.application.render_cache import RenderComputationCache
from animated_fabric.application.render_frame import (
    RENDER_FAILURE_CODE,
    RenderFrame,
    render_failure,
)
from animated_fabric.application.rendering import (
    ClippingEdges,
    CompositedFrame,
    CompositeRequest,
    FrameCompositor,
    PlannedRenderLayer,
    RenderedFrame,
    Renderer,
    RenderPlanner,
    RenderProject,
    RenderQuality,
    RenderRequest,
)
from animated_fabric.application.validation_service import ValidateProject, ValidateProjectRequest

__all__ = [
    "ClippingEdges",
    "CompositedFrame",
    "CompositeRequest",
    "FrameCompositor",
    "LAYER_MANIFEST_FILENAME",
    "LayerManifestRepository",
    "PROJECT_MANIFEST_FILENAME",
    "PlannedRenderLayer",
    "ProjectRepository",
    "RENDER_FAILURE_CODE",
    "RenderComputationCache",
    "RenderFrame",
    "RenderedFrame",
    "Renderer",
    "RenderPlanner",
    "RenderProject",
    "RenderQuality",
    "RenderRequest",
    "ValidateProject",
    "ValidateProjectRequest",
    "render_failure",
]
