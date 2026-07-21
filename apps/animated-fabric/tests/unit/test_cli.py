"""Tests for the Typer command-line interface."""

import json
import logging

from typer.testing import CliRunner

import animated_fabric.cli.app as cli_module
from animated_fabric.cli.app import app, collect_doctor_diagnostics
from animated_fabric.domain.diagnostics import Diagnostic, Severity

runner = CliRunner()


def test_help_lists_available_foundation_validation_and_render_commands() -> None:
    result = runner.invoke(app, ["--help"])

    assert result.exit_code == 0
    assert "Animated Fabric development and diagnostic tools." in result.stdout
    assert "version" in result.stdout
    assert "doctor" in result.stdout
    assert "validate" in result.stdout
    assert "import-layers" in result.stdout
    assert "export" in result.stdout
    assert "render-frame" in result.stdout


def test_usage_errors_are_in_english() -> None:
    result = runner.invoke(app, ["unknown-command"])

    assert result.exit_code == 2
    assert "No such command 'unknown-command'." in result.output


def test_version_uses_the_english_product_name() -> None:
    result = runner.invoke(app, ["version"])

    assert result.exit_code == 0
    assert result.stdout.strip() == "Animated Fabric 0.1.0"


def test_doctor_human_output_reports_a_healthy_environment(monkeypatch) -> None:
    monkeypatch.setattr("animated_fabric.cli.app.collect_doctor_diagnostics", lambda: ())

    result = runner.invoke(app, ["doctor"])

    assert result.exit_code == 0
    assert result.stdout.strip() == "Diagnostic complete: no problems found."


def test_doctor_json_uses_the_normative_diagnostic_shape(monkeypatch) -> None:
    diagnostic = Diagnostic(
        code="AFV203",
        severity=Severity.ERROR,
        message="The part references a missing bone.",
        path="rig/main.afrig.json",
        location="parts[8].bone_id",
        suggestion="Create the required bone.",
    )
    monkeypatch.setattr("animated_fabric.cli.app.collect_doctor_diagnostics", lambda: (diagnostic,))

    result = runner.invoke(app, ["doctor", "--json"])

    assert result.exit_code == 2
    assert json.loads(result.stdout) == [
        {
            "code": "AFV203",
            "severity": "error",
            "message": "The part references a missing bone.",
            "path": "rig/main.afrig.json",
            "location": "parts[8].bone_id",
            "suggestion": "Create the required bone.",
        }
    ]


def test_doctor_human_diagnostics_are_in_english(monkeypatch) -> None:
    diagnostic = Diagnostic(
        code="AFV103",
        severity=Severity.WARNING,
        message="The layer is fully transparent.",
        path="source/SE/arm.png",
        location="alpha",
        suggestion="Check the layer content.",
    )
    monkeypatch.setattr("animated_fabric.cli.app.collect_doctor_diagnostics", lambda: (diagnostic,))

    result = runner.invoke(app, ["doctor"])

    assert result.exit_code == 0
    assert "WARNING AFV103" in result.stdout
    assert "File: source/SE/arm.png" in result.stdout
    assert "Location: alpha" in result.stdout
    assert "Suggestion: Check the layer content." in result.stdout


def test_doctor_checks_python_and_every_runtime_module(monkeypatch) -> None:
    checked_modules: list[str] = []

    def missing_module(module_name: str) -> None:
        checked_modules.append(module_name)
        return None

    monkeypatch.setattr(cli_module, "MINIMUM_PYTHON", (99, 0))
    monkeypatch.setattr(cli_module.importlib.util, "find_spec", missing_module)

    diagnostics = collect_doctor_diagnostics()

    assert checked_modules == [module_name for module_name, _ in cli_module.REQUIRED_MODULES]
    assert diagnostics[0].code == "AFD001"
    assert len(diagnostics) == len(cli_module.REQUIRED_MODULES) + 1


def test_validate_logs_and_translates_unexpected_boundary_failures(
    monkeypatch,
    caplog,
) -> None:
    class BrokenValidationUseCase:
        def execute(self, _request):
            raise RuntimeError("sensitive internal detail")

    monkeypatch.setattr(
        cli_module,
        "create_validate_project",
        lambda: BrokenValidationUseCase(),
    )

    with caplog.at_level(logging.ERROR, logger=cli_module.__name__):
        result = runner.invoke(app, ["validate", "project"])

    assert result.exit_code == 10
    assert "Unexpected internal failure" in result.output
    assert "sensitive internal detail" not in result.output
    assert "AFC010" in caplog.text
    assert "RuntimeError" in caplog.text
    assert "sensitive internal detail" not in caplog.text


def test_validate_translates_unexpected_failure_to_json_without_leaking_details(
    monkeypatch,
) -> None:
    class BrokenValidationUseCase:
        def execute(self, _request):
            raise RuntimeError("sensitive internal detail")

    monkeypatch.setattr(
        cli_module,
        "create_validate_project",
        lambda: BrokenValidationUseCase(),
    )
    fallback_logger = logging.Logger("animated_fabric.cli.boundary_test", level=logging.ERROR)
    fallback_logger.propagate = False
    monkeypatch.setattr(cli_module, "LOGGER", fallback_logger)

    result = runner.invoke(app, ["validate", "project", "--json"])

    assert result.exit_code == 10
    assert json.loads(result.stdout) == [
        {
            "code": "AFC010",
            "severity": "error",
            "message": "Unexpected internal failure while validating the project.",
            "path": None,
            "location": None,
            "suggestion": "Review the application logs and retry.",
        }
    ]
    assert "sensitive internal detail" not in result.output
    assert "sensitive internal detail" not in result.stderr
    assert "AFC010" in result.stderr
    assert "RuntimeError" in result.stderr
