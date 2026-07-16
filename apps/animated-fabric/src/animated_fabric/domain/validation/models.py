"""Typed inputs and stable codes shared by structural validators."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.diagnostics import Diagnostic
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import RigDefinition


class ValidationCode(StrEnum):
    """Stable diagnostic identifiers owned by project validation."""

    MANIFEST_MISSING = "AFV001"
    INCOMPATIBLE_SCHEMA = "AFV002"
    PATH_OUTSIDE_PROJECT = "AFV003"
    INVALID_PROJECT_DOCUMENT = "AFV004"

    ASSET_MISSING = "AFV101"
    PNG_UNREADABLE = "AFV102"
    TRANSPARENT_LAYER = "AFV103"
    DIMENSIONS_EXCEEDED = "AFV104"
    DUPLICATE_PART = "AFV105"
    AUTHORED_DIRECTION_MISSING = "AFV106"
    ART_TOUCHES_EDGE = "AFV107"
    HASH_CHANGED = "AFV108"
    DUPLICATE_ASSET_ID = "AFV109"

    BONE_CYCLE = "AFV201"
    PARENT_MISSING = "AFV202"
    BINDING_BONE_MISSING = "AFV203"
    PART_WITHOUT_BINDING = "AFV204"
    ROOT_COUNT_INVALID = "AFV205"
    PIVOT_FAR_OUTSIDE_ASSET = "AFV206"
    DUPLICATE_RIG_ID = "AFV207"
    SOCKET_BONE_MISSING = "AFV208"

    TRACK_TARGET_MISSING = "AFV301"
    KEY_OUTSIDE_DURATION = "AFV302"
    DUPLICATE_KEY = "AFV303"
    CLIP_WITHOUT_TRACKS = "AFV304"
    EVENT_OUTSIDE_RANGE = "AFV305"
    KEYS_UNORDERED = "AFV306"
    TRACK_CHANNEL_INVALID = "AFV307"

    UNKNOWN_DRAW_SLOT = "AFV401"
    VISIBLE_PART_WITHOUT_ORDER = "AFV402"
    UNUSED_SOCKET = "AFV403"
    DUPLICATE_DRAW_SLOT = "AFV404"


@dataclass(frozen=True, slots=True)
class AssetObservation:
    """Filesystem facts supplied to the pure validator by an imaging adapter."""

    asset_id: str
    exists: bool = True
    readable: bool = True
    width: int | None = None
    height: int | None = None
    fully_transparent: bool | None = None
    touches_edge: bool | None = None
    sha256: str | None = None


@dataclass(frozen=True, slots=True)
class AnimationDocument:
    """An animation clip paired with its project-relative source path."""

    path: ProjectPath
    clip: AnimationClip


@dataclass(frozen=True, slots=True)
class ValidationInput:
    """Available project documents and optional observations for one validation run."""

    manifest: ProjectManifest
    rig: RigDefinition
    animations: tuple[AnimationDocument, ...] = ()
    assets: tuple[AssetLayer, ...] | None = None
    asset_observations: Mapping[str, AssetObservation] | None = None
    used_socket_ids: frozenset[str] | None = None


def diagnostic_sort_key(diagnostic: Diagnostic) -> tuple[str, str, str, str]:
    """Return the normative deterministic ordering key for diagnostics."""
    return (
        diagnostic.code,
        diagnostic.path or "",
        diagnostic.location or "",
        diagnostic.message,
    )


__all__ = [
    "AnimationDocument",
    "AssetObservation",
    "ValidationCode",
    "ValidationInput",
    "diagnostic_sort_key",
]
