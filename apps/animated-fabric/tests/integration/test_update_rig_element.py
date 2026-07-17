"""Integration and render proofs for the AF-033 rig-editing boundary."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

import animated_fabric.infrastructure.persistence.json_project_repository as repository_module
from animated_fabric.application.apply_rig_template import (
    ApplyRigTemplate,
    ApplyRigTemplateRequest,
)
from animated_fabric.application.import_layers import (
    ImportLayerSet,
    LayerAssignment,
    LayerImportRequest,
)
from animated_fabric.application.ports import (
    LAYER_MANIFEST_FILENAME,
    PROJECT_MANIFEST_FILENAME,
)
from animated_fabric.application.rendering import RenderProject, RenderRequest
from animated_fabric.application.update_rig_element import (
    RIG_UPDATE_FAILURE_CODE,
    RIG_UPDATE_REJECTED_CODE,
    AssignPart,
    ChangeDrawSlot,
    MoveBone,
    MovePivot,
    UpdateRigElement,
    UpdateRigElementRequest,
)
from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.assets import LayerManifest
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.exceptions import ProjectValidationError, ProjectValidationKind
from animated_fabric.domain.geometry import Vec2
from animated_fabric.domain.project import Direction, ProjectManifest
from animated_fabric.domain.rig import PartBinding, RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationCode, ValidationInput
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.imaging import OpenCvRenderer
from animated_fabric.infrastructure.importing import FolderLayerImporter
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from animated_fabric.templates import JsonRigTemplateRegistry
from scripts.generate_fixture_assets import generate_fixture_assets

RigUpdate = MoveBone | MovePivot | AssignPart | ChangeDrawSlot


@dataclass(frozen=True, slots=True)
class _PreparedProject:
    root: Path
    repository: JsonProjectRepository
    manifest: ProjectManifest
    catalog: LayerManifest
    rig: RigDefinition
    rig_path: Path


def _prepare_project(tmp_path: Path) -> _PreparedProject:
    generated = generate_fixture_assets(tmp_path / "generated")
    root = tmp_path / "project"
    repository = JsonProjectRepository()
    manifest = build_stick_humanoid_manifest()
    repository.save(root, manifest)
    importer = FolderLayerImporter(repository)
    import_layers = ImportLayerSet(importer, repository)

    for direction in (Direction.SE, Direction.NE):
        source = generated / "source" / "layers" / direction.value
        inspection = importer.inspect(source)
        assert not inspection.has_errors, inspection.diagnostics
        assignments = tuple(
            LayerAssignment(
                source_name=layer.source_name,
                semantic_part=layer.proposed_semantic_part,
            )
            for layer in inspection.layers
            if layer.proposed_semantic_part is not None
        )
        assert len(assignments) == len(inspection.layers)
        imported = import_layers.execute(
            LayerImportRequest(
                project_root=root,
                source=source,
                direction=direction,
                assignments=assignments,
            )
        )
        assert imported.value is not None, imported.diagnostics
        assert not imported.has_errors

    applied = ApplyRigTemplate(
        repository,
        repository,
        JsonRigTemplateRegistry(),
        ProjectValidator(),
    ).execute(ApplyRigTemplateRequest(project_root=root))
    assert applied.value is not None, applied.diagnostics
    assert not applied.has_errors

    catalog = repository.load_layer_manifest(root)
    rig_path = root.joinpath(*manifest.rig_path.split("/"))
    return _PreparedProject(
        root=root,
        repository=repository,
        manifest=manifest,
        catalog=catalog,
        rig=applied.value.rig,
        rig_path=rig_path,
    )


def _use_case(
    repository: JsonProjectRepository,
    validator: ProjectValidator | None = None,
) -> UpdateRigElement:
    return UpdateRigElement(
        repository,
        repository,
        validator or ProjectValidator(),
    )


def _project_input_bytes(project: _PreparedProject) -> dict[str, bytes]:
    paths = [
        project.root / PROJECT_MANIFEST_FILENAME,
        project.root / LAYER_MANIFEST_FILENAME,
        *sorted(path for path in (project.root / "source").rglob("*") if path.is_file()),
    ]
    return {path.relative_to(project.root).as_posix(): path.read_bytes() for path in paths}


def _part(rig: RigDefinition, part_id: str) -> PartBinding:
    return next(part for part in rig.parts if part.part_id == part_id)


def _update_for(edit_kind: str, rig: RigDefinition) -> RigUpdate:
    if edit_kind == "move_bone":
        current = rig.direction_profiles[Direction.SE].bone_rest_transforms["head"].position
        return MoveBone(
            bone_id="head",
            direction=Direction.SE,
            local_position=Vec2(x=current.x + 2.0, y=current.y + 1.0),
        )
    if edit_kind == "move_pivot":
        current = rig.direction_profiles[Direction.SE].pivots["head"]
        return MovePivot(
            part_id="head",
            direction=Direction.SE,
            pivot=Vec2(x=current.x + 2.0, y=current.y + 1.0),
        )
    if edit_kind == "assign_part":
        return AssignPart(part_id="head", bone_id="neck")
    if edit_kind == "change_draw_slot":
        return ChangeDrawSlot(part_id="head", draw_slot="torso")
    raise AssertionError(f"Unknown integration edit kind: {edit_kind}")


def _noop_update_for(edit_kind: str, rig: RigDefinition) -> RigUpdate:
    if edit_kind == "move_bone":
        current = rig.direction_profiles[Direction.SE].bone_rest_transforms["head"].position
        return MoveBone(
            bone_id="head",
            direction=Direction.SE,
            local_position=current,
        )
    if edit_kind == "move_pivot":
        current = rig.direction_profiles[Direction.SE].pivots["head"]
        return MovePivot(part_id="head", direction=Direction.SE, pivot=current)
    if edit_kind == "assign_part":
        return AssignPart(part_id="head", bone_id=_part(rig, "head").bone_id)
    if edit_kind == "change_draw_slot":
        return ChangeDrawSlot(part_id="head", draw_slot=_part(rig, "head").draw_slot)
    raise AssertionError(f"Unknown integration edit kind: {edit_kind}")


def _assert_applied(before: RigDefinition, after: RigDefinition, update: RigUpdate) -> None:
    assert after.sockets == before.sockets
    if isinstance(update, MoveBone):
        assert after.bones == before.bones
        assert (
            after.direction_profiles[update.direction].bone_rest_transforms[update.bone_id].position
            == update.local_position
        )
        assert after.direction_profiles[Direction.NE] == before.direction_profiles[Direction.NE]
    elif isinstance(update, MovePivot):
        assert after.parts == before.parts
        assert after.direction_profiles[update.direction].pivots[update.part_id] == update.pivot
        assert after.direction_profiles[Direction.NE] == before.direction_profiles[Direction.NE]
    elif isinstance(update, AssignPart):
        assert _part(after, update.part_id).bone_id == update.bone_id
        assert after.direction_profiles == before.direction_profiles
    else:
        assert isinstance(update, ChangeDrawSlot)
        assert _part(after, update.part_id).draw_slot == update.draw_slot
        assert after.direction_profiles == before.direction_profiles
        assert after.draw_slot_profiles == before.draw_slot_profiles


@pytest.mark.parametrize(
    "edit_kind",
    ("move_bone", "move_pivot", "assign_part", "change_draw_slot"),
)
def test_each_edit_is_atomically_persisted_without_modifying_project_inputs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    edit_kind: str,
) -> None:
    project = _prepare_project(tmp_path)
    original_rig_bytes = project.rig_path.read_bytes()
    original_inputs = _project_input_bytes(project)
    update = _update_for(edit_kind, project.rig)
    original_replace = repository_module.os.replace
    replacements: list[tuple[Path, Path]] = []

    def recording_replace(source: str | Path, destination: str | Path) -> None:
        replacements.append((Path(source), Path(destination)))
        original_replace(source, destination)

    monkeypatch.setattr(repository_module.os, "replace", recording_replace)

    result = _use_case(project.repository).execute(
        UpdateRigElementRequest(project_root=project.root, update=update)
    )

    assert result.value is not None, result.diagnostics
    assert not result.has_errors
    assert result.value.changed is True
    assert result.value.project_revision_delta == 1
    assert result.value.rig_path == project.manifest.rig_path
    assert project.rig_path.read_bytes() != original_rig_bytes
    assert len(replacements) == 1
    assert replacements[0][1] == project.rig_path
    assert replacements[0][0].parent == project.rig_path.parent
    assert not list(project.rig_path.parent.glob(f".{project.rig_path.name}.*.tmp"))

    persisted = project.repository.load_rig(project.root, project.manifest.rig_path)
    assert persisted == result.value.rig
    _assert_applied(project.rig, persisted, update)
    assert _project_input_bytes(project) == original_inputs

    canonical_bytes = project.rig_path.read_bytes()
    project.repository.save_rig(project.root, project.manifest.rig_path, persisted)
    assert project.rig_path.read_bytes() == canonical_bytes
    assert len(replacements) == 2
    assert replacements[1][1] == project.rig_path
    assert project.repository.load_rig(project.root, project.manifest.rig_path) == persisted
    assert _project_input_bytes(project) == original_inputs


@pytest.mark.parametrize(
    "edit_kind",
    ("move_bone", "move_pivot", "assign_part", "change_draw_slot"),
)
def test_exact_value_edit_is_a_noop_that_never_calls_save(
    tmp_path: Path,
    edit_kind: str,
) -> None:
    class CountingRepository(JsonProjectRepository):
        def __init__(self) -> None:
            self.save_calls = 0

        def save_rig(
            self,
            root: Path,
            path: ProjectPath,
            rig: RigDefinition,
            *,
            replace_existing: bool = True,
        ) -> None:
            self.save_calls += 1
            super().save_rig(root, path, rig, replace_existing=replace_existing)

    project = _prepare_project(tmp_path)
    repository = CountingRepository()
    original_bytes = project.rig_path.read_bytes()

    result = _use_case(repository).execute(
        UpdateRigElementRequest(
            project_root=project.root,
            update=_noop_update_for(edit_kind, project.rig),
        )
    )

    assert result.value is not None, result.diagnostics
    assert not result.has_errors
    assert result.value.rig == project.rig
    assert result.value.changed is False
    assert result.value.project_revision_delta == 0
    assert repository.save_calls == 0
    assert project.rig_path.read_bytes() == original_bytes


def test_candidate_validator_error_prevents_publication(tmp_path: Path) -> None:
    class CountingRepository(JsonProjectRepository):
        def __init__(self) -> None:
            self.save_calls = 0

        def save_rig(
            self,
            root: Path,
            path: ProjectPath,
            rig: RigDefinition,
            *,
            replace_existing: bool = True,
        ) -> None:
            self.save_calls += 1
            super().save_rig(root, path, rig, replace_existing=replace_existing)

    class RejectingValidator(ProjectValidator):
        def validate(self, value: ValidationInput) -> tuple[Diagnostic, ...]:
            del value
            return (
                Diagnostic(
                    code="AFV999",
                    severity=Severity.ERROR,
                    message="Synthetic edited-rig rejection.",
                ),
            )

    project = _prepare_project(tmp_path)
    repository = CountingRepository()
    original_bytes = project.rig_path.read_bytes()
    original_inputs = _project_input_bytes(project)

    current = project.rig.direction_profiles[Direction.SE].pivots["head"]
    result = _use_case(repository, RejectingValidator()).execute(
        UpdateRigElementRequest(
            project_root=project.root,
            update=MovePivot(
                part_id="head",
                direction=Direction.SE,
                pivot=Vec2(x=current.x + 1.0, y=current.y),
            ),
        )
    )

    assert result.value is None
    assert result.has_errors
    assert [diagnostic.code for diagnostic in result.diagnostics] == ["AFV999"]
    assert repository.save_calls == 0
    assert project.rig_path.read_bytes() == original_bytes
    assert _project_input_bytes(project) == original_inputs


def test_far_effective_profile_pivot_warns_but_is_published(tmp_path: Path) -> None:
    project = _prepare_project(tmp_path)
    head_asset_id = project.rig.direction_profiles[Direction.SE].asset_selection["head"]
    head_asset = next(asset for asset in project.catalog.layers if asset.asset_id == head_asset_id)
    current = project.rig.direction_profiles[Direction.SE].pivots["head"]
    far_pivot = Vec2(x=float(2 * head_asset.trim_size.width + 1), y=current.y)

    result = _use_case(project.repository).execute(
        UpdateRigElementRequest(
            project_root=project.root,
            update=MovePivot(
                part_id="head",
                direction=Direction.SE,
                pivot=far_pivot,
            ),
        )
    )

    assert result.value is not None, result.diagnostics
    assert not result.has_errors
    assert result.value.changed is True
    assert result.value.project_revision_delta == 1
    pivot_warnings = [
        diagnostic
        for diagnostic in result.diagnostics
        if diagnostic.code == ValidationCode.PIVOT_FAR_OUTSIDE_ASSET.value
    ]
    assert len(pivot_warnings) == 1
    assert pivot_warnings[0].severity is Severity.WARNING
    assert pivot_warnings[0].location == "direction_profiles.SE.pivots.head"
    persisted = project.repository.load_rig(project.root, project.manifest.rig_path)
    assert persisted.direction_profiles[Direction.SE].pivots["head"] == far_pivot


def test_repository_save_failure_preserves_the_original_rig(tmp_path: Path) -> None:
    class FailingRepository(JsonProjectRepository):
        def __init__(self) -> None:
            self.save_calls = 0

        def save_rig(
            self,
            root: Path,
            path: ProjectPath,
            rig: RigDefinition,
            *,
            replace_existing: bool = True,
        ) -> None:
            del root, rig, replace_existing
            self.save_calls += 1
            raise ProjectValidationError(
                "Synthetic rig storage failure.",
                kind=ProjectValidationKind.FILESYSTEM,
                path=path,
            )

    project = _prepare_project(tmp_path)
    repository = FailingRepository()
    original_bytes = project.rig_path.read_bytes()
    original_inputs = _project_input_bytes(project)
    current = project.rig.direction_profiles[Direction.SE].pivots["head"]

    result = _use_case(repository).execute(
        UpdateRigElementRequest(
            project_root=project.root,
            update=MovePivot(
                part_id="head",
                direction=Direction.SE,
                pivot=Vec2(x=current.x + 3.0, y=current.y),
            ),
        )
    )

    assert result.value is None
    assert result.has_errors
    assert [diagnostic.code for diagnostic in result.diagnostics] == [RIG_UPDATE_FAILURE_CODE]
    assert repository.save_calls == 1
    assert project.rig_path.read_bytes() == original_bytes
    assert _project_input_bytes(project) == original_inputs


def test_directional_pivot_edit_changes_only_the_selected_render(tmp_path: Path) -> None:
    project = _prepare_project(tmp_path)
    render_project = RenderProject(
        root=project.root,
        manifest=project.manifest,
        assets={asset.asset_id: asset for asset in project.catalog.layers},
    )
    renderer = OpenCvRenderer()

    def render(rig: RigDefinition, direction: Direction) -> bytes:
        return renderer.render(
            RenderRequest(
                project=render_project,
                rig=rig,
                clip=None,
                direction=direction,
                time_ms=0.0,
            )
        ).rgba

    before_se = render(project.rig, Direction.SE)
    before_ne = render(project.rig, Direction.NE)
    current = project.rig.direction_profiles[Direction.SE].pivots["head"]

    result = _use_case(project.repository).execute(
        UpdateRigElementRequest(
            project_root=project.root,
            update=MovePivot(
                part_id="head",
                direction=Direction.SE,
                pivot=Vec2(x=current.x + 6.0, y=current.y),
            ),
        )
    )

    assert result.value is not None, result.diagnostics
    assert result.value.changed is True
    assert render(result.value.rig, Direction.SE) != before_se
    assert render(result.value.rig, Direction.NE) == before_ne
    assert project.repository.load_rig(project.root, project.manifest.rig_path) == result.value.rig


def test_identical_baselines_produce_identical_rig_bytes_and_diagnostics(
    tmp_path: Path,
) -> None:
    first = _prepare_project(tmp_path / "first")
    second = _prepare_project(tmp_path / "second")
    assert first.rig == second.rig
    assert first.rig_path.read_bytes() == second.rig_path.read_bytes()
    update = _update_for("move_bone", first.rig)

    first_result = _use_case(first.repository).execute(
        UpdateRigElementRequest(project_root=first.root, update=update)
    )
    second_result = _use_case(second.repository).execute(
        UpdateRigElementRequest(project_root=second.root, update=update)
    )

    assert first_result.value is not None, first_result.diagnostics
    assert second_result.value is not None, second_result.diagnostics
    assert first_result.value == second_result.value
    assert first_result.diagnostics == second_result.diagnostics
    assert first.rig_path.read_bytes() == second.rig_path.read_bytes()


@pytest.mark.parametrize("edit_kind", ("move_bone", "move_pivot"))
def test_directional_edits_reject_a_missing_authored_profile_without_saving(
    tmp_path: Path,
    edit_kind: str,
) -> None:
    class CountingRepository(JsonProjectRepository):
        def __init__(self) -> None:
            self.save_calls = 0

        def save_rig(
            self,
            root: Path,
            path: ProjectPath,
            rig: RigDefinition,
            *,
            replace_existing: bool = True,
        ) -> None:
            self.save_calls += 1
            super().save_rig(root, path, rig, replace_existing=replace_existing)

    project = _prepare_project(tmp_path)
    profiles = dict(project.rig.direction_profiles)
    profiles.pop(Direction.SE)
    missing_profile_rig = project.rig.model_copy(update={"direction_profiles": profiles})
    project.repository.save_rig(
        project.root,
        project.manifest.rig_path,
        missing_profile_rig,
    )
    original_bytes = project.rig_path.read_bytes()
    repository = CountingRepository()
    update: RigUpdate
    if edit_kind == "move_bone":
        update = MoveBone(
            bone_id="head",
            direction=Direction.SE,
            local_position=Vec2(x=1.0, y=1.0),
        )
    else:
        update = MovePivot(
            part_id="head",
            direction=Direction.SE,
            pivot=Vec2(x=1.0, y=1.0),
        )

    result = _use_case(repository).execute(
        UpdateRigElementRequest(project_root=project.root, update=update)
    )

    assert result.value is None
    assert [diagnostic.code for diagnostic in result.diagnostics] == [RIG_UPDATE_REJECTED_CODE]
    assert repository.save_calls == 0
    assert project.rig_path.read_bytes() == original_bytes
