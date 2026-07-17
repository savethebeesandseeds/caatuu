"""Unit tests for AF-030 application import contracts and orchestration."""

from __future__ import annotations

from pathlib import Path

import pytest

from animated_fabric.application.import_layers import (
    IMPORT_FAILURE_CODE,
    ImportInspection,
    ImportLayerSet,
    ImportLimits,
    ImportResult,
    InspectedLayer,
    InspectLayerFolder,
    LayerImporter,
    LayerImportRequest,
)
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.exceptions import AssetImportError
from animated_fabric.domain.geometry import IntSize
from animated_fabric.domain.project import Direction
from animated_fabric.infrastructure.fixtures import build_stick_humanoid_manifest
from animated_fabric.infrastructure.persistence import JsonProjectRepository


class StubImporter:
    """Controllable importer port used to isolate application behavior."""

    def __init__(
        self,
        *,
        inspection: ImportInspection | None = None,
        result: ImportResult | None = None,
        error: AssetImportError | None = None,
    ) -> None:
        self.inspection = inspection or ImportInspection()
        self.result = result or ImportResult(
            imported_assets=(),
            catalog_assets=(),
            manifest_path="layers.manifest.json",
        )
        self.error = error
        self.inspected_source: Path | None = None
        self.import_request: LayerImportRequest | None = None

    def inspect(self, source: Path) -> ImportInspection:
        self.inspected_source = source
        if self.error is not None:
            raise self.error
        return self.inspection

    def import_layers(self, request: LayerImportRequest) -> ImportResult:
        self.import_request = request
        if self.error is not None:
            raise self.error
        return self.result


def test_stub_satisfies_layer_importer_port() -> None:
    importer: LayerImporter = StubImporter()

    assert callable(importer.inspect)
    assert callable(importer.import_layers)


def test_inspection_use_case_preserves_value_and_diagnostics(tmp_path: Path) -> None:
    warning = Diagnostic(
        code="AFV103",
        severity=Severity.WARNING,
        message="Transparent layer.",
    )
    inspection = ImportInspection(diagnostics=(warning,))
    importer = StubImporter(inspection=inspection)

    result = InspectLayerFolder(importer).execute(tmp_path)

    assert result.value is inspection
    assert result.diagnostics == (warning,)
    assert result.is_success
    assert importer.inspected_source == tmp_path


def test_import_use_case_preserves_value_and_diagnostics(tmp_path: Path) -> None:
    warning = Diagnostic(
        code="AFV107",
        severity=Severity.WARNING,
        message="Art touches an edge.",
    )
    imported = ImportResult(
        imported_assets=(),
        catalog_assets=(),
        manifest_path="layers.manifest.json",
        diagnostics=(warning,),
    )
    importer = StubImporter(result=imported)
    repository = JsonProjectRepository()
    repository.save(tmp_path, build_stick_humanoid_manifest())
    request = LayerImportRequest(
        project_root=tmp_path,
        source=tmp_path,
        direction=Direction.SE,
        assignments=(),
    )

    result = ImportLayerSet(importer, repository).execute(request)

    assert result.value is imported
    assert result.diagnostics == (warning,)
    assert result.is_success
    assert importer.import_request is request


@pytest.mark.parametrize("operation", ["inspect", "import"])
def test_expected_import_errors_become_actionable_diagnostics(
    tmp_path: Path,
    operation: str,
) -> None:
    importer = StubImporter(error=AssetImportError("Source detail is safe to report."))

    if operation == "inspect":
        result = InspectLayerFolder(importer).execute(tmp_path)
    else:
        repository = JsonProjectRepository()
        repository.save(tmp_path, build_stick_humanoid_manifest())
        request = LayerImportRequest(
            project_root=tmp_path,
            source=tmp_path,
            direction=Direction.SE,
            assignments=(),
        )
        result = ImportLayerSet(importer, repository).execute(request)

    assert result.value is None
    assert result.has_errors
    assert result.diagnostics[0].code == IMPORT_FAILURE_CODE
    assert result.diagnostics[0].message == "Source detail is safe to report."
    assert result.diagnostics[0].suggestion is not None


def test_import_use_case_requires_a_canonical_project_manifest(tmp_path: Path) -> None:
    importer = StubImporter()
    tmp_path.mkdir(exist_ok=True)
    request = LayerImportRequest(
        project_root=tmp_path,
        source=tmp_path,
        direction=Direction.SE,
        assignments=(),
    )

    result = ImportLayerSet(importer, JsonProjectRepository()).execute(request)

    assert result.has_errors
    assert result.diagnostics[0].code == IMPORT_FAILURE_CODE
    assert "Missing project manifest" in result.diagnostics[0].message
    assert importer.inspected_source is None
    assert importer.import_request is None


def test_import_use_case_rejects_mirrored_direction_before_publication(tmp_path: Path) -> None:
    repository = JsonProjectRepository()
    repository.save(tmp_path, build_stick_humanoid_manifest())
    importer = StubImporter()
    request = LayerImportRequest(
        project_root=tmp_path,
        source=tmp_path,
        direction=Direction.SW,
        assignments=(),
    )

    result = ImportLayerSet(importer, repository).execute(request)

    assert result.has_errors
    assert result.diagnostics[0].code == "AFI008"
    assert "not authored" in result.diagnostics[0].message
    assert importer.import_request is None


def test_import_use_case_rejects_layer_canvas_mismatch_before_publication(
    tmp_path: Path,
) -> None:
    repository = JsonProjectRepository()
    repository.save(tmp_path, build_stick_humanoid_manifest())
    layer = InspectedLayer(
        source_name="head.png",
        proposed_semantic_part="head",
        source_canvas_size=IntSize(width=5, height=4),
        alpha_origin=None,
        alpha_size=None,
        source_sha256="0" * 64,
        fully_transparent=True,
        touches_edge=False,
    )
    importer = StubImporter(inspection=ImportInspection(layers=(layer,)))
    request = LayerImportRequest(
        project_root=tmp_path,
        source=tmp_path,
        direction=Direction.SE,
        assignments=(),
    )

    result = ImportLayerSet(importer, repository).execute(request)

    assert result.has_errors
    assert result.diagnostics[0].code == "AFI007"
    assert "project canvas is 192 x 192" in result.diagnostics[0].message
    assert importer.import_request is None


@pytest.mark.parametrize(
    "changes",
    [
        {"max_layer_dimension": 0},
        {"max_layer_dimension": True},
        {"max_file_bytes": -1},
        {"max_layers": 0},
    ],
)
def test_import_limits_require_positive_non_boolean_integers(changes: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="positive integer"):
        ImportLimits(**changes)  # type: ignore[arg-type]
