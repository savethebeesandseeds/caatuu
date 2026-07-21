"""Pure frame-sampling and immutable export transport contracts."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

from animated_fabric.application.rendering import RenderProject
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition

MAX_EXPORT_FPS = 240
MAX_EXPORT_FRAMES = 4096
MAX_EXPORT_RAW_BYTES = 512 * 1024 * 1024


@runtime_checkable
class CancellationToken(Protocol):
    """Read-only cancellation signal checked at safe export boundaries."""

    def is_cancelled(self) -> bool:
        """Return whether the caller has requested cancellation."""
        ...


@dataclass(frozen=True, slots=True)
class FrameSample:
    """One deterministic render time, metadata duration, and event bin."""

    index: int
    time_ms: float
    duration_ms: int
    events: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if type(self.index) is not int or self.index < 0:
            raise ValueError("Frame sample index must be a non-negative integer.")
        if isinstance(self.time_ms, bool) or not isinstance(self.time_ms, (int, float)):
            raise TypeError("Frame sample time must be a finite number.")
        normalized_time = float(self.time_ms)
        if not math.isfinite(normalized_time) or normalized_time < 0.0:
            raise ValueError("Frame sample time must be finite and non-negative.")
        object.__setattr__(self, "time_ms", normalized_time)
        if type(self.duration_ms) is not int or self.duration_ms <= 0:
            raise ValueError("Frame sample duration must be a positive integer.")
        if not isinstance(self.events, tuple) or any(
            not isinstance(event, str) for event in self.events
        ):
            raise TypeError("Frame sample events must be an immutable tuple of strings.")


def _round_half_to_even(numerator: int, denominator: int) -> int:
    quotient, remainder = divmod(numerator, denominator)
    doubled_remainder = remainder * 2
    if doubled_remainder > denominator or (doubled_remainder == denominator and quotient % 2 == 1):
        return quotient + 1
    return quotient


def _frame_count(clip: AnimationClip, fps: int) -> int:
    if not isinstance(clip, AnimationClip):
        raise TypeError("Frame sampling requires a typed animation clip.")
    if type(fps) is not int:
        raise TypeError("Export FPS must be an integer.")
    if not 0 < fps <= MAX_EXPORT_FPS:
        raise ValueError(f"Export FPS must be between 1 and {MAX_EXPORT_FPS}.")
    frame_count = max(1, _round_half_to_even(clip.duration_ms * fps, 1000))
    if frame_count > MAX_EXPORT_FRAMES:
        raise ValueError(f"An animation may not exceed {MAX_EXPORT_FRAMES} export frames.")
    return frame_count


def build_frame_schedule(clip: AnimationClip, fps: int) -> tuple[FrameSample, ...]:
    """Sample one clip without a duplicate endpoint and bin its events deterministically."""
    frame_count = _frame_count(clip, fps)
    events_by_frame: list[list[str]] = [[] for _ in range(frame_count)]
    for event in clip.events:
        if event.time_ms < clip.duration_ms:
            event_index = (event.time_ms * frame_count) // clip.duration_ms
        elif event.time_ms == clip.duration_ms:
            event_index = 0 if clip.loop else frame_count - 1
        else:
            continue
        events_by_frame[event_index].append(event.event)

    samples: list[FrameSample] = []
    for index in range(frame_count):
        interval_start = (index * clip.duration_ms) // frame_count
        interval_end = ((index + 1) * clip.duration_ms) // frame_count
        samples.append(
            FrameSample(
                index=index,
                time_ms=index * clip.duration_ms / frame_count,
                duration_ms=interval_end - interval_start,
                events=tuple(events_by_frame[index]),
            )
        )
    return tuple(samples)


@dataclass(frozen=True, slots=True)
class ExportRequest:
    """Fully loaded, renderer-ready request for one frame-sequence transaction."""

    project: RenderProject
    rig: RigDefinition
    animations: tuple[AnimationClip, ...]
    directions: tuple[Direction, ...]
    fps: int
    destination: Path
    allow_clipping: bool = False
    cancellation: CancellationToken | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.project, RenderProject) or not isinstance(self.rig, RigDefinition):
            raise TypeError("Export requests require a typed render project and rig.")
        if not isinstance(self.animations, tuple):
            raise TypeError("Export animations must be an immutable tuple.")
        if not self.animations:
            raise ValueError("Export animations must be a non-empty immutable tuple.")
        if any(not isinstance(animation, AnimationClip) for animation in self.animations):
            raise TypeError("Export animations must contain only AnimationClip values.")
        animation_ids = tuple(animation.clip_id for animation in self.animations)
        if len(set(animation_ids)) != len(animation_ids):
            raise ValueError("Export animations must not contain duplicate clip IDs.")
        if not isinstance(self.directions, tuple):
            raise TypeError("Export directions must be an immutable tuple.")
        if not self.directions:
            raise ValueError("Export directions must be a non-empty immutable tuple.")
        if any(not isinstance(direction, Direction) for direction in self.directions):
            raise TypeError("Export directions must contain only Direction values.")
        if len(set(self.directions)) != len(self.directions):
            raise ValueError("Export directions must not contain duplicates.")
        if not isinstance(self.destination, Path):
            raise TypeError("Export destination must be a pathlib.Path.")
        if type(self.allow_clipping) is not bool:
            raise TypeError("The allow_clipping option must be boolean.")
        if self.cancellation is not None and not isinstance(self.cancellation, CancellationToken):
            raise TypeError("Export cancellation must implement CancellationToken.")

        schedules = tuple(
            build_frame_schedule(animation, self.fps) for animation in self.animations
        )
        total_frames = sum(len(schedule) for schedule in schedules) * len(self.directions)
        if total_frames > MAX_EXPORT_FRAMES:
            raise ValueError(f"An export request may not exceed {MAX_EXPORT_FRAMES} total frames.")
        canvas = self.project.manifest.canvas
        raw_bytes = total_frames * canvas.width * canvas.height * 4
        if raw_bytes > MAX_EXPORT_RAW_BYTES:
            raise ValueError(
                f"An export request may not exceed {MAX_EXPORT_RAW_BYTES} raw RGBA bytes."
            )


@dataclass(frozen=True, slots=True)
class AnimationExportResult:
    """Published files and frame count for one exported animation."""

    animation: str
    frame_count: int
    metadata_path: Path
    frame_paths: tuple[Path, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.animation, str):
            raise TypeError("Animation export result ID must be a string.")
        if not self.animation:
            raise ValueError("An animation export result requires an animation ID.")
        if type(self.frame_count) is not int or self.frame_count <= 0:
            raise ValueError("Animation export frame count must be a positive integer.")
        if not isinstance(self.metadata_path, Path):
            raise TypeError("Animation export metadata path must be a pathlib.Path.")
        if not isinstance(self.frame_paths, tuple):
            raise TypeError("Animation export frame paths must be an immutable tuple.")
        if not self.frame_paths:
            raise ValueError("Animation export frame paths must be a non-empty immutable tuple.")
        if any(not isinstance(path, Path) for path in self.frame_paths):
            raise TypeError("Animation export frame paths must be pathlib.Path values.")


@dataclass(frozen=True, slots=True)
class ExportResult:
    """Published destination and stable per-animation export results."""

    destination: Path
    animations: tuple[AnimationExportResult, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.destination, Path):
            raise TypeError("Export result destination must be a pathlib.Path.")
        if not isinstance(self.animations, tuple):
            raise TypeError("Export result animations must be an immutable tuple.")
        if not self.animations:
            raise ValueError("Export results must contain at least one animation.")
        if any(not isinstance(animation, AnimationExportResult) for animation in self.animations):
            raise TypeError("Export results must contain AnimationExportResult values.")


__all__ = [
    "MAX_EXPORT_FPS",
    "MAX_EXPORT_FRAMES",
    "MAX_EXPORT_RAW_BYTES",
    "AnimationExportResult",
    "CancellationToken",
    "ExportRequest",
    "ExportResult",
    "FrameSample",
    "build_frame_schedule",
]
