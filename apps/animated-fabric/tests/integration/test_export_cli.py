"""End-to-end CLI coverage for the AF-051 grid export command."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from PIL import Image
from typer.testing import CliRunner

import animated_fabric.cli.app as cli_module
from animated_fabric.application.generate_animation import (
    GenerateAnimation,
    GenerateAnimationRequest,
)
from animated_fabric.cli.app import app
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.export import GridSpritesheetMetadata
from animated_fabric.domain.validation import ProjectValidator
from animated_fabric.generators import BuiltinAnimationGeneratorRegistry
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from scripts.run_rig_application_demo import run_rig_application_demo

runner = CliRunner()


def _ready_project(tmp_path: Path, *, register_profile: bool = True) -> Path:
    demo_root = tmp_path / "rig_demo"
    run_rig_application_demo(demo_root)
    project_root = demo_root / "imported_project"
    repository = JsonProjectRepository()
    manifest = repository.load(project_root)
    repository.save(
        project_root,
        manifest.model_copy(
            update={"export_profiles": ("default_grid",) if register_profile else ()}
        ),
    )
    generated = GenerateAnimation(
        repository,
        BuiltinAnimationGeneratorRegistry(),
        ProjectValidator(),
    ).execute(
        GenerateAnimationRequest(
            project_root=project_root,
            generator_id="humanoid_idle_v1",
            clip_id="idle",
            parameters={"duration_ms": 200},
        )
    )
    assert generated.value is not None, generated.diagnostics
    assert not generated.has_errors
    return project_root


def test_export_help_exposes_profile_and_stable_override_options() -> None:
    result = runner.invoke(app, ["export", "--help"])

    assert result.exit_code == 0
    assert "--profile" in result.stdout
    assert "--out" in result.stdout
    assert "--animation" in result.stdout
    assert "--direction" in result.stdout
    assert "--fps" in result.stdout
    assert "--allow-clipping" in result.stdout
    assert "--json" in result.stdout


def test_export_cli_publishes_authored_rows_in_explicit_order(tmp_path: Path) -> None:
    project_root = _ready_project(tmp_path)
    destination = tmp_path / "published" / "hero"

    result = runner.invoke(
        app,
        [
            "export",
            str(project_root),
            "--profile",
            "default_grid",
            "--out",
            str(destination),
            "--animation",
            "idle",
            "--direction",
            "NE",
            "--direction",
            "SE",
            "--fps",
            "10",
            "--allow-clipping",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout) == []
    assert {path.name for path in destination.iterdir()} == {
        "idle.png",
        "idle.spritesheet.json",
    }
    metadata = GridSpritesheetMetadata.model_validate_json(
        (destination / "idle.spritesheet.json").read_bytes()
    )
    assert [direction.value for direction in metadata.directions] == ["NE", "SE"]
    assert metadata.frames_per_direction == 2
    assert sum(frame.duration_ms for frame in metadata.frames[:2]) == 200
    assert sum(frame.duration_ms for frame in metadata.frames[2:]) == 200
    with Image.open(destination / "idle.png") as sheet:
        sheet.load()
        assert sheet.format == "PNG"
        assert sheet.mode == "RGBA"
        assert sheet.size == (384, 384)


def test_default_profile_reports_af052_boundary_without_partial_output(tmp_path: Path) -> None:
    project_root = _ready_project(tmp_path)
    destination = tmp_path / "published" / "hero"

    result = runner.invoke(
        app,
        [
            "export",
            str(project_root),
            "--profile",
            "default_grid",
            "--out",
            str(destination),
            "--animation",
            "idle",
            "--json",
        ],
    )

    assert result.exit_code == 5
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFV502"]
    assert "AF-052" in payload[0]["message"]
    assert not destination.exists()


def test_export_rejects_unknown_or_unregistered_profiles(tmp_path: Path) -> None:
    missing_project = tmp_path / "missing"
    unknown = runner.invoke(
        app,
        [
            "export",
            str(missing_project),
            "--profile",
            "unknown_grid",
            "--out",
            str(tmp_path / "unknown"),
            "--json",
        ],
    )
    assert unknown.exit_code == 5
    assert json.loads(unknown.stdout)[0]["code"] == "AFV502"

    project_root = _ready_project(tmp_path / "unregistered", register_profile=False)
    destination = tmp_path / "unregistered-output"
    unregistered = runner.invoke(
        app,
        [
            "export",
            str(project_root),
            "--profile",
            "default_grid",
            "--out",
            str(destination),
            "--animation",
            "idle",
            "--direction",
            "SE",
            "--json",
        ],
    )
    assert unregistered.exit_code == 5
    payload = json.loads(unregistered.stdout)
    assert payload[0]["code"] == "AFV502"
    assert payload[0]["location"] == "export_profiles"
    assert not destination.exists()


def test_export_cli_maps_a_real_missing_project_to_validation_exit_two(tmp_path: Path) -> None:
    destination = tmp_path / "output"

    result = runner.invoke(
        app,
        [
            "export",
            str(tmp_path / "missing-project"),
            "--profile",
            "default_grid",
            "--out",
            str(destination),
            "--json",
        ],
    )

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert [item["code"] for item in payload] == ["AFV001"]
    assert not destination.exists()


def test_export_cli_sanitizes_unexpected_boundary_failure(monkeypatch, caplog) -> None:
    class BrokenExportUseCase:
        def execute(self, _request):
            raise RuntimeError("sensitive export detail")

    monkeypatch.setattr(
        cli_module,
        "create_export_grid_project",
        lambda: BrokenExportUseCase(),
    )

    with caplog.at_level(logging.ERROR, logger=cli_module.__name__):
        result = runner.invoke(
            app,
            [
                "export",
                "project",
                "--profile",
                "default_grid",
                "--out",
                "output",
                "--json",
            ],
        )

    assert result.exit_code == 10
    payload = json.loads(result.stdout)
    assert payload == [
        {
            "code": "AFC010",
            "severity": "error",
            "message": "Unexpected internal failure while exporting spritesheets.",
            "path": None,
            "location": None,
            "suggestion": "Review the application logs and retry.",
        }
    ]
    assert "RuntimeError" in caplog.text
    assert "sensitive export detail" not in result.output
    assert "sensitive export detail" not in caplog.text


def test_export_cli_uses_validation_exit_code_two(monkeypatch) -> None:
    class InvalidProjectUseCase:
        def execute(self, _request):
            return OperationResult[object](
                diagnostics=(
                    Diagnostic(
                        code="AFV201",
                        severity=Severity.ERROR,
                        message="The rig contains a cycle.",
                    ),
                )
            )

    monkeypatch.setattr(
        cli_module,
        "create_export_grid_project",
        lambda: InvalidProjectUseCase(),
    )

    result = runner.invoke(
        app,
        [
            "export",
            "project",
            "--profile",
            "default_grid",
            "--out",
            "output",
            "--json",
        ],
    )

    assert result.exit_code == 2
    assert json.loads(result.stdout)[0]["code"] == "AFV201"
