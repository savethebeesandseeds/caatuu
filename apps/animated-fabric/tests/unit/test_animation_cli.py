"""Focused CLI contracts for AF-043 animation discovery and parameter parsing."""

from __future__ import annotations

import json

import pytest
from typer.testing import CliRunner

import animated_fabric.cli.app as cli_module
from animated_fabric.application.generate_animation import (
    ANIMATION_GENERATION_FAILURE_CODE,
    ANIMATION_PUBLICATION_FAILURE_CODE,
    ANIMATION_REPLACEMENT_REQUIRED_CODE,
)
from animated_fabric.cli.app import app, parse_animation_parameter_assignments
from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity

runner = CliRunner()


def test_animation_help_exposes_only_the_approved_af043_commands_and_options() -> None:
    root_help = runner.invoke(app, ["--help"])
    animation_help = runner.invoke(app, ["animation", "--help"])
    generate_help = runner.invoke(app, ["animation", "generate", "--help"])

    assert root_help.exit_code == animation_help.exit_code == generate_help.exit_code == 0
    assert "animation" in root_help.stdout
    assert "list-generators" in animation_help.stdout
    assert "generate" in animation_help.stdout
    for option in ("--generator", "--clip", "--set", "--replace-existing", "--json"):
        assert option in generate_help.stdout


def test_list_generators_human_output_is_stable_and_displays_typed_bounds() -> None:
    result = runner.invoke(
        app,
        ["animation", "list-generators", "--template", "humanoid_v1"],
    )

    assert result.exit_code == 0, result.output
    assert result.stdout.index("humanoid_idle_v1") < result.stdout.index("humanoid_walk_v1")
    assert "duration_ms: integer; default=2000; minimum=4" in result.stdout
    assert "recommended-minimum=1200" in result.stdout
    assert "recommended-maximum=4000" in result.stdout
    assert "step_angle_deg: number; default=18.0; minimum=0.0" in result.stdout


def test_list_generators_json_returns_typed_summary_array_without_invented_walk_bounds() -> None:
    result = runner.invoke(
        app,
        [
            "animation",
            "list-generators",
            "--template",
            "humanoid_v1",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert [item["generator_id"] for item in payload] == [
        "humanoid_idle_v1",
        "humanoid_walk_v1",
    ]
    assert all(item["template_id"] == "humanoid_v1" for item in payload)
    idle_duration = payload[0]["parameters"][0]
    assert idle_duration == {
        "parameter_id": "duration_ms",
        "value_type": "integer",
        "default": 2000,
        "minimum": 4,
        "maximum": None,
        "recommended_minimum": 1200,
        "recommended_maximum": 4000,
    }
    for parameter in payload[1]["parameters"]:
        assert parameter["maximum"] is None
        assert parameter["recommended_minimum"] is None
        assert parameter["recommended_maximum"] is None


def test_list_generators_rejects_noncanonical_template_without_echoing_it() -> None:
    submitted = "Sensitive/Template"

    result = runner.invoke(
        app,
        ["animation", "list-generators", "--template", submitted, "--json"],
    )

    assert result.exit_code == 3
    assert [item["code"] for item in json.loads(result.stdout)] == [
        ANIMATION_GENERATION_FAILURE_CODE
    ]
    assert submitted not in result.output


def test_parameter_parser_accepts_only_bounded_json_scalars_and_splits_first_equals() -> None:
    parsed = parse_animation_parameter_assignments(
        [
            "duration_ms=800",
            "step_angle_deg=1.8e1",
            "enabled=true",
            "optional=null",
            'label="left=right"',
        ]
    )

    assert parsed == {
        "duration_ms": 800,
        "step_angle_deg": 18.0,
        "enabled": True,
        "optional": None,
        "label": "left=right",
    }


@pytest.mark.parametrize(
    "assignments",
    [
        ["missing_separator"],
        ["=1"],
        ["duration_ms="],
        ["Duration=800"],
        ["duration-ms=800"],
        ["duration_ms=800", "duration_ms=900"],
        ['value={"nested":1}'],
        ["value=[1,2]"],
        ["value=NaN"],
        ["value=Infinity"],
        ["value=-Infinity"],
        ["value=not_json"],
        [f"value={'1' * 4097}"],
        [f"parameter_{index}=0" for index in range(65)],
    ],
)
def test_parameter_parser_rejects_malformed_duplicate_complex_nonfinite_or_oversized_values(
    assignments: list[str],
) -> None:
    with pytest.raises(ValueError) as captured:
        parse_animation_parameter_assignments(assignments)

    assert len(str(captured.value)) <= 100


def test_generate_parser_failure_is_json_diagnostic_and_never_echoes_submitted_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sensitive = "sensitive_parameter_value"

    def should_not_compose() -> None:
        pytest.fail("The use case must not be composed after parser failure.")

    monkeypatch.setattr(cli_module, "create_generate_animation", should_not_compose)

    result = runner.invoke(
        app,
        [
            "animation",
            "generate",
            "project",
            "--generator",
            "humanoid_idle_v1",
            "--clip",
            "idle",
            "--set",
            f"unsafe-name={json.dumps(sensitive)}",
            "--json",
        ],
    )

    assert result.exit_code == 3
    assert [item["code"] for item in json.loads(result.stdout)] == [
        ANIMATION_GENERATION_FAILURE_CODE
    ]
    assert sensitive not in result.output


@pytest.mark.parametrize(
    ("code", "expected_exit"),
    [
        (ANIMATION_REPLACEMENT_REQUIRED_CODE, 2),
        ("AFB001", 2),
        ("AFV301", 2),
        (ANIMATION_GENERATION_FAILURE_CODE, 3),
        (ANIMATION_PUBLICATION_FAILURE_CODE, 3),
    ],
)
def test_generate_maps_expected_diagnostics_to_stable_exit_codes(
    code: str,
    expected_exit: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    diagnostic = Diagnostic(
        code=code,
        severity=Severity.ERROR,
        message="Animation generation could not continue.",
    )

    class FailedUseCase:
        def execute(self, _request: object) -> OperationResult[object]:
            return OperationResult[object](diagnostics=(diagnostic,))

    monkeypatch.setattr(cli_module, "create_generate_animation", FailedUseCase)

    result = runner.invoke(
        app,
        [
            "animation",
            "generate",
            "project",
            "--generator",
            "humanoid_idle_v1",
            "--clip",
            "idle",
            "--json",
        ],
    )

    assert result.exit_code == expected_exit
    assert [item["code"] for item in json.loads(result.stdout)] == [code]


def test_animation_cli_sanitizes_unexpected_boundary_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ExplodingUseCase:
        def execute(self, _request: object) -> None:
            raise RuntimeError("sensitive_animation_failure")

    monkeypatch.setattr(cli_module, "create_generate_animation", ExplodingUseCase)

    result = runner.invoke(
        app,
        [
            "animation",
            "generate",
            "project",
            "--generator",
            "humanoid_idle_v1",
            "--clip",
            "idle",
            "--json",
        ],
    )

    assert result.exit_code == 10
    assert [item["code"] for item in json.loads(result.stdout)] == ["AFC010"]
    assert "sensitive_animation_failure" not in result.output
