"""Complete authored-direction renderer backed by the OpenCV compositor."""

from __future__ import annotations

from animated_fabric.application.render_cache import RenderComputationCache
from animated_fabric.application.rendering import (
    RenderedFrame,
    Renderer,
    RenderPlanner,
    RenderRequest,
)
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.animation_evaluator import AnimationEvaluator, EvaluatedAnimation
from animated_fabric.domain.exceptions import AnimationError, RenderError, RigDefinitionError
from animated_fabric.domain.pose import PoseResolver
from animated_fabric.domain.project import DirectionMode
from animated_fabric.infrastructure.imaging.image_store import RgbaAssetCache
from animated_fabric.infrastructure.imaging.opencv_compositor import OpenCvFrameCompositor


class OpenCvRenderer(Renderer):
    """Orchestrate evaluation, pose, planning, cached image IO, and composition."""

    def __init__(
        self,
        *,
        asset_cache: RgbaAssetCache | None = None,
        computation_cache: RenderComputationCache | None = None,
        evaluator: AnimationEvaluator | None = None,
        pose_resolver: PoseResolver | None = None,
        planner: RenderPlanner | None = None,
    ) -> None:
        self._asset_cache = asset_cache or RgbaAssetCache()
        self._computation_cache = computation_cache or RenderComputationCache()
        self._evaluator = evaluator or AnimationEvaluator()
        self._pose_resolver = pose_resolver or PoseResolver()
        self._planner = planner or RenderPlanner()

    @property
    def asset_cache(self) -> RgbaAssetCache:
        """Expose explicit image-cache lifecycle controls."""
        return self._asset_cache

    @property
    def computation_cache(self) -> RenderComputationCache:
        """Expose explicit topology/evaluation-cache lifecycle controls."""
        return self._computation_cache

    def render(self, request: RenderRequest) -> RenderedFrame:
        """Render one complete authored-direction frame through the shared pipeline."""
        try:
            self._validate_request(request)
            bone_order = self._computation_cache.bone_order(request.project, request.rig)
            animation = self._evaluate_animation(request, bone_order)
            pose = self._pose_resolver.resolve(
                request.rig,
                request.direction,
                None if animation is None else animation.bone_deltas,
                bone_order=bone_order,
            )
            composite_request = self._planner.plan(
                request.project.manifest,
                request.rig,
                request.direction,
                pose,
                animation,
                request.project.assets,
                quality=request.quality,
                alpha_threshold=request.alpha_threshold,
            )
            composited = OpenCvFrameCompositor(
                request.project.root,
                asset_cache=self._asset_cache,
            ).compose(composite_request)
        except RenderError:
            raise
        except (AnimationError, RigDefinitionError) as error:
            raise RenderError(str(error)) from error

        return RenderedFrame(
            canvas_size=composited.canvas_size,
            rgba=composited.rgba,
            ground_anchor=request.project.manifest.canvas.ground_anchor,
            resolved_sockets=pose.socket_matrices,
            active_events=self._active_events(request, animation),
            clipping=composited.clipping,
        )

    @staticmethod
    def _validate_request(request: RenderRequest) -> None:
        manifest = request.project.manifest
        if manifest.template_id != request.rig.template_id:
            raise RenderError(
                f"Project template '{manifest.template_id}' does not match rig template "
                f"'{request.rig.template_id}'."
            )
        direction = manifest.directions.get(request.direction)
        if direction is None:
            raise RenderError(f"Project does not define direction '{request.direction.value}'.")
        if direction.mode is not DirectionMode.AUTHORED:
            raise RenderError(
                f"Direction '{request.direction.value}' uses layered mirroring; the OpenCV "
                "renderer accepts authored directions only. AF-052 directional yaw prerender "
                "is a separate 3D path."
            )

    def _evaluate_animation(
        self,
        request: RenderRequest,
        bone_order: tuple[str, ...],
    ) -> EvaluatedAnimation | None:
        if request.clip is None:
            return None
        return self._computation_cache.evaluate(
            request.project,
            request.rig,
            request.clip,
            request.direction,
            request.time_ms,
            bone_order,
            self._evaluator,
        )

    @staticmethod
    def _active_events(
        request: RenderRequest,
        animation: EvaluatedAnimation | None,
    ) -> tuple[str, ...]:
        clip: AnimationClip | None = request.clip
        if not request.include_events or clip is None or animation is None:
            return ()
        return tuple(
            event.event for event in clip.events if float(event.time_ms) == animation.time_ms
        )


__all__ = ["OpenCvRenderer"]
