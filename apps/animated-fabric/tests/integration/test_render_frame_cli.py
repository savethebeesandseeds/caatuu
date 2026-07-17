"""CLI integration coverage for the AF-023 complete-frame vertical slice."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from PIL import Image
from typer.testing import CliRunner

import animated_fabric.cli.app as cli_module
from animated_fabric.cli.app import app
from scripts.generate_fixture_assets import generate_fixture_assets

runner = CliRunner()


def test_render_frame_help_exposes_the_normative_inputs() -> None:
    result = runner.invoke(app, ["render-frame", "--help"])

    assert result.exit_code == 0
    assert "Generated fixture project root to render." in result.stdout
    for option in ("--direction", "--out", "--clip", "--time-ms", "--quality", "--json"):
        assert option in result.stdout


def test_render_frame_writes_a_complete_neutral_rgba_png(tmp_path: Path) -> None:
    fixture_root = generate_fixture_assets(tmp_path / "fixture")
    output_path = tmp_path / "nested" / "neutral-se.png"

    result = runner.invoke(
        app,
        [
            "render-frame",
            str(fixture_root),
            "--direction",
            "SE",
            "--out",
            str(output_path),
        ],
    )

    assert result.exit_code == 0, result.output
    assert result.stdout.strip() == f"Rendered neutral SE frame to {output_path}."
    assert output_path.is_file()
    assert not tuple(output_path.parent.glob(f".{output_path.name}.*.tmp"))
    with Image.open(output_path) as image:
        assert image.format == "PNG"
        assert image.mode == "RGBA"
        assert image.size == (192, 192)
        assert image.getchannel("A").getextrema() == (0, 255)
        assert image.getchannel("A").getbbox() is not None


def test_render_frame_maps_an_unknown_clip_to_structured_render_diagnostics(
    tmp_path: Path,
) -> None:
    fixture_root = generate_fixture_assets(tmp_path / "fixture")
    output_path = tmp_path / "unknown-clip.png"

    result = runner.invoke(
        app,
        [
            "render-frame",
            str(fixture_root),
            "--direction",
            "NE",
            "--clip",
            "walk",
            "--out",
            str(output_path),
            "--json",
        ],
    )

    assert result.exit_code == 4
    assert json.loads(result.stdout) == [
        {
            "code": "AFR001",
            "severity": "error",
            "message": "Project does not contain animation clip 'walk'.",
            "path": None,
            "location": None,
            "suggestion": "Check the project, render options, and referenced PNG assets.",
        }
    ]
    assert not output_path.exists()


def test_render_frame_rejects_mirroring_reserved_for_af052(tmp_path: Path) -> None:
    fixture_root = generate_fixture_assets(tmp_path / "fixture")
    output_path = tmp_path / "neutral-sw.png"

    result = runner.invoke(
        app,
        [
            "render-frame",
            str(fixture_root),
            "--direction",
            "SW",
            "--out",
            str(output_path),
            "--json",
        ],
    )

    assert result.exit_code == 4
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFR001"]
    assert "AF-052" in payload[0]["message"]
    assert not output_path.exists()


def test_render_frame_cannot_overwrite_an_immutable_source_layer(tmp_path: Path) -> None:
    fixture_root = generate_fixture_assets(tmp_path / "fixture")
    source_layer = fixture_root / "source/layers/SE/torso.png"
    original = source_layer.read_bytes()

    result = runner.invoke(
        app,
        [
            "render-frame",
            str(fixture_root),
            "--direction",
            "SE",
            "--out",
            str(source_layer),
            "--json",
        ],
    )

    assert result.exit_code == 4
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFR001"]
    assert "immutable source assets" in payload[0]["message"]
    assert source_layer.read_bytes() == original
    assert not tuple(source_layer.parent.glob(f".{source_layer.name}.*.tmp"))


def test_render_frame_reports_a_missing_fixture_without_leaking_a_traceback(
    tmp_path: Path,
) -> None:
    missing_root = tmp_path / "missing"
    output_path = tmp_path / "never-written.png"

    result = runner.invoke(
        app,
        [
            "render-frame",
            str(missing_root),
            "--direction",
            "SE",
            "--out",
            str(output_path),
        ],
    )

    assert result.exit_code == 4
    assert "ERROR AFR001:" in result.stdout
    assert "approved project root is not a directory" in result.stdout
    assert "Traceback" not in result.output
    assert not output_path.exists()


def test_render_frame_sanitizes_unexpected_boundary_failures(
    tmp_path: Path,
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    def fail_load(*_arguments: object, **_keywords: object) -> None:
        raise RuntimeError("sensitive renderer detail")

    monkeypatch.setattr(cli_module, "load_stick_humanoid_project", fail_load)
    fallback_logger = logging.Logger(
        "animated_fabric.cli.render_boundary_test", level=logging.ERROR
    )
    fallback_logger.propagate = False
    monkeypatch.setattr(cli_module, "LOGGER", fallback_logger)

    result = runner.invoke(
        app,
        [
            "render-frame",
            str(tmp_path),
            "--direction",
            "SE",
            "--out",
            str(tmp_path / "never-written.png"),
            "--json",
        ],
    )

    assert result.exit_code == 10
    assert json.loads(result.stdout) == [
        {
            "code": "AFC010",
            "severity": "error",
            "message": "Unexpected internal failure while rendering the frame.",
            "path": None,
            "location": None,
            "suggestion": "Review the application logs and retry.",
        }
    ]
    assert "sensitive renderer detail" not in result.output
