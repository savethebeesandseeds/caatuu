"""Image-library-neutral rendering contracts and deterministic layer planning."""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from types import MappingProxyType
from typing import Protocol, runtime_checkable

from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.animation_evaluator import EvaluatedAnimation, EvaluatedPartState
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.geometry import IntSize, Vec2
from animated_fabric.domain.pose import (
    ResolvedPose,
    part_pivot_for_direction,
    part_to_canvas_matrix,
)
from animated_fabric.domain.project import Direction, DirectionMode, PixelSnap, ProjectManifest
from animated_fabric.domain.rig import DirectionProfile, PartBinding, RigDefinition
from animated_fabric.domain.transforms import Matrix3


def _is_normalized_opacity(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        normalized = float(value)
    except (OverflowError, ValueError):
        return False
    return math.isfinite(normalized) and 0.0 <= normalized <= 1.0


class RenderQuality(StrEnum):
    """Image-library-neutral affine sampling quality."""

    NEAREST = "nearest"
    LINEAR = "linear"
    CUBIC = "cubic"


@dataclass(frozen=True, slots=True)
class RenderProject:
    """Transient render aggregate for one approved project root and asset catalog.

    The persisted specification does not yet define a whole-project or asset-catalog
    document. This value keeps those runtime facts typed without inventing persistence.
    """

    root: Path
    manifest: ProjectManifest
    assets: Mapping[str, AssetLayer]
    project_revision: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.root, Path):
            raise TypeError("A render project root must be a pathlib.Path.")
        if not isinstance(self.manifest, ProjectManifest):
            raise TypeError("A render project requires a typed project manifest.")
        if not isinstance(self.assets, Mapping):
            raise TypeError("A render project asset catalog must be a mapping.")
        if (
            isinstance(self.project_revision, bool)
            or not isinstance(self.project_revision, int)
            or self.project_revision < 0
        ):
            raise ValueError("Project revision must be a non-negative integer.")

        copied_assets: dict[str, AssetLayer] = {}
        for asset_id, asset in self.assets.items():
            if not isinstance(asset_id, str) or not isinstance(asset, AssetLayer):
                raise TypeError("Render project assets require string IDs and AssetLayer values.")
            if asset.asset_id != asset_id:
                raise ValueError(
                    f"Asset catalog key '{asset_id}' does not match asset ID '{asset.asset_id}'."
                )
            copied_assets[asset_id] = asset
        object.__setattr__(self, "assets", MappingProxyType(copied_assets))


@dataclass(frozen=True, slots=True)
class ClippingEdges:
    """Canvas edges touched by alpha above a composite request's threshold."""

    top: bool = False
    right: bool = False
    bottom: bool = False
    left: bool = False

    def __post_init__(self) -> None:
        if any(type(value) is not bool for value in (self.top, self.right, self.bottom, self.left)):
            raise ValueError("Clipping edge flags must be booleans.")

    @property
    def is_clipped(self) -> bool:
        """Return whether any canvas edge is touched."""
        return self.top or self.right or self.bottom or self.left


@dataclass(frozen=True, slots=True)
class PlannedRenderLayer:
    """One fully resolved visual layer in source-over draw order."""

    part_id: str
    asset: AssetLayer
    matrix: Matrix3
    opacity: float
    draw_slot: str
    slot_index: int
    effective_slot_order: int

    def __post_init__(self) -> None:
        if not isinstance(self.asset, AssetLayer) or not isinstance(self.matrix, Matrix3):
            raise TypeError("Planned layers require typed asset metadata and a Matrix3.")
        if not _is_normalized_opacity(self.opacity):
            raise ValueError("Planned layer opacity must be finite and between 0 and 1.")
        if type(self.slot_index) is not int or self.slot_index < 0:
            raise ValueError("Planned layer slot index must be non-negative.")
        if type(self.effective_slot_order) is not int:
            raise TypeError("Planned layer effective slot order must be an integer.")


@dataclass(frozen=True, slots=True)
class CompositeRequest:
    """Immutable compositor input independent of a concrete image array type."""

    canvas_size: IntSize
    direction: Direction
    layers: tuple[PlannedRenderLayer, ...]
    quality: RenderQuality = RenderQuality.CUBIC
    alpha_threshold: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.canvas_size, IntSize) or not isinstance(self.direction, Direction):
            raise TypeError("Composite requests require typed canvas and direction values.")
        if type(self.alpha_threshold) is not int or not 0 <= self.alpha_threshold <= 255:
            raise ValueError("Alpha threshold must be an integer from 0 through 255.")
        if not isinstance(self.quality, RenderQuality):
            raise TypeError("Render quality must be a RenderQuality value.")
        if not isinstance(self.layers, tuple):
            raise TypeError("Composite request layers must be an immutable tuple.")
        if any(not isinstance(layer, PlannedRenderLayer) for layer in self.layers):
            raise TypeError("Composite request layers must be planned render layers.")


@dataclass(frozen=True, slots=True)
class CompositedFrame:
    """Immutable straight-alpha RGBA bytes and clipping metadata."""

    canvas_size: IntSize
    rgba: bytes
    clipping: ClippingEdges

    def __post_init__(self) -> None:
        if not isinstance(self.canvas_size, IntSize) or not isinstance(
            self.clipping, ClippingEdges
        ):
            raise TypeError("Composited frames require typed canvas and clipping metadata.")
        if not isinstance(self.rgba, bytes):
            raise TypeError("Composited RGBA data must be immutable bytes.")
        expected_size = self.canvas_size.width * self.canvas_size.height * 4
        if len(self.rgba) != expected_size:
            raise ValueError(
                f"Composited RGBA data must contain exactly {expected_size} bytes; "
                f"received {len(self.rgba)}."
            )


@dataclass(frozen=True, slots=True)
class RenderRequest:
    """Immutable request for one complete render-pipeline evaluation."""

    project: RenderProject
    rig: RigDefinition
    clip: AnimationClip | None
    direction: Direction
    time_ms: float
    quality: RenderQuality = RenderQuality.CUBIC
    alpha_threshold: int = 0
    include_events: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.project, RenderProject) or not isinstance(self.rig, RigDefinition):
            raise TypeError("Render requests require a typed project and rig.")
        if self.clip is not None and not isinstance(self.clip, AnimationClip):
            raise TypeError("Render request clips must be AnimationClip values or None.")
        if not isinstance(self.direction, Direction):
            raise TypeError("Render request direction must be a Direction value.")
        if isinstance(self.time_ms, bool) or not isinstance(self.time_ms, (int, float)):
            raise TypeError("Render request time must be a finite number.")
        normalized_time = float(self.time_ms)
        if not math.isfinite(normalized_time):
            raise ValueError("Render request time must be finite.")
        object.__setattr__(self, "time_ms", normalized_time)
        if not isinstance(self.quality, RenderQuality):
            raise TypeError("Render request quality must be a RenderQuality value.")
        if type(self.alpha_threshold) is not int or not 0 <= self.alpha_threshold <= 255:
            raise ValueError("Alpha threshold must be an integer from 0 through 255.")
        if type(self.include_events) is not bool:
            raise TypeError("Event inclusion must be boolean.")


@dataclass(frozen=True, slots=True)
class RenderedFrame:
    """Immutable straight-alpha frame plus spatial and diagnostic metadata."""

    canvas_size: IntSize
    rgba: bytes
    ground_anchor: Vec2
    resolved_sockets: Mapping[str, Matrix3]
    active_events: tuple[str, ...]
    clipping: ClippingEdges

    def __post_init__(self) -> None:
        if not isinstance(self.canvas_size, IntSize) or not isinstance(self.ground_anchor, Vec2):
            raise TypeError("Rendered frames require typed canvas and ground-anchor values.")
        if not isinstance(self.rgba, bytes):
            raise TypeError("Rendered RGBA data must be immutable bytes.")
        expected_size = self.canvas_size.width * self.canvas_size.height * 4
        if len(self.rgba) != expected_size:
            raise ValueError(
                f"Rendered RGBA data must contain exactly {expected_size} bytes; "
                f"received {len(self.rgba)}."
            )
        if not isinstance(self.resolved_sockets, Mapping):
            raise TypeError("Resolved sockets must be a mapping of IDs to matrices.")
        copied_sockets: dict[str, Matrix3] = {}
        for socket_id, matrix in self.resolved_sockets.items():
            if not isinstance(socket_id, str) or not isinstance(matrix, Matrix3):
                raise TypeError("Resolved sockets require string IDs and Matrix3 values.")
            copied_sockets[socket_id] = matrix
        object.__setattr__(self, "resolved_sockets", MappingProxyType(copied_sockets))
        if not isinstance(self.active_events, tuple) or any(
            not isinstance(event, str) for event in self.active_events
        ):
            raise TypeError("Active events must be an immutable tuple of event IDs.")
        if not isinstance(self.clipping, ClippingEdges):
            raise TypeError("Rendered frames require clipping diagnostics.")


@runtime_checkable
class Renderer(Protocol):
    """Port for the complete preview/export frame pipeline."""

    def render(self, request: RenderRequest) -> RenderedFrame:
        """Render one frame and its metadata."""
        ...


@runtime_checkable
class FrameCompositor(Protocol):
    """Port implemented by a concrete RGBA frame compositor."""

    def compose(self, request: CompositeRequest) -> CompositedFrame:
        """Composite one planned frame."""
        ...


class RenderPlanner:
    """Resolve validated domain state into a deterministic authored-direction request."""

    def plan(
        self,
        project: ProjectManifest,
        rig: RigDefinition,
        direction: Direction,
        pose: ResolvedPose,
        animation: EvaluatedAnimation | None,
        assets: Mapping[str, AssetLayer],
        *,
        quality: RenderQuality = RenderQuality.CUBIC,
        alpha_threshold: int = 0,
    ) -> CompositeRequest:
        """Return visible layers ordered from back to front for source-over composition."""
        self._validate_project_direction(project, rig, direction)
        parts_by_id = self._parts_by_id(rig)
        part_ids = frozenset(parts_by_id)
        self._require_exact_part_ids("pose matrices", pose.part_matrices, part_ids)
        if animation is not None:
            self._require_exact_part_ids("animation states", animation.part_states, part_ids)

        slots = rig.draw_slot_profiles.get(direction)
        if slots is None:
            raise RenderError(f"Authored direction '{direction.value}' has no draw-slot profile.")
        if len(set(slots)) != len(slots):
            raise RenderError(
                f"Draw-slot profile for direction '{direction.value}' contains duplicates."
            )
        slot_indexes = {slot: index for index, slot in enumerate(slots)}
        profile = rig.direction_profiles.get(direction)

        layers: list[PlannedRenderLayer] = []
        for part in rig.parts:
            state = self._part_state(part, profile, animation)
            self._validate_part_state(part.part_id, state)
            if not state.visible:
                continue
            slot_index = slot_indexes.get(part.draw_slot)
            if slot_index is None:
                raise RenderError(
                    f"Visible part '{part.part_id}' uses unknown draw slot "
                    f"'{part.draw_slot}' for direction '{direction.value}'."
                )
            asset_id = (
                profile.asset_selection.get(part.part_id)
                if profile is not None and part.part_id in profile.asset_selection
                else part.assets_by_direction.get(direction)
            )
            if asset_id is None:
                raise RenderError(
                    f"Visible part '{part.part_id}' has no asset for authored direction "
                    f"'{direction.value}'."
                )
            asset = assets.get(asset_id)
            if asset is None:
                raise RenderError(
                    f"Visible part '{part.part_id}' selects missing asset '{asset_id}'."
                )
            if not isinstance(asset, AssetLayer):
                raise RenderError(f"Asset catalog entry '{asset_id}' is not typed asset metadata.")
            if asset.asset_id != asset_id:
                raise RenderError(
                    f"Asset catalog key '{asset_id}' does not match asset ID '{asset.asset_id}'."
                )
            if asset.direction is not direction:
                raise RenderError(
                    f"Asset '{asset_id}' belongs to direction '{asset.direction.value}', not "
                    f"'{direction.value}'."
                )

            base_order = (
                profile.slot_order.get(part.part_id, part.slot_order)
                if profile is not None
                else part.slot_order
            )
            matrix = self._part_matrix(project, rig, direction, pose, part)
            layers.append(
                PlannedRenderLayer(
                    part_id=part.part_id,
                    asset=asset,
                    matrix=matrix,
                    opacity=state.opacity,
                    draw_slot=part.draw_slot,
                    slot_index=slot_index,
                    effective_slot_order=base_order + state.z_bias,
                )
            )

        layers.sort(
            key=lambda layer: (
                layer.slot_index,
                layer.effective_slot_order,
                layer.part_id,
            )
        )
        return CompositeRequest(
            canvas_size=IntSize(width=project.canvas.width, height=project.canvas.height),
            direction=direction,
            layers=tuple(layers),
            quality=quality,
            alpha_threshold=alpha_threshold,
        )

    @staticmethod
    def _validate_project_direction(
        project: ProjectManifest,
        rig: RigDefinition,
        direction: Direction,
    ) -> None:
        if project.template_id != rig.template_id:
            raise RenderError(
                f"Project template '{project.template_id}' does not match rig template "
                f"'{rig.template_id}'."
            )
        definition = project.directions.get(direction)
        if definition is None:
            raise RenderError(f"Project does not define direction '{direction.value}'.")
        if definition.mode is not DirectionMode.AUTHORED:
            raise RenderError(
                f"RenderPlanner accepts authored directions only; '{direction.value}' is "
                f"'{definition.mode.value}'."
            )

    @staticmethod
    def _parts_by_id(rig: RigDefinition) -> dict[str, PartBinding]:
        parts: dict[str, PartBinding] = {}
        for part in rig.parts:
            if part.part_id in parts:
                raise RenderError(f"Rig contains duplicate part ID '{part.part_id}'.")
            parts[part.part_id] = part
        return parts

    @staticmethod
    def _require_exact_part_ids(
        label: str,
        values: Mapping[str, object],
        expected: frozenset[str],
    ) -> None:
        actual = frozenset(values)
        if actual == expected:
            return
        missing = ", ".join(f"'{part_id}'" for part_id in sorted(expected - actual)) or "none"
        extra = ", ".join(f"'{part_id}'" for part_id in sorted(actual - expected)) or "none"
        raise RenderError(
            f"Part IDs in {label} do not match the rig; missing: {missing}; extra: {extra}."
        )

    @staticmethod
    def _part_state(
        part: PartBinding,
        profile: DirectionProfile | None,
        animation: EvaluatedAnimation | None,
    ) -> EvaluatedPartState:
        if animation is not None:
            return animation.part_states[part.part_id]
        visible = part.visible
        if profile is not None:
            visible = profile.part_visibility.get(part.part_id, visible)
        return EvaluatedPartState(visible=visible, opacity=part.opacity, z_bias=0)

    @staticmethod
    def _part_matrix(
        project: ProjectManifest,
        rig: RigDefinition,
        direction: Direction,
        pose: ResolvedPose,
        part: PartBinding,
    ) -> Matrix3:
        matrix = pose.part_matrices[part.part_id]
        if not isinstance(matrix, Matrix3):
            raise RenderError(f"Pose matrix for part '{part.part_id}' is not a Matrix3.")
        if project.canvas.pixel_snap is PixelSnap.NONE:
            return matrix

        bone_world = pose.bone_world_matrices.get(part.bone_id)
        if not isinstance(bone_world, Matrix3):
            raise RenderError(f"Pixel snapping requires a world matrix for bone '{part.bone_id}'.")
        first, second, third = bone_world.rows
        snapped_world = Matrix3.from_rows(
            (first[0], first[1], float(round(first[2]))),
            (second[0], second[1], float(round(second[2]))),
            third,
        )
        return part_to_canvas_matrix(
            snapped_world,
            part,
            part_pivot_for_direction(part, direction, rig),
        )

    @staticmethod
    def _validate_part_state(part_id: str, state: object) -> None:
        if not isinstance(state, EvaluatedPartState):
            raise RenderError(f"Animation state for part '{part_id}' has an invalid type.")
        if type(state.visible) is not bool:
            raise RenderError(f"Animation visibility for part '{part_id}' must be boolean.")
        if not _is_normalized_opacity(state.opacity):
            raise RenderError(
                f"Animation opacity for part '{part_id}' must be finite and between 0 and 1."
            )
        if type(state.z_bias) is not int:
            raise RenderError(f"Animation z-bias for part '{part_id}' must be an integer.")


__all__ = [
    "ClippingEdges",
    "CompositedFrame",
    "CompositeRequest",
    "FrameCompositor",
    "PlannedRenderLayer",
    "RenderedFrame",
    "Renderer",
    "RenderPlanner",
    "RenderProject",
    "RenderQuality",
    "RenderRequest",
]
