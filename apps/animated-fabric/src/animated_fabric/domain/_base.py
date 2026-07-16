"""Shared strict types for persisted Animated Fabric domain models."""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints


class DomainModel(BaseModel):
    """Base for immutable persisted values with deterministic validation."""

    model_config = ConfigDict(
        allow_inf_nan=False,
        extra="forbid",
        frozen=True,
        strict=True,
        validate_default=True,
    )


SemanticId = Annotated[
    str,
    StringConstraints(strict=True, pattern=r"^[a-z][a-z0-9_]*$"),
]


_SEMVER_PATTERN = re.compile(
    r"^(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


def _validate_schema_version(value: str) -> str:
    """Validate the SemVer grammar used by persisted schema versions."""
    match = _SEMVER_PATTERN.fullmatch(value)
    if match is None:
        raise ValueError("must be a valid semantic version")

    prerelease = match.group(4)
    if prerelease is not None:
        for identifier in prerelease.split("."):
            if identifier.isdigit() and len(identifier) > 1 and identifier.startswith("0"):
                raise ValueError("numeric prerelease identifiers must not contain leading zeroes")
    return value


SchemaVersion = Annotated[
    str,
    StringConstraints(strict=True),
    AfterValidator(_validate_schema_version),
]


def _validate_project_path(value: str) -> str:
    """Reject paths that cannot stay inside a project root on supported hosts."""
    if "\x00" in value:
        raise ValueError("must not contain a null byte")
    if "\\" in value:
        raise ValueError("must use forward-slash separators")
    if value.startswith("/") or re.match(r"^[A-Za-z]:", value):
        raise ValueError("must be relative to the project root")

    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("must not contain empty, current-directory, or parent-directory segments")
    return value


ProjectPath = Annotated[
    str,
    StringConstraints(strict=True, min_length=1),
    AfterValidator(_validate_project_path),
]


Sha256Digest = Annotated[
    str,
    StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$"),
]


type JsonValue = str | int | float | bool | None | list[JsonValue] | dict[str, JsonValue]
