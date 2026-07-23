"""Typed failures for the isolated reconstruction boundary."""


class ReconstructionError(RuntimeError):
    """Base expected failure for reconstruction tooling."""


class ModelIntegrityError(ReconstructionError):
    """A required pinned model file is absent or has unexpected bytes."""


class UnsafePathError(ReconstructionError):
    """A path escapes its mounted input or output boundary."""


class CandidateExistsError(ReconstructionError):
    """The requested immutable candidate ID is already present."""
