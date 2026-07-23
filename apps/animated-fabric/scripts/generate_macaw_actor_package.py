"""Author the deterministic AF-056 traveler-macaw actor package.

The geometry in this module is a reviewed, first-party low-poly model expressed as
code.  It consumes approved reference identities but does not reconstruct geometry
from pixels and does not provide a general image-to-3D or rigging facility.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import stat
import struct
import sys
import tempfile
import zlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = APP_ROOT.parent.parent
sys.path.insert(0, str(APP_ROOT))

from tools import reference_package  # noqa: E402
from tools.blender import actor_package  # noqa: E402

PACKAGE_ID = "macaw-traveler-avian-v1"
ACTOR_ROOT = "root"
RIG_ID = "avian_v1"
REFERENCE_PACKAGE_ROOT = APP_ROOT / "assets/reference-packages/macaw-traveler-v1"
RIG_CONTRACT_PATH = APP_ROOT / "tools/blender/contracts/avian_v1.json"
AUTHORING_RECORD_PATH = APP_ROOT / "assets/actor-reviews/macaw-traveler-avian-v1/authoring.json"

REFERENCE_MANIFEST_SHA256 = "a88520b026a4c48b98c6b50785fe49ffa60d01f1e94157650dbfbbb754b11f77"
REFERENCE_APPROVAL_SHA256 = "e6dc9202b6608ab5821c2fb9c76811a5a69296061bf20314b6c7ea3bafa142bc"
REFERENCE_SOURCE_APPROVAL_SHA256 = (
    "4b6d2348fff593ece021d12a32cc1713afb0d05367b9f660d493a7431e7c4cfc"
)
REFERENCE_VIEW_SET_SHA256 = "3c625d9ff3e87567d2e1eb2878866243629c2af18ed0af011fe2526c2aee9311"

TEXTURE_SIZE = (32, 32)
TEXTURE_COLORS: tuple[tuple[str, tuple[int, int, int, int], tuple[int, int, int, int]], ...] = (
    ("black", (20, 24, 28, 255), (46, 43, 39, 255)),
    ("brown", (132, 72, 24, 255), (181, 106, 38, 255)),
    ("cream", (242, 230, 192, 255), (255, 247, 220, 255)),
    ("cyan", (0, 132, 159, 255), (20, 181, 192, 255)),
    ("dark-brown", (72, 37, 17, 255), (108, 60, 25, 255)),
    ("gray", (80, 86, 91, 255), (137, 143, 146, 255)),
    ("orange", (230, 130, 9, 255), (255, 184, 30, 255)),
)

BONE_ORDER = (
    "root",
    "pelvis",
    "torso",
    "neck",
    "head",
    "beak",
    "wing_upper_l",
    "wing_lower_l",
    "wing_hand_l",
    "wing_upper_r",
    "wing_lower_r",
    "wing_hand_r",
    "tail_base",
    "tail_mid",
    "tail_tip",
    "thigh_l",
    "shin_l",
    "foot_l",
    "thigh_r",
    "shin_r",
    "foot_r",
)

PARENT_BY_BONE: dict[str, str | None] = {
    "root": None,
    "pelvis": "root",
    "torso": "pelvis",
    "neck": "torso",
    "head": "neck",
    "beak": "head",
    "wing_upper_l": "torso",
    "wing_lower_l": "wing_upper_l",
    "wing_hand_l": "wing_lower_l",
    "wing_upper_r": "torso",
    "wing_lower_r": "wing_upper_r",
    "wing_hand_r": "wing_lower_r",
    "tail_base": "torso",
    "tail_mid": "tail_base",
    "tail_tip": "tail_mid",
    "thigh_l": "pelvis",
    "shin_l": "thigh_l",
    "foot_l": "shin_l",
    "thigh_r": "pelvis",
    "shin_r": "thigh_r",
    "foot_r": "shin_r",
}

BIND_WORLD_ACTOR: dict[str, tuple[float, float, float]] = {
    "root": (0.0, 0.0, 0.0),
    "pelvis": (0.0, 0.0, 0.78),
    "torso": (0.0, 0.0, 1.02),
    "neck": (0.0, 0.02, 1.43),
    "head": (0.0, 0.03, 1.62),
    "beak": (0.0, 0.23, 1.68),
    "wing_upper_l": (-0.34, 0.0, 1.28),
    "wing_lower_l": (-0.53, 0.02, 1.05),
    "wing_hand_l": (-0.58, 0.12, 0.82),
    "wing_upper_r": (0.34, 0.0, 1.28),
    "wing_lower_r": (0.53, 0.02, 1.05),
    "wing_hand_r": (0.58, 0.12, 0.82),
    "tail_base": (0.0, -0.16, 1.0),
    "tail_mid": (0.0, -0.3, 0.78),
    "tail_tip": (0.0, -0.48, 0.56),
    "thigh_l": (-0.17, 0.0, 0.68),
    "shin_l": (-0.17, 0.0, 0.4),
    "foot_l": (-0.17, 0.08, 0.14),
    "thigh_r": (0.17, 0.0, 0.68),
    "shin_r": (0.17, 0.0, 0.4),
    "foot_r": (0.17, 0.08, 0.14),
}

Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]
JointRow = tuple[int, int, int, int]
WeightRow = tuple[float, float, float, float]
_REPARSE_ATTRIBUTE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


@dataclass(slots=True)
class Primitive:
    """One material-homogeneous indexed triangle primitive."""

    positions: list[Vec3] = field(default_factory=list)
    normals: list[Vec3] = field(default_factory=list)
    texcoords: list[Vec2] = field(default_factory=list)
    joints: list[JointRow] = field(default_factory=list)
    weights: list[WeightRow] = field(default_factory=list)
    indices: list[int] = field(default_factory=list)

    def vertex(
        self,
        position: Vec3,
        normal: Vec3,
        uv: Vec2,
        influences: tuple[tuple[int, float], ...],
    ) -> int:
        if not 1 <= len(influences) <= 4:
            raise ValueError("Authored vertices require one to four influences.")
        if abs(sum(weight for _joint, weight in influences) - 1.0) > 1e-9:
            raise ValueError("Authored vertex weights must be normalized.")
        joint_values = [joint for joint, _weight in influences]
        weight_values = [weight for _joint, weight in influences]
        while len(joint_values) < 4:
            joint_values.append(0)
            weight_values.append(0.0)
        # Five-decimal actor-space authoring precision keeps the generic
        # preflight bounds and Blender's five-decimal post-import gate exact.
        authored_position = (
            round(position[0], 5),
            round(position[1], 5),
            round(position[2], 5),
        )
        self.positions.append(_f32_vec(authored_position))
        self.normals.append(_f32_vec(_normalize(normal)))
        self.texcoords.append((_f32(uv[0]), _f32(uv[1])))
        self.joints.append(tuple(joint_values))  # type: ignore[arg-type]
        self.weights.append(tuple(_f32(value) for value in weight_values))  # type: ignore[arg-type]
        return len(self.positions) - 1


@dataclass(frozen=True, slots=True)
class GeneratedGeometry:
    primitives: Mapping[str, Primitive]
    actor_bounds: Mapping[str, list[float]]


@dataclass(frozen=True, slots=True)
class GeneratedGlb:
    payload: bytes
    buffer_bytes: int
    accessors: int
    buffer_views: int
    vertices: int
    indices: int
    triangles: int
    primitives: int
    actor_bounds: Mapping[str, list[float]]


def _f32(value: float) -> float:
    return float(struct.unpack("<f", struct.pack("<f", value))[0])


def _f32_vec(value: Vec3) -> Vec3:
    return (_f32(value[0]), _f32(value[1]), _f32(value[2]))


def _add(left: Vec3, right: Vec3) -> Vec3:
    return (left[0] + right[0], left[1] + right[1], left[2] + right[2])


def _subtract(left: Vec3, right: Vec3) -> Vec3:
    return (left[0] - right[0], left[1] - right[1], left[2] - right[2])


def _scale(value: Vec3, factor: float) -> Vec3:
    return (value[0] * factor, value[1] * factor, value[2] * factor)


def _dot(left: Vec3, right: Vec3) -> float:
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]


def _cross(left: Vec3, right: Vec3) -> Vec3:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def _length(value: Vec3) -> float:
    return math.sqrt(_dot(value, value))


def _normalize(value: Vec3) -> Vec3:
    length = _length(value)
    if length <= 1e-12 or not math.isfinite(length):
        raise ValueError("Authored geometry contains a zero-length vector.")
    return (value[0] / length, value[1] / length, value[2] / length)


def _basis_from_direction(direction: Vec3) -> tuple[Vec3, Vec3, Vec3]:
    axis = _normalize(direction)
    helper = (0.0, 0.0, 1.0) if abs(axis[2]) < 0.9 else (0.0, 1.0, 0.0)
    first = _normalize(_cross(helper, axis))
    second = _normalize(_cross(axis, first))
    return first, second, axis


def _basis_transform(basis: tuple[Vec3, Vec3, Vec3], local: Vec3) -> Vec3:
    first, second, third = basis
    return (
        first[0] * local[0] + second[0] * local[1] + third[0] * local[2],
        first[1] * local[0] + second[1] * local[1] + third[1] * local[2],
        first[2] * local[0] + second[2] * local[1] + third[2] * local[2],
    )


def _ellipsoid(
    primitive: Primitive,
    *,
    center: Vec3,
    radii: Vec3,
    joint: int,
    basis: tuple[Vec3, Vec3, Vec3] | None = None,
    segments: int = 16,
    rings: int = 10,
) -> None:
    if min(radii) <= 0.0:
        raise ValueError("Ellipsoid radii must be positive.")
    transform = basis or ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    start = len(primitive.positions)
    influence = ((joint, 1.0),)
    for ring in range(rings + 1):
        latitude = -math.pi / 2.0 + math.pi * ring / rings
        cos_latitude = math.cos(latitude)
        sin_latitude = math.sin(latitude)
        for segment in range(segments + 1):
            longitude = 2.0 * math.pi * segment / segments
            cos_longitude = math.cos(longitude)
            sin_longitude = math.sin(longitude)
            local = (
                radii[0] * cos_latitude * cos_longitude,
                radii[1] * cos_latitude * sin_longitude,
                radii[2] * sin_latitude,
            )
            local_normal = _normalize(
                (
                    cos_latitude * cos_longitude / radii[0],
                    cos_latitude * sin_longitude / radii[1],
                    sin_latitude / radii[2],
                )
            )
            primitive.vertex(
                _add(center, _basis_transform(transform, local)),
                _basis_transform(transform, local_normal),
                (segment / segments, ring / rings),
                influence,
            )
    stride = segments + 1
    for ring in range(rings):
        for segment in range(segments):
            lower = start + ring * stride + segment
            upper = lower + stride
            primitive.indices.extend((lower, lower + 1, upper + 1, lower, upper + 1, upper))


def _ellipsoid_between(
    primitive: Primitive,
    *,
    start: Vec3,
    end: Vec3,
    cross_radii: tuple[float, float],
    joint: int,
    segments: int = 14,
    rings: int = 8,
) -> None:
    direction = _subtract(end, start)
    center = _scale(_add(start, end), 0.5)
    _ellipsoid(
        primitive,
        center=center,
        radii=(cross_radii[0], cross_radii[1], _length(direction) * 0.55),
        joint=joint,
        basis=_basis_from_direction(direction),
        segments=segments,
        rings=rings,
    )


def _cone(
    primitive: Primitive,
    *,
    base: Vec3,
    tip: Vec3,
    radius: tuple[float, float],
    joint: int,
    sides: int = 14,
) -> None:
    first, second, axis = _basis_from_direction(_subtract(tip, base))
    influence = ((joint, 1.0),)
    side_start = len(primitive.positions)
    axis_length = _length(_subtract(tip, base))
    for side in range(sides):
        angle = 2.0 * math.pi * side / sides
        radial = _add(
            _scale(first, radius[0] * math.cos(angle)),
            _scale(second, radius[1] * math.sin(angle)),
        )
        normal = _normalize(_add(radial, _scale(axis, max(radius) / axis_length)))
        primitive.vertex(
            _add(base, radial),
            normal,
            (side / sides, 0.0),
            influence,
        )
    tip_index = primitive.vertex(tip, axis, (0.5, 1.0), influence)
    for side in range(sides):
        next_side = (side + 1) % sides
        primitive.indices.extend((side_start + side, side_start + next_side, tip_index))

    cap_center = primitive.vertex(base, _scale(axis, -1.0), (0.5, 0.5), influence)
    cap_start = len(primitive.positions)
    for side in range(sides):
        angle = 2.0 * math.pi * side / sides
        radial = _add(
            _scale(first, radius[0] * math.cos(angle)),
            _scale(second, radius[1] * math.sin(angle)),
        )
        primitive.vertex(
            _add(base, radial),
            _scale(axis, -1.0),
            (0.5 + 0.5 * math.cos(angle), 0.5 + 0.5 * math.sin(angle)),
            influence,
        )
    for side in range(sides):
        next_side = (side + 1) % sides
        primitive.indices.extend((cap_center, cap_start + next_side, cap_start + side))


def _joint_ordinals() -> dict[str, int]:
    return {bone_id: index for index, bone_id in enumerate(BONE_ORDER[1:])}


def _build_geometry() -> GeneratedGeometry:
    joints = _joint_ordinals()
    primitives = {texture_id: Primitive() for texture_id, _base, _accent in TEXTURE_COLORS}
    black = primitives["black"]
    brown = primitives["brown"]
    cream = primitives["cream"]
    cyan = primitives["cyan"]
    dark_brown = primitives["dark-brown"]
    gray = primitives["gray"]
    orange = primitives["orange"]

    # Robe, belt, lapels, and pack. Overlap at joints is deliberate so fixed
    # diagnostic extremes expose deformation without opening visible gaps.
    _ellipsoid(
        brown,
        center=(0.0, 0.0, 0.9),
        radii=(0.46, 0.3, 0.42),
        joint=joints["pelvis"],
    )
    _ellipsoid(
        brown,
        center=(0.0, 0.0, 1.2),
        radii=(0.43, 0.29, 0.42),
        joint=joints["torso"],
    )
    _ellipsoid(
        dark_brown,
        center=(0.0, 0.27, 0.99),
        radii=(0.43, 0.055, 0.075),
        joint=joints["pelvis"],
        segments=14,
        rings=8,
    )
    _ellipsoid(
        dark_brown,
        center=(0.0, 0.335, 1.0),
        radii=(0.105, 0.055, 0.095),
        joint=joints["pelvis"],
        segments=12,
        rings=8,
    )
    for x in (-0.16, 0.16):
        _ellipsoid_between(
            dark_brown,
            start=(x * 1.7, 0.19, 1.49),
            end=(x, 0.31, 1.05),
            cross_radii=(0.035, 0.018),
            joint=joints["torso"],
            segments=10,
            rings=6,
        )

    _ellipsoid(
        brown,
        center=(0.0, -0.27, 1.28),
        radii=(0.34, 0.16, 0.36),
        joint=joints["torso"],
        segments=16,
        rings=10,
    )
    _ellipsoid(
        dark_brown,
        center=(0.0, -0.445, 1.33),
        radii=(0.25, 0.035, 0.16),
        joint=joints["torso"],
        segments=14,
        rings=8,
    )
    _ellipsoid_between(
        brown,
        start=(-0.34, -0.4, 1.6),
        end=(0.34, -0.4, 1.6),
        cross_radii=(0.14, 0.14),
        joint=joints["torso"],
        segments=16,
        rings=8,
    )

    # Head, face, eyes, beak, and beard.
    _ellipsoid(
        cyan,
        center=(0.0, 0.015, 1.65),
        radii=(0.33, 0.28, 0.34),
        joint=joints["head"],
        segments=18,
        rings=12,
    )
    for x in (-0.16, 0.16):
        _ellipsoid(
            cream,
            center=(x, 0.274, 1.68),
            radii=(0.145, 0.035, 0.18),
            joint=joints["head"],
            segments=14,
            rings=9,
        )
        _ellipsoid(
            black,
            center=(x, 0.306, 1.72),
            radii=(0.047, 0.024, 0.068),
            joint=joints["head"],
            segments=12,
            rings=8,
        )
    _ellipsoid(
        orange,
        center=(0.0, 0.35, 1.69),
        radii=(0.18, 0.2, 0.155),
        joint=joints["beak"],
        segments=16,
        rings=10,
    )
    _cone(
        orange,
        base=(0.0, 0.42, 1.72),
        tip=(0.0, 0.54, 1.56),
        radius=(0.13, 0.11),
        joint=joints["beak"],
        sides=16,
    )
    _ellipsoid(
        black,
        center=(0.0, 0.355, 1.58),
        radii=(0.145, 0.105, 0.075),
        joint=joints["beak"],
        segments=14,
        rings=8,
    )
    _ellipsoid(
        gray,
        center=(0.0, 0.235, 1.4),
        radii=(0.27, 0.12, 0.29),
        joint=joints["neck"],
        segments=16,
        rings=10,
    )
    for x, tip_z in ((-0.17, 1.13), (0.0, 1.08), (0.17, 1.13)):
        _cone(
            gray,
            base=(x, 0.25, 1.42),
            tip=(x * 0.85, 0.23, tip_z),
            radius=(0.095, 0.055),
            joint=joints["neck"],
            sides=12,
        )

    # Articulated sleeve and wing-hand volumes.
    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        shoulder = (0.34 * side, 0.0, 1.28)
        elbow = (0.53 * side, 0.02, 1.05)
        wrist = (0.58 * side, 0.12, 0.82)
        _ellipsoid_between(
            brown,
            start=shoulder,
            end=elbow,
            cross_radii=(0.16, 0.13),
            joint=joints[f"wing_upper_{suffix}"],
        )
        _ellipsoid_between(
            brown,
            start=elbow,
            end=wrist,
            cross_radii=(0.14, 0.11),
            joint=joints[f"wing_lower_{suffix}"],
        )
        _ellipsoid(
            cyan,
            center=(0.59 * side, 0.15, 0.78),
            radii=(0.13, 0.11, 0.15),
            joint=joints[f"wing_hand_{suffix}"],
            segments=14,
            rings=9,
        )
        for finger in (-1, 0, 1):
            finger_x = 0.59 * side + 0.038 * finger
            _ellipsoid_between(
                cyan,
                start=(finger_x, 0.17, 0.78),
                end=(finger_x + 0.025 * side, 0.24, 0.69 + 0.025 * abs(finger)),
                cross_radii=(0.032, 0.026),
                joint=joints[f"wing_hand_{suffix}"],
                segments=10,
                rings=6,
            )

    # Legs, feet, three modeled talons, and separate dark claws.
    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        x = 0.17 * side
        _ellipsoid_between(
            orange,
            start=(x, 0.0, 0.72),
            end=(x, 0.0, 0.4),
            cross_radii=(0.085, 0.08),
            joint=joints[f"thigh_{suffix}"],
            segments=12,
            rings=7,
        )
        _ellipsoid_between(
            orange,
            start=(x, 0.0, 0.43),
            end=(x, 0.07, 0.15),
            cross_radii=(0.075, 0.07),
            joint=joints[f"shin_{suffix}"],
            segments=12,
            rings=7,
        )
        _ellipsoid(
            orange,
            center=(x, 0.12, 0.085),
            radii=(0.17, 0.22, 0.085),
            joint=joints[f"foot_{suffix}"],
            segments=14,
            rings=8,
        )
        for toe in (-1, 0, 1):
            toe_x = x + 0.065 * toe
            _ellipsoid_between(
                orange,
                start=(toe_x, 0.15, 0.075),
                end=(toe_x + 0.02 * toe, 0.33, 0.055),
                cross_radii=(0.04, 0.035),
                joint=joints[f"foot_{suffix}"],
                segments=10,
                rings=6,
            )
            _cone(
                black,
                base=(toe_x + 0.02 * toe, 0.31, 0.055),
                tip=(toe_x + 0.03 * toe, 0.41, 0.025),
                radius=(0.025, 0.025),
                joint=joints[f"foot_{suffix}"],
                sides=10,
            )

    # Three tail feathers are authored inference, segmented across all tail bones.
    _ellipsoid_between(
        cyan,
        start=(0.0, -0.12, 1.04),
        end=(0.0, -0.28, 0.82),
        cross_radii=(0.2, 0.075),
        joint=joints["tail_base"],
        segments=14,
        rings=8,
    )
    _ellipsoid_between(
        cyan,
        start=(0.0, -0.24, 0.86),
        end=(0.0, -0.46, 0.61),
        cross_radii=(0.16, 0.06),
        joint=joints["tail_mid"],
        segments=14,
        rings=8,
    )
    for x, tip in (
        (-0.16, (-0.24, -0.69, 0.34)),
        (0.0, (0.0, -0.75, 0.27)),
        (0.16, (0.24, -0.69, 0.34)),
    ):
        _ellipsoid_between(
            cyan,
            start=(x * 0.35, -0.4, 0.67),
            end=tip,
            cross_radii=(0.085, 0.038),
            joint=joints["tail_tip"],
            segments=12,
            rings=7,
        )

    if any(not primitive.positions or not primitive.indices for primitive in primitives.values()):
        raise RuntimeError("Every authored material must contain visible geometry.")
    positions = [position for primitive in primitives.values() for position in primitive.positions]
    minimum = [round(min(point[axis] for point in positions), 6) for axis in range(3)]
    maximum = [round(max(point[axis] for point in positions), 6) for axis in range(3)]
    if abs(minimum[2]) > 1e-6:
        raise RuntimeError(f"Authored macaw does not touch ground Z=0: {minimum[2]}")
    return GeneratedGeometry(
        primitives=primitives,
        actor_bounds={"max": maximum, "min": minimum},
    )


def _actor_to_storage(vector: Vec3) -> Vec3:
    x, forward, up = vector
    return (x, up, -forward)


def _storage_to_actor(vector: Vec3) -> Vec3:
    x, up, negative_forward = vector
    return (x, -negative_forward, up)


def _pack_rows(format_string: str, rows: Sequence[Sequence[int | float]]) -> bytes:
    packer = struct.Struct("<" + format_string)
    return b"".join(packer.pack(*row) for row in rows)


def _add_buffer_view(
    binary: bytearray,
    views: list[dict[str, int]],
    payload: bytes,
    *,
    target: int | None,
) -> int:
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    binary.extend(payload)
    view: dict[str, int] = {
        "buffer": 0,
        "byteLength": len(payload),
        "byteOffset": offset,
    }
    if target is not None:
        view["target"] = target
    views.append(view)
    return len(views) - 1


def _local_translation(bone_id: str) -> Vec3:
    parent_id = PARENT_BY_BONE[bone_id]
    if parent_id is None:
        return BIND_WORLD_ACTOR[bone_id]
    return _subtract(BIND_WORLD_ACTOR[bone_id], BIND_WORLD_ACTOR[parent_id])


def _glb() -> GeneratedGlb:
    geometry = _build_geometry()
    binary = bytearray()
    views: list[dict[str, int]] = []
    accessors: list[dict[str, object]] = []

    def add_accessor(
        payload: bytes,
        *,
        component_type: int,
        count: int,
        value_type: str,
        target: int | None,
        minimum: list[float] | None = None,
        maximum: list[float] | None = None,
    ) -> int:
        view = _add_buffer_view(binary, views, payload, target=target)
        accessor: dict[str, object] = {
            "bufferView": view,
            "componentType": component_type,
            "count": count,
            "type": value_type,
        }
        if minimum is not None:
            accessor["min"] = minimum
        if maximum is not None:
            accessor["max"] = maximum
        accessors.append(accessor)
        return len(accessors) - 1

    glb_primitives: list[dict[str, object]] = []
    total_vertices = 0
    total_indices = 0
    for material_index, (texture_id, _base, _accent) in enumerate(TEXTURE_COLORS):
        primitive = geometry.primitives[texture_id]
        storage_positions = [_actor_to_storage(value) for value in primitive.positions]
        storage_normals = [_actor_to_storage(value) for value in primitive.normals]
        position_min = [min(point[axis] for point in storage_positions) for axis in range(3)]
        position_max = [max(point[axis] for point in storage_positions) for axis in range(3)]
        position_accessor = add_accessor(
            _pack_rows("fff", storage_positions),
            component_type=5126,
            count=len(storage_positions),
            value_type="VEC3",
            target=34962,
            minimum=position_min,
            maximum=position_max,
        )
        normal_accessor = add_accessor(
            _pack_rows("fff", storage_normals),
            component_type=5126,
            count=len(storage_normals),
            value_type="VEC3",
            target=34962,
        )
        uv_accessor = add_accessor(
            _pack_rows("ff", primitive.texcoords),
            component_type=5126,
            count=len(primitive.texcoords),
            value_type="VEC2",
            target=34962,
        )
        joint_accessor = add_accessor(
            _pack_rows("BBBB", primitive.joints),
            component_type=5121,
            count=len(primitive.joints),
            value_type="VEC4",
            target=34962,
        )
        weight_accessor = add_accessor(
            _pack_rows("ffff", primitive.weights),
            component_type=5126,
            count=len(primitive.weights),
            value_type="VEC4",
            target=34962,
        )
        index_accessor = add_accessor(
            _pack_rows("H", [(value,) for value in primitive.indices]),
            component_type=5123,
            count=len(primitive.indices),
            value_type="SCALAR",
            target=34963,
        )
        glb_primitives.append(
            {
                "attributes": {
                    "JOINTS_0": joint_accessor,
                    "NORMAL": normal_accessor,
                    "POSITION": position_accessor,
                    "TEXCOORD_0": uv_accessor,
                    "WEIGHTS_0": weight_accessor,
                },
                "indices": index_accessor,
                "material": material_index,
                "mode": 4,
            }
        )
        total_vertices += len(primitive.positions)
        total_indices += len(primitive.indices)

    inverse_bind_rows: list[tuple[float, ...]] = []
    for bone_id in BONE_ORDER[1:]:
        storage = _actor_to_storage(BIND_WORLD_ACTOR[bone_id])
        inverse_bind_rows.append(
            (
                1.0,
                0.0,
                0.0,
                0.0,
                0.0,
                1.0,
                0.0,
                0.0,
                0.0,
                0.0,
                1.0,
                0.0,
                -storage[0],
                -storage[1],
                -storage[2],
                1.0,
            )
        )
    inverse_bind_accessor = add_accessor(
        _pack_rows("f" * 16, inverse_bind_rows),
        component_type=5126,
        count=len(inverse_bind_rows),
        value_type="MAT4",
        target=None,
    )

    node_index_by_bone = {bone_id: index + 2 for index, bone_id in enumerate(BONE_ORDER[1:])}
    nodes: list[dict[str, object]] = [
        {"children": [1, node_index_by_bone["pelvis"]], "name": "root"},
        {"mesh": 0, "name": "macaw_mesh", "skin": 0},
    ]
    children_by_bone: dict[str, list[str]] = {bone_id: [] for bone_id in BONE_ORDER}
    for bone_id in BONE_ORDER[1:]:
        parent_id = PARENT_BY_BONE[bone_id]
        if parent_id is None:
            raise RuntimeError("Every skin joint must have a parent in avian_v1.")
        children_by_bone[parent_id].append(bone_id)
    for bone_id in BONE_ORDER[1:]:
        node: dict[str, object] = {"name": bone_id}
        children = children_by_bone[bone_id]
        if children:
            node["children"] = [node_index_by_bone[child] for child in children]
        translation = _actor_to_storage(_local_translation(bone_id))
        if any(abs(value) > 0.0 for value in translation):
            node["translation"] = list(translation)
        nodes.append(node)

    texture_ids = [record[0] for record in TEXTURE_COLORS]
    materials = [
        {
            "alphaMode": "OPAQUE",
            "doubleSided": False,
            "name": f"material_{texture_id.replace('-', '_')}",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "baseColorTexture": {"index": index, "texCoord": 0},
                "metallicFactor": 0.0,
                "roughnessFactor": 0.78,
            },
        }
        for index, texture_id in enumerate(texture_ids)
    ]
    images = [
        {"name": f"{texture_id.replace('-', '_')}_image", "uri": f"textures/{texture_id}.png"}
        for texture_id in texture_ids
    ]
    samplers = [
        {
            "magFilter": 9729,
            "minFilter": 9987,
            "name": f"{texture_id.replace('-', '_')}_sampler",
            "wrapS": 10497,
            "wrapT": 10497,
        }
        for texture_id in texture_ids
    ]
    textures = [
        {
            "name": f"{texture_id.replace('-', '_')}_texture",
            "sampler": index,
            "source": index,
        }
        for index, texture_id in enumerate(texture_ids)
    ]

    buffer_length = len(binary)
    while len(binary) % 4:
        binary.append(0)
    document: dict[str, object] = {
        "accessors": accessors,
        "asset": {
            "generator": "Animated Fabric AF-056 deterministic macaw authoring",
            "version": "2.0",
        },
        "bufferViews": views,
        "buffers": [{"byteLength": buffer_length}],
        "images": images,
        "materials": materials,
        "meshes": [{"name": "macaw_mesh", "primitives": glb_primitives}],
        "nodes": nodes,
        "samplers": samplers,
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "skins": [
            {
                "inverseBindMatrices": inverse_bind_accessor,
                "joints": [node_index_by_bone[bone_id] for bone_id in BONE_ORDER[1:]],
                "name": "avian_v1_skin",
                "skeleton": node_index_by_bone["pelvis"],
            }
        ],
        "textures": textures,
    }
    json_payload = json.dumps(
        document,
        allow_nan=False,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    json_payload += b" " * ((-len(json_payload)) % 4)
    total_length = 12 + 8 + len(json_payload) + 8 + len(binary)
    payload = b"".join(
        (
            struct.pack("<4sII", b"glTF", 2, total_length),
            struct.pack("<II", len(json_payload), 0x4E4F534A),
            json_payload,
            struct.pack("<II", len(binary), 0x004E4942),
            bytes(binary),
        )
    )
    decoded_actor_positions = [
        _storage_to_actor(_actor_to_storage(position))
        for primitive in geometry.primitives.values()
        for position in primitive.positions
    ]
    bounds = {
        "max": [
            round(max(point[axis] for point in decoded_actor_positions), 6) for axis in range(3)
        ],
        "min": [
            round(min(point[axis] for point in decoded_actor_positions), 6) for axis in range(3)
        ],
    }
    return GeneratedGlb(
        payload=payload,
        buffer_bytes=buffer_length,
        accessors=len(accessors),
        buffer_views=len(views),
        vertices=total_vertices,
        indices=total_indices,
        triangles=total_indices // 3,
        primitives=len(glb_primitives),
        actor_bounds=bounds,
    )


def _png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(chunk_type)
    checksum = zlib.crc32(payload, checksum) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + chunk_type + payload + struct.pack(">I", checksum)


def _texture_png(base: tuple[int, int, int, int], accent: tuple[int, int, int, int]) -> bytes:
    width, height = TEXTURE_SIZE
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            stripe = ((x // 4) + (y // 4) + ((x + y) // 11)) % 5 == 0
            rows.extend(accent if stripe else base)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", ihdr),
            _png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9)),
            _png_chunk(b"IEND", b""),
        )
    )


def _verified_source_identities() -> list[dict[str, str]]:
    verified = reference_package.verify_reference_package(
        REFERENCE_PACKAGE_ROOT,
        require_approved=True,
    )
    if (
        verified.manifest_sha256 != REFERENCE_MANIFEST_SHA256
        or verified.approval_sha256 != REFERENCE_APPROVAL_SHA256
        or verified.ordered_view_set_sha256 != REFERENCE_VIEW_SET_SHA256
    ):
        raise ValueError("AF-054 reference identities disagree with the AF-056 authoring gate.")
    source_approval = REFERENCE_PACKAGE_ROOT / reference_package.SOURCE_APPROVAL_PATH
    if reference_package.sha256_file(source_approval) != REFERENCE_SOURCE_APPROVAL_SHA256:
        raise ValueError("AF-054 source approval disagrees with the AF-056 authoring gate.")
    contract_payload = RIG_CONTRACT_PATH.read_bytes()
    authoring_payload = AUTHORING_RECORD_PATH.read_bytes()
    authoring = json.loads(authoring_payload.decode("utf-8"))
    if not isinstance(authoring, dict) or authoring.get("review_status") != (
        "candidate_pending_deformation_review"
    ):
        raise ValueError("AF-056 authoring record is missing or not a review candidate.")
    return sorted(
        [
            {
                "id": "approved-reference-approval",
                "path": "assets/reference-packages/macaw-traveler-v1/approval.json",
                "sha256": verified.approval_sha256,
            },
            {
                "id": "approved-reference-manifest",
                "path": "assets/reference-packages/macaw-traveler-v1/reference.json",
                "sha256": verified.manifest_sha256,
            },
            {
                "id": "approved-source-approval",
                "path": "assets/reference-packages/macaw-traveler-v1/review/source-approval.json",
                "sha256": REFERENCE_SOURCE_APPROVAL_SHA256,
            },
            {
                "id": "avian-rig-contract",
                "path": "tools/blender/contracts/avian_v1.json",
                "sha256": actor_package.sha256_bytes(contract_payload),
            },
            {
                "id": "macaw-authoring-record",
                "path": "assets/actor-reviews/macaw-traveler-avian-v1/authoring.json",
                "sha256": actor_package.sha256_bytes(authoring_payload),
            },
            {
                "id": "macaw-package-generator",
                "path": "scripts/generate_macaw_actor_package.py",
                "sha256": actor_package.sha256_bytes(Path(__file__).resolve().read_bytes()),
            },
        ],
        key=lambda record: record["id"],
    )


def _manifest(
    glb: GeneratedGlb,
    textures: Mapping[str, bytes],
    source_identities: list[dict[str, str]],
) -> dict[str, object]:
    asset: dict[str, object] = {
        "bytes": len(glb.payload),
        "media_type": "model/gltf-binary",
        "path": actor_package.GLB_FILENAME,
        "sha256": actor_package.sha256_bytes(glb.payload),
    }
    texture_records: list[dict[str, object]] = []
    for texture_id in sorted(textures):
        payload = textures[texture_id]
        texture_records.append(
            {
                "bytes": len(payload),
                "height_px": TEXTURE_SIZE[1],
                "id": texture_id,
                "media_type": "image/png",
                "mode": "RGBA8",
                "path": f"textures/{texture_id}.png",
                "sha256": actor_package.sha256_bytes(payload),
                "width_px": TEXTURE_SIZE[0],
            }
        )
    content_records: list[Mapping[str, object]] = [asset, *texture_records]
    content_bytes = len(glb.payload) + sum(len(payload) for payload in textures.values())
    observed: dict[str, object] = {
        "accessors": glb.accessors,
        "actor_bounds_m": glb.actor_bounds,
        "buffer_bytes": glb.buffer_bytes,
        "buffer_views": glb.buffer_views,
        "content_bytes": content_bytes,
        "content_files": 1 + len(textures),
        "images": len(textures),
        "indices": glb.indices,
        "joints": len(BONE_ORDER) - 1,
        "materials": len(textures),
        "max_influences_per_vertex": 1,
        "meshes": 1,
        "nodes": len(BONE_ORDER) + 1,
        "primitives": glb.primitives,
        "root_node_index": 0,
        "samplers": len(textures),
        "skins": 1,
        "texture_pixels": len(textures) * TEXTURE_SIZE[0] * TEXTURE_SIZE[1],
        "texture_properties": [
            {
                "height_px": TEXTURE_SIZE[1],
                "mode": "RGBA8",
                "path": record["path"],
                "pixels": TEXTURE_SIZE[0] * TEXTURE_SIZE[1],
                "width_px": TEXTURE_SIZE[0],
            }
            for record in texture_records
        ],
        "textures": len(textures),
        "triangles": glb.triangles,
        "vertices": glb.vertices,
    }
    return {
        "actor": {"ground_z_m": 0.0, "neutral_pose": "rest", "root_node": ACTOR_ROOT},
        "asset": asset,
        "content_set": {
            "format": actor_package.CONTENT_SET_FORMAT,
            "order": [
                actor_package.GLB_FILENAME,
                *(record["path"] for record in texture_records),
            ],
            "sha256": actor_package.content_set_sha256(content_records),
        },
        "coordinates": {
            "actor_forward": "+Y",
            "actor_right": "+X",
            "actor_up": "+Z",
            "handedness": "right",
            "meters_per_unit": 1.0,
            "storage": "gltf-2.0-right-handed-y-up",
            "storage_to_actor": {"+X": "+X", "+Y": "+Z", "+Z": "-Y"},
        },
        "format": actor_package.ACTOR_PACKAGE_FORMAT,
        "limits": {"profile": actor_package.POLICY_PROFILE, "values": actor_package.LIMITS},
        "observed": observed,
        "package_id": PACKAGE_ID,
        "provenance": {
            "geometry_license": "CC0-1.0",
            "kind": "reviewed-authored-actor",
            "sources": source_identities,
            "texture_license": "CC0-1.0",
            "ticket": "AF-056",
        },
        "schema_version": actor_package.SCHEMA_VERSION,
        "textures": texture_records,
    }


def _same_path(left: Path, right: Path) -> bool:
    return os.path.normcase(str(left)) == os.path.normcase(str(right))


def _reject_linked_path(path: Path) -> None:
    cursor = path
    while True:
        try:
            status_result = cursor.stat(follow_symlinks=False)
        except FileNotFoundError:
            pass
        except OSError as error:
            raise ValueError("Actor-package destination cannot be safely inspected.") from error
        else:
            is_junction = getattr(cursor, "is_junction", lambda: False)
            attributes = getattr(status_result, "st_file_attributes", 0)
            if cursor.is_symlink() or is_junction() or attributes & _REPARSE_ATTRIBUTE:
                raise ValueError("Actor-package destination cannot use linked ancestors.")
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def _validated_destination(destination: Path) -> Path:
    destination = Path(os.path.abspath(destination))
    protected = {
        REPOSITORY_ROOT,
        APP_ROOT,
        APP_ROOT / ".tmp",
        APP_ROOT / "assets",
        APP_ROOT / "assets/actor-packages",
        APP_ROOT / "workspaces",
        APP_ROOT / "workspaces/actor-packages",
    }
    if any(_same_path(destination, root) for root in protected):
        raise ValueError("Actor-package output must be a child, not a protected workspace root.")
    _reject_linked_path(destination)
    if not destination.exists():
        return destination
    if not destination.is_dir():
        raise ValueError("Actor-package destination must be a directory.")
    return destination


def _accept_identical_destination(
    stage: Path,
    destination: Path,
    staged: actor_package.VerifiedActorPackage,
) -> None:
    try:
        existing = actor_package.verify_actor_package(
            destination,
            expected_manifest_sha256=staged.manifest_sha256,
        )
    except (OSError, ValueError) as error:
        raise ValueError(
            "Refusing to replace the immutable macaw-traveler-avian-v1 actor package."
        ) from error
    if existing.content_set_sha256 != staged.content_set_sha256 or dict(
        existing.file_sha256
    ) != dict(staged.file_sha256):
        raise ValueError("Refusing to replace the immutable macaw-traveler-avian-v1 actor package.")
    shutil.rmtree(stage)


def generate_macaw_actor_package(destination: Path) -> str:
    """Generate and atomically publish the reviewed AF-056 package candidate."""
    destination = _validated_destination(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".af056-macaw-stage-", dir=destination.parent))
    try:
        sources = _verified_source_identities()
        textures = {
            texture_id: _texture_png(base, accent) for texture_id, base, accent in TEXTURE_COLORS
        }
        glb = _glb()
        manifest = _manifest(glb, textures, sources)
        manifest_payload = actor_package.canonical_json_bytes(manifest)
        (stage / "textures").mkdir()
        (stage / actor_package.GLB_FILENAME).write_bytes(glb.payload)
        for texture_id, payload in textures.items():
            (stage / f"textures/{texture_id}.png").write_bytes(payload)
        (stage / actor_package.MANIFEST_FILENAME).write_bytes(manifest_payload)
        manifest_sha256 = actor_package.sha256_bytes(manifest_payload)
        staged = actor_package.verify_actor_package(
            stage,
            expected_manifest_sha256=manifest_sha256,
        )
        if destination.exists():
            _validated_destination(destination)
            _accept_identical_destination(stage, destination, staged)
        else:
            stage.replace(destination)
        return manifest_sha256
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Author the deterministic reviewed AF-056 macaw actor package candidate."
    )
    parser.add_argument("--out", required=True, type=Path, help="Destination package directory.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    manifest_sha256 = generate_macaw_actor_package(arguments.out)
    print(f"AF-056 macaw actor package candidate: {arguments.out}")
    print(f"Manifest SHA-256: {manifest_sha256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
