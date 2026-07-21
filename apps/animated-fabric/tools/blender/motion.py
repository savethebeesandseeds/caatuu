"""Pure deterministic motion plan for the AF-044 Blender walk prototype.

This module intentionally depends only on the Python standard library. Blender is a
raster adapter for these immutable poses; the regular test suite can therefore review
the gait, sampling, events, and metadata without importing ``bpy`` or ``mathutils``.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from types import MappingProxyType

FRAME_COUNT = 12
DURATION_MS = 1000
FPS = 12
FRAME_SIZE = (192, 192)
GROUND_ORIGIN = (96.0, 164.0)
DIRECTIONS = ("SE", "SW", "NE", "NW")
DIRECTION_YAW_DEGREES: Mapping[str, int] = MappingProxyType(
    {"SE": -90, "SW": 180, "NE": 0, "NW": 90}
)

STANCE_RATIO = 0.62
STRIDE_LENGTH = 0.60
FOOT_LIFT = 0.16
FOOT_HEEL_LENGTH = 0.12
FOOT_TOE_LENGTH = 0.22
ANKLE_HEIGHT = 0.10
STANCE_WIDTH = 0.30

UPPER_LEG_LENGTH = 0.58
LOWER_LEG_LENGTH = 0.55
HIP_WIDTH = 0.28
PELVIS_BASE_HEIGHT = 1.10
PELVIS_BOB = 0.035
PELVIS_SWAY = 0.025

UPPER_ARM_LENGTH = 0.36
LOWER_ARM_LENGTH = 0.33
SHOULDER_WIDTH = 0.66
ARM_SWING = 0.22

_TORSO_HEIGHT = 0.52
_HEAD_HEIGHT = 0.43
_ARM_DROP = 0.58
_ARM_RISE = 0.025
_LEG_POLE_FORWARD = 0.80
_EPSILON = 1e-12
_PROJECT_SLUG = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
_SEMANTIC_ID = re.compile(r"^[a-z][a-z0-9_]*$")


@dataclass(frozen=True, slots=True)
class Vec3:
    """One finite immutable Cartesian vector in actor-local Blender units."""

    x: float
    y: float
    z: float

    def __post_init__(self) -> None:
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in self):
            raise TypeError("Vec3 coordinates must be real numbers.")
        normalized = tuple(float(value) for value in self)
        if not all(math.isfinite(value) for value in normalized):
            raise ValueError("Vec3 coordinates must be finite.")
        object.__setattr__(self, "x", normalized[0])
        object.__setattr__(self, "y", normalized[1])
        object.__setattr__(self, "z", normalized[2])

    def __iter__(self) -> Iterator[float]:
        yield self.x
        yield self.y
        yield self.z

    def __add__(self, other: Vec3) -> Vec3:
        return Vec3(self.x + other.x, self.y + other.y, self.z + other.z)

    def __sub__(self, other: Vec3) -> Vec3:
        return Vec3(self.x - other.x, self.y - other.y, self.z - other.z)

    def __mul__(self, scalar: float) -> Vec3:
        return Vec3(self.x * scalar, self.y * scalar, self.z * scalar)

    def __truediv__(self, scalar: float) -> Vec3:
        if scalar == 0.0:
            raise ZeroDivisionError("A vector cannot be divided by zero.")
        return self * (1.0 / scalar)

    def dot(self, other: Vec3) -> float:
        """Return the scalar dot product."""
        return self.x * other.x + self.y * other.y + self.z * other.z

    @property
    def length(self) -> float:
        """Return Euclidean vector length."""
        return math.sqrt(self.dot(self))

    def normalized(self) -> Vec3:
        """Return a unit vector, rejecting a directionless value."""
        length = self.length
        if length <= _EPSILON:
            raise ValueError("A zero-length vector has no direction.")
        return self / length

    def reflected_x(self) -> Vec3:
        """Return the bilateral mirror used by gait symmetry tests."""
        return Vec3(-self.x, self.y, self.z)


ZERO = Vec3(0.0, 0.0, 0.0)


@dataclass(frozen=True, slots=True)
class FootPose:
    """Sole anchor and rigid foot landmarks for one leg."""

    sole_center: Vec3
    ankle: Vec3
    heel: Vec3
    toe: Vec3
    contact: bool

    def __post_init__(self) -> None:
        if not all(
            isinstance(value, Vec3) for value in (self.sole_center, self.ankle, self.heel, self.toe)
        ):
            raise TypeError("Foot landmarks must be Vec3 values.")
        if type(self.contact) is not bool:
            raise TypeError("Foot contact state must be boolean.")

    @property
    def sole_clearance(self) -> float:
        """Return the lowest modeled sole landmark above the ground plane."""
        return min(self.heel.z, self.toe.z)


@dataclass(frozen=True, slots=True)
class LegPose:
    """Two-link leg solution and its foot target."""

    hip: Vec3
    knee: Vec3
    foot: FootPose

    @property
    def ankle(self) -> Vec3:
        """Expose the foot ankle as the lower-leg endpoint."""
        return self.foot.ankle


@dataclass(frozen=True, slots=True)
class ArmPose:
    """Two-link arm solution from shoulder through wrist."""

    shoulder: Vec3
    elbow: Vec3
    wrist: Vec3


@dataclass(frozen=True, slots=True)
class WalkPose:
    """One complete actor-local in-place walk pose."""

    root: Vec3
    pelvis: Vec3
    chest: Vec3
    head: Vec3
    left_leg: LegPose
    right_leg: LegPose
    left_arm: ArmPose
    right_arm: ArmPose
    pelvis_yaw_deg: float
    chest_yaw_deg: float

    @property
    def points(self) -> tuple[Vec3, ...]:
        """Return every explicit landmark in stable anatomical order."""
        return (
            self.root,
            self.pelvis,
            self.chest,
            self.head,
            self.left_leg.hip,
            self.left_leg.knee,
            self.left_leg.foot.ankle,
            self.left_leg.foot.heel,
            self.left_leg.foot.toe,
            self.right_leg.hip,
            self.right_leg.knee,
            self.right_leg.foot.ankle,
            self.right_leg.foot.heel,
            self.right_leg.foot.toe,
            self.left_arm.shoulder,
            self.left_arm.elbow,
            self.left_arm.wrist,
            self.right_arm.shoulder,
            self.right_arm.elbow,
            self.right_arm.wrist,
        )


@dataclass(frozen=True, slots=True)
class WalkFrame:
    """One sampled pose and its exact frame-sequence metadata."""

    index: int
    time_ms: float
    duration_ms: int
    events: tuple[str, ...]
    pose: WalkPose


def _normalize_phase(phase: float) -> float:
    if isinstance(phase, bool) or not isinstance(phase, (int, float)):
        raise TypeError("Walk phase must be a real number.")
    normalized = float(phase)
    if not math.isfinite(normalized):
        raise ValueError("Walk phase must be finite.")
    return normalized % 1.0


def _smoothstep(value: float) -> float:
    return value * value * (3.0 - 2.0 * value)


def _foot_pose(side: int, phase: float) -> FootPose:
    x = side * STANCE_WIDTH / 2.0
    half_stride = STRIDE_LENGTH / 2.0
    if phase < STANCE_RATIO:
        progress = phase / STANCE_RATIO
        y = half_stride - STRIDE_LENGTH * progress
        clearance = 0.0
        pitch = 0.0
        contact = True
    else:
        progress = (phase - STANCE_RATIO) / (1.0 - STANCE_RATIO)
        y = -half_stride + STRIDE_LENGTH * _smoothstep(progress)
        clearance = FOOT_LIFT * math.sin(math.pi * progress) ** 2
        pitch = math.radians(-12.0) * math.sin(2.0 * math.pi * progress)
        contact = False

    sine = math.sin(pitch)
    cosine = math.cos(pitch)
    raw_heel_z = sine * -FOOT_HEEL_LENGTH
    raw_toe_z = sine * FOOT_TOE_LENGTH
    vertical_offset = clearance - min(raw_heel_z, raw_toe_z)
    sole_center = Vec3(x, y, clearance)
    heel = Vec3(
        x,
        y - cosine * FOOT_HEEL_LENGTH,
        vertical_offset + raw_heel_z,
    )
    toe = Vec3(
        x,
        y + cosine * FOOT_TOE_LENGTH,
        vertical_offset + raw_toe_z,
    )
    ankle = Vec3(
        x,
        y - sine * ANKLE_HEIGHT,
        vertical_offset + cosine * ANKLE_HEIGHT,
    )
    return FootPose(
        sole_center=sole_center,
        ankle=ankle,
        heel=heel,
        toe=toe,
        contact=contact,
    )


def _solve_two_link(
    origin: Vec3,
    target: Vec3,
    first_length: float,
    second_length: float,
    pole_direction: Vec3,
) -> Vec3:
    delta = target - origin
    distance = delta.length
    minimum = abs(first_length - second_length)
    maximum = first_length + second_length
    if not minimum + _EPSILON < distance < maximum - _EPSILON:
        raise ValueError(
            f"Two-link target distance {distance:.6f} is outside ({minimum:.6f}, {maximum:.6f})."
        )

    axis = delta / distance
    along = (first_length * first_length - second_length * second_length + distance * distance) / (
        2.0 * distance
    )
    height_squared = first_length * first_length - along * along
    if height_squared <= 0.0:
        raise ValueError("Two-link target produces a degenerate joint solution.")

    projected_pole = pole_direction - axis * pole_direction.dot(axis)
    bend_direction = projected_pole.normalized()
    return origin + axis * along + bend_direction * math.sqrt(height_squared)


def _leg_pose(side: int, hip: Vec3, phase: float) -> LegPose:
    foot = _foot_pose(side, phase)
    knee = _solve_two_link(
        hip,
        foot.ankle,
        UPPER_LEG_LENGTH,
        LOWER_LEG_LENGTH,
        Vec3(side * 0.14, _LEG_POLE_FORWARD, 0.0),
    )
    return LegPose(hip=hip, knee=knee, foot=foot)


def _arm_pose(side: int, shoulder: Vec3, leg_phase: float, chest: Vec3) -> ArmPose:
    phase_angle = 2.0 * math.pi * leg_phase
    wrist = Vec3(
        chest.x + side * SHOULDER_WIDTH / 2.0,
        chest.y - ARM_SWING * math.cos(phase_angle),
        shoulder.z - _ARM_DROP + _ARM_RISE * (1.0 - abs(math.cos(phase_angle))),
    )
    elbow = _solve_two_link(
        shoulder,
        wrist,
        UPPER_ARM_LENGTH,
        LOWER_ARM_LENGTH,
        Vec3(side * 0.75, -0.20, 0.0),
    )
    return ArmPose(shoulder=shoulder, elbow=elbow, wrist=wrist)


def pose_at_phase(phase: float) -> WalkPose:
    """Return the periodic actor-local pose at any finite normalized cycle phase."""
    normalized = _normalize_phase(phase)
    cycle_angle = 2.0 * math.pi * normalized
    pelvis = Vec3(
        PELVIS_SWAY * math.sin(cycle_angle),
        0.0,
        PELVIS_BASE_HEIGHT - PELVIS_BOB * math.cos(2.0 * cycle_angle),
    )
    chest = Vec3(pelvis.x * 0.55, pelvis.y, pelvis.z + _TORSO_HEIGHT)
    head = Vec3(chest.x * 0.45, chest.y, chest.z + _HEAD_HEIGHT)

    left_phase = normalized
    right_phase = (normalized + 0.5) % 1.0
    left_hip = Vec3(pelvis.x - HIP_WIDTH / 2.0, pelvis.y, pelvis.z)
    right_hip = Vec3(pelvis.x + HIP_WIDTH / 2.0, pelvis.y, pelvis.z)
    left_leg = _leg_pose(-1, left_hip, left_phase)
    right_leg = _leg_pose(1, right_hip, right_phase)

    left_shoulder = Vec3(
        chest.x - SHOULDER_WIDTH / 2.0,
        chest.y,
        chest.z + 0.04,
    )
    right_shoulder = Vec3(
        chest.x + SHOULDER_WIDTH / 2.0,
        chest.y,
        chest.z + 0.04,
    )
    left_arm = _arm_pose(-1, left_shoulder, left_phase, chest)
    right_arm = _arm_pose(1, right_shoulder, right_phase, chest)

    return WalkPose(
        root=ZERO,
        pelvis=pelvis,
        chest=chest,
        head=head,
        left_leg=left_leg,
        right_leg=right_leg,
        left_arm=left_arm,
        right_arm=right_arm,
        pelvis_yaw_deg=4.0 * math.sin(cycle_angle),
        chest_yaw_deg=-3.0 * math.sin(cycle_angle),
    )


def frame_durations_ms() -> tuple[int, ...]:
    """Return exact integer durations whose sum is the one-second cycle."""
    return tuple(
        ((index + 1) * DURATION_MS) // FRAME_COUNT - (index * DURATION_MS) // FRAME_COUNT
        for index in range(FRAME_COUNT)
    )


def _require_frame_index(index: int) -> None:
    if type(index) is not int or not 0 <= index < FRAME_COUNT:
        raise ValueError(f"Frame index must be an integer from 0 through {FRAME_COUNT - 1}.")


def frame_events(index: int) -> tuple[str, ...]:
    """Return stable contact events at the two half-cycle heel strikes."""
    _require_frame_index(index)
    if index == 0:
        return ("foot_contact_l",)
    if index == FRAME_COUNT // 2:
        return ("foot_contact_r",)
    return ()


def walk_frame(index: int) -> WalkFrame:
    """Return one sampled walk frame without a duplicate duration endpoint."""
    _require_frame_index(index)
    return WalkFrame(
        index=index,
        time_ms=index * DURATION_MS / FRAME_COUNT,
        duration_ms=frame_durations_ms()[index],
        events=frame_events(index),
        pose=pose_at_phase(index / FRAME_COUNT),
    )


def walk_frames() -> tuple[WalkFrame, ...]:
    """Return all twelve deterministic output samples in index order."""
    return tuple(walk_frame(index) for index in range(FRAME_COUNT))


def direction_yaw_degrees(direction: str) -> int:
    """Return the fixed actor-root yaw for one logical direction."""
    if not isinstance(direction, str) or direction not in DIRECTION_YAW_DEGREES:
        raise ValueError(f"Direction must be one of: {', '.join(DIRECTIONS)}.")
    return DIRECTION_YAW_DEGREES[direction]


def build_frame_sequence_manifest(
    project: str = "blender_humanoid",
    animation: str = "walk",
) -> dict[str, object]:
    """Build JSON-ready metadata compatible with ``frame-sequence.v1``."""
    if _PROJECT_SLUG.fullmatch(project) is None:
        raise ValueError("Project must be a lowercase snake_case project slug.")
    if _SEMANTIC_ID.fullmatch(animation) is None:
        raise ValueError("Animation must be a lowercase snake_case semantic ID.")

    durations = frame_durations_ms()
    frames: list[dict[str, object]] = []
    for direction in DIRECTIONS:
        for index in range(FRAME_COUNT):
            frames.append(
                {
                    "direction": direction,
                    "index": index,
                    "image": f"{direction}/{index:03d}.png",
                    "duration_ms": durations[index],
                    "events": list(frame_events(index)),
                }
            )
    return {
        "format": "animated-fabric.frame-sequence.v1",
        "schema_version": "0.1.0",
        "project": project,
        "animation": animation,
        "frame_size": list(FRAME_SIZE),
        "origin": list(GROUND_ORIGIN),
        "fps": FPS,
        "duration_ms": DURATION_MS,
        "directions": list(DIRECTIONS),
        "frames_per_direction": FRAME_COUNT,
        "frames": frames,
    }


def canonical_manifest_json(
    project: str = "blender_humanoid",
    animation: str = "walk",
) -> str:
    """Encode stable UTF-8-ready metadata with no timestamp or host path."""
    return (
        json.dumps(
            build_frame_sequence_manifest(project, animation),
            allow_nan=False,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


__all__ = [
    "ANKLE_HEIGHT",
    "ARM_SWING",
    "DIRECTIONS",
    "DIRECTION_YAW_DEGREES",
    "DURATION_MS",
    "FOOT_LIFT",
    "FPS",
    "FRAME_COUNT",
    "FRAME_SIZE",
    "GROUND_ORIGIN",
    "HIP_WIDTH",
    "LOWER_ARM_LENGTH",
    "LOWER_LEG_LENGTH",
    "PELVIS_BASE_HEIGHT",
    "PELVIS_BOB",
    "PELVIS_SWAY",
    "SHOULDER_WIDTH",
    "STANCE_RATIO",
    "STANCE_WIDTH",
    "STRIDE_LENGTH",
    "UPPER_ARM_LENGTH",
    "UPPER_LEG_LENGTH",
    "ArmPose",
    "FootPose",
    "LegPose",
    "Vec3",
    "WalkFrame",
    "WalkPose",
    "build_frame_sequence_manifest",
    "canonical_manifest_json",
    "direction_yaw_degrees",
    "frame_durations_ms",
    "frame_events",
    "pose_at_phase",
    "walk_frame",
    "walk_frames",
]
