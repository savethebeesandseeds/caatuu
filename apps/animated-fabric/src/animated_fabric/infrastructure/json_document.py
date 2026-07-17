"""Shared strict JSON-object decoding for trusted application adapters."""

from __future__ import annotations

import json
from typing import NoReturn, cast


class DuplicateJsonKeyError(ValueError):
    """Raised when a JSON object repeats a key at any depth."""


class NonstandardJsonConstantError(ValueError):
    """Raised for NaN or infinity tokens forbidden by RFC 8259."""


class JsonObjectExpectedError(ValueError):
    """Raised when a JSON document's root value is not an object."""


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJsonKeyError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_nonstandard_constant(value: str) -> NoReturn:
    raise NonstandardJsonConstantError(f"nonstandard JSON constant: {value}")


def decode_json_object(raw: bytes) -> dict[str, object]:
    """Decode one UTF-8 JSON object without ambiguous or nonstandard values."""
    text = raw.decode("utf-8")
    value = cast(
        object,
        json.loads(
            text,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_nonstandard_constant,
        ),
    )
    if not isinstance(value, dict):
        raise JsonObjectExpectedError("JSON document root must be an object")
    return cast(dict[str, object], value)


__all__ = [
    "DuplicateJsonKeyError",
    "JsonObjectExpectedError",
    "NonstandardJsonConstantError",
    "decode_json_object",
]
