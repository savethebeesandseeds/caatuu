"""Pure-Python verification and static isolation tests for AF-055 neutral evidence."""

from __future__ import annotations

import hashlib
import json
import struct
import zlib
from collections.abc import Callable
from pathlib import Path

import pytest
from PIL import Image

from scripts.generate_actor_package_fixture import generate_actor_package_fixture
from scripts.verify_blender_actor_neutral import (
    DEFAULT_GOLDEN,
    DEFAULT_GOLDEN_PROVENANCE,
    FRAME_SIZE,
    MAX_CHANGED_PIXEL_FRACTION,
    MAX_CHANNEL_DELTA,
    MAX_NEUTRAL_BYTES,
    MAX_VALIDATION_BYTES,
    _verify_golden,
    _verify_golden_provenance,
    build_parser,
    main,
    verify_actor_neutral,
)
from tools.blender import actor_package, evidence

APP_ROOT = Path(__file__).resolve().parents[2]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_canonical_json(path: Path, document: dict[str, object]) -> None:
    path.write_bytes(
        (
            json.dumps(
                document,
                allow_nan=False,
                ensure_ascii=True,
                indent=2,
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8")
    )


@pytest.fixture(scope="module")
def generated_package(tmp_path_factory: pytest.TempPathFactory) -> Path:
    package_root = tmp_path_factory.mktemp("af055-package") / "geometric-fixture-v1"

    manifest_sha256 = generate_actor_package_fixture(package_root)

    assert manifest_sha256 == actor_package.AF055_FIXTURE_MANIFEST_SHA256
    return package_root


def _trusted_source_hashes() -> dict[str, str]:
    return {
        "actor_package.py": _sha256(APP_ROOT / "tools/blender/actor_package.py"),
        "compose.yaml": _sha256(APP_ROOT / "compose.yaml"),
        "container.Dockerfile": _sha256(APP_ROOT / "containers/blender/Dockerfile"),
        "evidence.py": _sha256(APP_ROOT / "tools/blender/evidence.py"),
        "motion.py": _sha256(APP_ROOT / "tools/blender/motion.py"),
        "output_paths.py": _sha256(APP_ROOT / "tools/blender/output_paths.py"),
        "png_canonical.py": _sha256(APP_ROOT / "tools/blender/png_canonical.py"),
        "render_actor_package.py": _sha256(APP_ROOT / "tools/blender/render_actor_package.py"),
    }


def _write_neutral_evidence(root: Path, package_root: Path) -> tuple[Path, Path]:
    root.mkdir()
    neutral_path = root / "neutral.png"
    image = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    image.paste((35, 120, 205, 255), (64, 32, 128, 160))
    image.save(neutral_path, format="PNG", optimize=False, compress_level=9)

    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=actor_package.AF055_FIXTURE_MANIFEST_SHA256,
    )
    expected_files = {path: digest for path, digest in verified.file_sha256}
    document: dict[str, object] = {
        "blender": {
            "archive_sha256": evidence.BLENDER_ARCHIVE_SHA256,
            "color_transform": "AgX Medium High Contrast",
            "render_engine": "BLENDER_EEVEE_NEXT",
            "samples": 16,
            "threads": 1,
            "version": evidence.BLENDER_VERSION,
        },
        "container": {
            "image": "caatuu-animated-fabric-blender-actor-validator:4.5.12",
            "input_mount": "read-only",
            "platform": evidence.CONTAINER_PLATFORM,
            "private_snapshot": True,
            "runtime_network": "none",
        },
        "format": "animated-fabric.actor-validation.v1",
        "imported": {
            "armatures": verified.observations["skins"],
            "images": verified.observations["images"],
            "materials": verified.observations["materials"],
            "meshes": verified.observations["meshes"],
            "objects": 2,
            "world_bounds_m": verified.observations["actor_bounds_m"],
        },
        "output": {
            "alpha_bounds_xyxy": [64, 32, 127, 159],
            "bytes": neutral_path.stat().st_size,
            "height_px": FRAME_SIZE[1],
            "mode": "RGBA8",
            "nontransparent_pixels": 64 * 128,
            "path": "neutral.png",
            "sha256": _sha256(neutral_path),
            "width_px": FRAME_SIZE[0],
        },
        "package": {
            "content_set_sha256": verified.content_set_sha256,
            "expected_manifest_sha256": actor_package.AF055_FIXTURE_MANIFEST_SHA256,
            "files": expected_files,
            "id": verified.actor_id,
            "manifest_sha256": verified.manifest_sha256,
            "observed": dict(verified.observations),
        },
        "render": {
            "camera_location": [3.2, 5.2, 2.7],
            "camera_orthographic_scale": 2.45,
            "camera_target": [0.0, 0.0, 0.9],
            "frame_size": list(FRAME_SIZE),
            "pose": "rest",
            "transparent": True,
        },
        "schema_version": "0.1.0",
        "ticket": "AF-055",
        "trusted_sources": _trusted_source_hashes(),
    }
    report_path = root / "validation.json"
    _write_canonical_json(report_path, document)
    return neutral_path, report_path


def _load_report(path: Path) -> dict[str, object]:
    document = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return document


def _report_object(document: dict[str, object], key: str) -> dict[str, object]:
    value = document[key]
    assert isinstance(value, dict)
    return value


def test_neutral_verifier_accepts_exact_bound_evidence_and_cli(
    tmp_path: Path,
    generated_package: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    evidence_root = tmp_path / "evidence"
    neutral_path, report_path = _write_neutral_evidence(evidence_root, generated_package)
    golden_path = tmp_path / "golden.png"
    golden_path.write_bytes(neutral_path.read_bytes())

    summary = verify_actor_neutral(evidence_root, generated_package, golden_path)

    assert summary == {
        "changed_pixel_fraction": 0.0,
        "content_set_sha256": actor_package.verify_actor_package(
            generated_package,
            expected_manifest_sha256=actor_package.AF055_FIXTURE_MANIFEST_SHA256,
        ).content_set_sha256,
        "manifest_sha256": actor_package.AF055_FIXTURE_MANIFEST_SHA256,
        "maximum_channel_delta": 0,
        "neutral_sha256": _sha256(neutral_path),
        "validation_sha256": _sha256(report_path),
    }
    assert (
        main(
            [
                "--source",
                str(evidence_root),
                "--package",
                str(generated_package),
                "--golden",
                str(golden_path),
            ]
        )
        == 0
    )
    cli_summary = json.loads(capsys.readouterr().out)
    assert cli_summary == summary


@pytest.mark.parametrize(
    ("unexpected_kind", "message"),
    [
        ("file", "exactly neutral.png and validation.json"),
        ("directory", "must not contain subdirectories"),
    ],
)
def test_neutral_verifier_requires_an_exact_closed_output_tree(
    tmp_path: Path,
    generated_package: Path,
    unexpected_kind: str,
    message: str,
) -> None:
    evidence_root = tmp_path / "evidence"
    neutral_path, _ = _write_neutral_evidence(evidence_root, generated_package)
    golden_path = tmp_path / "golden.png"
    golden_path.write_bytes(neutral_path.read_bytes())
    unexpected = evidence_root / "unexpected"
    if unexpected_kind == "file":
        unexpected.write_text("unexpected", encoding="utf-8")
    else:
        unexpected.mkdir()

    with pytest.raises(ValueError, match=message):
        verify_actor_neutral(evidence_root, generated_package, golden_path)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda report: _report_object(report, "package").__setitem__("id", "other-actor"),
        lambda report: _report_object(report, "package").__setitem__("manifest_sha256", "0" * 64),
        lambda report: _report_object(report, "package").__setitem__(
            "content_set_sha256", "0" * 64
        ),
        lambda report: _report_object(report, "package").__setitem__(
            "files", {"actor.glb": "0" * 64}
        ),
        lambda report: _report_object(_report_object(report, "package"), "observed").__setitem__(
            "images", True
        ),
    ],
)
def test_neutral_report_is_bound_to_the_exact_actor_package(
    tmp_path: Path,
    generated_package: Path,
    mutate: Callable[[dict[str, object]], None],
) -> None:
    evidence_root = tmp_path / "evidence"
    neutral_path, report_path = _write_neutral_evidence(evidence_root, generated_package)
    golden_path = tmp_path / "golden.png"
    golden_path.write_bytes(neutral_path.read_bytes())
    report = _load_report(report_path)
    mutate(report)
    _write_canonical_json(report_path, report)

    with pytest.raises(ValueError, match="not bound to the verified package"):
        verify_actor_neutral(evidence_root, generated_package, golden_path)


def test_neutral_verifier_rejects_tampered_output_and_noncanonical_report(
    tmp_path: Path,
    generated_package: Path,
) -> None:
    evidence_root = tmp_path / "evidence"
    neutral_path, report_path = _write_neutral_evidence(evidence_root, generated_package)
    golden_path = tmp_path / "golden.png"
    golden_path.write_bytes(neutral_path.read_bytes())
    with Image.open(neutral_path) as source:
        tampered = source.copy()
    tampered.putpixel((80, 80), (220, 30, 40, 255))
    tampered.save(neutral_path, format="PNG")

    with pytest.raises(ValueError, match="neutral output identity"):
        verify_actor_neutral(evidence_root, generated_package, golden_path)

    neutral_path, report_path = _write_neutral_evidence(
        tmp_path / "second-evidence", generated_package
    )
    golden_path.write_bytes(neutral_path.read_bytes())
    report_path.write_bytes(report_path.read_bytes().replace(b"\n", b"\r\n"))
    with pytest.raises(ValueError, match="not canonically encoded"):
        verify_actor_neutral(report_path.parent, generated_package, golden_path)


@pytest.mark.parametrize(
    "source_name", ["evidence.py", "motion.py", "output_paths.py", "render_actor_package.py"]
)
def test_neutral_report_is_bound_to_current_trusted_worker_sources(
    tmp_path: Path,
    generated_package: Path,
    source_name: str,
) -> None:
    evidence_root = tmp_path / "evidence"
    neutral_path, report_path = _write_neutral_evidence(evidence_root, generated_package)
    golden_path = tmp_path / "golden.png"
    golden_path.write_bytes(neutral_path.read_bytes())
    report = _load_report(report_path)
    _report_object(report, "trusted_sources")[source_name] = "0" * 64
    _write_canonical_json(report_path, report)

    with pytest.raises(ValueError, match="current trusted worker sources"):
        verify_actor_neutral(evidence_root, generated_package, golden_path)


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda report: _report_object(report, "blender").__setitem__(
                "archive_sha256", "0" * 64
            ),
            "Blender settings",
        ),
        (
            lambda report: _report_object(report, "blender").__setitem__(
                "color_transform", "Standard"
            ),
            "Blender settings",
        ),
        (
            lambda report: _report_object(report, "blender").__setitem__("samples", True),
            "Blender settings",
        ),
        (
            lambda report: _report_object(report, "container").__setitem__("private_snapshot", 1),
            "isolation contract",
        ),
        (
            lambda report: _report_object(report, "imported").__setitem__("objects", 3),
            "imported Blender observations",
        ),
        (
            lambda report: _report_object(report, "imported").__setitem__("armatures", True),
            "imported Blender observations",
        ),
        (
            lambda report: _report_object(report, "imported").__setitem__(
                "world_bounds_m", {"max": [9.0, 9.0, 9.0], "min": [0.0, 0.0, 0.0]}
            ),
            "imported Blender observations",
        ),
        (
            lambda report: _report_object(report, "render").__setitem__(
                "camera_orthographic_scale", 99.0
            ),
            "render declaration",
        ),
        (
            lambda report: _report_object(report, "render").__setitem__("transparent", 1),
            "render declaration",
        ),
        (
            lambda report: _report_object(report, "output").__setitem__("unexpected", True),
            "unexpected keys at output",
        ),
    ],
)
def test_neutral_report_rejects_tampered_or_extended_observations(
    tmp_path: Path,
    generated_package: Path,
    mutate: Callable[[dict[str, object]], None],
    message: str,
) -> None:
    evidence_root = tmp_path / "evidence"
    neutral_path, report_path = _write_neutral_evidence(evidence_root, generated_package)
    golden_path = tmp_path / "golden.png"
    golden_path.write_bytes(neutral_path.read_bytes())
    report = _load_report(report_path)
    mutate(report)
    _write_canonical_json(report_path, report)

    with pytest.raises(ValueError, match=message):
        verify_actor_neutral(evidence_root, generated_package, golden_path)


@pytest.mark.parametrize(
    ("relative", "ceiling"),
    [
        ("neutral.png", MAX_NEUTRAL_BYTES),
        ("validation.json", MAX_VALIDATION_BYTES),
    ],
)
def test_neutral_verifier_rejects_oversize_evidence_before_decoding(
    tmp_path: Path,
    generated_package: Path,
    relative: str,
    ceiling: int,
) -> None:
    evidence_root = tmp_path / "evidence"
    neutral_path, _ = _write_neutral_evidence(evidence_root, generated_package)
    golden_path = tmp_path / "golden.png"
    golden_path.write_bytes(neutral_path.read_bytes())
    (evidence_root / relative).write_bytes(b"x" * (ceiling + 1))

    with pytest.raises(ValueError, match="byte ceiling"):
        verify_actor_neutral(evidence_root, generated_package, golden_path)


def _png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(payload, zlib.crc32(chunk_type)) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + chunk_type + payload + struct.pack(">I", checksum)


def _png_chunks(payload: bytes) -> list[tuple[bytes, bytes]]:
    chunks: list[tuple[bytes, bytes]] = []
    offset = 8
    while offset < len(payload):
        length = struct.unpack_from(">I", payload, offset)[0]
        chunk_type = payload[offset + 4 : offset + 8]
        data = payload[offset + 8 : offset + 8 + length]
        chunks.append((chunk_type, data))
        offset += 12 + length
    return chunks


def _encode_png(chunks: list[tuple[bytes, bytes]]) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"".join(
        _png_chunk(chunk_type, payload) for chunk_type, payload in chunks
    )


@pytest.mark.parametrize("malformation", ["ancillary", "split-idat", "nonempty-iend", "trailing"])
def test_neutral_verifier_rejects_noncanonical_worker_png_structure(
    tmp_path: Path,
    generated_package: Path,
    malformation: str,
) -> None:
    evidence_root = tmp_path / "evidence"
    neutral_path, report_path = _write_neutral_evidence(evidence_root, generated_package)
    golden_path = tmp_path / "golden.png"
    golden_path.write_bytes(neutral_path.read_bytes())
    original = neutral_path.read_bytes()
    chunks = _png_chunks(original)
    if malformation == "ancillary":
        chunks.insert(1, (b"tEXt", b"key\0value"))
        malformed = _encode_png(chunks)
    elif malformation == "split-idat":
        idat_index = next(index for index, item in enumerate(chunks) if item[0] == b"IDAT")
        idat = chunks[idat_index][1]
        midpoint = len(idat) // 2
        chunks[idat_index : idat_index + 1] = [
            (b"IDAT", idat[:midpoint]),
            (b"tEXt", b"key\0value"),
            (b"IDAT", idat[midpoint:]),
        ]
        malformed = _encode_png(chunks)
    elif malformation == "nonempty-iend":
        chunks[-1] = (b"IEND", b"unexpected")
        malformed = _encode_png(chunks)
    else:
        malformed = original + b"trailing"
    neutral_path.write_bytes(malformed)
    report = _load_report(report_path)
    output = _report_object(report, "output")
    output["bytes"] = len(malformed)
    output["sha256"] = _sha256(neutral_path)
    _write_canonical_json(report_path, report)

    with pytest.raises(ValueError, match="neutral PNG"):
        verify_actor_neutral(evidence_root, generated_package, golden_path)


def test_neutral_golden_enforces_channel_and_changed_pixel_tolerances(tmp_path: Path) -> None:
    actual_path = tmp_path / "actual.png"
    golden_path = tmp_path / "golden.png"
    image = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    image.paste((40, 110, 190, 255), (64, 32, 128, 160))
    image.save(actual_path, format="PNG")
    image.save(golden_path, format="PNG")

    within = image.copy()
    within.putpixel((0, 0), (MAX_CHANNEL_DELTA, 0, 0, 0))
    within.save(golden_path, format="PNG")
    assert _verify_golden(actual_path, golden_path) == {
        "changed_pixel_fraction": round(1 / (FRAME_SIZE[0] * FRAME_SIZE[1]), 8),
        "maximum_channel_delta": MAX_CHANNEL_DELTA,
    }

    channel_failure = image.copy()
    channel_failure.putpixel((0, 0), (MAX_CHANNEL_DELTA + 1, 0, 0, 0))
    channel_failure.save(golden_path, format="PNG")
    with pytest.raises(ValueError, match=f"maximum_delta={MAX_CHANNEL_DELTA + 1}"):
        _verify_golden(actual_path, golden_path)

    changed_pixels = int(MAX_CHANGED_PIXEL_FRACTION * FRAME_SIZE[0] * FRAME_SIZE[1]) + 1
    fraction_failure = image.copy()
    for index in range(changed_pixels):
        fraction_failure.putpixel((index % FRAME_SIZE[0], index // FRAME_SIZE[0]), (1, 0, 0, 0))
    fraction_failure.save(golden_path, format="PNG")
    with pytest.raises(ValueError, match="changed_fraction"):
        _verify_golden(actual_path, golden_path)


def test_reviewed_golden_provenance_is_exact_and_tamper_evident(
    tmp_path: Path,
    generated_package: Path,
) -> None:
    verified = actor_package.verify_actor_package(
        generated_package,
        expected_manifest_sha256=actor_package.AF055_FIXTURE_MANIFEST_SHA256,
    )
    _verify_golden_provenance(DEFAULT_GOLDEN_PROVENANCE, DEFAULT_GOLDEN, verified)

    stale = tmp_path / "stale.provenance.json"
    document = json.loads(DEFAULT_GOLDEN_PROVENANCE.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    package = document["package"]
    assert isinstance(package, dict)
    package["manifest_sha256"] = "0" * 64
    _write_canonical_json(stale, document)

    with pytest.raises(ValueError, match="provenance is stale or invalid"):
        _verify_golden_provenance(stale, DEFAULT_GOLDEN, verified)


def test_verifier_parser_rejects_worker_or_model_selection_arguments() -> None:
    parser = build_parser()
    arguments = parser.parse_args(
        ["--source", "evidence", "--package", "package", "--golden", "golden.png"]
    )

    assert arguments.source == Path("evidence")
    assert arguments.package == Path("package")
    assert arguments.golden == Path("golden.png")
    with pytest.raises(SystemExit):
        parser.parse_args(
            [
                "--source",
                "evidence",
                "--package",
                "package",
                "--worker-script",
                "untrusted.py",
            ]
        )


def _compose_service_block(source: str, service: str) -> str:
    marker = f"  {service}:\n"
    start = source.index(marker)
    remainder = source[start + len(marker) :]
    next_service = next(
        (
            index
            for index, line in enumerate(remainder.splitlines(keepends=True))
            if line.startswith("  ") and not line.startswith("    ") and line.rstrip().endswith(":")
        ),
        None,
    )
    if next_service is None:
        return source[start:]
    lines = remainder.splitlines(keepends=True)
    return marker + "".join(lines[:next_service])


def test_dockerfile_keeps_separate_fixed_workers_and_af053_entrypoint() -> None:
    dockerfile = (APP_ROOT / "containers/blender/Dockerfile").read_text(encoding="utf-8")

    assert "FROM blender-runtime-base AS directional-worker" in dockerfile
    assert "FROM blender-runtime-base AS actor-validator" in dockerfile
    assert "FROM blender-runtime-base AS macaw-actor-validator" in dockerfile
    assert '"/opt/animated-fabric/render_walk.py"' in dockerfile
    assert '"/opt/animated-fabric/render_actor_package.py"' in dockerfile
    assert '"/opt/animated-fabric/render_macaw_actor_review.py"' in dockerfile
    assert dockerfile.count('"--disable-autoexec"') == 3
    assert dockerfile.count('"--offline-mode"') == 3
    assert "FROM directional-worker AS blender-runtime" in dockerfile

    actor_source = (APP_ROOT / "tools/blender/render_actor_package.py").read_text(encoding="utf-8")
    assert 'ACTOR_INPUT_ROOT = Path("/actor-package")' in actor_source
    assert actor_source.count('add_argument("--out"') == 1
    assert 'add_argument("--package"' not in actor_source
    assert 'add_argument("--script"' not in actor_source
    for required_gate in (
        "_assert_armature_bindings",
        "if weight > 0.0",
        "use_deform_preserve_volume",
        "_mesh_topology",
        "evaluated_depsgraph_get",
        "to_mesh(",
        "_assert_runtime_network_isolated",
        '"evidence.py"',
        '"motion.py"',
        '"output_paths.py"',
    ):
        assert required_gate in actor_source


def test_compose_actor_mount_is_read_only_and_worker_remains_isolated() -> None:
    compose = (APP_ROOT / "compose.yaml").read_text(encoding="utf-8")
    actor = _compose_service_block(compose, "animated-fabric-blender-actor-validator")
    directional = _compose_service_block(compose, "animated-fabric-blender")

    assert "target: actor-validator" in actor
    assert "./workspaces/actor-packages/geometric-fixture-v1:/actor-package:ro" in actor
    assert "./workspaces/blender:/output" in actor
    assert "network_mode: none" in actor
    assert "read_only: true" in actor
    assert "cap_drop:\n      - ALL" in actor
    assert "no-new-privileges:true" in actor
    assert "/tmp:rw,noexec,nosuid,nodev" in actor
    assert "target: directional-worker" in directional
    assert '--out", "/output/af053-demo' in directional
    assert "/actor-package" not in directional
