"""Typed non-recoverable failures defined by the master specification."""

from enum import StrEnum


class ProjectValidationKind(StrEnum):
    """Stable repository failure categories for later diagnostic mapping."""

    INVALID_DOCUMENT = "invalid_document"
    MISSING_DOCUMENT = "missing_document"
    DOCUMENT_EXISTS = "document_exists"
    UNSAFE_PATH = "unsafe_path"
    FILESYSTEM = "filesystem"


class AnimatedFabricError(Exception):
    """Base class for failures that prevent an application use case continuing."""


class ProjectValidationError(AnimatedFabricError):
    """Raised when an invalid project cannot be handled as diagnostics."""

    def __init__(
        self,
        message: str,
        *,
        kind: ProjectValidationKind = ProjectValidationKind.INVALID_DOCUMENT,
        path: str | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.path = path


class ProjectVersionError(AnimatedFabricError):
    """Raised when a project schema version cannot be opened safely."""

    def __init__(self, message: str, *, path: str | None = None) -> None:
        super().__init__(message)
        self.path = path


class AssetImportError(AnimatedFabricError):
    """Raised when an asset import cannot continue."""


class RigDefinitionError(AnimatedFabricError):
    """Raised when a rig definition is unusable."""


class AnimationError(AnimatedFabricError):
    """Raised when animation processing cannot continue."""


class RenderError(AnimatedFabricError):
    """Raised when rendering cannot continue."""


class ExportError(AnimatedFabricError):
    """Raised when an export cannot complete safely."""


__all__ = [
    "AnimationError",
    "AnimatedFabricError",
    "AssetImportError",
    "ExportError",
    "ProjectValidationError",
    "ProjectValidationKind",
    "ProjectVersionError",
    "RenderError",
    "RigDefinitionError",
]
