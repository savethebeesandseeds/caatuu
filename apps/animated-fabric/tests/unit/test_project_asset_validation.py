"""Project-direction and asset-catalog validation contracts."""

from __future__ import annotations

import copy
import json

from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.diagnostics import Severity
from animated_fabric.domain.project import ProjectManifest
from animated_fabric.domain.rig import RigDefinition
from animated_fabric.domain.validation.models import (
    AssetObservation,
    ValidationCode,
    ValidationInput,
    diagnostic_sort_key,
)
from animated_fabric.domain.validation.project_assets import (
    MAX_LAYER_DIMENSION,
    validate_project_and_assets,
)

MANIFEST_DATA: dict[str, object] = {
    "format": "animated-fabric.project.v1",
    "schema_version": "0.1.0",
    "project_id": "7f22ab90-e64f-4af7-9298-55e38f7797fa",
    "slug": "eva_mage",
    "display_name": "Eva, Forest Mage",
    "template_id": "humanoid_v1",
    "canvas": {
        "width": 192,
        "height": 192,
        "ground_anchor": [96.0, 160.0],
        "pixel_snap": "none",
    },
    "directions": {
        "SE": {"mode": "authored"},
        "SW": {"mode": "mirror", "source": "SE"},
        "NE": {"mode": "authored"},
        "NW": {"mode": "mirror", "source": "NE"},
    },
    "rig_path": "rig/main.animated-rig.json",
    "animation_paths": [],
    "export_profiles": ["default_grid"],
    "selection_ellipse": {
        "center_offset": [0.0, -2.0],
        "radius_x": 20.0,
        "radius_y": 9.0,
    },
}


def _manifest(*, directions: dict[str, object] | None = None) -> ProjectManifest:
    data = copy.deepcopy(MANIFEST_DATA)
    if directions is not None:
        data["directions"] = directions
    return ProjectManifest.model_validate_json(json.dumps(data))


def _rig(
    *,
    parts: list[dict[str, object]] | None = None,
    direction_profiles: dict[str, object] | None = None,
) -> RigDefinition:
    return RigDefinition.model_validate_json(
        json.dumps(
            {
                "format": "animated-fabric.rig.v1",
                "schema_version": "0.1.0",
                "rig_id": "main",
                "template_id": "humanoid_v1",
                "bones": [
                    {
                        "bone_id": "root",
                        "parent_id": None,
                    }
                ],
                "parts": parts or [],
                "sockets": [],
                "direction_profiles": direction_profiles or {},
                "draw_slot_profiles": {},
            }
        )
    )


def _part(
    part_id: str,
    semantic_part: str,
    assets_by_direction: dict[str, str],
) -> dict[str, object]:
    return {
        "part_id": part_id,
        "semantic_part": semantic_part,
        "bone_id": "root",
        "assets_by_direction": assets_by_direction,
        "pivot_by_direction": {},
        "draw_slot": "torso",
    }


def _asset(
    asset_id: str,
    direction: str,
    semantic_part: str,
    *,
    optional: bool = False,
) -> AssetLayer:
    return AssetLayer.model_validate_json(
        json.dumps(
            {
                "asset_id": asset_id,
                "direction": direction,
                "semantic_part": semantic_part,
                "path": f"source/layers/{direction}/{semantic_part}_{asset_id}.png",
                "source_canvas_size": [192, 192],
                "trim_origin": [16, 20],
                "trim_size": [64, 80],
                "sha256": "a" * 64,
                "optional": optional,
            }
        )
    )


def _paired_input(
    *,
    se_observation: AssetObservation | None = None,
    optional: bool = False,
) -> ValidationInput:
    assets = (
        _asset("se_torso", "SE", "torso", optional=optional),
        _asset("ne_torso", "NE", "torso", optional=optional),
    )
    observations = None
    if se_observation is not None:
        observations = {
            "se_torso": se_observation,
            "ne_torso": AssetObservation(
                asset_id="ne_torso",
                width=64,
                height=80,
                fully_transparent=False,
                touches_edge=False,
                sha256="a" * 64,
            ),
        }
    return ValidationInput(
        manifest=_manifest(),
        rig=_rig(parts=[_part("body_torso", "torso", {"SE": "se_torso", "NE": "ne_torso"})]),
        assets=assets,
        asset_observations=observations,
    )


def test_valid_project_assets_have_no_diagnostics() -> None:
    value = _paired_input(
        se_observation=AssetObservation(
            asset_id="se_torso",
            width=64,
            height=80,
            fully_transparent=False,
            touches_edge=False,
            sha256="a" * 64,
        )
    )

    assert validate_project_and_assets(value) == ()


def test_required_directions_and_mirror_sources_emit_afv106() -> None:
    manifest = _manifest(
        directions={
            "SE": {"mode": "mirror", "source": "SW"},
            "SW": {"mode": "mirror", "source": "NE"},
        }
    )

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=manifest, rig=_rig(), assets=None)
    )

    assert [item.code for item in diagnostics] == [ValidationCode.AUTHORED_DIRECTION_MISSING] * 4
    assert {item.location for item in diagnostics} == {
        "directions.NE",
        "directions.NW",
        "directions.SE.mode",
        "directions.SW.source",
    }
    assert all(item.severity is Severity.ERROR for item in diagnostics)
    assert all(item.path == "project.animated-fabric.json" for item in diagnostics)
    assert all(item.suggestion for item in diagnostics)


def test_derived_directions_may_be_authored_directly() -> None:
    manifest = _manifest(
        directions={
            "SE": {"mode": "authored"},
            "SW": {"mode": "authored"},
            "NE": {"mode": "authored"},
            "NW": {"mode": "authored"},
        }
    )

    assert (
        validate_project_and_assets(ValidationInput(manifest=manifest, rig=_rig(), assets=None))
        == ()
    )


def test_absent_asset_catalog_skips_catalog_observation_and_rig_reference_checks() -> None:
    rig = _rig(parts=[_part("body_torso", "torso", {"SE": "missing_asset"})])
    value = ValidationInput(
        manifest=_manifest(),
        rig=rig,
        assets=None,
        asset_observations={
            "missing_asset": AssetObservation(asset_id="missing_asset", exists=False)
        },
    )

    assert validate_project_and_assets(value) == ()


def test_missing_nonoptional_file_emits_afv101_with_actionable_fields() -> None:
    diagnostics = validate_project_and_assets(
        _paired_input(
            se_observation=AssetObservation(asset_id="se_torso", exists=False),
        )
    )

    assert len(diagnostics) == 1
    diagnostic = diagnostics[0]
    assert diagnostic.code == ValidationCode.ASSET_MISSING
    assert diagnostic.severity is Severity.ERROR
    assert diagnostic.path == "source/layers/SE/torso_se_torso.png"
    assert diagnostic.location == "assets[0].path"
    assert diagnostic.suggestion == "Restore the PNG or mark the asset as optional."


def test_missing_optional_file_is_permitted() -> None:
    diagnostics = validate_project_and_assets(
        _paired_input(
            se_observation=AssetObservation(asset_id="se_torso", exists=False),
            optional=True,
        )
    )

    assert diagnostics == ()


def test_unreadable_png_emits_afv102() -> None:
    diagnostics = validate_project_and_assets(
        _paired_input(
            se_observation=AssetObservation(asset_id="se_torso", readable=False),
        )
    )

    assert [item.code for item in diagnostics] == [ValidationCode.PNG_UNREADABLE]
    assert diagnostics[0].severity is Severity.ERROR
    assert diagnostics[0].suggestion == "Replace the file with a readable PNG."


def test_observed_alpha_dimensions_edge_and_hash_emit_afv103_104_107_108() -> None:
    diagnostics = validate_project_and_assets(
        _paired_input(
            se_observation=AssetObservation(
                asset_id="se_torso",
                width=MAX_LAYER_DIMENSION + 1,
                height=80,
                fully_transparent=True,
                touches_edge=True,
                sha256="b" * 64,
            )
        )
    )

    assert [item.code for item in diagnostics] == [
        ValidationCode.TRANSPARENT_LAYER,
        ValidationCode.DIMENSIONS_EXCEEDED,
        ValidationCode.ART_TOUCHES_EDGE,
        ValidationCode.HASH_CHANGED,
    ]
    assert [item.severity for item in diagnostics] == [
        Severity.WARNING,
        Severity.ERROR,
        Severity.WARNING,
        Severity.WARNING,
    ]
    assert all(item.path == "source/layers/SE/torso_se_torso.png" for item in diagnostics)
    assert all(item.suggestion for item in diagnostics)


def test_duplicate_semantic_part_in_one_direction_emits_afv105() -> None:
    assets = (
        _asset("se_torso", "SE", "torso"),
        _asset("se_torso_alt", "SE", "torso"),
        _asset("ne_torso", "NE", "torso"),
    )
    rig = _rig(
        parts=[
            _part("body_torso", "torso", {"SE": "se_torso", "NE": "ne_torso"}),
            _part("body_torso_alt", "torso", {"SE": "se_torso_alt"}),
        ]
    )

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=_manifest(), rig=rig, assets=assets)
    )

    assert [item.code for item in diagnostics] == [ValidationCode.DUPLICATE_PART]
    assert diagnostics[0].location == "assets[1].semantic_part"
    assert "first declared by asset 'se_torso'" in diagnostics[0].message


def test_duplicate_asset_id_emits_afv109() -> None:
    assets = (
        _asset("shared_torso", "SE", "torso"),
        _asset("shared_torso", "NE", "torso"),
    )
    rig = _rig(
        parts=[
            _part(
                "body_torso",
                "torso",
                {"SE": "shared_torso", "NE": "shared_torso"},
            )
        ]
    )

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=_manifest(), rig=rig, assets=assets)
    )

    assert [item.code for item in diagnostics] == [ValidationCode.DUPLICATE_ASSET_ID]
    assert diagnostics[0].location == "assets[1].asset_id"
    assert "first declared at assets[0]" in diagnostics[0].message


def test_nonoptional_semantic_part_requires_every_authored_direction() -> None:
    asset = _asset("se_torso", "SE", "torso")
    rig = _rig(parts=[_part("body_torso", "torso", {"SE": "se_torso"})])

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=_manifest(), rig=rig, assets=(asset,))
    )

    assert [item.code for item in diagnostics] == [ValidationCode.AUTHORED_DIRECTION_MISSING]
    assert diagnostics[0].path == "source/layers/NE"
    assert diagnostics[0].location == "assets_by_direction.NE.torso"


def test_future_authored_direction_also_requires_nonoptional_part_coverage() -> None:
    manifest = _manifest(
        directions={
            "SE": {"mode": "authored"},
            "SW": {"mode": "authored"},
            "NE": {"mode": "authored"},
            "NW": {"mode": "mirror", "source": "NE"},
        }
    )
    assets = (
        _asset("se_torso", "SE", "torso"),
        _asset("ne_torso", "NE", "torso"),
    )
    rig = _rig(parts=[_part("body_torso", "torso", {"SE": "se_torso", "NE": "ne_torso"})])

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=manifest, rig=rig, assets=assets)
    )

    assert [item.code for item in diagnostics] == [ValidationCode.AUTHORED_DIRECTION_MISSING]
    assert diagnostics[0].location == "assets_by_direction.SW.torso"


def test_optional_semantic_part_does_not_require_cross_direction_coverage() -> None:
    asset = _asset("se_cape", "SE", "cape", optional=True)
    rig = _rig(parts=[_part("cape_part", "cape", {"SE": "se_cape"})])

    assert (
        validate_project_and_assets(ValidationInput(manifest=_manifest(), rig=rig, assets=(asset,)))
        == ()
    )


def test_binding_asset_from_wrong_direction_does_not_satisfy_authored_coverage() -> None:
    asset = _asset("ne_torso", "NE", "torso")
    rig = _rig(
        parts=[
            _part(
                "body_torso",
                "torso",
                {"SE": "ne_torso", "NE": "ne_torso"},
            )
        ]
    )

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=_manifest(), rig=rig, assets=(asset,))
    )

    assert [item.code for item in diagnostics] == [ValidationCode.AUTHORED_DIRECTION_MISSING]
    assert diagnostics[0].location == "assets_by_direction.SE.torso"


def test_profile_asset_from_wrong_direction_does_not_satisfy_coverage() -> None:
    assets = (_asset("ne_torso", "NE", "torso"),)
    rig = _rig(
        parts=[_part("body_torso", "torso", {})],
        direction_profiles={
            "SE": {"asset_selection": {"body_torso": "ne_torso"}},
            "NE": {"asset_selection": {"body_torso": "ne_torso"}},
        },
    )

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=_manifest(), rig=rig, assets=assets)
    )

    assert [item.code for item in diagnostics] == [ValidationCode.AUTHORED_DIRECTION_MISSING]
    assert diagnostics[0].location == "assets_by_direction.SE.torso"


def test_profile_only_asset_selections_are_bound_and_cover_authored_directions() -> None:
    assets = (
        _asset("se_torso", "SE", "torso"),
        _asset("ne_torso", "NE", "torso"),
    )
    rig = _rig(
        parts=[_part("body_torso", "torso", {})],
        direction_profiles={
            "SE": {"asset_selection": {"body_torso": "se_torso"}},
            "NE": {"asset_selection": {"body_torso": "ne_torso"}},
        },
    )

    assert (
        validate_project_and_assets(ValidationInput(manifest=_manifest(), rig=rig, assets=assets))
        == ()
    )


def test_rig_reference_absent_from_catalog_emits_afv101() -> None:
    rig = _rig(parts=[_part("body_torso", "torso", {"SE": "missing_asset"})])

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=_manifest(), rig=rig, assets=())
    )

    assert [item.code for item in diagnostics] == [ValidationCode.ASSET_MISSING]
    assert diagnostics[0].path == "rig/main.animated-rig.json"
    assert diagnostics[0].location == "parts[0].assets_by_direction.SE"
    assert diagnostics[0].suggestion == (
        "Add asset 'missing_asset' to the catalog or update the binding."
    )


def test_catalog_asset_unused_by_bindings_emits_afv204() -> None:
    asset = _asset("se_cape", "SE", "cape", optional=True)

    diagnostics = validate_project_and_assets(
        ValidationInput(manifest=_manifest(), rig=_rig(), assets=(asset,))
    )

    assert [item.code for item in diagnostics] == [ValidationCode.PART_WITHOUT_BINDING]
    assert diagnostics[0].severity is Severity.WARNING
    assert diagnostics[0].path == asset.path
    assert diagnostics[0].location == "assets[0].asset_id"


def test_diagnostics_follow_the_shared_stable_sort_order() -> None:
    asset = _asset("se_torso", "SE", "torso")
    value = ValidationInput(
        manifest=_manifest(),
        rig=_rig(parts=[_part("body_torso", "torso", {"NE": "missing_asset"})]),
        assets=(asset,),
        asset_observations={
            "se_torso": AssetObservation(
                asset_id="se_torso",
                fully_transparent=True,
                touches_edge=True,
                sha256="b" * 64,
            )
        },
    )

    diagnostics = validate_project_and_assets(value)

    assert diagnostics == tuple(sorted(diagnostics, key=diagnostic_sort_key))
    assert all(
        item.message and item.path and item.location and item.suggestion for item in diagnostics
    )
