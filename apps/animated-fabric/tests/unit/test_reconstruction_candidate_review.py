"""Pure-Python tests for the bounded AF-045 Blender review boundary."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import pytest
from PIL import Image

from tools import reconstruction
from tools.blender import reconstruction_candidate_review as review

APP_ROOT = Path(__file__).resolve().parents[2]


def _minimal_glb(*, forbidden_field: str | None = None) -> bytes:
    document = {
        "accessors": [{}, {}, {}],
        "asset": {"version": "2.0"},
        "bufferViews": [{"buffer": 0, "byteLength": 4, "byteOffset": 0}],
        "buffers": [{"byteLength": 4}],
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": {"COLOR_0": 1, "POSITION": 0},
                        "indices": 2,
                        "mode": 4,
                    }
                ]
            }
        ],
        "nodes": [{"mesh": 0}],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
    }
    if forbidden_field is not None:
        document[forbidden_field] = []
    encoded = json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")
    json_chunk = encoded + b" " * ((-len(encoded)) % 4)
    binary_chunk = b"\x00" * 4
    length = 12 + 8 + len(json_chunk) + 8 + len(binary_chunk)
    return (
        struct.pack("<4sII", b"glTF", 2, length)
        + struct.pack("<I4s", len(json_chunk), b"JSON")
        + json_chunk
        + struct.pack("<I4s", len(binary_chunk), b"BIN\x00")
        + binary_chunk
    )


def _write_candidate(root: Path) -> dict[str, object]:
    root.mkdir()
    input_path = root / "input.png"
    Image.new("RGB", review.NORMALIZED_SIZE, (128, 128, 128)).save(
        input_path,
        format="PNG",
        compress_level=9,
    )
    mesh_path = root / "mesh.glb"
    mesh_path.write_bytes(_minimal_glb())
    document: dict[str, object] = {
        "candidate_id": "macaw-front-triposr-r1",
        "format": review.CANDIDATE_FORMAT,
        "mesh": {
            "bytes": mesh_path.stat().st_size,
            "media_type": "model/gltf-binary",
            "path": "mesh.glb",
            "sha256": review.sha256_file(mesh_path),
            "triangles": 12,
            "vertices": 8,
        },
        "parameters": {
            "chunk_size": 4096,
            "device": "cuda:0",
            "foreground_ratio": 0.85,
            "mc_resolution": 256,
            "vertex_colors": True,
        },
        "preprocessing": {
            "alpha_bottom": 180,
            "alpha_left": 10,
            "alpha_right": 90,
            "alpha_top": 20,
            "canvas_size": 512,
            "foreground_ratio": 0.85,
            "normalized_height": 435,
            "normalized_width": 218,
            "offset_x": 147,
            "offset_y": 38,
            "output": "input.png",
            "output_bytes": input_path.stat().st_size,
            "output_sha256": review.sha256_file(input_path),
            "source_height": 200,
            "source_width": 100,
        },
        "provider": dict(review.EXPECTED_PROVIDER),
        "review": {
            "decision": "pending",
            "notes": review.PROPOSAL_NOTE,
        },
        "runtime": {
            "cuda_version": "11.8",
            "elapsed_seconds": 4.125,
            "gpu_name": "fixture GPU",
            "peak_cuda_bytes": 5_000_000,
            "torch_version": "2.2.2+cu118",
        },
        "schema_version": review.CANDIDATE_SCHEMA_VERSION,
        "source": {
            "bytes": 1,
            "path": "source.png",
            "sha256": "0" * 64,
        },
        "status": "proposal",
    }
    (root / "candidate.json").write_bytes(review.canonical_json_bytes(document))
    return document


def _write_document(root: Path, document: dict[str, object]) -> None:
    (root / "candidate.json").write_bytes(review.canonical_json_bytes(document))


def test_review_provider_identity_matches_the_reconstruction_runtime() -> None:
    assert review.EXPECTED_PROVIDER == {
        "dino_model_id": reconstruction.DINO_MODEL_ID,
        "dino_model_revision": reconstruction.DINO_MODEL_REVISION,
        "id": "triposr",
        "model_id": reconstruction.TRIPOSR_MODEL_ID,
        "model_revision": reconstruction.TRIPOSR_MODEL_REVISION,
        "pymcubes_version": reconstruction.PYMCUBES_VERSION,
        "pymcubes_wheel_sha256": reconstruction.PYMCUBES_WHEEL_SHA256,
        "source_revision": reconstruction.TRIPOSR_SOURCE_REVISION,
    }


def test_verify_candidate_binds_exact_files_and_hashes(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    _write_candidate(root)

    proposal = review.verify_candidate(root)

    assert proposal.candidate_id == "macaw-front-triposr-r1"
    assert proposal.input_path == (root / "input.png").resolve()
    assert proposal.mesh_path == (root / "mesh.glb").resolve()
    assert proposal.vertices == 8
    assert proposal.triangles == 12
    assert proposal.manifest_sha256 == review.sha256_file(root / "candidate.json")
    assert dict(proposal.provider) == review.EXPECTED_PROVIDER


def test_verify_candidate_binds_the_selected_directory_identity(tmp_path: Path) -> None:
    root = tmp_path / "renamed-proposal"
    _write_candidate(root)

    with pytest.raises(ValueError, match="selected proposal directory"):
        review.verify_candidate(root, expected_candidate_id="different-candidate")


def test_verify_candidate_requires_the_pinned_provider(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    provider = document["provider"]
    assert isinstance(provider, dict)
    provider["model_revision"] = "0" * 40
    _write_document(root, document)

    with pytest.raises(ValueError, match="pinned AF-045 baseline"):
        review.verify_candidate(root)


def test_verify_candidate_rejects_an_unexpected_file(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    _write_candidate(root)
    (root / "texture.png").write_bytes(b"not approved")

    with pytest.raises(ValueError, match="exact AF-045 file set"):
        review.verify_candidate(root)


def test_verify_candidate_rejects_a_changed_mesh(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    _write_candidate(root)
    with (root / "mesh.glb").open("ab") as stream:
        stream.write(b"changed")

    with pytest.raises(ValueError, match="GLB disagrees"):
        review.verify_candidate(root)


def test_verify_candidate_rejects_glb_texture_or_behavior_fields(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    mesh_path = root / "mesh.glb"
    mesh_path.write_bytes(_minimal_glb(forbidden_field="images"))
    mesh = document["mesh"]
    assert isinstance(mesh, dict)
    mesh["bytes"] = mesh_path.stat().st_size
    mesh["sha256"] = review.sha256_file(mesh_path)
    _write_document(root, document)

    with pytest.raises(ValueError, match="must not declare images"):
        review.verify_candidate(root)


def test_verify_candidate_rejects_noncanonical_json(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    _write_candidate(root)
    manifest = root / "candidate.json"
    manifest.write_bytes(manifest.read_bytes() + b"\n")

    with pytest.raises(ValueError, match="canonical JSON"):
        review.verify_candidate(root)


def test_verify_candidate_requires_vertex_colors_and_pending_review(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    parameters = document["parameters"]
    assert isinstance(parameters, dict)
    parameters["vertex_colors"] = False
    _write_document(root, document)

    with pytest.raises(ValueError, match="vertex colors"):
        review.verify_candidate(root)

    parameters["vertex_colors"] = True
    review_record = document["review"]
    assert isinstance(review_record, dict)
    review_record["decision"] = "accepted"
    _write_document(root, document)
    with pytest.raises(ValueError, match="remain pending"):
        review.verify_candidate(root)


@pytest.mark.parametrize(
    ("section", "removed_key"),
    [
        ("source", "sha256"),
        ("preprocessing", "alpha_left"),
        ("mesh", "media_type"),
        ("runtime", "cuda_version"),
        ("review", "notes"),
    ],
)
def test_verify_candidate_requires_every_nested_producer_field(
    tmp_path: Path,
    section: str,
    removed_key: str,
) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    record = document[section]
    assert isinstance(record, dict)
    record.pop(removed_key)
    _write_document(root, document)

    with pytest.raises(ValueError, match=f"{section} has unexpected or missing fields"):
        review.verify_candidate(root)


@pytest.mark.parametrize("section", ["source", "preprocessing", "mesh", "runtime", "review"])
def test_verify_candidate_rejects_extra_nested_producer_fields(
    tmp_path: Path,
    section: str,
) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    record = document[section]
    assert isinstance(record, dict)
    record["unexpected"] = "not produced"
    _write_document(root, document)

    with pytest.raises(ValueError, match=f"{section} has unexpected or missing fields"):
        review.verify_candidate(root)


@pytest.mark.parametrize("invalid_path", ["../escaped.png", ".", "nested\\source.png"])
def test_verify_candidate_rejects_unsafe_source_paths(
    tmp_path: Path,
    invalid_path: str,
) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    source = document["source"]
    assert isinstance(source, dict)
    source["path"] = invalid_path
    _write_document(root, document)

    with pytest.raises(ValueError, match="canonical relative POSIX path"):
        review.verify_candidate(root)


def test_verify_candidate_requires_positive_source_bytes(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    source = document["source"]
    assert isinstance(source, dict)
    source["bytes"] = 0
    _write_document(root, document)

    with pytest.raises(ValueError, match=r"source\.bytes is outside policy"):
        review.verify_candidate(root)


def test_verify_candidate_validates_preprocessing_geometry_and_parameter_binding(
    tmp_path: Path,
) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    preprocessing = document["preprocessing"]
    assert isinstance(preprocessing, dict)
    preprocessing["offset_x"] = 0
    _write_document(root, document)

    with pytest.raises(ValueError, match="normalized foreground is not centered"):
        review.verify_candidate(root)

    preprocessing["offset_x"] = 147
    preprocessing["foreground_ratio"] = 0.8
    _write_document(root, document)
    with pytest.raises(ValueError, match="foreground ratios disagree"):
        review.verify_candidate(root)


@pytest.mark.parametrize(
    ("key", "value", "message"),
    [
        ("elapsed_seconds", -0.001, "cannot be negative"),
        ("gpu_name", "", "bounded non-empty string"),
        ("peak_cuda_bytes", 0, "outside policy"),
    ],
)
def test_verify_candidate_validates_runtime_observations(
    tmp_path: Path,
    key: str,
    value: object,
    message: str,
) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    runtime = document["runtime"]
    assert isinstance(runtime, dict)
    runtime[key] = value
    _write_document(root, document)

    with pytest.raises(ValueError, match=message):
        review.verify_candidate(root)


def test_verify_candidate_preserves_the_proposal_disclaimer(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    review_record = document["review"]
    assert isinstance(review_record, dict)
    review_record["notes"] = "Recovered hidden truth."
    _write_document(root, document)

    with pytest.raises(ValueError, match="generated-geometry disclaimer"):
        review.verify_candidate(root)


def test_verify_candidate_checks_the_normalized_png_contract(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)
    input_path = root / "input.png"
    Image.new("RGBA", review.NORMALIZED_SIZE, (128, 128, 128, 255)).save(input_path)
    preprocessing = document["preprocessing"]
    assert isinstance(preprocessing, dict)
    preprocessing["output_bytes"] = input_path.stat().st_size
    preprocessing["output_sha256"] = review.sha256_file(input_path)
    _write_document(root, document)

    with pytest.raises(ValueError, match="canonical 512 px RGB"):
        review.verify_candidate(root)


def test_framing_uses_one_shared_scale_for_every_fixed_view() -> None:
    framing = review.framing_from_bounds((-1.0, -2.0, 0.0), (1.0, 2.0, 3.0))

    assert framing.target == (0.0, 0.0, 1.5)
    assert framing.ortho_scale == pytest.approx(math.sqrt(29.0) * 1.12)
    assert [view.view_id for view in review.VIEW_SPECS] == [
        "front",
        "left",
        "back",
        "front-right-3q",
    ]
    assert [view.direction for view in review.VIEW_SPECS] == [
        (1.0, 0.0, 0.0),
        (0.0, -1.0, 0.0),
        (-1.0, 0.0, 0.0),
        (math.sqrt(0.5), math.sqrt(0.5), 0.0),
    ]
    for view in review.VIEW_SPECS:
        location = review.camera_location(framing, view)
        distance = math.dist(location, framing.target)
        assert distance == pytest.approx(framing.camera_distance)


@pytest.mark.parametrize(
    ("minimum", "maximum", "message"),
    [
        ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), "degenerate"),
        ((1.0, 0.0, 0.0), (0.0, 1.0, 1.0), "inverted"),
        ((0.0, 0.0, 0.0), (math.inf, 1.0, 1.0), "finite"),
    ],
)
def test_framing_rejects_unsafe_bounds(
    minimum: tuple[float, float, float],
    maximum: tuple[float, float, float],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        review.framing_from_bounds(minimum, maximum)


def test_worker_and_runner_preserve_the_isolated_review_boundary() -> None:
    worker = (APP_ROOT / "tools/blender/render_reconstruction_candidate.py").read_text(
        encoding="utf-8"
    )
    runner = (APP_ROOT / "scripts/run_reconstruction_candidate_review.sh").read_text(
        encoding="utf-8"
    )

    assert "actor_package.assert_linux_read_only_mount(CANDIDATE_ROOT)" in worker
    assert "_assert_runtime_network_isolated()" in worker
    assert 'nodes.new(type="ShaderNodeVertexColor")' in worker
    assert "Imported AF-045 topology disagrees with candidate.json." in worker
    assert "bpy.data.images.load(filepath=str(path), check_existing=False)" in worker
    assert 'bpy.data.images.get("Render Result")' not in worker
    assert "camera_up = world_up - forward * world_up.dot(forward)" in worker
    assert "SOURCE_TO_REVIEW_ROTATION_DEGREES_X = -90.0" in worker
    assert "_normalize_import_orientation(meshes)" in worker
    assert '"source_to_review_rotation_degrees_xyz"' in worker
    assert '"x": "front"' in worker
    assert worker.index("canonicalize_rgba_png(destination") < worker.index(
        "_rendered_png_observations(destination)"
    )
    assert '"actor_package.py"' in worker
    assert '"evidence.py"' in worker
    assert "--disable-autoexec" in runner
    assert "--offline-mode" in runner
    assert '"$candidate_root:/candidate:ro"' in runner
    assert "--entrypoint /opt/blender/blender" in runner
    assert "animated-fabric-blender" in runner
    assert "animated-fabric-blender-macaw-actor-validator" not in runner
    assert '--expected-candidate-id "$candidate_id"' in runner


def test_candidate_manifest_fixture_is_json_round_trip_safe(tmp_path: Path) -> None:
    root = tmp_path / "proposal"
    document = _write_candidate(root)

    decoded = json.loads((root / "candidate.json").read_text(encoding="utf-8"))

    assert decoded == document
