"""Validated loader for package-owned rig-template JSON resources."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from importlib.resources import files
from types import MappingProxyType

from pydantic import ValidationError

from animated_fabric.domain.exceptions import RigDefinitionError
from animated_fabric.domain.templates import RigTemplate, RigTemplateSummary
from animated_fabric.infrastructure.json_document import (
    DuplicateJsonKeyError,
    JsonObjectExpectedError,
    NonstandardJsonConstantError,
    decode_json_object,
)

_RESOURCE_PACKAGE = "animated_fabric.templates.resources"
_BUILTIN_RESOURCE_NAMES = ("humanoid_v1.json",)
_RESOURCE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*\.json$")
_MAX_RESOURCE_COUNT = 32
_MAX_RESOURCE_BYTES = 1024 * 1024


class JsonRigTemplateRegistry:
    """Eagerly load and index validated rig templates from owned JSON bytes."""

    def __init__(
        self,
        resource_documents: Sequence[tuple[str, bytes]] | None = None,
    ) -> None:
        documents = (
            tuple(resource_documents)
            if resource_documents is not None
            else _read_builtin_resource_documents()
        )
        templates = _load_resource_documents(documents)
        ordered_templates = dict(sorted(templates.items()))
        self._templates: Mapping[str, RigTemplate] = MappingProxyType(ordered_templates)
        self._summaries = tuple(
            RigTemplateSummary(
                template_id=template.template_id,
                display_name=template.display_name,
            )
            for template in ordered_templates.values()
        )

    def list_templates(self) -> tuple[RigTemplateSummary, ...]:
        """Return immutable summaries in stable template-ID order."""
        return self._summaries

    def get(self, template_id: str) -> RigTemplate:
        """Return a prevalidated template without performing resource IO."""
        try:
            return self._templates[template_id]
        except (KeyError, TypeError) as error:
            raise RigDefinitionError(f"Unknown rig template ID '{template_id}'.") from error


def _read_builtin_resource_documents() -> tuple[tuple[str, bytes], ...]:
    try:
        package_root = files(_RESOURCE_PACKAGE)
    except (ModuleNotFoundError, TypeError) as error:
        raise RigDefinitionError("Built-in rig template resources are unavailable.") from error

    documents: list[tuple[str, bytes]] = []
    for resource_name in _BUILTIN_RESOURCE_NAMES:
        try:
            raw = package_root.joinpath(resource_name).read_bytes()
        except (FileNotFoundError, IsADirectoryError, OSError) as error:
            raise RigDefinitionError(
                f"Built-in rig template resource '{resource_name}' is unavailable."
            ) from error
        documents.append((resource_name, raw))
    return tuple(documents)


def _load_resource_documents(
    documents: Sequence[tuple[str, bytes]],
) -> dict[str, RigTemplate]:
    if not documents:
        raise RigDefinitionError("The rig template registry must contain at least one resource.")
    if len(documents) > _MAX_RESOURCE_COUNT:
        raise RigDefinitionError(
            f"The rig template registry exceeds the {_MAX_RESOURCE_COUNT}-resource limit."
        )

    templates: dict[str, RigTemplate] = {}
    resource_names: set[str] = set()
    for resource_name, raw in documents:
        if (
            not isinstance(resource_name, str)
            or _RESOURCE_NAME_PATTERN.fullmatch(resource_name) is None
        ):
            raise RigDefinitionError("Rig template resources must use canonical JSON filenames.")
        if resource_name in resource_names:
            raise RigDefinitionError(f"Duplicate rig template resource '{resource_name}'.")
        resource_names.add(resource_name)
        if not isinstance(raw, bytes):
            raise RigDefinitionError(
                f"Rig template resource '{resource_name}' must be immutable bytes."
            )
        if len(raw) > _MAX_RESOURCE_BYTES:
            raise RigDefinitionError(
                f"Rig template resource '{resource_name}' exceeds the 1 MiB limit."
            )

        _decode_resource_object(resource_name, raw)
        try:
            template = RigTemplate.model_validate_json(raw)
        except ValidationError as error:
            location, message = _first_validation_error(error)
            raise RigDefinitionError(
                f"Invalid rig template resource '{resource_name}' at '{location}': {message}."
            ) from error

        expected_name = f"{template.template_id}.json"
        if resource_name != expected_name:
            raise RigDefinitionError(
                f"Rig template resource '{resource_name}' must be named '{expected_name}'."
            )
        if template.template_id in templates:
            raise RigDefinitionError(f"Duplicate rig template ID '{template.template_id}'.")
        templates[template.template_id] = template
    return templates


def _decode_resource_object(resource_name: str, raw: bytes) -> dict[str, object]:
    try:
        return decode_json_object(raw)
    except UnicodeDecodeError as error:
        raise RigDefinitionError(
            f"Rig template resource '{resource_name}' is not valid UTF-8."
        ) from error
    except DuplicateJsonKeyError as error:
        raise RigDefinitionError(
            f"Rig template resource '{resource_name}' contains {error}."
        ) from error
    except json.JSONDecodeError as error:
        raise RigDefinitionError(
            f"Malformed JSON in rig template resource '{resource_name}' at "
            f"line {error.lineno}, column {error.colno}."
        ) from error
    except NonstandardJsonConstantError as error:
        raise RigDefinitionError(
            f"Rig template resource '{resource_name}' contains a nonstandard JSON value."
        ) from error
    except JsonObjectExpectedError as error:
        raise RigDefinitionError(
            f"Rig template resource '{resource_name}' must contain a JSON object."
        ) from error
    except (RecursionError, ValueError) as error:
        raise RigDefinitionError(
            f"Rig template resource '{resource_name}' cannot be decoded safely."
        ) from error


def _first_validation_error(error: ValidationError) -> tuple[str, str]:
    first_error = error.errors(include_url=False)[0]
    location = ".".join(str(part) for part in first_error["loc"]) or "<root>"
    return location, first_error["msg"]


__all__ = ["JsonRigTemplateRegistry"]
