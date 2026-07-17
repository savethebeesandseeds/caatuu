"""AF-023 tests for bounded revision-aware renderer computations."""

from __future__ import annotations

from pathlib import Path

import pytest

import animated_fabric.application.render_cache as render_cache_module
from animated_fabric.application.render_cache import RenderComputationCache
from animated_fabric.application.rendering import RenderProject
from animated_fabric.domain.animation import AnimationClip
from animated_fabric.domain.animation_evaluator import AnimationEvaluator, EvaluatedAnimation
from animated_fabric.domain.exceptions import AnimationError, RigDefinitionError
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.infrastructure.fixtures import (
    build_stick_humanoid_manifest,
    build_stick_humanoid_rig,
)


def _project(root: Path, revision: int = 0) -> RenderProject:
    return RenderProject(
        root=root,
        manifest=build_stick_humanoid_manifest(),
        assets={},
        project_revision=revision,
    )


def _clip(clip_id: str = "idle") -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id=clip_id,
        display_name=clip_id.title(),
        template_id="humanoid_v1",
        duration_ms=100,
        loop=True,
        fps_hint=12,
    )


class _CountingEvaluator(AnimationEvaluator):
    def __init__(self) -> None:
        self.calls = 0

    def evaluate(
        self,
        clip: AnimationClip,
        rig: RigDefinition,
        direction: Direction,
        time_ms: float,
        *,
        bone_order: tuple[str, ...] | None = None,
    ) -> EvaluatedAnimation:
        self.calls += 1
        return super().evaluate(
            clip,
            rig,
            direction,
            time_ms,
            bone_order=bone_order,
        )


def test_cache_hits_topology_and_normalized_clip_evaluation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = _project(tmp_path)
    rig = build_stick_humanoid_rig()
    evaluator = _CountingEvaluator()
    topology_calls = 0
    original_order = render_cache_module.topological_bone_order

    def counting_order(candidate: RigDefinition) -> tuple[str, ...]:
        nonlocal topology_calls
        topology_calls += 1
        return original_order(candidate)

    monkeypatch.setattr(render_cache_module, "topological_bone_order", counting_order)
    cache = RenderComputationCache()

    first_order = cache.bone_order(project, rig)
    second_order = cache.bone_order(project, rig)
    first_frame = cache.evaluate(
        project,
        rig,
        _clip(),
        Direction.SE,
        25.0,
        first_order,
        evaluator,
    )
    repeated_loop_frame = cache.evaluate(
        project,
        rig,
        _clip(),
        Direction.SE,
        125.0,
        second_order,
        evaluator,
    )

    assert first_order is second_order
    assert first_frame is repeated_loop_frame
    assert topology_calls == 1
    assert evaluator.calls == 1
    assert cache.topology_entry_count == 1
    assert cache.evaluation_entry_count == 1


def test_revision_change_evicts_stale_topology_and_evaluations(tmp_path: Path) -> None:
    rig = build_stick_humanoid_rig()
    evaluator = _CountingEvaluator()
    cache = RenderComputationCache()
    revision_zero = _project(tmp_path, revision=0)
    order = cache.bone_order(revision_zero, rig)
    cache.evaluate(
        revision_zero,
        rig,
        _clip(),
        Direction.SE,
        0,
        order,
        evaluator,
    )

    revision_one = _project(tmp_path, revision=1)
    refreshed_order = cache.bone_order(revision_one, rig)

    assert refreshed_order == order
    assert cache.topology_entry_count == 1
    assert cache.evaluation_entry_count == 0
    cache.evaluate(
        revision_one,
        rig,
        _clip(),
        Direction.SE,
        0,
        refreshed_order,
        evaluator,
    )
    assert evaluator.calls == 2
    assert cache.evaluation_entry_count == 1


def test_evaluation_cache_does_not_trust_an_invalid_order_on_a_cache_hit(tmp_path: Path) -> None:
    project = _project(tmp_path)
    rig = build_stick_humanoid_rig()
    evaluator = _CountingEvaluator()
    cache = RenderComputationCache()
    order = cache.bone_order(project, rig)
    cache.evaluate(project, rig, _clip(), Direction.SE, 0, order, evaluator)

    with pytest.raises(RigDefinitionError, match="every rig bone exactly once"):
        cache.evaluate(project, rig, _clip(), Direction.SE, 0, (), evaluator)

    assert evaluator.calls == 1


def test_cache_capacity_is_bounded_and_explicit_lifecycle_clears_entries(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)
    evaluator = _CountingEvaluator()
    cache = RenderComputationCache(max_topology_entries=2, max_evaluation_entries=2)

    rigs = tuple(
        build_stick_humanoid_rig().model_copy(update={"rig_id": f"fixture_{index}"})
        for index in range(3)
    )
    for rig in rigs:
        cache.bone_order(project, rig)
    order = cache.bone_order(project, rigs[-1])
    for index in range(3):
        cache.evaluate(
            project,
            rigs[-1],
            _clip(f"idle_{index}"),
            Direction.SE,
            0,
            order,
            evaluator,
        )

    assert cache.topology_entry_count == 2
    assert cache.evaluation_entry_count == 2
    cache.invalidate_project(project)
    assert cache.topology_entry_count == 0
    assert cache.evaluation_entry_count == 0

    cache.bone_order(project, rigs[0])
    cache.clear()
    assert cache.topology_entry_count == 0


def test_project_revision_registry_is_pruned_with_lru_entries(tmp_path: Path) -> None:
    rig = build_stick_humanoid_rig()
    cache = RenderComputationCache(max_topology_entries=2)

    for index in range(5):
        cache.bone_order(_project(tmp_path / f"project_{index}"), rig)

    assert cache.topology_entry_count == 2
    assert cache.tracked_project_count == 2


def test_failed_computations_do_not_retain_project_revision_identities(tmp_path: Path) -> None:
    valid_rig = build_stick_humanoid_rig()
    invalid_rig = valid_rig.model_copy(update={"bones": ()})
    cache = RenderComputationCache()

    for index in range(5):
        with pytest.raises(RigDefinitionError, match="at least one bone"):
            cache.bone_order(_project(tmp_path / f"invalid_{index}"), invalid_rig)

    bad_clip = _clip().model_copy(update={"template_id": "other_template"})
    with pytest.raises(AnimationError, match="does not match rig template"):
        cache.evaluate(
            _project(tmp_path / "bad_clip"),
            valid_rig,
            bad_clip,
            Direction.SE,
            0,
            ("root",),
            _CountingEvaluator(),
        )

    assert cache.topology_entry_count == 0
    assert cache.evaluation_entry_count == 0
    assert cache.tracked_project_count == 0


@pytest.mark.parametrize("limit", [0, -1, True, 1.5])
def test_cache_rejects_non_positive_or_non_integer_bounds(limit: object) -> None:
    with pytest.raises(ValueError, match="positive integer"):
        RenderComputationCache(max_topology_entries=limit)  # type: ignore[arg-type]
