"""Integration tests for AF-032 persistence and replacement safety."""

from __future__ import annotations

from pathlib import Path

from animated_fabric.application.apply_rig_template import (
    RIG_TEMPLATE_APPLICATION_FAILURE_CODE,
    RIG_TEMPLATE_REPLACEMENT_REQUIRED_CODE,
    ApplyRigTemplate,
    ApplyRigTemplateRequest,
)
from animated_fabric.application.humanoid_rig import RIG_TEMPLATE_MISSING_PART_CODE
from animated_fabric.domain._base import ProjectPath
from animated_fabric.domain.assets import AssetLayer, LayerManifest
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.exceptions import ProjectValidationError, ProjectValidationKind
from animated_fabric.domain.geometry import IntPoint, IntSize
from animated_fabric.domain.project import Direction
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation import ProjectValidator, ValidationCode, ValidationInput
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from animated_fabric.templates import JsonRigTemplateRegistry

_DIGEST = "a" * 64


def _catalog(
    *,
    omit: tuple[str, Direction] | None = None,
    mixed_alias: bool = False,
) -> LayerManifest:
    template = JsonRigTemplateRegistry().get("humanoid_v1")
    layers = []
    for part in template.required_parts:
        for direction in (Direction.SE, Direction.NE):
            if omit == (part.part_id, direction):
                continue
            prefix = direction.value.lower()
            use_alias = mixed_alias and part.part_id == "upper_arm_l" and direction is Direction.NE
            asset_part = "left_upper_arm" if use_alias else part.part_id
            layers.append(
                AssetLayer(
                    asset_id=f"{prefix}_{asset_part}",
                    direction=direction,
                    semantic_part=asset_part,
                    path=f"source/layers/{direction.value}/{asset_part}.png",
                    source_canvas_size=IntSize(width=192, height=192),
                    trim_origin=IntPoint(x=0, y=0),
                    trim_size=IntSize(width=192, height=192),
                    sha256=_DIGEST,
                )
            )
    return LayerManifest(
        format="animated-fabric.layer-manifest.v1",
        schema_version="0.1.0",
        layers=tuple(sorted(layers, key=lambda asset: asset.asset_id)),
    )


def _use_case(repository: JsonProjectRepository) -> ApplyRigTemplate:
    return ApplyRigTemplate(
        repository,
        repository,
        JsonRigTemplateRegistry(),
        ProjectValidator(),
    )


def test_apply_persists_canonical_rig_and_requires_explicit_repeat_confirmation(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    repository.save(root, project)
    repository.save_layer_manifest(root, _catalog())
    use_case = _use_case(repository)

    first = use_case.execute(ApplyRigTemplateRequest(project_root=root))

    assert first.value is not None
    assert not first.has_errors
    rig_path = root / project.rig_path
    first_bytes = rig_path.read_bytes()
    assert repository.load_rig(root, project.rig_path) == first.value.rig

    blocked = use_case.execute(ApplyRigTemplateRequest(project_root=root))

    assert blocked.value is None
    assert [item.code for item in blocked.diagnostics] == [RIG_TEMPLATE_REPLACEMENT_REQUIRED_CODE]
    assert rig_path.read_bytes() == first_bytes

    replaced = use_case.execute(ApplyRigTemplateRequest(project_root=root, replace_existing=True))

    assert replaced.value is not None
    assert not replaced.has_errors
    assert rig_path.read_bytes() == first_bytes


def test_missing_required_asset_never_publishes_partial_rig(tmp_path: Path) -> None:
    root = tmp_path / "project"
    repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    repository.save(root, project)
    repository.save_layer_manifest(root, _catalog(omit=("head", Direction.NE)))

    result = _use_case(repository).execute(ApplyRigTemplateRequest(project_root=root))

    assert result.value is None
    assert result.has_errors
    assert RIG_TEMPLATE_MISSING_PART_CODE in {item.code for item in result.diagnostics}
    assert not (root / project.rig_path).exists()


def test_mixed_canonical_and_alias_directions_validate_as_one_template_part(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    repository.save(root, project)
    repository.save_layer_manifest(root, _catalog(mixed_alias=True))

    result = _use_case(repository).execute(ApplyRigTemplateRequest(project_root=root))

    assert result.value is not None, result.diagnostics
    binding = next(part for part in result.value.rig.parts if part.part_id == "upper_arm_l")
    assert binding.assets_by_direction[Direction.SE] == "se_upper_arm_l"
    assert binding.assets_by_direction[Direction.NE] == "ne_left_upper_arm"
    persisted_rig = repository.load_rig(root, project.rig_path)
    persisted_catalog = repository.load_layer_manifest(root)
    assert not ProjectValidator().validate(
        ValidationInput(
            manifest=project,
            rig=persisted_rig,
            assets=persisted_catalog.layers,
        )
    )


def test_unmapped_one_view_garment_remains_a_nonblocking_validator_warning(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    repository.save(root, project)
    catalog = _catalog()
    extra = AssetLayer(
        asset_id="se_banner",
        direction=Direction.SE,
        semantic_part="banner",
        path="source/layers/SE/banner.png",
        source_canvas_size=IntSize(width=192, height=192),
        trim_origin=IntPoint(x=0, y=0),
        trim_size=IntSize(width=192, height=192),
        sha256=_DIGEST,
    )
    repository.save_layer_manifest(
        root,
        catalog.model_copy(
            update={
                "layers": tuple(sorted((*catalog.layers, extra), key=lambda asset: asset.asset_id))
            }
        ),
    )

    result = _use_case(repository).execute(ApplyRigTemplateRequest(project_root=root))

    assert result.value is not None, result.diagnostics
    assert [item.code for item in result.diagnostics] == [ValidationCode.PART_WITHOUT_BINDING.value]


def test_invalid_existing_rig_requires_confirmation_before_atomic_replacement(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    repository.save(root, project)
    repository.save_layer_manifest(root, _catalog())
    rig_path = root / project.rig_path
    rig_path.parent.mkdir(parents=True)
    rig_path.write_text("{not valid json", encoding="utf-8")
    use_case = _use_case(repository)

    blocked = use_case.execute(ApplyRigTemplateRequest(project_root=root))

    assert [item.code for item in blocked.diagnostics] == [RIG_TEMPLATE_REPLACEMENT_REQUIRED_CODE]
    assert rig_path.read_text(encoding="utf-8") == "{not valid json"

    replaced = use_case.execute(ApplyRigTemplateRequest(project_root=root, replace_existing=True))

    assert replaced.value is not None
    assert repository.load_rig(root, project.rig_path) == replaced.value.rig


def test_missing_layer_catalog_returns_typed_failure_without_writing(tmp_path: Path) -> None:
    root = tmp_path / "project"
    repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    repository.save(root, project)

    result = _use_case(repository).execute(ApplyRigTemplateRequest(project_root=root))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_TEMPLATE_APPLICATION_FAILURE_CODE]
    assert not (root / project.rig_path).exists()


def test_save_failure_is_a_typed_result_and_leaves_no_rig(tmp_path: Path) -> None:
    class FailingSaveRepository(JsonProjectRepository):
        def save_rig(
            self,
            root: Path,
            path: ProjectPath,
            rig: RigDefinition,
            *,
            replace_existing: bool = True,
        ) -> None:
            del root, rig, replace_existing
            raise ProjectValidationError(
                "The rig destination is read-only.",
                kind=ProjectValidationKind.FILESYSTEM,
                path=path,
            )

    root = tmp_path / "project"
    setup_repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    setup_repository.save(root, project)
    setup_repository.save_layer_manifest(root, _catalog())
    repository = FailingSaveRepository()

    result = _use_case(repository).execute(ApplyRigTemplateRequest(project_root=root))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == [RIG_TEMPLATE_APPLICATION_FAILURE_CODE]
    assert not (root / project.rig_path).exists()


def test_validator_error_blocks_publication_after_successful_construction(
    tmp_path: Path,
) -> None:
    class RejectingValidator(ProjectValidator):
        def validate(self, value: ValidationInput) -> tuple[Diagnostic, ...]:
            del value
            return (
                Diagnostic(
                    code="AFV999",
                    severity=Severity.ERROR,
                    message="Synthetic post-build rejection.",
                ),
            )

    root = tmp_path / "project"
    repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    repository.save(root, project)
    repository.save_layer_manifest(root, _catalog())
    use_case = ApplyRigTemplate(
        repository,
        repository,
        JsonRigTemplateRegistry(),
        RejectingValidator(),
    )

    result = use_case.execute(ApplyRigTemplateRequest(project_root=root))

    assert result.value is None
    assert [item.code for item in result.diagnostics] == ["AFV999"]
    assert not (root / project.rig_path).exists()
