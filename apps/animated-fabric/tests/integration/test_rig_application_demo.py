"""Acceptance tests for the visible AF-032 import-and-rig demo."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from PIL import Image

from animated_fabric.domain.exceptions import AssetImportError
from animated_fabric.domain.project import Direction
from scripts.run_rig_application_demo import run_rig_application_demo

_GOLDEN_HASHES = {
    Direction.SE: "0b2632ea0670e3d66931a849acfaeb76256d6800e6103931ed89cb22d764b6d4",
    Direction.NE: "2d416e98997e8f6cde343f3213947b3e54e4ed97564ccdd544de25d6644144d0",
}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_demo_outputs_reviewed_frames_visible_overlays_and_persisted_rig(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "af032_demo"

    outputs = run_rig_application_demo(output_root)

    assert set(outputs) == {Direction.SE, Direction.NE}
    for direction, output in outputs.items():
        assert _sha256(output.frame) == _GOLDEN_HASHES[direction]
        assert output.overlay.is_file()
        assert output.overlay.read_bytes() != output.frame.read_bytes()
        with Image.open(output.overlay) as overlay:
            assert overlay.mode == "RGBA"
            assert overlay.size == (192, 192)

    manifest = json.loads((output_root / "af032_demo_manifest.json").read_text())
    assert manifest["bones"] == 17
    assert manifest["parts"] == 14
    assert manifest["sockets"] == 8
    assert (output_root / "imported_project/rig/main.animated-rig.json").is_file()
    assert (output_root / "imported_project/layers.manifest.json").is_file()
    assert not (output_root / "imported_project/fixture_manifest.json").exists()


def test_demo_refuses_to_reuse_an_existing_imported_project(tmp_path: Path) -> None:
    output_root = tmp_path / "af032_demo"
    (output_root / "imported_project").mkdir(parents=True)

    with pytest.raises(AssetImportError, match="fresh output root"):
        run_rig_application_demo(output_root)


def test_demo_refuses_a_dangling_output_symlink(tmp_path: Path) -> None:
    output_root = tmp_path / "af032_demo"
    output_root.symlink_to(tmp_path / "redirected", target_is_directory=True)

    with pytest.raises(AssetImportError, match="fresh output root"):
        run_rig_application_demo(output_root)

    assert not (tmp_path / "redirected").exists()
