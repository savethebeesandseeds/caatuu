"""Strict diagnostic contracts for recoverable Animated Fabric outcomes."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Severity(StrEnum):
    """Severity levels exposed by CLI and GUI diagnostics."""

    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class Diagnostic(BaseModel):
    """A stable, actionable description of an expected problem."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    code: str = Field(min_length=1)
    severity: Severity
    message: str = Field(min_length=1)
    path: str | None = None
    location: str | None = None
    suggestion: str | None = None


class OperationResult[ResultT](BaseModel):
    """A typed value accompanied by deterministic recoverable diagnostics."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    value: ResultT | None = None
    diagnostics: tuple[Diagnostic, ...] = ()

    @property
    def has_errors(self) -> bool:
        """Return whether at least one diagnostic blocks the operation."""
        return any(item.severity is Severity.ERROR for item in self.diagnostics)

    @property
    def is_success(self) -> bool:
        """Return whether the operation completed without error diagnostics."""
        return not self.has_errors
