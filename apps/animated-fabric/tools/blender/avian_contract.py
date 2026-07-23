"""Trusted AF-056 avian rig, mapping, and deformation-review contracts.

This module is standard-library only.  It runs before Blender interprets an
actor and keeps the reviewed macaw mapping outside the closed actor package.
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import actor_package

RIG_FORMAT = "animated-fabric.avian-rig-contract.v1"
MAPPING_FORMAT = "animated-fabric.actor-rig-mapping.v1"
POSE_FORMAT = "animated-fabric.actor-deformation-review.v1"
SCHEMA_VERSION = "0.1.0"
RIG_ID = "avian_v1"
PACKAGE_ID = "macaw-traveler-avian-v1"
ACTOR_ROOT_BONE_ID = "root"
SKIN_SKELETON_BONE_ID = "pelvis"

CONTRACT_ROOT = Path(__file__).resolve().parent / "contracts"
RIG_CONTRACT_PATH = CONTRACT_ROOT / "avian_v1.json"
REVIEW_POSE_PATH = CONTRACT_ROOT / "af056_review_poses.json"

REFERENCE_PACKAGE_ID = "macaw-traveler-v1"
REFERENCE_MANIFEST_SHA256 = "a88520b026a4c48b98c6b50785fe49ffa60d01f1e94157650dbfbbb754b11f77"
REFERENCE_APPROVAL_SHA256 = "e6dc9202b6608ab5821c2fb9c76811a5a69296061bf20314b6c7ea3bafa142bc"
REFERENCE_SOURCE_APPROVAL_SHA256 = (
    "4b6d2348fff593ece021d12a32cc1713afb0d05367b9f660d493a7431e7c4cfc"
)
REFERENCE_VIEW_SET_SHA256 = "3c625d9ff3e87567d2e1eb2878866243629c2af18ed0af011fe2526c2aee9311"

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
PARENT_BY_BONE: Mapping[str, str | None] = {
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
OPTIONAL_UNWEIGHTED_BONES = frozenset({"beak", "tail_tip", "wing_hand_l", "wing_hand_r"})
SOCKET_BINDINGS: Mapping[str, str] = {
    "head_hat": "head",
    "back_pack": "torso",
    "wing_hand_l_item": "wing_hand_l",
    "wing_hand_r_item": "wing_hand_r",
    "root_shadow": "root",
}
POSE_ORDER = ("neutral", "limb-extreme", "tail-extreme", "wing-extreme")


@dataclass(frozen=True, slots=True)
class BoneContract:
    bone_id: str
    parent_id: str | None


@dataclass(frozen=True, slots=True)
class SocketContract:
    socket_id: str
    bone_id: str
    offset_m: tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class AvianRigContract:
    path: Path
    sha256: str
    bones: tuple[BoneContract, ...]
    sockets: tuple[SocketContract, ...]


@dataclass(frozen=True, slots=True)
class PoseRotation:
    bone_id: str
    local_euler_xyz_deg: tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class ReviewPose:
    pose_id: str
    rotations: tuple[PoseRotation, ...]


@dataclass(frozen=True, slots=True)
class ReviewPoseContract:
    path: Path
    sha256: str
    poses: tuple[ReviewPose, ...]


@dataclass(frozen=True, slots=True)
class SkinInspection:
    document: Mapping[str, object]
    node_index_by_bone: Mapping[str, int]
    skin_ordinal_by_bone: Mapping[str, int | None]
    rest_local_translation_m: Mapping[str, tuple[float, float, float]]
    rest_world_translation_m: Mapping[str, tuple[float, float, float]]
    positive_vertex_counts: Mapping[str, int]
    ground_contacts: Mapping[str, tuple[float, float, float]]
    vertex_skin_sha256: str


def canonical_json_bytes(document: object) -> bytes:
    """Encode external AF-056 contracts canonically."""
    return (
        json.dumps(
            document,
            allow_nan=False,
            ensure_ascii=True,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_rig_contract(path: Path = RIG_CONTRACT_PATH) -> AvianRigContract:
    """Load and enforce the exact normative avian_v1 hierarchy and sockets."""
    payload, document = _canonical_document(path)
    _expect_keys(
        document,
        {
            "actor_root_bone_id",
            "bones",
            "coordinate_space",
            "format",
            "optional_unweighted_bones",
            "rig_id",
            "schema_version",
            "skin_skeleton_bone_id",
            "sockets",
        },
        "avian rig contract",
    )
    if (
        _string(document, "format") != RIG_FORMAT
        or _string(document, "schema_version") != SCHEMA_VERSION
        or _string(document, "rig_id") != RIG_ID
        or _string(document, "actor_root_bone_id") != ACTOR_ROOT_BONE_ID
        or _string(document, "skin_skeleton_bone_id") != SKIN_SKELETON_BONE_ID
    ):
        raise ValueError("Avian rig contract header is unsupported.")
    coordinates = _object(document, "coordinate_space")
    _expect_keys(coordinates, {"forward", "right", "up"}, "coordinate_space")
    if coordinates != {"forward": "+Y", "right": "+X", "up": "+Z"}:
        raise ValueError("Avian rig contract coordinate axes are not canonical.")
    optional = _strings(document, "optional_unweighted_bones")
    if optional != sorted(OPTIONAL_UNWEIGHTED_BONES):
        raise ValueError("Avian optional unweighted bones disagree with the specification.")

    bones: list[BoneContract] = []
    for index, record in enumerate(_objects(document, "bones")):
        _expect_keys(record, {"bone_id", "parent_id"}, f"bones[{index}]")
        bone_id = _string(record, "bone_id")
        parent_value = record["parent_id"]
        if parent_value is not None and not isinstance(parent_value, str):
            raise ValueError("Avian bone parent must be a string or null.")
        bones.append(BoneContract(bone_id, parent_value))
    if tuple(bone.bone_id for bone in bones) != BONE_ORDER:
        raise ValueError("Avian bones are not in the normative topological order.")
    if {bone.bone_id: bone.parent_id for bone in bones} != PARENT_BY_BONE:
        raise ValueError("Avian bone hierarchy disagrees with the specification.")

    sockets: list[SocketContract] = []
    for index, record in enumerate(_objects(document, "sockets")):
        _expect_keys(record, {"bone_id", "offset_m", "socket_id"}, f"sockets[{index}]")
        offset = _numbers3(record, "offset_m")
        if any(abs(value) > actor_package.MAX_ABSOLUTE_COORDINATE_M for value in offset):
            raise ValueError("Avian socket offset exceeds the actor coordinate ceiling.")
        sockets.append(
            SocketContract(
                socket_id=_string(record, "socket_id"),
                bone_id=_string(record, "bone_id"),
                offset_m=offset,
            )
        )
    if {socket.socket_id: socket.bone_id for socket in sockets} != SOCKET_BINDINGS:
        raise ValueError("Avian socket bindings disagree with the specification.")
    if tuple(socket.socket_id for socket in sockets) != tuple(SOCKET_BINDINGS):
        raise ValueError("Avian sockets are not in canonical order.")
    return AvianRigContract(path, sha256_bytes(payload), tuple(bones), tuple(sockets))


def load_review_poses(path: Path = REVIEW_POSE_PATH) -> ReviewPoseContract:
    """Load the fixed AF-056 diagnostic poses; this is not an animation clip."""
    payload, document = _canonical_document(path)
    _expect_keys(document, {"format", "poses", "schema_version", "ticket"}, "pose contract")
    if (
        _string(document, "format") != POSE_FORMAT
        or _string(document, "schema_version") != SCHEMA_VERSION
        or _string(document, "ticket") != "AF-056"
    ):
        raise ValueError("AF-056 pose contract header is unsupported.")
    poses: list[ReviewPose] = []
    for pose_index, record in enumerate(_objects(document, "poses")):
        _expect_keys(record, {"id", "rotations"}, f"poses[{pose_index}]")
        pose_id = _string(record, "id")
        seen_bones: set[str] = set()
        rotations: list[PoseRotation] = []
        for rotation_index, rotation in enumerate(_objects(record, "rotations")):
            _expect_keys(
                rotation,
                {"bone_id", "local_euler_xyz_deg"},
                f"poses[{pose_index}].rotations[{rotation_index}]",
            )
            bone_id = _string(rotation, "bone_id")
            if bone_id not in BONE_ORDER[1:] or bone_id in seen_bones:
                raise ValueError("AF-056 pose rotation has an invalid or duplicate bone.")
            euler = _numbers3(rotation, "local_euler_xyz_deg")
            if any(abs(value) > 90.0 for value in euler):
                raise ValueError("AF-056 review rotation exceeds its diagnostic bound.")
            seen_bones.add(bone_id)
            rotations.append(PoseRotation(bone_id, euler))
        if pose_id == "neutral" and rotations:
            raise ValueError("Neutral deformation review must be the bind pose.")
        if pose_id != "neutral" and not rotations:
            raise ValueError("Every non-neutral deformation review must exercise joints.")
        poses.append(ReviewPose(pose_id, tuple(rotations)))
    if tuple(pose.pose_id for pose in poses) != POSE_ORDER:
        raise ValueError("AF-056 deformation poses are not in canonical order.")
    return ReviewPoseContract(path, sha256_bytes(payload), tuple(poses))


def inspect_verified_avian_skin(
    verified: actor_package.VerifiedActorPackage,
    contract: AvianRigContract,
) -> SkinInspection:
    """Prove exact avian_v1 joint semantics on an already generic-verified GLB."""
    if verified.actor_id != PACKAGE_ID or verified.root_node != ACTOR_ROOT_BONE_ID:
        raise ValueError("Reviewed actor package identity or root is not canonical.")
    glb_payload = verified.glb_path.read_bytes()
    if actor_package.sha256_bytes(glb_payload) != verified.glb_sha256:
        raise ValueError("Reviewed actor GLB changed after generic verification.")
    document, binary = actor_package._decode_glb(glb_payload)
    nodes = _objects(document, "nodes")
    if _string(nodes[0], "name") != ACTOR_ROOT_BONE_ID:
        raise ValueError("Reviewed actor root node must be canonical avian root.")
    names: list[str] = []
    node_index_by_name: dict[str, int] = {}
    for index, node in enumerate(nodes):
        name = _string(node, "name")
        if name in node_index_by_name:
            raise ValueError("Reviewed actor node names must be unique.")
        names.append(name)
        node_index_by_name[name] = index
    if any(bone_id not in node_index_by_name for bone_id in BONE_ORDER):
        raise ValueError("Reviewed actor is missing canonical avian nodes.")

    parent_by_index: dict[int, int] = {}
    for parent_index, node in enumerate(nodes):
        for child in _integers(node, "children", default=()):
            if child in parent_by_index:
                raise ValueError("Reviewed actor node has multiple parents.")
            parent_by_index[child] = parent_index
    for bone in contract.bones[1:]:
        node_index = node_index_by_name[bone.bone_id]
        parent_id = bone.parent_id
        if parent_id is None or parent_by_index.get(node_index) != node_index_by_name[parent_id]:
            raise ValueError(f"Reviewed actor parent is invalid for {bone.bone_id}.")

    skins = _objects(document, "skins")
    if len(skins) != 1:
        raise ValueError("Reviewed avian actor requires exactly one skin.")
    skin = skins[0]
    joint_indices = _integers(skin, "joints")
    expected_joint_names = BONE_ORDER[1:]
    if tuple(names[index] for index in joint_indices) != expected_joint_names:
        raise ValueError("Reviewed actor skin joint order is not canonical avian_v1.")
    skeleton_index = _integer(skin, "skeleton")
    if names[skeleton_index] != SKIN_SKELETON_BONE_ID:
        raise ValueError("Reviewed actor skin skeleton must be pelvis.")
    for node in nodes:
        if "mesh" in node and _integer(node, "skin") != 0:
            raise ValueError("Every reviewed actor mesh must use the one avian skin.")

    accessors = _decode_accessors(document, binary)
    meshes = _objects(document, "meshes")
    positive_counts = {bone_id: 0 for bone_id in expected_joint_names}
    ground_points: dict[str, list[tuple[float, float, float]]] = {
        "foot_l": [],
        "foot_r": [],
    }
    digest_records: list[bytes] = []
    for mesh in meshes:
        for primitive in _objects(mesh, "primitives"):
            attributes = _object(primitive, "attributes")
            position_accessor = accessors[_integer(attributes, "POSITION")]
            joint_accessor = accessors[_integer(attributes, "JOINTS_0")]
            weight_accessor = accessors[_integer(attributes, "WEIGHTS_0")]
            for storage_position, joints, weights in zip(
                position_accessor.values,
                joint_accessor.values,
                weight_accessor.values,
                strict=True,
            ):
                actor_position = _storage_to_actor(
                    (
                        float(storage_position[0]),
                        float(storage_position[1]),
                        float(storage_position[2]),
                    )
                )
                influences: list[tuple[str, float]] = []
                for joint_value, weight_value in zip(joints, weights, strict=True):
                    weight = float(weight_value)
                    if weight <= 0.0:
                        continue
                    ordinal = int(joint_value)
                    if ordinal >= len(expected_joint_names):
                        raise ValueError("Reviewed actor has an out-of-range avian influence.")
                    bone_id = expected_joint_names[ordinal]
                    positive_counts[bone_id] += 1
                    influences.append((bone_id, weight))
                    if bone_id in ground_points and abs(actor_position[2]) <= 1e-6:
                        ground_points[bone_id].append(actor_position)
                digest_records.append(_skin_record(actor_position, influences))
    required = set(expected_joint_names) - OPTIONAL_UNWEIGHTED_BONES
    if any(positive_counts[bone_id] == 0 for bone_id in required):
        raise ValueError("Reviewed actor leaves a required avian joint unweighted.")
    if any(not ground_points[bone_id] for bone_id in ("foot_l", "foot_r")):
        raise ValueError("Reviewed actor lacks bilateral foot-weighted ground contact.")

    local_translation = {
        bone_id: _node_actor_translation(nodes[node_index_by_name[bone_id]])
        for bone_id in BONE_ORDER
    }
    world_translation: dict[str, tuple[float, float, float]] = {}
    for bone_id in BONE_ORDER:
        parent_id = PARENT_BY_BONE[bone_id]
        world_translation[bone_id] = (
            local_translation[bone_id]
            if parent_id is None
            else _add(world_translation[parent_id], local_translation[bone_id])
        )
    contacts = {
        bone_id: sorted(
            ground_points[bone_id],
            key=lambda point: (point[0], point[1], point[2]),
        )[0]
        for bone_id in ("foot_l", "foot_r")
    }
    skin_ordinal_by_bone: dict[str, int | None] = {"root": None}
    skin_ordinal_by_bone.update(
        {bone_id: index for index, bone_id in enumerate(expected_joint_names)}
    )
    digest = vertex_skin_sha256(digest_records)
    return SkinInspection(
        document=document,
        node_index_by_bone={bone_id: node_index_by_name[bone_id] for bone_id in BONE_ORDER},
        skin_ordinal_by_bone=skin_ordinal_by_bone,
        rest_local_translation_m=local_translation,
        rest_world_translation_m=world_translation,
        positive_vertex_counts=positive_counts,
        ground_contacts=contacts,
        vertex_skin_sha256=digest,
    )


def build_mapping_document(
    verified: actor_package.VerifiedActorPackage,
    contract: AvianRigContract,
) -> dict[str, object]:
    """Build the exact external mapping bound to one reviewed actor manifest."""
    inspection = inspect_verified_avian_skin(verified, contract)
    root_record = _mapping_record("root", inspection)
    joint_records = [_mapping_record(bone_id, inspection) for bone_id in BONE_ORDER[1:]]
    sockets = [
        {
            "bone_id": socket.bone_id,
            "offset_m": list(socket.offset_m),
            "socket_id": socket.socket_id,
        }
        for socket in contract.sockets
    ]
    return {
        "format": MAPPING_FORMAT,
        "ground_contacts": [
            {
                "bone_id": bone_id,
                "point_actor_m": list(inspection.ground_contacts[bone_id]),
                "tolerance_m": 0.00001,
            }
            for bone_id in ("foot_l", "foot_r")
        ],
        "joints": joint_records,
        "package": {
            "content_set_sha256": verified.content_set_sha256,
            "glb_sha256": verified.glb_sha256,
            "id": verified.actor_id,
            "manifest_sha256": verified.manifest_sha256,
        },
        "reference": {
            "approval_sha256": REFERENCE_APPROVAL_SHA256,
            "manifest_sha256": REFERENCE_MANIFEST_SHA256,
            "ordered_view_set_sha256": REFERENCE_VIEW_SET_SHA256,
            "package_id": REFERENCE_PACKAGE_ID,
            "source_approval_sha256": REFERENCE_SOURCE_APPROVAL_SHA256,
        },
        "rig": {
            "contract_path": "tools/blender/contracts/avian_v1.json",
            "contract_sha256": contract.sha256,
            "id": RIG_ID,
        },
        "root": root_record,
        "schema_version": SCHEMA_VERSION,
        "sockets": sockets,
        "ticket": "AF-056",
        "vertex_skin_sha256": inspection.vertex_skin_sha256,
        "weight_coverage": [
            {
                "bone_id": bone_id,
                "positive_vertex_count": inspection.positive_vertex_counts[bone_id],
            }
            for bone_id in BONE_ORDER[1:]
        ],
    }


def verify_mapping_document(
    path: Path,
    verified: actor_package.VerifiedActorPackage,
    contract: AvianRigContract,
) -> tuple[dict[str, object], str]:
    """Require the tracked mapping to equal fresh inspection byte for byte."""
    payload, document = _canonical_document(path)
    expected = build_mapping_document(verified, contract)
    if document != expected:
        raise ValueError("Tracked avian mapping disagrees with the verified actor package.")
    return document, sha256_bytes(payload)


def _mapping_record(bone_id: str, inspection: SkinInspection) -> dict[str, object]:
    world = inspection.rest_world_translation_m[bone_id]
    return {
        "bone_id": bone_id,
        "joint_node": bone_id,
        "motion_basis_quaternion_xyzw": [0.0, 0.0, 0.0, 1.0],
        "node_index": inspection.node_index_by_bone[bone_id],
        "parent_id": PARENT_BY_BONE[bone_id],
        "rest_local_translation_m": list(inspection.rest_local_translation_m[bone_id]),
        "rest_world_matrix_actor": [
            1.0,
            0.0,
            0.0,
            world[0],
            0.0,
            1.0,
            0.0,
            world[1],
            0.0,
            0.0,
            1.0,
            world[2],
            0.0,
            0.0,
            0.0,
            1.0,
        ],
        "role": "actor_root" if bone_id == "root" else "skin_joint",
        "skin_joint_ordinal": inspection.skin_ordinal_by_bone[bone_id],
    }


def _decode_accessors(
    document: Mapping[str, object], binary: bytes
) -> tuple[actor_package._Accessor, ...]:
    buffers = _objects(document, "buffers")
    declared_length = _integer(buffers[0], "byteLength")
    binary = binary[:declared_length]
    buffer_views = _objects(document, "bufferViews")
    ranges: list[tuple[int, int, int | None]] = []
    for view in buffer_views:
        offset = _optional_integer(view, "byteOffset", 0)
        length = _integer(view, "byteLength")
        stride = _optional_integer_or_none(view, "byteStride")
        ranges.append((offset, length, stride))
    return tuple(
        actor_package._decode_accessor(index, accessor, buffer_views, ranges, binary)
        for index, accessor in enumerate(_objects(document, "accessors"))
    )


def _skin_record(
    position: tuple[float, float, float], influences: Sequence[tuple[str, float]]
) -> bytes:
    # Blender applies deterministic glTF coordinate conversion in float math.
    # Canonical authoring precision removes representation-only signed-zero and
    # sub-micrometer drift while preserving every authored vertex and weight.
    canonical_position = tuple(
        0.0 if round(value, 5) == 0.0 else round(value, 5) for value in position
    )
    payload = bytearray(struct.pack("<fff", *canonical_position))
    ordered = sorted(influences)
    payload.extend(struct.pack("<B", len(ordered)))
    for bone_id, weight in ordered:
        encoded = bone_id.encode("ascii")
        payload.extend(struct.pack("<B", len(encoded)))
        payload.extend(encoded)
        payload.extend(struct.pack("<f", round(weight, 6)))
    return bytes(payload)


def vertex_skin_sha256(records: Iterable[bytes]) -> str:
    """Hash unordered canonical vertex/skin records for import-parity checks."""
    digest = hashlib.sha256()
    for record in sorted(records):
        digest.update(struct.pack("<I", len(record)))
        digest.update(record)
    return digest.hexdigest()


def _node_actor_translation(node: Mapping[str, object]) -> tuple[float, float, float]:
    storage = _numbers3(node, "translation", default=(0.0, 0.0, 0.0))
    return _storage_to_actor(storage)


def _storage_to_actor(vector: tuple[float, float, float]) -> tuple[float, float, float]:
    x, up, negative_forward = vector
    return (x, -negative_forward, up)


def _add(
    left: tuple[float, float, float], right: tuple[float, float, float]
) -> tuple[float, float, float]:
    return (left[0] + right[0], left[1] + right[1], left[2] + right[2])


def _canonical_document(path: Path) -> tuple[bytes, dict[str, object]]:
    payload = path.read_bytes()
    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeError, ValueError) as error:
        raise ValueError(f"{path.name} is not canonical UTF-8 JSON.") from error
    if not isinstance(document, dict) or payload != canonical_json_bytes(document):
        raise ValueError(f"{path.name} is not canonical JSON.")
    return payload, document


def _expect_keys(mapping: Mapping[str, object], expected: set[str], location: str) -> None:
    if set(mapping) != expected:
        raise ValueError(f"{location} keys are not exact.")


def _object(mapping: Mapping[str, object], key: str) -> dict[str, object]:
    value = mapping.get(key)
    if not isinstance(value, dict) or not all(isinstance(name, str) for name in value):
        raise ValueError(f"{key} must be an object.")
    return value


def _objects(mapping: Mapping[str, object], key: str) -> list[dict[str, object]]:
    value = mapping.get(key)
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"{key} must be an array of objects.")
    return [dict(item) for item in value]


def _string(mapping: Mapping[str, object], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string.")
    return value


def _strings(mapping: Mapping[str, object], key: str) -> list[str]:
    value = mapping.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{key} must be an array of strings.")
    return list(value)


def _integer(mapping: Mapping[str, object], key: str) -> int:
    value = mapping.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{key} must be an integer.")
    return value


def _integers(
    mapping: Mapping[str, object], key: str, *, default: Sequence[int] | None = None
) -> tuple[int, ...]:
    if key not in mapping and default is not None:
        return tuple(default)
    value = mapping.get(key)
    if not isinstance(value, list) or any(
        not isinstance(item, int) or isinstance(item, bool) for item in value
    ):
        raise ValueError(f"{key} must be an integer array.")
    return tuple(value)


def _numbers(
    mapping: Mapping[str, object],
    key: str,
    length: int,
    *,
    default: tuple[float, ...] | None = None,
) -> tuple[float, ...]:
    if key not in mapping and default is not None:
        return default
    value = mapping.get(key)
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{key} must contain exactly {length} numbers.")
    numbers: list[float] = []
    for item in value:
        if not isinstance(item, (int, float)) or isinstance(item, bool):
            raise ValueError(f"{key} must contain only numbers.")
        number = float(item)
        if not math.isfinite(number):
            raise ValueError(f"{key} must contain only finite numbers.")
        numbers.append(number)
    return tuple(numbers)


def _numbers3(
    mapping: Mapping[str, object],
    key: str,
    *,
    default: tuple[float, float, float] | None = None,
) -> tuple[float, float, float]:
    values = _numbers(mapping, key, 3, default=default)
    return (values[0], values[1], values[2])


def _optional_integer(mapping: Mapping[str, object], key: str, default: int) -> int:
    return _integer(mapping, key) if key in mapping else default


def _optional_integer_or_none(mapping: Mapping[str, object], key: str) -> int | None:
    return _integer(mapping, key) if key in mapping else None
