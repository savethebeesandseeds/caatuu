"""Deterministic and atomic JSON persistence within an approved project root."""

from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import NoReturn, TypeVar, cast

from pydantic import TypeAdapter, ValidationError

from animated_fabric.application.ports import LAYER_MANIFEST_FILENAME, PROJECT_MANIFEST_FILENAME
from animated_fabric.domain._base import DomainModel, ProjectPath, SchemaVersion
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.assets import LayerManifest
from animated_fabric.domain.exceptions import (
    ProjectValidationError,
    ProjectValidationKind,
    ProjectVersionError,
)
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import RigDefinition

_PROJECT_FORMAT = "animated-fabric.project.v1"
_RIG_FORMAT = "animated-fabric.rig.v1"
_ANIMATION_FORMAT = "animated-fabric.animation-clip.v1"
_LAYER_MANIFEST_FORMAT = "animated-fabric.layer-manifest.v1"
_RIG_SUFFIX = ".animated-rig.json"
_ANIMATION_SUFFIX = ".animated-clip.json"
_SUPPORTED_SCHEMA_FAMILIES = frozenset({(0, 1)})
_PROJECT_PATH_ADAPTER = TypeAdapter(ProjectPath)
_SCHEMA_VERSION_ADAPTER = TypeAdapter(SchemaVersion)

ModelT = TypeVar("ModelT", bound=DomainModel)


class _DuplicateKeyError(ValueError):
    """Raised while decoding an ambiguous JSON object."""


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """Build a JSON object while rejecting repeated keys at every depth."""
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKeyError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_nonstandard_constant(value: str) -> NoReturn:
    """Reject NaN and infinities, which are not valid RFC 8259 JSON values."""
    raise ValueError(f"nonstandard JSON constant: {value}")


class JsonProjectRepository:
    """Persist project, rig, and animation documents as canonical JSON files.

    ``load`` and ``save`` implement the application port for the canonical project
    manifest. Related rig and animation methods share the same hardened per-file
    persistence primitive without inventing an unspecified whole-project aggregate.
    """

    def load(self, root: Path) -> ProjectManifest:
        """Load the canonical project manifest from an existing project root."""
        return self._load_model(
            root,
            PROJECT_MANIFEST_FILENAME,
            ProjectManifest,
            expected_format=_PROJECT_FORMAT,
            artifact_name="project manifest",
        )

    def save(self, root: Path, project: ProjectManifest) -> None:
        """Atomically save the canonical project manifest, creating ``root`` if needed."""
        self._save_model(
            root,
            PROJECT_MANIFEST_FILENAME,
            project,
            expected_format=_PROJECT_FORMAT,
            artifact_name="project manifest",
        )

    def load_layer_manifest(self, root: Path) -> LayerManifest:
        """Load the canonical layer catalog from an existing project root."""
        return self._load_model(
            root,
            LAYER_MANIFEST_FILENAME,
            LayerManifest,
            expected_format=_LAYER_MANIFEST_FORMAT,
            artifact_name="layer manifest",
        )

    def save_layer_manifest(self, root: Path, manifest: LayerManifest) -> None:
        """Atomically save the canonical layer catalog beneath the project root."""
        self._save_model(
            root,
            LAYER_MANIFEST_FILENAME,
            manifest,
            expected_format=_LAYER_MANIFEST_FORMAT,
            artifact_name="layer manifest",
        )

    def load_rig(self, root: Path, path: ProjectPath) -> RigDefinition:
        """Load one rig document from a safe project-relative path."""
        self._require_suffix(path, _RIG_SUFFIX, "rig")
        return self._load_model(
            root,
            path,
            RigDefinition,
            expected_format=_RIG_FORMAT,
            artifact_name="rig",
        )

    def save_rig(self, root: Path, path: ProjectPath, rig: RigDefinition) -> None:
        """Atomically save one rig document beneath the project root."""
        self._require_suffix(path, _RIG_SUFFIX, "rig")
        self._save_model(
            root,
            path,
            rig,
            expected_format=_RIG_FORMAT,
            artifact_name="rig",
        )

    def load_animation(self, root: Path, path: ProjectPath) -> AnimationClip:
        """Load one animation clip from a safe project-relative path."""
        self._require_suffix(path, _ANIMATION_SUFFIX, "animation clip")
        return self._load_model(
            root,
            path,
            AnimationClip,
            expected_format=_ANIMATION_FORMAT,
            artifact_name="animation clip",
        )

    def save_animation(
        self,
        root: Path,
        path: ProjectPath,
        clip: AnimationClip,
    ) -> None:
        """Atomically save one animation clip beneath the project root."""
        self._require_suffix(path, _ANIMATION_SUFFIX, "animation clip")
        self._save_model(
            root,
            path,
            clip,
            expected_format=_ANIMATION_FORMAT,
            artifact_name="animation clip",
        )

    def _load_model(
        self,
        root: Path,
        relative_path: ProjectPath,
        model_type: type[ModelT],
        *,
        expected_format: str,
        artifact_name: str,
    ) -> ModelT:
        project_root = self._project_root(root, create=False)
        normalized_path, candidate = self._resolve_project_path(project_root, relative_path)
        raw = self._read_bytes(candidate, normalized_path, artifact_name)
        document = self._decode_document(raw, normalized_path, artifact_name)
        self._validate_identity(
            document,
            expected_format=expected_format,
            relative_path=normalized_path,
            artifact_name=artifact_name,
        )

        try:
            return model_type.model_validate_json(raw)
        except ValidationError as error:
            location, message = self._first_validation_error(error)
            raise ProjectValidationError(
                f"Invalid {artifact_name} '{normalized_path}' at '{location}': {message}.",
                path=normalized_path,
            ) from error

    def _save_model(
        self,
        root: Path,
        relative_path: ProjectPath,
        model: DomainModel,
        *,
        expected_format: str,
        artifact_name: str,
    ) -> None:
        project_root = self._project_root(root, create=True)
        normalized_path, candidate = self._resolve_project_path(
            project_root,
            relative_path,
            for_write=True,
        )
        try:
            document = cast(dict[str, object], model.model_dump(mode="json"))
        except (TypeError, ValueError) as error:
            raise ProjectValidationError(
                f"The {artifact_name} '{normalized_path}' cannot be serialized.",
                path=normalized_path,
            ) from error
        self._validate_identity(
            document,
            expected_format=expected_format,
            relative_path=normalized_path,
            artifact_name=artifact_name,
        )
        payload = self._encode_document(document, normalized_path, artifact_name)
        self._atomic_write(project_root, candidate, normalized_path, payload, artifact_name)

    @staticmethod
    def _project_root(root: Path, *, create: bool) -> Path:
        try:
            project_root = root.resolve(strict=False)
            if create:
                project_root.mkdir(parents=True, exist_ok=True)
        except (OSError, RuntimeError, ValueError) as error:
            raise ProjectValidationError(
                "The approved project root is not accessible.",
                kind=ProjectValidationKind.FILESYSTEM,
            ) from error

        if not project_root.is_dir():
            kind = (
                ProjectValidationKind.MISSING_DOCUMENT
                if not create and not project_root.exists()
                else ProjectValidationKind.FILESYSTEM
            )
            raise ProjectValidationError(
                "The approved project root is not a directory.",
                kind=kind,
            )
        return project_root

    @staticmethod
    def _resolve_project_path(
        project_root: Path,
        relative_path: ProjectPath,
        *,
        for_write: bool = False,
    ) -> tuple[str, Path]:
        try:
            normalized_path = _PROJECT_PATH_ADAPTER.validate_python(relative_path)
        except ValidationError as error:
            raise ProjectValidationError(
                "Project paths must be safe relative paths using '/' separators.",
                kind=ProjectValidationKind.UNSAFE_PATH,
            ) from error

        path_parts = PurePosixPath(normalized_path).parts
        if for_write and path_parts[0] == "source":
            raise ProjectValidationError(
                "Repository writes must not modify immutable source files.",
                kind=ProjectValidationKind.UNSAFE_PATH,
                path=normalized_path,
            )

        candidate = project_root.joinpath(*path_parts)
        try:
            resolved_candidate = candidate.resolve(strict=False)
            resolved_source_root = (project_root / "source").resolve(strict=False)
        except (OSError, RuntimeError) as error:
            raise ProjectValidationError(
                f"Project path '{normalized_path}' cannot be resolved safely.",
                kind=ProjectValidationKind.UNSAFE_PATH,
                path=normalized_path,
            ) from error

        if not resolved_candidate.is_relative_to(project_root):
            raise ProjectValidationError(
                f"Project path '{normalized_path}' resolves outside the approved project root.",
                kind=ProjectValidationKind.UNSAFE_PATH,
                path=normalized_path,
            )
        if for_write and resolved_candidate.is_relative_to(resolved_source_root):
            raise ProjectValidationError(
                "Repository writes must not modify immutable source files.",
                kind=ProjectValidationKind.UNSAFE_PATH,
                path=normalized_path,
            )
        return normalized_path, candidate

    @staticmethod
    def _read_bytes(candidate: Path, relative_path: str, artifact_name: str) -> bytes:
        try:
            return candidate.read_bytes()
        except FileNotFoundError as error:
            raise ProjectValidationError(
                f"Missing {artifact_name} JSON file '{relative_path}'.",
                kind=ProjectValidationKind.MISSING_DOCUMENT,
                path=relative_path,
            ) from error
        except IsADirectoryError as error:
            raise ProjectValidationError(
                f"Expected {artifact_name} JSON file at '{relative_path}', found a directory.",
                path=relative_path,
            ) from error
        except OSError as error:
            raise ProjectValidationError(
                f"Unable to read {artifact_name} JSON file '{relative_path}'.",
                kind=ProjectValidationKind.FILESYSTEM,
                path=relative_path,
            ) from error

    @staticmethod
    def _decode_document(
        raw: bytes,
        relative_path: str,
        artifact_name: str,
    ) -> dict[str, object]:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ProjectValidationError(
                f"The {artifact_name} '{relative_path}' is not valid UTF-8.",
                path=relative_path,
            ) from error

        try:
            value = cast(
                object,
                json.loads(
                    text,
                    object_pairs_hook=_unique_object,
                    parse_constant=_reject_nonstandard_constant,
                ),
            )
        except _DuplicateKeyError as error:
            raise ProjectValidationError(
                f"The {artifact_name} '{relative_path}' contains {error}.",
                path=relative_path,
            ) from error
        except json.JSONDecodeError as error:
            raise ProjectValidationError(
                f"Malformed JSON in {artifact_name} '{relative_path}' at "
                f"line {error.lineno}, column {error.colno}.",
                path=relative_path,
            ) from error
        except ValueError as error:
            raise ProjectValidationError(
                f"The {artifact_name} '{relative_path}' contains a nonstandard JSON value.",
                path=relative_path,
            ) from error

        if not isinstance(value, dict):
            raise ProjectValidationError(
                f"The {artifact_name} '{relative_path}' must contain a JSON object.",
                path=relative_path,
            )
        return cast(dict[str, object], value)

    @staticmethod
    def _validate_identity(
        document: Mapping[str, object],
        *,
        expected_format: str,
        relative_path: str,
        artifact_name: str,
    ) -> None:
        raw_format = document.get("format")
        if not isinstance(raw_format, str):
            raise ProjectValidationError(
                f"The {artifact_name} '{relative_path}' is missing a string 'format'.",
                path=relative_path,
            )
        if raw_format != expected_format:
            raise ProjectVersionError(
                f"The {artifact_name} '{relative_path}' uses unsupported format "
                f"'{raw_format}'; expected '{expected_format}'.",
                path=relative_path,
            )

        raw_version = document.get("schema_version")
        if not isinstance(raw_version, str):
            raise ProjectValidationError(
                f"The {artifact_name} '{relative_path}' is missing a string 'schema_version'.",
                path=relative_path,
            )
        try:
            version = _SCHEMA_VERSION_ADAPTER.validate_python(raw_version)
        except ValidationError as error:
            raise ProjectValidationError(
                f"The {artifact_name} '{relative_path}' has an invalid schema version.",
                path=relative_path,
            ) from error

        version_without_build = version.split("+", maxsplit=1)[0]
        if "-" in version_without_build:
            raise ProjectVersionError(
                f"The {artifact_name} '{relative_path}' uses unsupported prerelease schema "
                f"'{version}'.",
                path=relative_path,
            )
        major_text, minor_text, _patch_text = version_without_build.split(".")
        family = (int(major_text), int(minor_text))
        if family not in _SUPPORTED_SCHEMA_FAMILIES:
            supported = "0.1.x"
            raise ProjectVersionError(
                f"The {artifact_name} '{relative_path}' uses incompatible schema '{version}'; "
                f"supported schema family: {supported}.",
                path=relative_path,
            )

    @staticmethod
    def _encode_document(
        document: Mapping[str, object],
        relative_path: str,
        artifact_name: str,
    ) -> bytes:
        try:
            text = json.dumps(
                document,
                allow_nan=False,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            return f"{text}\n".encode()
        except (TypeError, ValueError, UnicodeError) as error:
            raise ProjectValidationError(
                f"The {artifact_name} '{relative_path}' cannot be encoded as canonical JSON.",
                path=relative_path,
            ) from error

    def _atomic_write(
        self,
        project_root: Path,
        candidate: Path,
        relative_path: str,
        payload: bytes,
        artifact_name: str,
    ) -> None:
        try:
            candidate.parent.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise ProjectValidationError(
                f"Unable to create the parent directory for {artifact_name} '{relative_path}'.",
                kind=ProjectValidationKind.FILESYSTEM,
                path=relative_path,
            ) from error

        self._resolve_project_path(
            project_root,
            relative_path,
            for_write=True,
        )
        if candidate.is_dir():
            raise ProjectValidationError(
                f"Cannot save {artifact_name} '{relative_path}' over a directory.",
                path=relative_path,
            )

        descriptor = -1
        temporary_path: Path | None = None
        write_error: OSError | None = None
        try:
            descriptor, temporary_name = tempfile.mkstemp(
                dir=candidate.parent,
                prefix=f".{candidate.name}.",
                suffix=".tmp",
            )
            temporary_path = Path(temporary_name)
            stream = os.fdopen(descriptor, "wb")
            descriptor = -1
            with stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, candidate)
        except OSError as error:
            write_error = error
        finally:
            if descriptor >= 0:
                try:
                    os.close(descriptor)
                except OSError as error:
                    if write_error is None:
                        write_error = error
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError as error:
                    if write_error is None:
                        write_error = error

        if write_error is not None:
            raise ProjectValidationError(
                f"Unable to atomically save {artifact_name} '{relative_path}'.",
                kind=ProjectValidationKind.FILESYSTEM,
                path=relative_path,
            ) from write_error

    @staticmethod
    def _first_validation_error(error: ValidationError) -> tuple[str, str]:
        """Return a stable field location and message for an invalid document."""
        first_error = error.errors(include_url=False)[0]
        location = ".".join(str(part) for part in first_error["loc"]) or "<root>"
        return location, first_error["msg"]

    @staticmethod
    def _require_suffix(path: ProjectPath, suffix: str, artifact_name: str) -> None:
        if not isinstance(path, str) or not path.endswith(suffix):
            raise ProjectValidationError(f"The {artifact_name} path must end with '{suffix}'.")


__all__ = ["LAYER_MANIFEST_FILENAME", "JsonProjectRepository", "PROJECT_MANIFEST_FILENAME"]
