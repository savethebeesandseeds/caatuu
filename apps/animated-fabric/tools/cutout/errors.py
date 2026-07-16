"""Typed failures raised by the optional cutout tool."""


class CutoutError(RuntimeError):
    """Base error for actionable cutout failures."""


class MissingDependencyError(CutoutError):
    """Raised when an optional provider cannot run in the current image."""


class ModelUnavailableError(MissingDependencyError):
    """Raised when the pinned model snapshot has not been provisioned."""


class ModelIntegrityError(CutoutError):
    """Raised when cached model files do not match the committed manifest."""


class UnsafePathError(CutoutError):
    """Raised when a batch operation would cross its declared path boundary."""
