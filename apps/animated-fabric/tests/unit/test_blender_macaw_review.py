"""Pure-Python AF-056 evidence, contact-sheet, and isolation tests."""

from __future__ import annotations

import copy
import json
import os
import struct
import zlib
from collections.abc import Callable
from pathlib import Path

import pytest
from PIL import Image

from scripts import verify_macaw_actor_review as verifier

APP_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = APP_ROOT / "assets/actor-packages/macaw-traveler-avian-v1/package"


def _write_json(path: Path, document: dict[str, object]) -> None:
    path.write_bytes(
        (
            json.dumps(document, allow_nan=False, ensure_ascii=True, indent=2, sort_keys=True)
            + "\n"
        ).encode("utf-8")
    )


def _report(path: Path) -> dict[str, object]:
    document = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return document


def _object(document: dict[str, object], key: str) -> dict[str, object]:
    value = document[key]
    assert isinstance(value, dict)
    return value


def _objects(document: dict[str, object], key: str) -> list[dict[str, object]]:
    value = document[key]
    assert isinstance(value, list)
    assert all(isinstance(item, dict) for item in value)
    return value


def _deformation_document(
    poses: verifier.avian_contract.ReviewPoseContract,
    verified: verifier.actor_package.VerifiedActorPackage,
) -> dict[str, object]:
    bones = verifier.avian_contract.BONE_ORDER[1:]
    topology = {key: verified.observations[key] for key in ("indices", "triangles", "vertices")}
    result: dict[str, object] = {}
    for index, pose in enumerate(poses.poses):
        maximum = {bone_id: 0.0 for bone_id in bones}
        if pose.rotations:
            for rotation in pose.rotations:
                maximum[rotation.bone_id] = 0.05
        minimum = {bone_id: 0.2 for bone_id in bones}
        minimum["foot_l"] = 0.0
        minimum["foot_r"] = 0.0
        result[pose.pose_id] = {
            "bounds_m": copy.deepcopy(verified.observations["actor_bounds_m"]),
            "geometry_sha256": verifier._sha256_bytes(f"geometry-{index}".encode()),
            "max_vertex_displacement_m": 0.0 if not pose.rotations else 0.05,
            "maximum_displacement_by_bone_m": maximum,
            "minimum_z_by_bone_m": minimum,
            "minimum_z_m": 0.0,
            "rotations": [
                {
                    "bone_id": rotation.bone_id,
                    "local_euler_xyz_deg": list(rotation.local_euler_xyz_deg),
                }
                for rotation in pose.rotations
            ],
            "topology": topology,
        }
    return result


def _write_evidence(root: Path) -> Path:
    root.mkdir()
    verified = verifier.actor_package.verify_actor_package(
        PACKAGE_ROOT,
        expected_manifest_sha256=verifier.EXPECTED_MANIFEST_SHA256,
    )
    rig = verifier.avian_contract.load_rig_contract()
    poses = verifier.avian_contract.load_review_poses()
    mapping, mapping_sha256 = verifier.avian_contract.verify_mapping_document(
        verifier.MAPPING_PATH, verified, rig
    )
    frames: list[dict[str, object]] = []
    frame_hashes: dict[str, str] = {}
    total_bytes = 0
    for index, (pose_id, view_id) in enumerate(verifier.FRAME_ORDER):
        path = root / f"{pose_id}--{view_id}.png"
        image = Image.new("RGBA", verifier.FRAME_SIZE, (0, 0, 0, 0))
        color = ((index * 31 + 25) % 255, (index * 47 + 60) % 255, 180, 255)
        image.paste(color, (32 + index % 4, 36 + index // 4, 220, 224))
        image.save(path, format="PNG", optimize=False, compress_level=9)
        observations, _ = verifier._inspect_frame(path)
        frames.append(
            {
                "camera_location": list(verifier.VIEW_LOCATIONS[view_id]),
                "path": path.name,
                "pose_id": pose_id,
                "view_id": view_id,
                **observations,
            }
        )
        frame_hashes[path.name] = str(observations["sha256"])
        total_bytes += int(observations["bytes"])
    document: dict[str, object] = {
        "blender": {
            "archive_sha256": verifier.evidence.BLENDER_ARCHIVE_SHA256,
            "color_transform": "AgX Medium High Contrast",
            "render_engine": "BLENDER_EEVEE_NEXT",
            "samples": 8,
            "threads": 1,
            "version": verifier.evidence.BLENDER_VERSION,
        },
        "container": {
            "image": "caatuu-animated-fabric-blender-macaw-actor-validator:4.5.12",
            "input_mount": "read-only",
            "platform": verifier.evidence.CONTAINER_PLATFORM,
            "private_snapshot": True,
            "runtime_network": "none",
        },
        "deformation": _deformation_document(poses, verified),
        "format": verifier.VALIDATION_FORMAT,
        "imported": {
            "armatures": verified.observations["skins"],
            "images": verified.observations["images"],
            "materials": verified.observations["materials"],
            "meshes": verified.observations["meshes"],
            "objects": 2,
            "world_bounds_m": verified.observations["actor_bounds_m"],
        },
        "outputs": {
            "frame_count": len(verifier.FRAME_PATHS),
            "frame_sha256": frame_hashes,
            "frame_total_bytes": total_bytes,
            "max_evidence_bytes": verifier.MAX_EVIDENCE_BYTES,
            "max_frame_bytes": verifier.MAX_FRAME_BYTES,
        },
        "package": {
            "content_set_sha256": verified.content_set_sha256,
            "expected_manifest_sha256": verifier.EXPECTED_MANIFEST_SHA256,
            "files": dict(verified.file_sha256),
            "id": verified.actor_id,
            "manifest_sha256": verified.manifest_sha256,
            "observed": dict(verified.observations),
        },
        "reference": {
            "approval_sha256": verifier.avian_contract.REFERENCE_APPROVAL_SHA256,
            "manifest_sha256": verifier.avian_contract.REFERENCE_MANIFEST_SHA256,
            "ordered_view_set_sha256": verifier.avian_contract.REFERENCE_VIEW_SET_SHA256,
            "package_id": verifier.avian_contract.REFERENCE_PACKAGE_ID,
            "source_approval_sha256": verifier.avian_contract.REFERENCE_SOURCE_APPROVAL_SHA256,
        },
        "review": {
            "camera_orthographic_scale": 2.75,
            "camera_target": [0.0, 0.0, 1.02],
            "frame_size": list(verifier.FRAME_SIZE),
            "frames": frames,
            "pose_contract_sha256": poses.sha256,
            "pose_order": list(verifier.avian_contract.POSE_ORDER),
            "transparent": True,
            "view_order": list(verifier.VIEW_ORDER),
        },
        "rig": {
            "contract_sha256": rig.sha256,
            "id": verifier.avian_contract.RIG_ID,
            "mapping_sha256": mapping_sha256,
            "vertex_skin_sha256": mapping["vertex_skin_sha256"],
        },
        "schema_version": verifier.VALIDATION_SCHEMA_VERSION,
        "ticket": "AF-056",
        "trusted_sources": verifier._trusted_sources(),
    }
    report_path = root / "validation.json"
    _write_json(report_path, document)
    return report_path


def test_verifier_accepts_bound_evidence_and_writes_only_explicit_contact_sheet(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    source = tmp_path / "evidence"
    _write_evidence(source)
    summary = verifier.verify_macaw_actor_review(source, PACKAGE_ROOT)

    assert summary["frame_count"] == 16
    assert summary["manifest_sha256"] == verifier.EXPECTED_MANIFEST_SHA256
    assert set(tmp_path.iterdir()) == {source}

    sheet = tmp_path / "review.png"
    with_sheet = verifier.verify_macaw_actor_review(source, PACKAGE_ROOT, sheet)
    first = sheet.read_bytes()
    assert with_sheet["contact_sheet"]["sha256"] == verifier._sha256(sheet)  # type: ignore[index]
    with Image.open(sheet) as image:
        image.load()
        assert image.mode == "RGBA"
        assert image.size == (1024, 1024)
        for index, name in enumerate(verifier.FRAME_PATHS):
            with Image.open(source / name) as frame:
                expected = frame.getpixel((128, 128))
            assert image.getpixel(((index % 4) * 256 + 128, (index // 4) * 256 + 128)) == expected
    verifier.verify_macaw_actor_review(source, PACKAGE_ROOT, sheet)
    assert sheet.read_bytes() == first

    assert (
        verifier.main(
            ["--source", str(source), "--package", str(PACKAGE_ROOT), "--contact-sheet", str(sheet)]
        )
        == 0
    )
    assert json.loads(capsys.readouterr().out)["frame_count"] == 16


@pytest.mark.parametrize("kind", ["extra-file", "extra-directory", "symlink", "hardlink"])
def test_verifier_rejects_open_or_linked_evidence_trees(tmp_path: Path, kind: str) -> None:
    source = tmp_path / "evidence"
    _write_evidence(source)
    if kind == "extra-file":
        (source / "extra.txt").write_text("extra", encoding="utf-8")
    elif kind == "extra-directory":
        (source / "extra").mkdir()
    elif kind == "symlink":
        target = tmp_path / "outside.png"
        target.write_bytes((source / verifier.FRAME_PATHS[0]).read_bytes())
        linked = source / verifier.FRAME_PATHS[0]
        linked.unlink()
        try:
            linked.symlink_to(target)
        except OSError:
            pytest.skip("Filesystem does not permit symlinks.")
    else:
        linked = source / verifier.FRAME_PATHS[1]
        linked.unlink()
        try:
            os.link(source / verifier.FRAME_PATHS[0], linked)
        except OSError:
            pytest.skip("Filesystem does not permit hard links.")

    with pytest.raises(ValueError, match="extra|unexpected|link"):
        verifier.verify_macaw_actor_review(source, PACKAGE_ROOT)


@pytest.mark.parametrize(
    "malformation", ["crlf-json", "duplicate-key", "png-ancillary", "png-trailing"]
)
def test_verifier_rejects_noncanonical_json_and_png(tmp_path: Path, malformation: str) -> None:
    source = tmp_path / "evidence"
    report_path = _write_evidence(source)
    if malformation == "crlf-json":
        report_path.write_bytes(report_path.read_bytes().replace(b"\n", b"\r\n"))
    elif malformation == "duplicate-key":
        payload = report_path.read_bytes()
        report_path.write_bytes(payload[:-2] + b',\n  "ticket": "AF-056"\n}\n')
    else:
        path = source / verifier.FRAME_PATHS[0]
        payload = path.read_bytes()
        if malformation == "png-trailing":
            path.write_bytes(payload + b"trailing")
        else:
            length = struct.unpack_from(">I", payload, 8)[0]
            insertion = 8 + 12 + length
            chunk_type = b"tEXt"
            data = b"key\0value"
            crc = zlib.crc32(data, zlib.crc32(chunk_type)) & 0xFFFFFFFF
            chunk = struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)
            path.write_bytes(payload[:insertion] + chunk + payload[insertion:])

    with pytest.raises(ValueError, match="canonically|Duplicate JSON key|PNG"):
        verifier.verify_macaw_actor_review(source, PACKAGE_ROOT)


def test_verifier_rejects_oversize_and_pixel_tampering(tmp_path: Path) -> None:
    source = tmp_path / "evidence"
    _write_evidence(source)
    (source / verifier.FRAME_PATHS[0]).write_bytes(b"x" * (verifier.MAX_FRAME_BYTES + 1))
    with pytest.raises(ValueError, match="byte ceiling"):
        verifier.verify_macaw_actor_review(source, PACKAGE_ROOT)

    second = tmp_path / "second"
    _write_evidence(second)
    target = second / verifier.FRAME_PATHS[0]
    with Image.open(target) as original:
        changed = original.copy()
    changed.putpixel((128, 128), (255, 0, 0, 255))
    changed.save(target, format="PNG", optimize=False, compress_level=9)
    with pytest.raises(ValueError, match="frame record"):
        verifier.verify_macaw_actor_review(second, PACKAGE_ROOT)


def _mutate_package(report: dict[str, object]) -> None:
    _object(report, "package")["manifest_sha256"] = "0" * 64


def _mutate_reference(report: dict[str, object]) -> None:
    _object(report, "reference")["approval_sha256"] = "0" * 64


def _mutate_rig(report: dict[str, object]) -> None:
    _object(report, "rig")["mapping_sha256"] = "0" * 64


def _mutate_container(report: dict[str, object]) -> None:
    _object(report, "container")["runtime_network"] = "default"


def _mutate_source(report: dict[str, object]) -> None:
    _object(report, "trusted_sources")["render_macaw_actor_review.py"] = "0" * 64


def _mutate_import(report: dict[str, object]) -> None:
    _object(report, "imported")["objects"] = 3


def _mutate_deformation(report: dict[str, object]) -> None:
    deformation = _object(report, "deformation")
    wing = _object(deformation, "wing-extreme")
    _object(wing, "maximum_displacement_by_bone_m")["foot_l"] = 0.1
    wing["max_vertex_displacement_m"] = 0.1


def _mutate_outputs(report: dict[str, object]) -> None:
    _object(report, "outputs")["frame_count"] = 15


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (_mutate_package, "exact actor package"),
        (_mutate_reference, "approved reference"),
        (_mutate_rig, "exact avian rig"),
        (_mutate_container, "isolation"),
        (_mutate_source, "trusted worker sources"),
        (_mutate_import, "imported Blender"),
        (_mutate_deformation, "fixed foot"),
        (_mutate_outputs, "output hashes"),
    ],
)
def test_verifier_rejects_tampered_contract_records(
    tmp_path: Path,
    mutate: Callable[[dict[str, object]], None],
    message: str,
) -> None:
    source = tmp_path / "evidence"
    report_path = _write_evidence(source)
    report = _report(report_path)
    mutate(report)
    _write_json(report_path, report)

    with pytest.raises(ValueError, match=message):
        verifier.verify_macaw_actor_review(source, PACKAGE_ROOT)


def test_contact_sheet_rejects_protected_or_linked_destinations(tmp_path: Path) -> None:
    source = tmp_path / "evidence"
    _write_evidence(source)
    protected_child = source / "new" / "sheet.png"
    with pytest.raises(ValueError, match="outside evidence"):
        verifier.verify_macaw_actor_review(source, PACKAGE_ROOT, protected_child)
    assert not protected_child.parent.exists()

    directory_alias = tmp_path / "directory-alias"
    try:
        directory_alias.symlink_to(source, target_is_directory=True)
    except OSError:
        pytest.skip("Filesystem does not permit symlinks.")
    escaped_child = directory_alias / "new" / "sheet.png"
    with pytest.raises(ValueError, match="existing real directory"):
        verifier.verify_macaw_actor_review(source, PACKAGE_ROOT, escaped_child)
    assert not (source / "new").exists()

    target = tmp_path / "target.png"
    target.write_bytes(b"previous")
    alias = tmp_path / "alias.png"
    try:
        alias.symlink_to(target)
    except OSError:
        pytest.skip("Filesystem does not permit symlinks.")
    with pytest.raises(ValueError, match="must not be a link"):
        verifier.verify_macaw_actor_review(source, PACKAGE_ROOT, alias)
    assert target.read_bytes() == b"previous"


def _compose_service(source: str, service: str) -> str:
    marker = f"  {service}:\n"
    start = source.index(marker)
    remainder = source[start + len(marker) :]
    lines = remainder.splitlines(keepends=True)
    stop = next(
        (
            index
            for index, line in enumerate(lines)
            if line.startswith("  ") and not line.startswith("    ") and line.rstrip().endswith(":")
        ),
        len(lines),
    )
    return marker + "".join(lines[:stop])


def test_parser_and_container_keep_the_macaw_worker_fixed_and_isolated() -> None:
    parser = verifier.build_parser()
    arguments = parser.parse_args(["--source", "evidence", "--package", "package"])
    assert arguments.contact_sheet is None
    for override in ("--worker", "--mapping", "--render-engine", "--golden"):
        with pytest.raises(SystemExit):
            parser.parse_args(["--source", "evidence", "--package", "package", override, "x"])

    dockerfile = (APP_ROOT / "containers/blender/Dockerfile").read_text(encoding="utf-8")
    compose = (APP_ROOT / "compose.yaml").read_text(encoding="utf-8")
    service = _compose_service(compose, "animated-fabric-blender-macaw-actor-validator")
    worker = (APP_ROOT / "tools/blender/render_macaw_actor_review.py").read_text(encoding="utf-8")
    assert "FROM blender-runtime-base AS macaw-actor-validator" in dockerfile
    assert '"--disable-autoexec"' in dockerfile
    assert '"--offline-mode"' in dockerfile
    assert '"/opt/animated-fabric/render_macaw_actor_review.py"' in dockerfile
    assert "target: macaw-actor-validator" in service
    assert "./assets/actor-packages/macaw-traveler-avian-v1/package:/actor-package:ro" in service
    assert "network_mode: none" in service
    assert "read_only: true" in service
    assert "cap_drop:\n      - ALL" in service
    assert "no-new-privileges:true" in service
    assert "/tmp:rw,noexec,nosuid,nodev" in service
    assert "ports:" not in service and "docker.sock" not in service
    assert 'command: ["--out", "/output/af056-review"]' in service
    assert worker.count('add_argument("--out"') == 1
    for forbidden in ('add_argument("--package"', 'add_argument("--worker"', "docker.sock"):
        assert forbidden not in worker
