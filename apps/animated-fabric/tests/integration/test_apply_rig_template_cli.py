"""CLI integration tests for the normative AF-032 rig command."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

import animated_fabric.cli.app as cli_module
from animated_fabric.application.apply_rig_template import (
    RIG_TEMPLATE_APPLICATION_FAILURE_CODE,
    RIG_TEMPLATE_REPLACEMENT_REQUIRED_CODE,
)
from animated_fabric.application.humanoid_rig import RIG_TEMPLATE_VALIDATION_CODE
from animated_fabric.cli.app import app
from animated_fabric.domain.assets import AssetLayer, LayerManifest
from animated_fabric.domain.geometry import IntPoint, IntSize
from animated_fabric.domain.project import Direction
from animated_fabric.domain.validation import ProjectValidator, ValidationInput
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from animated_fabric.templates import JsonRigTemplateRegistry

runner = CliRunner()
_DIGEST = "b" * 64


def _write_ready_project(root: Path, *, include_one_view_optional: bool = False) -> None:
    repository = JsonProjectRepository()
    project = build_stick_humanoid_manifest()
    repository.save(root, project)
    template = JsonRigTemplateRegistry().get("humanoid_v1")
    layer_values = [
        AssetLayer(
            asset_id=f"{direction.value.lower()}_{part.part_id}",
            direction=direction,
            semantic_part=part.part_id,
            path=f"source/layers/{direction.value}/{part.part_id}.png",
            source_canvas_size=IntSize(width=192, height=192),
            trim_origin=IntPoint(x=0, y=0),
            trim_size=IntSize(width=192, height=192),
            sha256=_DIGEST,
        )
        for part in template.required_parts
        for direction in (Direction.SE, Direction.NE)
    ]
    if include_one_view_optional:
        layer_values.append(
            AssetLayer(
                asset_id="se_hair_front",
                direction=Direction.SE,
                semantic_part="hair_front",
                path="source/layers/SE/hair_front.png",
                source_canvas_size=IntSize(width=192, height=192),
                trim_origin=IntPoint(x=0, y=0),
                trim_size=IntSize(width=192, height=192),
                sha256=_DIGEST,
            )
        )
    layers = tuple(sorted(layer_values, key=lambda asset: asset.asset_id))
    repository.save_layer_manifest(
        root,
        LayerManifest(
            format="animated-fabric.layer-manifest.v1",
            schema_version="0.1.0",
            layers=layers,
        ),
    )


def test_rig_apply_template_command_persists_and_reports_created_structure(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    _write_ready_project(root)

    result = runner.invoke(app, ["rig", "apply-template", str(root)])

    assert result.exit_code == 0, result.output
    assert "17 bones, 14 bound parts, and 8 sockets" in result.stdout
    assert (root / "rig/main.animated-rig.json").is_file()


def test_rig_apply_template_json_requires_and_accepts_explicit_replacement(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    _write_ready_project(root)
    assert runner.invoke(app, ["rig", "apply-template", str(root)]).exit_code == 0

    blocked = runner.invoke(app, ["rig", "apply-template", str(root), "--json"])

    assert blocked.exit_code == 2
    assert [item["code"] for item in json.loads(blocked.stdout)] == [
        RIG_TEMPLATE_REPLACEMENT_REQUIRED_CODE
    ]

    replaced = runner.invoke(
        app,
        [
            "rig",
            "apply-template",
            str(root),
            "--replace-existing",
            "--json",
        ],
    )

    assert replaced.exit_code == 0, replaced.output
    assert json.loads(replaced.stdout) == []


def test_cli_honors_template_optionality_for_a_one_view_import(tmp_path: Path) -> None:
    root = tmp_path / "project"
    _write_ready_project(root, include_one_view_optional=True)

    result = runner.invoke(app, ["rig", "apply-template", str(root)])

    assert result.exit_code == 0, result.output
    assert "WARNING AFT004" in result.stdout
    repository = JsonProjectRepository()
    project = repository.load(root)
    rig = repository.load_rig(root, project.rig_path)
    assert not rig.direction_profiles[Direction.NE].part_visibility["hair_front"]
    catalog = repository.load_layer_manifest(root)
    assert not ProjectValidator().validate(
        ValidationInput(manifest=project, rig=rig, assets=catalog.layers)
    )


def test_missing_project_is_an_expected_input_failure() -> None:
    result = runner.invoke(
        app,
        ["rig", "apply-template", "missing-project", "--json"],
    )

    assert result.exit_code == 3
    assert [item["code"] for item in json.loads(result.stdout)] == [
        RIG_TEMPLATE_APPLICATION_FAILURE_CODE
    ]


def test_structural_template_validation_uses_exit_two(tmp_path: Path) -> None:
    root = tmp_path / "project"
    _write_ready_project(root)
    repository = JsonProjectRepository()
    project = repository.load(root)
    repository.save(
        root,
        project.model_copy(update={"canvas": project.canvas.model_copy(update={"width": 193})}),
    )

    result = runner.invoke(app, ["rig", "apply-template", str(root), "--json"])

    assert result.exit_code == 2
    assert {item["code"] for item in json.loads(result.stdout)} == {RIG_TEMPLATE_VALIDATION_CODE}


def test_unexpected_rig_cli_failure_is_sanitized(
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    class ExplodingUseCase:
        def execute(self, request: object) -> None:
            del request
            raise RuntimeError("private rig failure details")

    monkeypatch.setattr(cli_module, "create_apply_rig_template", ExplodingUseCase)

    result = runner.invoke(app, ["rig", "apply-template", "project", "--json"])

    assert result.exit_code == 10
    assert [item["code"] for item in json.loads(result.stdout)] == ["AFC010"]
    assert "private rig failure details" not in result.stdout
