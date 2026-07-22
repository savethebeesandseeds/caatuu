"""Adversarial tests for the AF-055 data-only actor-package boundary."""

from __future__ import annotations

import json
import math
import os
import stat
import struct
import zlib
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest

from scripts.generate_actor_package_fixture import (
    _validated_fixture_destination,
    generate_actor_package_fixture,
)
from tools.blender import actor_package

JsonObject = dict[str, object]


def _manifest(package_root: Path) -> JsonObject:
    return cast(
        JsonObject,
        json.loads((package_root / actor_package.MANIFEST_FILENAME).read_text(encoding="utf-8")),
    )


def _object(document: JsonObject, key: str) -> JsonObject:
    return cast(JsonObject, document[key])


def _objects(document: JsonObject, key: str) -> list[JsonObject]:
    return cast(list[JsonObject], document[key])


def _write_manifest(package_root: Path, manifest: JsonObject) -> str:
    payload = actor_package.canonical_json_bytes(manifest)
    (package_root / actor_package.MANIFEST_FILENAME).write_bytes(payload)
    return actor_package.sha256_bytes(payload)


def _decode_glb_for_mutation(payload: bytes) -> tuple[JsonObject, bytes]:
    json_length, json_type = struct.unpack_from("<II", payload, 12)
    assert json_type == 0x4E4F534A
    json_start = 20
    json_end = json_start + json_length
    binary_length, binary_type = struct.unpack_from("<II", payload, json_end)
    assert binary_type == 0x004E4942
    binary_start = json_end + 8
    assert binary_start + binary_length == len(payload)
    document = cast(JsonObject, json.loads(payload[json_start:json_end].rstrip(b" ")))
    return document, payload[binary_start:]


def _encode_glb(document: JsonObject, binary: bytes) -> bytes:
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
            binary,
        )
    )


def _resign_glb(package_root: Path, glb: bytes) -> str:
    (package_root / actor_package.GLB_FILENAME).write_bytes(glb)
    manifest = _manifest(package_root)
    asset = _object(manifest, "asset")
    asset["bytes"] = len(glb)
    asset["sha256"] = actor_package.sha256_bytes(glb)
    textures = _objects(manifest, "textures")
    _object(manifest, "content_set")["sha256"] = actor_package.content_set_sha256(
        [asset, *textures]
    )
    return _write_manifest(package_root, manifest)


def _resign_texture(package_root: Path, payload: bytes) -> str:
    texture_path = package_root / "textures/albedo.png"
    texture_path.write_bytes(payload)
    manifest = _manifest(package_root)
    texture = _objects(manifest, "textures")[0]
    texture["bytes"] = len(payload)
    texture["sha256"] = actor_package.sha256_bytes(payload)
    asset = _object(manifest, "asset")
    _object(manifest, "content_set")["sha256"] = actor_package.content_set_sha256([asset, texture])
    return _write_manifest(package_root, manifest)


def _png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(payload, zlib.crc32(chunk_type)) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + chunk_type + payload + struct.pack(">I", checksum)


def _mutate_glb_document(
    package_root: Path,
    mutation: Callable[[JsonObject], None],
) -> str:
    glb_path = package_root / actor_package.GLB_FILENAME
    document, binary = _decode_glb_for_mutation(glb_path.read_bytes())
    mutation(document)
    return _resign_glb(package_root, _encode_glb(document, binary))


def _mutate_accessor_bytes(
    package_root: Path,
    accessor_index: int,
    mutation: Callable[[bytearray, int], None],
) -> str:
    glb_path = package_root / actor_package.GLB_FILENAME
    document, immutable_binary = _decode_glb_for_mutation(glb_path.read_bytes())
    accessors = _objects(document, "accessors")
    buffer_views = _objects(document, "bufferViews")
    accessor = accessors[accessor_index]
    view = buffer_views[cast(int, accessor["bufferView"])]
    offset = cast(int, view.get("byteOffset", 0)) + cast(int, accessor.get("byteOffset", 0))
    binary = bytearray(immutable_binary)
    mutation(binary, offset)
    return _resign_glb(package_root, _encode_glb(document, bytes(binary)))


def _package_bytes(package_root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(package_root).as_posix(): path.read_bytes()
        for path in sorted(package_root.rglob("*"))
        if path.is_file()
    }


def test_fixture_generation_is_byte_deterministic_across_two_trees(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"

    first_hash = generate_actor_package_fixture(first)
    second_hash = generate_actor_package_fixture(second)

    assert first_hash == second_hash
    assert _package_bytes(first) == _package_bytes(second)


def test_fixture_destination_preserves_supported_children_but_rejects_roots(
    tmp_path: Path,
) -> None:
    repository_root = tmp_path / "repository"
    app_root = repository_root / "apps/animated-fabric"
    temporary_root = app_root / ".tmp"
    workspaces_root = app_root / "workspaces"
    package_root = workspaces_root / "actor-packages"
    package_root.mkdir(parents=True)
    temporary_root.mkdir()

    assert (
        _validated_fixture_destination(
            temporary_root / "af055/geometric-fixture-v1", app_root=app_root
        )
        == temporary_root / "af055/geometric-fixture-v1"
    )
    assert (
        _validated_fixture_destination(package_root / "geometric-fixture-v1", app_root=app_root)
        == package_root / "geometric-fixture-v1"
    )

    for protected in (repository_root, app_root, temporary_root, workspaces_root, package_root):
        with pytest.raises(ValueError, match="protected workspace root"):
            _validated_fixture_destination(protected, app_root=app_root)


def test_fixture_destination_rejects_dot_before_any_replacement() -> None:
    with pytest.raises(ValueError, match="protected workspace root"):
        _validated_fixture_destination(Path("."))


def test_fixture_generation_refuses_to_replace_unrelated_content(tmp_path: Path) -> None:
    destination = tmp_path / "unrelated"
    destination.mkdir()
    sentinel = destination / "keep-me.txt"
    sentinel.write_text("user content", encoding="utf-8")

    with pytest.raises(ValueError, match="not generated by this fixture"):
        generate_actor_package_fixture(destination)

    assert sentinel.read_text(encoding="utf-8") == "user content"
    assert set(destination.iterdir()) == {sentinel}


def test_fixture_generation_replaces_only_a_recognized_generated_tree(tmp_path: Path) -> None:
    destination = tmp_path / "fixture"
    first_hash = generate_actor_package_fixture(destination)
    stale = destination / "stale-package.txt"
    stale.write_text("stale", encoding="utf-8")

    second_hash = generate_actor_package_fixture(destination)

    assert second_hash == first_hash
    assert not stale.exists()
    assert set(_package_bytes(destination)) == {
        "actor-package.json",
        "actor.glb",
        "textures/albedo.png",
    }


def test_fixture_generation_rejects_link_targets_and_linked_ancestors(tmp_path: Path) -> None:
    real = tmp_path / "real"
    real.mkdir()
    linked = tmp_path / "linked"
    try:
        linked.symlink_to(real, target_is_directory=True)
    except OSError:
        pytest.skip("Filesystem does not permit symbolic links.")

    for destination in (linked, linked / "geometric-fixture-v1"):
        with pytest.raises(ValueError, match="links or reparse points"):
            generate_actor_package_fixture(destination)

    assert list(real.iterdir()) == []


def test_exact_package_verification_returns_only_declared_content(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    manifest_hash = generate_actor_package_fixture(package_root)

    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=manifest_hash,
    )

    assert verified.root == package_root
    assert verified.actor_id == "geometric-fixture-v1"
    assert verified.root_node == "actor_root"
    assert verified.manifest_sha256 == manifest_hash
    assert verified.glb_path == package_root / "actor.glb"
    assert verified.texture_paths == (package_root / "textures/albedo.png",)
    assert dict(verified.file_sha256).keys() == {
        "actor-package.json",
        "actor.glb",
        "textures/albedo.png",
    }
    assert verified.observations["vertices"] == 24
    assert verified.observations["triangles"] == 12


def test_external_manifest_trust_anchor_is_mandatory(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    manifest_hash = generate_actor_package_fixture(package_root)
    wrong_hash = "0" * 64 if manifest_hash != "0" * 64 else "1" * 64

    with pytest.raises(ValueError, match="external trust anchor"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=wrong_hash,
        )


def test_manifest_must_use_canonical_json_even_when_trust_anchor_matches(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest = _manifest(package_root)
    payload = json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode("utf-8")
    (package_root / actor_package.MANIFEST_FILENAME).write_bytes(payload)

    with pytest.raises(ValueError, match="canonical JSON"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=actor_package.sha256_bytes(payload),
        )


def test_manifest_rejects_unknown_fields_even_when_canonical_and_signed(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest = _manifest(package_root)
    manifest["unreviewed_behavior"] = {"script": "run.py"}
    manifest_hash = _write_manifest(package_root, manifest)

    with pytest.raises(ValueError, match="Unexpected keys"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_schema_accepts_reviewed_actor_provenance_without_fixture_hardcoding(
    tmp_path: Path,
) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest = _manifest(package_root)
    manifest["provenance"] = {
        "geometry_license": "CC0-1.0",
        "kind": "reviewed-authored-actor",
        "sources": [
            {
                "id": "approved-reference",
                "path": "assets/reference-packages/macaw-traveler-v1/reference.json",
                "sha256": "1" * 64,
            }
        ],
        "texture_license": "CC0-1.0",
        "ticket": "AF-056",
    }
    manifest_hash = _write_manifest(package_root, manifest)

    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=manifest_hash,
    )

    assert verified.actor_id == "geometric-fixture-v1"


@pytest.mark.parametrize(
    "source_path",
    [
        "./scripts/generate_actor_package_fixture.py",
        "scripts//generate_actor_package_fixture.py",
        "scripts/./generate_actor_package_fixture.py",
        "scripts/generate_actor_package_fixture.py/",
    ],
)
def test_manifest_rejects_noncanonical_provenance_source_paths(
    tmp_path: Path, source_path: str
) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest = _manifest(package_root)
    provenance = _object(manifest, "provenance")
    _objects(provenance, "sources")[0]["path"] = source_path
    manifest_hash = _write_manifest(package_root, manifest)

    with pytest.raises(ValueError, match="path is unsafe"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_closed_tree_rejects_missing_declared_file(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    manifest_hash = generate_actor_package_fixture(package_root)
    (package_root / "textures/albedo.png").unlink()
    (package_root / "textures").rmdir()

    with pytest.raises(ValueError, match="tree is not closed"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_closed_tree_rejects_undeclared_file(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    manifest_hash = generate_actor_package_fixture(package_root)
    (package_root / "payload.py").write_text("raise SystemExit\n", encoding="utf-8")

    with pytest.raises(ValueError, match="tree is not closed"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_declared_hash_rejects_tampered_content(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    manifest_hash = generate_actor_package_fixture(package_root)
    texture = package_root / "textures/albedo.png"
    payload = bytearray(texture.read_bytes())
    payload[-1] ^= 1
    texture.write_bytes(payload)

    with pytest.raises(ValueError, match="SHA-256 disagrees"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_png_decoder_bounds_expansion_before_flushing(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    ihdr = struct.pack(">IIBBBBB", 32, 32, 8, 6, 0, 0, 0)
    payload = b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", ihdr),
            _png_chunk(b"IDAT", zlib.compress(b"\0" * 1_000_000, level=9)),
            _png_chunk(b"IEND", b""),
        )
    )
    manifest_hash = _resign_texture(package_root, payload)

    with pytest.raises(ValueError, match="image data does not match"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_png_rejects_nonempty_iend_chunk(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    texture = package_root / "textures/albedo.png"
    payload = texture.read_bytes()
    assert payload[-12:-8] == b"\0\0\0\0"
    assert payload[-8:-4] == b"IEND"
    manifest_hash = _resign_texture(package_root, payload[:-12] + _png_chunk(b"IEND", b"x"))

    with pytest.raises(ValueError, match="IEND chunk must be empty"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_package_rejects_symbolic_links(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    manifest_hash = generate_actor_package_fixture(package_root)
    texture = package_root / "textures/albedo.png"
    external = tmp_path / "external.png"
    external.write_bytes(texture.read_bytes())
    texture.unlink()
    try:
        texture.symlink_to(external)
    except OSError:
        pytest.skip("Filesystem does not permit symbolic links.")

    with pytest.raises(ValueError, match="links or reparse points"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_package_rejects_hard_links(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    manifest_hash = generate_actor_package_fixture(package_root)
    texture = package_root / "textures/albedo.png"
    external = tmp_path / "external.png"
    external.write_bytes(texture.read_bytes())
    texture.unlink()
    try:
        os.link(external, texture)
    except OSError:
        pytest.skip("Filesystem does not permit hard links.")

    with pytest.raises(ValueError, match="must not be hard-linked"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


@pytest.mark.parametrize(
    "uri",
    [
        "../textures/albedo.png",
        "/textures/albedo.png",
        "https://example.invalid/albedo.png",
        "data:image/png;base64,AAAA",
        "textures/albedo.png?unreviewed=1",
    ],
)
def test_glb_rejects_external_or_unsafe_texture_uris(tmp_path: Path, uri: str) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)

    def mutate(document: JsonObject) -> None:
        _objects(document, "images")[0]["uri"] = uri

    manifest_hash = _mutate_glb_document(package_root, mutate)

    with pytest.raises(ValueError, match="URI|path is unsafe"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


@pytest.mark.parametrize(
    "path",
    [
        "CON",
        "con.txt",
        "textures/AUX.png",
        "textures/com1.albedo.png",
        "textures/LPT9.png",
        "textures/albedo.",
    ],
)
def test_package_paths_reject_portability_aliases(path: str) -> None:
    with pytest.raises(ValueError, match="path is unsafe"):
        actor_package._safe_relative_path(path)


def test_package_paths_accept_portable_provenance_path() -> None:
    path = "assets/reference-packages/macaw-traveler-v1/reference.json"

    assert actor_package._safe_relative_path(path).as_posix() == path


@pytest.mark.parametrize("field", ["animations", "cameras", "extensionsUsed", "extensions"])
def test_glb_rejects_embedded_scene_behavior_and_extensions(tmp_path: Path, field: str) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)

    def mutate(document: JsonObject) -> None:
        document[field] = {} if field == "extensions" else []

    manifest_hash = _mutate_glb_document(package_root, mutate)

    with pytest.raises(ValueError, match="unsupported|Unexpected keys"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


@pytest.mark.parametrize("malformation", ["magic", "declared-length", "chunk-alignment"])
def test_glb_rejects_malformed_binary_framing(tmp_path: Path, malformation: str) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    glb = bytearray((package_root / actor_package.GLB_FILENAME).read_bytes())
    if malformation == "magic":
        glb[:4] = b"NOPE"
    elif malformation == "declared-length":
        struct.pack_into("<I", glb, 8, len(glb) + 4)
    else:
        json_length = struct.unpack_from("<I", glb, 12)[0]
        struct.pack_into("<I", glb, 12, json_length - 1)
    manifest_hash = _resign_glb(package_root, bytes(glb))

    with pytest.raises(ValueError, match="GLB"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_nonfinite_position_data(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest_hash = _mutate_accessor_bytes(
        package_root,
        accessor_index=0,
        mutation=lambda binary, offset: struct.pack_into("<f", binary, offset, math.nan),
    )

    with pytest.raises(ValueError, match="NaN or infinity"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_nonidentity_mesh_composed_world_transform(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)

    def mutate(document: JsonObject) -> None:
        nodes = _objects(document, "nodes")
        nodes[0]["children"] = [4, 2]
        nodes.append(
            {
                "children": [1],
                "name": "mesh_parent",
                "translation": [0.25, 0.0, 0.0],
            }
        )

    manifest_hash = _mutate_glb_document(package_root, mutate)

    with pytest.raises(ValueError, match="mesh composed/world transform"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_unbounded_node_rest_transform(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)

    def mutate(document: JsonObject) -> None:
        _objects(document, "nodes")[3]["translation"] = [11.0, 0.0, 0.0]

    manifest_hash = _mutate_glb_document(package_root, mutate)

    with pytest.raises(ValueError, match="node rest transform"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_unbounded_composed_world_transform(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)

    def mutate(document: JsonObject) -> None:
        nodes = _objects(document, "nodes")
        nodes[2]["translation"] = [6.0, 0.0, 0.0]
        nodes[3]["translation"] = [5.0, 0.9, 0.0]

    manifest_hash = _mutate_glb_document(package_root, mutate)

    with pytest.raises(ValueError, match="composed/world transform exceeds"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_inverse_bind_that_disagrees_with_rest_transform(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest_hash = _mutate_accessor_bytes(
        package_root,
        accessor_index=6,
        mutation=lambda binary, offset: struct.pack_into(
            "<f", binary, offset + (16 + 13) * 4, -0.8
        ),
    )

    with pytest.raises(ValueError, match="joint composed/world rest transform"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_unbounded_inverse_bind_matrix(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest_hash = _mutate_accessor_bytes(
        package_root,
        accessor_index=6,
        mutation=lambda binary, offset: struct.pack_into(
            "<f", binary, offset + (16 + 13) * 4, -11.0
        ),
    )

    with pytest.raises(ValueError, match="Inverse-bind matrix exceeds"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_requires_every_skin_to_be_referenced(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)

    def mutate(document: JsonObject) -> None:
        _objects(document, "nodes")[1].pop("skin")

    manifest_hash = _mutate_glb_document(package_root, mutate)

    with pytest.raises(ValueError, match="Every GLB skin must be referenced"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_weighted_joint_outside_skin_inventory(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest_hash = _mutate_accessor_bytes(
        package_root,
        accessor_index=3,
        mutation=lambda binary, offset: struct.pack_into("<B", binary, offset, 2),
    )

    with pytest.raises(ValueError, match="joint index is outside"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_tiny_positive_weight_for_joint_outside_skin_inventory(
    tmp_path: Path,
) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    _mutate_accessor_bytes(
        package_root,
        accessor_index=3,
        mutation=lambda binary, offset: struct.pack_into("<B", binary, offset + 1, 2),
    )
    manifest_hash = _mutate_accessor_bytes(
        package_root,
        accessor_index=4,
        mutation=lambda binary, offset: struct.pack_into(
            "<ffff", binary, offset, 1.0 - 1e-7, 1e-7, 0.0, 0.0
        ),
    )

    with pytest.raises(ValueError, match="joint index is outside"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_nonnormalized_skin_weights(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest_hash = _mutate_accessor_bytes(
        package_root,
        accessor_index=4,
        mutation=lambda binary, offset: struct.pack_into(
            "<ffff", binary, offset, 0.5, 0.0, 0.0, 0.0
        ),
    )

    with pytest.raises(ValueError, match="normalized per vertex"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_triangle_index_outside_vertex_inventory(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest_hash = _mutate_accessor_bytes(
        package_root,
        accessor_index=5,
        mutation=lambda binary, offset: struct.pack_into("<H", binary, offset, 65_535),
    )

    with pytest.raises(ValueError, match="indices are invalid or out of range"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_manifest_rejects_resource_policy_drift(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest = _manifest(package_root)
    values = _object(_object(manifest, "limits"), "values")
    values["nodes"] = cast(int, values["nodes"]) - 1
    manifest_hash = _write_manifest(package_root, manifest)

    with pytest.raises(ValueError, match="compiled policy ceiling"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


@pytest.mark.parametrize(
    ("path", "replacement", "message"),
    [
        (("coordinates", "meters_per_unit"), 1, "coordinate contract"),
        (("limits", "values", "skins"), True, "limits"),
        (("observed", "images"), True, "observations"),
        (("observed", "images"), 1.0, "observations"),
        (("actor", "ground_z_m"), 0, "neutral-pose contract"),
    ],
)
def test_manifest_exact_contracts_reject_json_numeric_type_aliases(
    tmp_path: Path,
    path: tuple[str, ...],
    replacement: object,
    message: str,
) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)
    manifest = _manifest(package_root)
    target = manifest
    for key in path[:-1]:
        target = _object(target, key)
    target[path[-1]] = replacement
    manifest_hash = _write_manifest(package_root, manifest)

    with pytest.raises(ValueError, match=message):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_glb_rejects_buffer_resource_declaration_outside_payload(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    generate_actor_package_fixture(package_root)

    def mutate(document: JsonObject) -> None:
        buffer = _objects(document, "buffers")[0]
        buffer["byteLength"] = cast(int, buffer["byteLength"]) + 4

    manifest_hash = _mutate_glb_document(package_root, mutate)

    with pytest.raises(ValueError, match="BIN chunk length"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256=manifest_hash,
        )


def test_inventory_rejects_deep_undeclared_directory_without_descending(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    package_root = tmp_path / "actor"
    deep = package_root / "textures" / "nested"
    for index in range(32):
        deep /= f"d{index}"
    deep.mkdir(parents=True)
    real_scandir = actor_package.os.scandir
    scanned: list[Path] = []

    def guarded_scandir(directory: Path) -> os.ScandirIterator[str]:
        current = Path(directory)
        scanned.append(current)
        if current not in {package_root, package_root / "textures"}:
            raise AssertionError("Validator descended into an undeclared directory.")
        return real_scandir(directory)

    monkeypatch.setattr(actor_package.os, "scandir", guarded_scandir)

    with pytest.raises(ValueError, match="directory shape is outside policy"):
        actor_package.verify_actor_package(
            package_root,
            expected_manifest_sha256="0" * 64,
        )

    assert scanned == [package_root, package_root / "textures"]


def test_private_snapshot_isolated_from_source_and_removed_after_use(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    scratch_root = tmp_path / "scratch"
    manifest_hash = generate_actor_package_fixture(package_root)
    source_texture = package_root / "textures/albedo.png"
    original_texture = source_texture.read_bytes()

    with actor_package.private_verified_snapshot(
        package_root,
        scratch_root,
        expected_manifest_sha256=manifest_hash,
    ) as verified:
        snapshot_root = verified.root
        assert snapshot_root != package_root
        assert snapshot_root.is_relative_to(scratch_root)
        assert verified.glb_path.is_relative_to(snapshot_root)
        source_texture.write_bytes(b"source changed after snapshot")
        assert verified.texture_paths[0].read_bytes() == original_texture

    assert not snapshot_root.exists()
    assert list(scratch_root.iterdir()) == []


@pytest.mark.skipif(os.name != "posix", reason="POSIX modes are authoritative in the worker.")
def test_private_snapshot_seals_files_and_directories_read_only(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    scratch_root = tmp_path / "scratch"
    manifest_hash = generate_actor_package_fixture(package_root)

    with actor_package.private_verified_snapshot(
        package_root,
        scratch_root,
        expected_manifest_sha256=manifest_hash,
    ) as verified:
        assert stat.S_IMODE(verified.root.stat().st_mode) == 0o500
        for path in verified.root.rglob("*"):
            expected_mode = 0o500 if path.is_dir() else 0o400
            assert stat.S_IMODE(path.stat().st_mode) == expected_mode

    assert list(scratch_root.iterdir()) == []


def test_private_snapshot_detects_post_yield_mutation_and_cleans_stage(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    scratch_root = tmp_path / "scratch"
    manifest_hash = generate_actor_package_fixture(package_root)
    snapshot_root: Path | None = None

    with pytest.raises(ValueError, match="snapshot changed while in use"):
        with actor_package.private_verified_snapshot(
            package_root,
            scratch_root,
            expected_manifest_sha256=manifest_hash,
        ) as verified:
            snapshot_root = verified.root
            snapshot_root.chmod(0o700)
            snapshot_texture = verified.texture_paths[0]
            snapshot_texture.parent.chmod(0o700)
            snapshot_texture.chmod(0o600)
            snapshot_texture.write_bytes(b"mutated verified snapshot")

    assert snapshot_root is not None
    assert not snapshot_root.exists()
    assert list(scratch_root.iterdir()) == []


def test_private_snapshot_cleans_failed_verification_stage(tmp_path: Path) -> None:
    package_root = tmp_path / "actor"
    scratch_root = tmp_path / "scratch"
    manifest_hash = generate_actor_package_fixture(package_root)
    wrong_hash = "0" * 64 if manifest_hash != "0" * 64 else "1" * 64

    with pytest.raises(ValueError, match="external trust anchor"):
        with actor_package.private_verified_snapshot(
            package_root,
            scratch_root,
            expected_manifest_sha256=wrong_hash,
        ):
            pytest.fail("Snapshot verification unexpectedly succeeded.")

    assert list(scratch_root.iterdir()) == []
