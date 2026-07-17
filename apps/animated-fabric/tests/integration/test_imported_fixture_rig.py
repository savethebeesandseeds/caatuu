"""Vertical AF-030 -> AF-032 -> renderer proof for the owned humanoid fixture."""

from __future__ import annotations

from pathlib import Path

from PIL import Image
from typer.testing import CliRunner

from animated_fabric.application.rendering import RenderProject, RenderRequest
from animated_fabric.cli.app import app
from animated_fabric.domain.project import Direction
from animated_fabric.domain.validation import ProjectValidator, ValidationInput
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.imaging import OpenCvRenderer
from animated_fabric.infrastructure.persistence import JsonProjectRepository
from scripts.generate_fixture_assets import generate_fixture_assets

runner = CliRunner()


def test_imported_trimmed_fixture_applies_and_matches_reviewed_neutral_goldens(
    tmp_path: Path,
) -> None:
    generated = generate_fixture_assets(tmp_path / "generated")
    project_root = tmp_path / "imported_project"
    repository = JsonProjectRepository()
    repository.save(project_root, build_stick_humanoid_manifest())
    for direction in (Direction.SE, Direction.NE):
        imported = runner.invoke(
            app,
            [
                "import-layers",
                str(project_root),
                "--direction",
                direction.value,
                "--source",
                str(generated / "source" / "layers" / direction.value),
                "--yes",
            ],
        )
        assert imported.exit_code == 0, imported.output

    applied = runner.invoke(app, ["rig", "apply-template", str(project_root)])

    assert applied.exit_code == 0, applied.output
    assert "17 bones, 14 bound parts, and 8 sockets" in applied.stdout
    assert not (project_root / "fixture_manifest.json").exists()

    manifest = repository.load(project_root)
    rig = repository.load_rig(project_root, manifest.rig_path)
    catalog = repository.load_layer_manifest(project_root)
    diagnostics = ProjectValidator().validate(
        ValidationInput(manifest=manifest, rig=rig, assets=catalog.layers)
    )
    assert not [item for item in diagnostics if item.severity.value == "error"]

    render_project = RenderProject(
        root=project_root,
        manifest=manifest,
        assets={asset.asset_id: asset for asset in catalog.layers},
    )
    renderer = OpenCvRenderer()
    golden_root = Path(__file__).parents[1] / "golden"
    for direction, golden_name in (
        (Direction.SE, "af023_stick_humanoid_neutral_se.png"),
        (Direction.NE, "af023_stick_humanoid_neutral_ne.png"),
    ):
        rendered = renderer.render(
            RenderRequest(
                project=render_project,
                rig=rig,
                clip=None,
                direction=direction,
                time_ms=0.0,
            )
        )
        with Image.open(golden_root / golden_name) as golden:
            assert golden.mode == "RGBA"
            assert golden.size == (192, 192)
            assert rendered.rgba == golden.tobytes()
