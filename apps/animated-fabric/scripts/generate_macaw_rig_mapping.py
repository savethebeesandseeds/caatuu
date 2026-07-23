"""Generate the external AF-056 avian_v1 mapping for one pinned actor package."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
BLENDER_TOOLS_ROOT = APP_ROOT / "tools/blender"

sys.path.insert(0, str(BLENDER_TOOLS_ROOT))

import actor_package  # noqa: E402
import avian_contract  # noqa: E402


def _recognized_mapping(path: Path) -> bool:
    try:
        payload = path.read_bytes()
        document = json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeError, ValueError, TypeError):
        return False
    return (
        isinstance(document, dict)
        and payload == avian_contract.canonical_json_bytes(document)
        and document.get("format") == avian_contract.MAPPING_FORMAT
        and document.get("schema_version") == avian_contract.SCHEMA_VERSION
        and isinstance(document.get("package"), dict)
        and document["package"].get("id") == avian_contract.PACKAGE_ID
    )


def generate_mapping(
    package_root: Path,
    destination: Path,
    *,
    expected_manifest_sha256: str,
) -> str:
    """Inspect the package and atomically publish its canonical rig mapping."""
    verified = actor_package.verify_actor_package(
        package_root,
        expected_manifest_sha256=expected_manifest_sha256,
    )
    contract = avian_contract.load_rig_contract()
    document = avian_contract.build_mapping_document(verified, contract)
    payload = avian_contract.canonical_json_bytes(document)
    destination = Path(os.path.abspath(destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and not _recognized_mapping(destination):
        raise ValueError("Refusing to replace a file that is not the AF-056 rig mapping.")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, destination)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise
    return avian_contract.sha256_bytes(payload)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate the fixed external avian_v1 mapping for the AF-056 actor."
    )
    parser.add_argument("--package", required=True, type=Path, help="Verified actor package root.")
    parser.add_argument(
        "--expected-manifest-sha256",
        required=True,
        help="Trusted actor-package manifest SHA-256.",
    )
    parser.add_argument("--out", required=True, type=Path, help="Mapping JSON destination.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    mapping_sha256 = generate_mapping(
        arguments.package,
        arguments.out,
        expected_manifest_sha256=arguments.expected_manifest_sha256,
    )
    print(f"AF-056 avian_v1 mapping: {arguments.out}")
    print(f"Mapping SHA-256: {mapping_sha256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
