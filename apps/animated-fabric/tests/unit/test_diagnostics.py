"""Tests for strict diagnostic and error contracts."""

import pytest
from pydantic import ValidationError

from animated_fabric.domain.diagnostics import Diagnostic, OperationResult, Severity
from animated_fabric.domain.exceptions import (
    AnimatedFabricError,
    AnimationError,
    AssetImportError,
    ExportError,
    ProjectValidationError,
    ProjectVersionError,
    RenderError,
    RigDefinitionError,
)


def make_diagnostic(severity: Severity = Severity.WARNING) -> Diagnostic:
    return Diagnostic(
        code="AFV103",
        severity=severity,
        message="The layer is fully transparent.",
        path="source/SE/arm.png",
        location="alpha",
        suggestion="Check the layer content.",
    )


def test_diagnostic_uses_the_normative_json_shape() -> None:
    diagnostic = make_diagnostic()

    assert diagnostic.model_dump(mode="json") == {
        "code": "AFV103",
        "severity": "warning",
        "message": "The layer is fully transparent.",
        "path": "source/SE/arm.png",
        "location": "alpha",
        "suggestion": "Check the layer content.",
    }


@pytest.mark.parametrize(
    ("field", "invalid_value"),
    [("code", 203), ("severity", "error"), ("message", False)],
)
def test_diagnostic_rejects_type_coercion(field: str, invalid_value: object) -> None:
    values: dict[str, object] = {
        "code": "AFV203",
        "severity": Severity.ERROR,
        "message": "The binding references a missing bone.",
    }
    values[field] = invalid_value

    with pytest.raises(ValidationError):
        Diagnostic.model_validate(values)


def test_diagnostic_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        Diagnostic(
            code="AFV203",
            severity=Severity.ERROR,
            message="The binding references a missing bone.",
            unknown="not allowed",  # type: ignore[call-arg]
        )


def test_operation_result_is_successful_with_warnings() -> None:
    result = OperationResult[str](
        value="fixture",
        diagnostics=(make_diagnostic(Severity.WARNING),),
    )

    assert result.value == "fixture"
    assert result.is_success is True
    assert result.has_errors is False


def test_operation_result_fails_when_any_diagnostic_is_an_error() -> None:
    result = OperationResult[None](
        diagnostics=(
            make_diagnostic(Severity.WARNING),
            make_diagnostic(Severity.ERROR),
        )
    )

    assert result.is_success is False
    assert result.has_errors is True


@pytest.mark.parametrize(
    "error_type",
    [
        ProjectValidationError,
        ProjectVersionError,
        AssetImportError,
        RigDefinitionError,
        AnimationError,
        RenderError,
        ExportError,
    ],
)
def test_specification_errors_share_a_typed_base(
    error_type: type[AnimatedFabricError],
) -> None:
    assert issubclass(error_type, AnimatedFabricError)
