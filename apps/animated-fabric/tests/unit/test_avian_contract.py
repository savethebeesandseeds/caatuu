"""Focused contract and adversarial tests for the AF-056 avian actor."""

from __future__ import annotations

import copy
import json
import shutil
import struct
from collections.abc import Callable, Mapping
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

from scripts import generate_macaw_actor_package as macaw_generator
from scripts.generate_macaw_rig_mapping import (
    actor_package,
    avian_contract,
    generate_mapping,
)

generate_macaw_actor_package = macaw_generator.generate_macaw_actor_package

JsonObject = dict[str, object]
GlbMutation = Callable[[JsonObject, bytearray], None]


def _object(document: Mapping[str, object], key: str) -> JsonObject:
    return cast(JsonObject, document[key])


def _objects(document: Mapping[str, object], key: str) -> list[JsonObject]:
    return cast(list[JsonObject], document[key])


def _integers(document: Mapping[str, object], key: str) -> list[int]:
    return cast(list[int], document[key])


def _manifest(package_root: Path) -> JsonObject:
    return cast(
        JsonObject,
        json.loads((package_root / actor_package.MANIFEST_FILENAME).read_text(encoding="utf-8")),
    )


def _tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _decode_glb(payload: bytes) -> tuple[JsonObject, bytearray]:
    json_length, json_type = struct.unpack_from("<II", payload, 12)
    assert json_type == 0x4E4F534A
    json_start = 20
    json_end = json_start + json_length
    binary_length, binary_type = struct.unpack_from("<II", payload, json_end)
    assert binary_type == 0x004E4942
    binary_start = json_end + 8
    assert binary_start + binary_length == len(payload)
    document = cast(JsonObject, json.loads(payload[json_start:json_end].rstrip(b" ")))
    return document, bytearray(payload[binary_start:])


def _encode_glb(document: JsonObject, binary: bytearray) -> bytes:
    json_payload = json.dumps(
        document,
        allow_nan=False,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    json_payload += b" " * ((-len(json_payload)) % 4)
    assert len(binary) % 4 == 0
    total_length = 12 + 8 + len(json_payload) + 8 + len(binary)
    return b"".join(
        (
            struct.pack("<4sII", b"glTF", 2, total_length),
            struct.pack("<II", len(json_payload), 0x4E4F534A),
            json_payload,
            struct.pack("<II", len(binary), 0x004E4942),
            bytes(binary),
        )
    )


def _resign_glb(package_root: Path, payload: bytes) -> str:
    (package_root / actor_package.GLB_FILENAME).write_bytes(payload)
    manifest = _manifest(package_root)
    asset = _object(manifest, "asset")
    asset["bytes"] = len(payload)
    asset["sha256"] = actor_package.sha256_bytes(payload)
    textures = _objects(manifest, "textures")
    try:
        observations = actor_package._validate_glb(
            payload,
            manifest=manifest,
            declared_texture_paths=tuple(cast(str, record["path"]) for record in textures),
        )
    except ValueError:
        # Some adversarial cases deliberately fail the generic package gate.
        pass
    else:
        manifest_observations = _object(manifest, "observed")
        manifest_observations.update(observations)
        manifest_observations["content_bytes"] = len(payload) + sum(
            cast(int, record["bytes"]) for record in textures
        )
    _object(manifest, "content_set")["sha256"] = actor_package.content_set_sha256(
        [asset, *textures]
    )
    manifest_payload = actor_package.canonical_json_bytes(manifest)
    (package_root / actor_package.MANIFEST_FILENAME).write_bytes(manifest_payload)
    return actor_package.sha256_bytes(manifest_payload)


def _mutate_glb(package_root: Path, mutation: GlbMutation) -> str:
    glb_path = package_root / actor_package.GLB_FILENAME
    document, binary = _decode_glb(glb_path.read_bytes())
    mutation(document, binary)
    return _resign_glb(package_root, _encode_glb(document, binary))


def _accessor_layout(
    document: Mapping[str, object], accessor_index: int
) -> tuple[int, int, int, int, str]:
    accessor = _objects(document, "accessors")[accessor_index]
    view = _objects(document, "bufferViews")[cast(int, accessor["bufferView"])]
    component_type = cast(int, accessor["componentType"])
    component_bytes = {5121: 1, 5123: 2, 5125: 4, 5126: 4}[component_type]
    value_type = cast(str, accessor["type"])
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[value_type]
    offset = cast(int, view.get("byteOffset", 0)) + cast(int, accessor.get("byteOffset", 0))
    stride = cast(int, view.get("byteStride", component_bytes * components))
    return offset, stride, cast(int, accessor["count"]), component_type, value_type


def _node_index(document: Mapping[str, object], name: str) -> int:
    for index, node in enumerate(_objects(document, "nodes")):
        if node.get("name") == name:
            return index
    raise AssertionError(f"Missing generated node: {name}")


def _move_tail_mid_to_pelvis(document: JsonObject, _binary: bytearray) -> None:
    nodes = _objects(document, "nodes")
    tail_base = nodes[_node_index(document, "tail_base")]
    pelvis = nodes[_node_index(document, "pelvis")]
    tail_mid_index = _node_index(document, "tail_mid")
    parent_by_node = {
        child: parent_index
        for parent_index, node in enumerate(nodes)
        for child in cast(list[int], node.get("children", []))
    }

    def world_translation(node_index: int) -> tuple[float, float, float]:
        local = cast(list[float], nodes[node_index].get("translation", [0.0, 0.0, 0.0]))
        parent_index = parent_by_node.get(node_index)
        if parent_index is None:
            return (local[0], local[1], local[2])
        parent_world = world_translation(parent_index)
        return (
            parent_world[0] + local[0],
            parent_world[1] + local[1],
            parent_world[2] + local[2],
        )

    tail_mid_world = world_translation(tail_mid_index)
    pelvis_world = world_translation(_node_index(document, "pelvis"))
    nodes[tail_mid_index]["translation"] = [
        tail_mid_world[axis] - pelvis_world[axis] for axis in range(3)
    ]
    _integers(tail_base, "children").remove(tail_mid_index)
    _integers(pelvis, "children").append(tail_mid_index)


def _swap_first_skin_joints(document: JsonObject, binary: bytearray) -> None:
    skin = _objects(document, "skins")[0]
    joints = _integers(skin, "joints")
    joints[0], joints[1] = joints[1], joints[0]
    accessor_index = cast(int, skin["inverseBindMatrices"])
    offset, stride, count, component_type, value_type = _accessor_layout(document, accessor_index)
    assert count == len(joints)
    assert component_type == 5126
    assert value_type == "MAT4"
    first = bytes(binary[offset : offset + 64])
    second_offset = offset + stride
    second = bytes(binary[second_offset : second_offset + 64])
    binary[offset : offset + 64] = second
    binary[second_offset : second_offset + 64] = first


def _set_skin_skeleton_to_root(document: JsonObject, _binary: bytearray) -> None:
    _objects(document, "skins")[0]["skeleton"] = _node_index(document, "root")


def _remove_mesh_skin(document: JsonObject, _binary: bytearray) -> None:
    mesh_nodes = [node for node in _objects(document, "nodes") if "mesh" in node]
    assert len(mesh_nodes) == 1
    del mesh_nodes[0]["skin"]


def _replace_joint_ordinal(
    document: JsonObject,
    binary: bytearray,
    *,
    source_bone: str,
    destination_bone: str,
    ground_only: bool,
) -> int:
    joint_names = avian_contract.BONE_ORDER[1:]
    source_ordinal = joint_names.index(source_bone)
    destination_ordinal = joint_names.index(destination_bone)
    changed = 0
    for mesh in _objects(document, "meshes"):
        for primitive in _objects(mesh, "primitives"):
            attributes = _object(primitive, "attributes")
            position_index = cast(int, attributes["POSITION"])
            joint_index = cast(int, attributes["JOINTS_0"])
            position_offset, position_stride, position_count, position_type, position_shape = (
                _accessor_layout(document, position_index)
            )
            joint_offset, joint_stride, joint_count, joint_type, joint_shape = _accessor_layout(
                document, joint_index
            )
            assert position_type == 5126 and position_shape == "VEC3"
            assert joint_type == 5121 and joint_shape == "VEC4"
            assert joint_count == position_count
            for vertex_index in range(joint_count):
                storage_up = struct.unpack_from(
                    "<f", binary, position_offset + vertex_index * position_stride + 4
                )[0]
                if ground_only and abs(storage_up) > 1e-6:
                    continue
                row_offset = joint_offset + vertex_index * joint_stride
                for component in range(4):
                    component_offset = row_offset + component
                    if binary[component_offset] == source_ordinal:
                        binary[component_offset] = destination_ordinal
                        changed += 1
    return changed


def _remove_required_neck_weights(document: JsonObject, binary: bytearray) -> None:
    assert (
        _replace_joint_ordinal(
            document,
            binary,
            source_bone="neck",
            destination_bone="torso",
            ground_only=False,
        )
        > 0
    )


def _remove_left_foot_contact(document: JsonObject, binary: bytearray) -> None:
    assert (
        _replace_joint_ordinal(
            document,
            binary,
            source_bone="foot_l",
            destination_bone="shin_l",
            ground_only=True,
        )
        > 0
    )


@pytest.fixture(scope="module")
def generated_package(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, str]:
    package_root = tmp_path_factory.mktemp("af056-package") / "macaw"
    manifest_sha256 = generate_macaw_actor_package(package_root)
    return package_root, manifest_sha256


def test_rig_and_pose_contracts_are_exactly_normative() -> None:
    contract = avian_contract.load_rig_contract()
    poses = avian_contract.load_review_poses()

    assert tuple(bone.bone_id for bone in contract.bones) == avian_contract.BONE_ORDER
    assert {bone.bone_id: bone.parent_id for bone in contract.bones} == dict(
        avian_contract.PARENT_BY_BONE
    )
    assert {socket.socket_id: socket.bone_id for socket in contract.sockets} == dict(
        avian_contract.SOCKET_BINDINGS
    )
    assert avian_contract.OPTIONAL_UNWEIGHTED_BONES == {
        "beak",
        "tail_tip",
        "wing_hand_l",
        "wing_hand_r",
    }
    assert tuple(pose.pose_id for pose in poses.poses) == avian_contract.POSE_ORDER
    assert poses.poses[0].rotations == ()
    assert all(pose.rotations for pose in poses.poses[1:])


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda document: cast(list[object], document["bones"]).__setitem__(
                slice(1, 3),
                cast(list[object], document["bones"])[1:3][::-1],
            ),
            "topological order",
        ),
        (
            lambda document: cast(JsonObject, cast(list[object], document["bones"])[13]).update(
                {"parent_id": "pelvis"}
            ),
            "hierarchy disagrees",
        ),
    ],
    ids=["bone-order", "parent"],
)
def test_rig_contract_rejects_order_and_parent_mutations(
    tmp_path: Path,
    mutation: Callable[[JsonObject], None],
    message: str,
) -> None:
    document = cast(
        JsonObject,
        json.loads(avian_contract.RIG_CONTRACT_PATH.read_text(encoding="utf-8")),
    )
    mutation(document)
    path = tmp_path / "avian_v1.json"
    path.write_bytes(avian_contract.canonical_json_bytes(document))

    with pytest.raises(ValueError, match=message):
        avian_contract.load_rig_contract(path)


def test_macaw_package_generation_is_byte_deterministic_and_pinned_to_reference(
    tmp_path: Path,
) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"

    first_hash = generate_macaw_actor_package(first)
    second_hash = generate_macaw_actor_package(second)

    assert first_hash == second_hash
    assert _tree_bytes(first) == _tree_bytes(second)
    manifest = _manifest(first)
    provenance = _object(manifest, "provenance")
    sources = {record["id"]: record for record in _objects(provenance, "sources")}
    assert manifest["package_id"] == avian_contract.PACKAGE_ID
    assert sources["approved-reference-manifest"]["sha256"] == (
        avian_contract.REFERENCE_MANIFEST_SHA256
    )
    assert sources["approved-reference-approval"]["sha256"] == (
        avian_contract.REFERENCE_APPROVAL_SHA256
    )
    assert sources["approved-source-approval"]["sha256"] == (
        avian_contract.REFERENCE_SOURCE_APPROVAL_SHA256
    )


def test_macaw_package_generation_reuses_only_an_exact_immutable_destination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "actor"
    manifest_sha256 = generate_macaw_actor_package(destination)
    original = _tree_bytes(destination)
    original_status = destination.stat()

    assert generate_macaw_actor_package(destination) == manifest_sha256
    repeated_status = destination.stat()
    assert _tree_bytes(destination) == original
    assert repeated_status.st_ino == original_status.st_ino
    assert repeated_status.st_mtime_ns == original_status.st_mtime_ns

    changed_colors = list(macaw_generator.TEXTURE_COLORS)
    texture_id, base, _accent = changed_colors[0]
    changed_colors[0] = (texture_id, base, (47, 43, 39, 255))
    monkeypatch.setattr(macaw_generator, "TEXTURE_COLORS", tuple(changed_colors))

    with pytest.raises(ValueError, match="immutable macaw-traveler-avian-v1"):
        generate_macaw_actor_package(destination)
    assert _tree_bytes(destination) == original


def test_macaw_package_generation_preserves_a_forged_destination(tmp_path: Path) -> None:
    destination = tmp_path / "actor"
    destination.mkdir()
    fake_manifest = {
        "format": actor_package.ACTOR_PACKAGE_FORMAT,
        "package_id": avian_contract.PACKAGE_ID,
        "provenance": {
            "kind": "reviewed-authored-actor",
            "sources": [{"path": "scripts/generate_macaw_actor_package.py"}],
        },
    }
    (destination / actor_package.MANIFEST_FILENAME).write_bytes(
        actor_package.canonical_json_bytes(fake_manifest)
    )
    (destination / "sentinel.txt").write_bytes(b"must remain")
    original = _tree_bytes(destination)

    with pytest.raises(ValueError, match="immutable macaw-traveler-avian-v1"):
        generate_macaw_actor_package(destination)
    assert _tree_bytes(destination) == original


def test_package_inspection_builds_complete_explicit_mapping(
    generated_package: tuple[Path, str],
) -> None:
    package_root, manifest_sha256 = generated_package
    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=manifest_sha256,
    )
    contract = avian_contract.load_rig_contract()
    inspection = avian_contract.inspect_verified_avian_skin(verified, contract)
    mapping = avian_contract.build_mapping_document(verified, contract)

    assert mapping["root"] == avian_contract._mapping_record("root", inspection)
    assert [record["bone_id"] for record in _objects(mapping, "joints")] == list(
        avian_contract.BONE_ORDER[1:]
    )
    assert _object(mapping, "package") == {
        "content_set_sha256": verified.content_set_sha256,
        "glb_sha256": verified.glb_sha256,
        "id": avian_contract.PACKAGE_ID,
        "manifest_sha256": verified.manifest_sha256,
    }
    assert _object(mapping, "reference") == {
        "approval_sha256": avian_contract.REFERENCE_APPROVAL_SHA256,
        "manifest_sha256": avian_contract.REFERENCE_MANIFEST_SHA256,
        "ordered_view_set_sha256": avian_contract.REFERENCE_VIEW_SET_SHA256,
        "package_id": avian_contract.REFERENCE_PACKAGE_ID,
        "source_approval_sha256": avian_contract.REFERENCE_SOURCE_APPROVAL_SHA256,
    }
    assert all(
        inspection.positive_vertex_counts[bone_id] > 0
        for bone_id in set(avian_contract.BONE_ORDER[1:]) - avian_contract.OPTIONAL_UNWEIGHTED_BONES
    )
    assert inspection.ground_contacts["foot_l"][2] == pytest.approx(0.0, abs=1e-6)
    assert inspection.ground_contacts["foot_r"][2] == pytest.approx(0.0, abs=1e-6)


def test_mapping_generation_is_canonical_repeatable_and_hash_bound(
    tmp_path: Path,
    generated_package: tuple[Path, str],
) -> None:
    package_root, manifest_sha256 = generated_package
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"

    first_hash = generate_mapping(
        package_root,
        first,
        expected_manifest_sha256=manifest_sha256,
    )
    second_hash = generate_mapping(
        package_root,
        second,
        expected_manifest_sha256=manifest_sha256,
    )
    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=manifest_sha256,
    )
    document, verified_mapping_hash = avian_contract.verify_mapping_document(
        first,
        verified,
        avian_contract.load_rig_contract(),
    )

    assert first_hash == second_hash == verified_mapping_hash
    assert first.read_bytes() == second.read_bytes()
    assert first.read_bytes() == avian_contract.canonical_json_bytes(document)

    tampered = copy.deepcopy(document)
    _object(tampered, "package")["manifest_sha256"] = "0" * 64
    first.write_bytes(avian_contract.canonical_json_bytes(tampered))
    with pytest.raises(ValueError, match="disagrees with the verified actor package"):
        avian_contract.verify_mapping_document(
            first,
            verified,
            avian_contract.load_rig_contract(),
        )

    with pytest.raises(ValueError, match="external trust anchor"):
        generate_mapping(
            package_root,
            tmp_path / "wrong-anchor.json",
            expected_manifest_sha256="0" * 64,
        )


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (_move_tail_mid_to_pelvis, "parent is invalid for tail_mid"),
        (_swap_first_skin_joints, "joint order is not canonical"),
        (_remove_required_neck_weights, "required avian joint unweighted"),
        (_remove_left_foot_contact, "bilateral foot-weighted ground contact"),
    ],
    ids=["parent", "joint-order", "zero-required-weight", "ground-contact"],
)
def test_avian_inspection_rejects_semantic_glb_mutations_after_generic_validation(
    tmp_path: Path,
    generated_package: tuple[Path, str],
    mutation: GlbMutation,
    message: str,
) -> None:
    baseline, _manifest_sha256 = generated_package
    package_root = tmp_path / "mutated"
    shutil.copytree(baseline, package_root)
    mutated_hash = _mutate_glb(package_root, mutation)
    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=mutated_hash,
    )

    with pytest.raises(ValueError, match=message):
        avian_contract.inspect_verified_avian_skin(
            verified,
            avian_contract.load_rig_contract(),
        )


def test_avian_inspection_rechecks_glb_identity_after_generic_verification(
    tmp_path: Path,
    generated_package: tuple[Path, str],
) -> None:
    baseline, manifest_sha256 = generated_package
    package_root = tmp_path / "changed-after-verification"
    shutil.copytree(baseline, package_root)
    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=manifest_sha256,
    )
    verified.glb_path.write_bytes(verified.glb_path.read_bytes() + b"changed")

    with pytest.raises(ValueError, match="changed after generic verification"):
        avian_contract.inspect_verified_avian_skin(
            verified,
            avian_contract.load_rig_contract(),
        )


@pytest.mark.parametrize(
    ("mutation", "generic_message", "avian_message"),
    [
        (
            _set_skin_skeleton_to_root,
            "skin skeleton must be one of its joints",
            "skin skeleton must be pelvis",
        ),
        (
            _remove_mesh_skin,
            "Every GLB skin must be referenced",
            "skin must be an integer",
        ),
    ],
    ids=["wrong-skeleton", "unskinned-mesh"],
)
def test_generic_and_avian_gates_reject_skeleton_and_unskinned_mutations(
    tmp_path: Path,
    generated_package: tuple[Path, str],
    mutation: GlbMutation,
    generic_message: str,
    avian_message: str,
) -> None:
    baseline, baseline_hash = generated_package
    package_root = tmp_path / "mutated"
    shutil.copytree(baseline, package_root)
    baseline_verified = actor_package.verify_actor_package(
        baseline,
        expected_manifest_sha256=baseline_hash,
    )
    mutated_hash = _mutate_glb(package_root, mutation)

    with pytest.raises(ValueError, match=generic_message):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=mutated_hash,
        )

    changed_after_verification = replace(
        baseline_verified,
        root=package_root,
        glb_path=package_root / actor_package.GLB_FILENAME,
        glb_sha256=actor_package.sha256_bytes(
            (package_root / actor_package.GLB_FILENAME).read_bytes()
        ),
    )
    with pytest.raises(ValueError, match=avian_message):
        avian_contract.inspect_verified_avian_skin(
            changed_after_verification,
            avian_contract.load_rig_contract(),
        )
