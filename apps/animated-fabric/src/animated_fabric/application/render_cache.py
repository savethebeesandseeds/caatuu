"""Bounded revision-aware caches for complete frame orchestration."""

from __future__ import annotations

import hashlib
import json
from collections import OrderedDict
from threading import RLock

from animated_fabric.application.rendering import RenderProject
from animated_fabric.domain._base import DomainModel
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.animation_evaluator import AnimationEvaluator, EvaluatedAnimation
from animated_fabric.domain.exceptions import AnimationError, RenderError, RigDefinitionError
from animated_fabric.domain.hierarchy import (
    topological_bone_order,
    validate_topological_bone_order,
)
from animated_fabric.domain.interpolation import normalize_clip_time
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition

DEFAULT_MAX_TOPOLOGY_ENTRIES = 64
DEFAULT_MAX_EVALUATION_ENTRIES = 500

type ProjectIdentity = tuple[str, str]
type TopologyKey = tuple[ProjectIdentity, int, str]
type EvaluationKey = tuple[ProjectIdentity, int, str, str, str, float]


def _model_fingerprint(model: DomainModel) -> str:
    """Return a deterministic content identity for an immutable persisted model."""
    payload = json.dumps(
        model.model_dump(mode="json"),
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


class RenderComputationCache:
    """Cache rig topology and evaluated clips while a project revision is current."""

    def __init__(
        self,
        *,
        max_topology_entries: int = DEFAULT_MAX_TOPOLOGY_ENTRIES,
        max_evaluation_entries: int = DEFAULT_MAX_EVALUATION_ENTRIES,
    ) -> None:
        self._max_topology_entries = self._positive_int(
            max_topology_entries,
            "max_topology_entries",
        )
        self._max_evaluation_entries = self._positive_int(
            max_evaluation_entries,
            "max_evaluation_entries",
        )
        self._topologies: OrderedDict[TopologyKey, tuple[str, ...]] = OrderedDict()
        self._evaluations: OrderedDict[EvaluationKey, EvaluatedAnimation] = OrderedDict()
        self._project_revisions: dict[ProjectIdentity, int] = {}
        self._lock = RLock()

    @property
    def topology_entry_count(self) -> int:
        """Return the number of retained hierarchy results."""
        with self._lock:
            return len(self._topologies)

    @property
    def evaluation_entry_count(self) -> int:
        """Return the number of retained clip evaluations."""
        with self._lock:
            return len(self._evaluations)

    @property
    def tracked_project_count(self) -> int:
        """Return project identities retained by at least one computation entry."""
        with self._lock:
            return len(self._project_revisions)

    def bone_order(self, project: RenderProject, rig: RigDefinition) -> tuple[str, ...]:
        """Return the stable cached parent-before-child order for ``rig``."""
        identity = self._project_identity(project)
        key: TopologyKey = (
            identity,
            project.project_revision,
            _model_fingerprint(rig),
        )
        with self._lock:
            self._observe_revision(identity, project.project_revision)
            cached = self._topologies.get(key)
            if cached is not None:
                self._topologies.move_to_end(key)
                return cached
            try:
                order = topological_bone_order(rig)
            except RigDefinitionError:
                self._prune_project_revisions()
                raise
            self._topologies[key] = order
            self._topologies.move_to_end(key)
            self._trim(self._topologies, self._max_topology_entries)
            self._prune_project_revisions()
            return order

    def evaluate(
        self,
        project: RenderProject,
        rig: RigDefinition,
        clip: AnimationClip,
        direction: Direction,
        time_ms: float,
        bone_order: tuple[str, ...],
        evaluator: AnimationEvaluator,
    ) -> EvaluatedAnimation:
        """Return a direction-aware clip evaluation normalized to clip time."""
        normalized_time = normalize_clip_time(time_ms, clip.duration_ms, clip.loop)
        validated_order = validate_topological_bone_order(rig, bone_order)
        identity = self._project_identity(project)
        key: EvaluationKey = (
            identity,
            project.project_revision,
            _model_fingerprint(rig),
            _model_fingerprint(clip),
            direction.value,
            normalized_time,
        )
        with self._lock:
            self._observe_revision(identity, project.project_revision)
            cached = self._evaluations.get(key)
            if cached is not None:
                self._evaluations.move_to_end(key)
                return cached
            try:
                evaluated = evaluator.evaluate(
                    clip,
                    rig,
                    direction,
                    normalized_time,
                    bone_order=validated_order,
                )
            except (AnimationError, RigDefinitionError):
                self._prune_project_revisions()
                raise
            self._evaluations[key] = evaluated
            self._evaluations.move_to_end(key)
            self._trim(self._evaluations, self._max_evaluation_entries)
            self._prune_project_revisions()
            return evaluated

    def invalidate_project(self, project: RenderProject) -> None:
        """Discard every computation retained for one runtime project identity."""
        identity = self._project_identity(project)
        with self._lock:
            self._remove_project_entries(identity)
            self._project_revisions.pop(identity, None)

    def clear(self) -> None:
        """Discard all retained computations and revision observations."""
        with self._lock:
            self._topologies.clear()
            self._evaluations.clear()
            self._project_revisions.clear()

    def _observe_revision(self, identity: ProjectIdentity, revision: int) -> None:
        previous = self._project_revisions.get(identity)
        if previous is not None and previous != revision:
            self._remove_project_entries(identity)
        self._project_revisions[identity] = revision

    def _remove_project_entries(self, identity: ProjectIdentity) -> None:
        topology_keys = tuple(key for key in self._topologies if key[0] == identity)
        for topology_key in topology_keys:
            del self._topologies[topology_key]
        evaluation_keys = tuple(key for key in self._evaluations if key[0] == identity)
        for evaluation_key in evaluation_keys:
            del self._evaluations[evaluation_key]

    def _prune_project_revisions(self) -> None:
        live_identities = {key[0] for key in self._topologies}
        live_identities.update(key[0] for key in self._evaluations)
        stale_identities = tuple(
            identity for identity in self._project_revisions if identity not in live_identities
        )
        for identity in stale_identities:
            del self._project_revisions[identity]

    @staticmethod
    def _project_identity(project: RenderProject) -> ProjectIdentity:
        try:
            root = str(project.root.resolve(strict=False))
        except (OSError, RuntimeError) as exc:
            raise RenderError("The render project root cannot be resolved.") from exc
        return root, str(project.manifest.project_id)

    @staticmethod
    def _positive_int(value: int, name: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"{name} must be a positive integer")
        return value

    @staticmethod
    def _trim[KeyT, ValueT](entries: OrderedDict[KeyT, ValueT], limit: int) -> None:
        while len(entries) > limit:
            entries.popitem(last=False)


__all__ = [
    "DEFAULT_MAX_EVALUATION_ENTRIES",
    "DEFAULT_MAX_TOPOLOGY_ENTRIES",
    "RenderComputationCache",
]
