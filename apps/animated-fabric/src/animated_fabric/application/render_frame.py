"""Typed application use case for rendering one preview/export frame."""

from __future__ import annotations

from animated_fabric.application.rendering import RenderedFrame, Renderer, RenderRequest
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import RenderError

RENDER_FAILURE_CODE = "AFR001"


def render_failure(error: RenderError) -> OperationResult[RenderedFrame]:
    """Translate an expected renderer failure into one actionable result."""
    message = str(error) or "Rendering could not continue."
    return OperationResult[RenderedFrame](
        diagnostics=(
            Diagnostic(
                code=RENDER_FAILURE_CODE,
                severity=Severity.ERROR,
                message=message,
                suggestion="Check the project, render options, and referenced PNG assets.",
            ),
        )
    )


class RenderFrame:
    """Invoke the shared renderer without printing or opening presentation state."""

    def __init__(self, renderer: Renderer) -> None:
        self._renderer = renderer

    def execute(self, request: RenderRequest) -> OperationResult[RenderedFrame]:
        """Return one frame or structured diagnostics for an expected failure."""
        try:
            frame = self._renderer.render(request)
        except RenderError as error:
            return render_failure(error)
        return OperationResult[RenderedFrame](value=frame)


__all__ = ["RENDER_FAILURE_CODE", "RenderFrame", "render_failure"]
