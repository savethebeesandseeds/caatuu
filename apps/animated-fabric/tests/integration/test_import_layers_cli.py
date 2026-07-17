"""Integration tests for the AF-030 layer-import CLI boundary."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image
from typer.testing import CliRunner

import animated_fabric.cli.app as cli_module
from animated_fabric.cli.app import app
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.persistence import JsonProjectRepository

runner = CliRunner()


def write_project(root: Path) -> None:
    """Persist one valid project whose canvas matches the small CLI source fixture."""
    manifest = build_stick_humanoid_manifest()
    canvas = manifest.canvas.model_copy(update={"width": 5, "height": 4})
    JsonProjectRepository().save(root, manifest.model_copy(update={"canvas": canvas}))


def write_interior_rgba(path: Path) -> None:
    """Write one small RGBA source whose alpha does not touch its canvas edge."""
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (5, 4), (90, 40, 10, 0))
    image.putpixel((2, 1), (10, 120, 240, 255))
    image.putpixel((3, 2), (200, 30, 80, 128))
    image.save(path, format="PNG")


def test_import_layers_yes_publishes_trimmed_png_and_catalog(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    write_project(project_root)
    source = tmp_path / "prepared"
    write_interior_rgba(source / "head.png")

    result = runner.invoke(
        app,
        [
            "import-layers",
            str(project_root),
            "--direction",
            "SE",
            "--source",
            str(source),
            "--yes",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Imported 1 SE layer(s)" in result.stdout
    manifest = JsonProjectRepository().load_layer_manifest(project_root)
    assert len(manifest.layers) == 1
    asset = manifest.layers[0]
    assert asset.asset_id == "se_head"
    assert asset.path == "source/layers/SE/head.png"
    assert asset.source_canvas_size.width == 5
    assert asset.source_canvas_size.height == 4
    assert (asset.trim_origin.x, asset.trim_origin.y) == (2, 1)
    assert (asset.trim_size.width, asset.trim_size.height) == (2, 2)
    with Image.open(project_root / asset.path) as imported:
        assert imported.mode == "RGBA"
        assert imported.size == (2, 2)


def test_import_layers_displays_mappings_and_requires_confirmation(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    write_project(project_root)
    source = tmp_path / "prepared"
    write_interior_rgba(source / "left_upper_arm.png")

    result = runner.invoke(
        app,
        [
            "import-layers",
            str(project_root),
            "--direction",
            "NE",
            "--source",
            str(source),
        ],
        input="y\n",
    )

    assert result.exit_code == 0, result.output
    assert "left_upper_arm.png -> upper_arm_l" in result.stdout
    assert "Import these mappings?" in result.stdout
    assert (project_root / "source/layers/NE/upper_arm_l.png").is_file()


def test_import_layers_explicit_map_overrides_filename_proposal(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    write_project(project_root)
    source = tmp_path / "prepared"
    write_interior_rgba(source / "bras-gauche.png")

    result = runner.invoke(
        app,
        [
            "import-layers",
            str(project_root),
            "--direction",
            "SE",
            "--source",
            str(source),
            "--map",
            "bras-gauche.png=upper_arm_l",
            "--yes",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFI010"]
    assert payload[0]["path"] == "bras-gauche.png"
    assert payload[0]["location"] == "upper_arm_l"
    assert (project_root / "source/layers/SE/upper_arm_l.png").is_file()


def test_json_import_requires_noninteractive_confirmation(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    write_project(project_root)
    source = tmp_path / "prepared"
    write_interior_rgba(source / "head.png")

    result = runner.invoke(
        app,
        [
            "import-layers",
            str(project_root),
            "--direction",
            "SE",
            "--source",
            str(source),
            "--json",
        ],
    )

    assert result.exit_code == 3
    assert [item["code"] for item in json.loads(result.stdout)] == ["AFI010", "AFI004"]
    assert not (project_root / "layers.manifest.json").exists()


def test_expected_import_failure_uses_exit_three_and_json_diagnostic(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    write_project(project_root)

    result = runner.invoke(
        app,
        [
            "import-layers",
            str(project_root),
            "--direction",
            "SE",
            "--source",
            str(tmp_path / "missing"),
            "--yes",
            "--json",
        ],
    )

    assert result.exit_code == 3
    payload = json.loads(result.stdout)
    assert payload[0]["code"] == "AFI001"
    assert payload[0]["severity"] == "error"


def test_import_requires_project_manifest_before_publication(tmp_path: Path) -> None:
    project_root = tmp_path / "not-a-project"
    project_root.mkdir()
    source = tmp_path / "prepared"
    write_interior_rgba(source / "head.png")

    result = runner.invoke(
        app,
        [
            "import-layers",
            str(project_root),
            "--direction",
            "SE",
            "--source",
            str(source),
            "--yes",
            "--json",
        ],
    )

    assert result.exit_code == 3
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFI010", "AFI001"]
    assert "Missing project manifest" in payload[1]["message"]
    assert not (project_root / "layers.manifest.json").exists()


def test_import_rejects_source_canvas_that_disagrees_with_project(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    JsonProjectRepository().save(project_root, build_stick_humanoid_manifest())
    source = tmp_path / "prepared"
    write_interior_rgba(source / "head.png")

    result = runner.invoke(
        app,
        [
            "import-layers",
            str(project_root),
            "--direction",
            "SE",
            "--source",
            str(source),
            "--yes",
            "--json",
        ],
    )

    assert result.exit_code == 3
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFI010", "AFI007"]
    assert "project canvas is 192 x 192" in payload[1]["message"]
    assert not (project_root / "layers.manifest.json").exists()


def test_unexpected_import_failure_is_sanitized(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_composition() -> None:
        raise RuntimeError("sensitive importer detail")

    monkeypatch.setattr(cli_module, "create_folder_layer_importer", fail_composition)

    result = runner.invoke(
        app,
        [
            "import-layers",
            str(tmp_path),
            "--direction",
            "SE",
            "--source",
            str(tmp_path),
            "--yes",
            "--json",
        ],
    )

    assert result.exit_code == 10
    payload = json.loads(result.stdout)
    assert payload[0]["code"] == "AFC010"
    assert payload[0]["message"] == "Unexpected internal failure while importing layers."
    assert "sensitive importer detail" not in result.output
