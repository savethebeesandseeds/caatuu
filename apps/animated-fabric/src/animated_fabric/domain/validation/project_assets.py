"""Pure structural validation for project directions and asset-layer facts."""

from __future__ import annotations

from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.project import Direction, DirectionMode
from animated_fabric.domain.rig import PartBinding
from animated_fabric.domain.validation.models import (
    AssetObservation,
    ValidationCode,
    ValidationInput,
    diagnostic_sort_key,
)

MAX_LAYER_DIMENSION = 2048
_PROJECT_MANIFEST_PATH = "project.animated-fabric.json"
_REQUIRED_AUTHORED_DIRECTIONS = (Direction.SE, Direction.NE)
_DEFAULT_MIRROR_SOURCES = {
    Direction.SW: Direction.SE,
    Direction.NW: Direction.NE,
}


def validate_project_and_assets(value: ValidationInput) -> tuple[Diagnostic, ...]:
    """Return deterministic project-direction and asset diagnostics without IO."""
    diagnostics: list[Diagnostic] = []
    _validate_direction_contract(value, diagnostics)

    if value.assets is not None:
        _validate_asset_catalog(value, diagnostics)

    return tuple(sorted(diagnostics, key=diagnostic_sort_key))


def _validate_direction_contract(
    value: ValidationInput,
    diagnostics: list[Diagnostic],
) -> None:
    directions = value.manifest.directions

    for direction in _REQUIRED_AUTHORED_DIRECTIONS:
        definition = directions.get(direction)
        if definition is None:
            diagnostics.append(
                _diagnostic(
                    ValidationCode.AUTHORED_DIRECTION_MISSING,
                    Severity.ERROR,
                    f"Required authored direction '{direction.value}' is missing.",
                    path=_PROJECT_MANIFEST_PATH,
                    location=f"directions.{direction.value}",
                    suggestion=f"Add direction '{direction.value}' with mode 'authored'.",
                )
            )
        elif definition.mode is not DirectionMode.AUTHORED:
            diagnostics.append(
                _diagnostic(
                    ValidationCode.AUTHORED_DIRECTION_MISSING,
                    Severity.ERROR,
                    f"Direction '{direction.value}' must be authored.",
                    path=_PROJECT_MANIFEST_PATH,
                    location=f"directions.{direction.value}.mode",
                    suggestion=f"Set direction '{direction.value}' to mode 'authored'.",
                )
            )

    for direction, expected_source in _DEFAULT_MIRROR_SOURCES.items():
        definition = directions.get(direction)
        if definition is None:
            diagnostics.append(
                _diagnostic(
                    ValidationCode.AUTHORED_DIRECTION_MISSING,
                    Severity.ERROR,
                    f"Required logical direction '{direction.value}' is missing.",
                    path=_PROJECT_MANIFEST_PATH,
                    location=f"directions.{direction.value}",
                    suggestion=(
                        f"Add direction '{direction.value}' with mode 'mirror' and source "
                        f"'{expected_source.value}'."
                    ),
                )
            )
        elif definition.mode is DirectionMode.MIRROR and definition.source is not expected_source:
            diagnostics.append(
                _diagnostic(
                    ValidationCode.AUTHORED_DIRECTION_MISSING,
                    Severity.ERROR,
                    (
                        f"Mirrored direction '{direction.value}' must use "
                        f"'{expected_source.value}' as its source."
                    ),
                    path=_PROJECT_MANIFEST_PATH,
                    location=f"directions.{direction.value}.source",
                    suggestion=(
                        f"Set the source to '{expected_source.value}' or author "
                        f"direction '{direction.value}' directly."
                    ),
                )
            )


def _validate_asset_catalog(
    value: ValidationInput,
    diagnostics: list[Diagnostic],
) -> None:
    assert value.assets is not None
    assets = value.assets
    observations = value.asset_observations
    catalog_asset_ids = {asset.asset_id for asset in assets}
    bound_asset_ids = {
        asset_id for part in value.rig.parts for asset_id in _part_asset_ids(value, part)
    }

    first_part_by_direction: dict[tuple[Direction, str], tuple[int, AssetLayer]] = {}
    first_asset_index_by_id: dict[str, int] = {}
    for index, asset in enumerate(assets):
        first_asset_index = first_asset_index_by_id.get(asset.asset_id)
        if first_asset_index is None:
            first_asset_index_by_id[asset.asset_id] = index
        else:
            diagnostics.append(
                _diagnostic(
                    ValidationCode.DUPLICATE_ASSET_ID,
                    Severity.ERROR,
                    (
                        f"Asset ID '{asset.asset_id}' is declared more than once; "
                        f"first declared at assets[{first_asset_index}]."
                    ),
                    path=asset.path,
                    location=f"assets[{index}].asset_id",
                    suggestion="Rename this asset so every asset ID is unique.",
                )
            )

        key = (asset.direction, asset.semantic_part)
        first = first_part_by_direction.get(key)
        if first is None:
            first_part_by_direction[key] = (index, asset)
        else:
            first_index, first_asset = first
            diagnostics.append(
                _diagnostic(
                    ValidationCode.DUPLICATE_PART,
                    Severity.ERROR,
                    (
                        f"Asset '{asset.asset_id}' duplicates semantic part "
                        f"'{asset.semantic_part}' for direction '{asset.direction.value}'; "
                        f"first declared by asset '{first_asset.asset_id}'."
                    ),
                    path=asset.path,
                    location=f"assets[{index}].semantic_part",
                    suggestion=(
                        f"Keep only one '{asset.semantic_part}' asset for direction "
                        f"'{asset.direction.value}' (first declaration: assets[{first_index}])."
                    ),
                )
            )

        if observations is not None:
            observation = observations.get(asset.asset_id)
            if observation is not None:
                _validate_asset_observation(index, asset, observation, diagnostics)

        if asset.asset_id not in bound_asset_ids:
            diagnostics.append(
                _diagnostic(
                    ValidationCode.PART_WITHOUT_BINDING,
                    Severity.WARNING,
                    f"Asset '{asset.asset_id}' is not used by any rig part binding.",
                    path=asset.path,
                    location=f"assets[{index}].asset_id",
                    suggestion=(
                        f"Bind asset '{asset.asset_id}' to a rig part or remove it from "
                        "the catalog."
                    ),
                )
            )

    _validate_authored_asset_coverage(value, diagnostics)
    _validate_rig_asset_references(value, catalog_asset_ids, diagnostics)


def _validate_asset_observation(
    index: int,
    asset: AssetLayer,
    observation: AssetObservation,
    diagnostics: list[Diagnostic],
) -> None:
    if not observation.exists:
        if not asset.optional:
            diagnostics.append(
                _diagnostic(
                    ValidationCode.ASSET_MISSING,
                    Severity.ERROR,
                    f"Asset file for '{asset.asset_id}' is missing.",
                    path=asset.path,
                    location=f"assets[{index}].path",
                    suggestion="Restore the PNG or mark the asset as optional.",
                )
            )
        return

    if not observation.readable:
        diagnostics.append(
            _diagnostic(
                ValidationCode.PNG_UNREADABLE,
                Severity.ERROR,
                f"Asset file for '{asset.asset_id}' is not a readable PNG.",
                path=asset.path,
                location=f"assets[{index}].path",
                suggestion="Replace the file with a readable PNG.",
            )
        )

    if observation.fully_transparent is True:
        diagnostics.append(
            _diagnostic(
                ValidationCode.TRANSPARENT_LAYER,
                Severity.WARNING,
                f"Asset '{asset.asset_id}' is completely transparent.",
                path=asset.path,
                location=f"assets[{index}].path",
                suggestion="Provide visible pixels or remove the empty layer.",
            )
        )

    if _exceeds_dimension_limit(observation):
        diagnostics.append(
            _diagnostic(
                ValidationCode.DIMENSIONS_EXCEEDED,
                Severity.ERROR,
                (
                    f"Asset '{asset.asset_id}' exceeds the maximum layer dimension of "
                    f"{MAX_LAYER_DIMENSION} pixels."
                ),
                path=asset.path,
                location=f"assets[{index}].trim_size",
                suggestion=(
                    f"Resize the PNG so neither dimension exceeds {MAX_LAYER_DIMENSION} pixels."
                ),
            )
        )

    if observation.touches_edge is True:
        diagnostics.append(
            _diagnostic(
                ValidationCode.ART_TOUCHES_EDGE,
                Severity.WARNING,
                f"Visible art in asset '{asset.asset_id}' touches the source canvas edge.",
                path=asset.path,
                location=f"assets[{index}].path",
                suggestion="Add transparent padding inside the source canvas.",
            )
        )

    if observation.sha256 is not None and observation.sha256 != asset.sha256:
        diagnostics.append(
            _diagnostic(
                ValidationCode.HASH_CHANGED,
                Severity.WARNING,
                f"Asset '{asset.asset_id}' does not match its recorded SHA-256 digest.",
                path=asset.path,
                location=f"assets[{index}].sha256",
                suggestion="Re-import the layer or update its recorded digest after review.",
            )
        )


def _exceeds_dimension_limit(observation: AssetObservation) -> bool:
    return (observation.width is not None and observation.width > MAX_LAYER_DIMENSION) or (
        observation.height is not None and observation.height > MAX_LAYER_DIMENSION
    )


def _validate_authored_asset_coverage(
    value: ValidationInput,
    diagnostics: list[Diagnostic],
) -> None:
    assert value.assets is not None
    assets_by_id = {asset.asset_id: asset for asset in value.assets}
    seen_asset_ids: set[str] = set()
    duplicate_asset_ids: set[str] = set()
    for asset in value.assets:
        if asset.asset_id in seen_asset_ids:
            duplicate_asset_ids.add(asset.asset_id)
        seen_asset_ids.add(asset.asset_id)
    authored_directions = tuple(
        direction
        for direction in Direction
        if (
            (definition := value.manifest.directions.get(direction)) is not None
            and definition.mode is DirectionMode.AUTHORED
        )
    )

    parts_by_semantic: dict[str, list[PartBinding]] = {}
    for part in value.rig.parts:
        parts_by_semantic.setdefault(part.semantic_part, []).append(part)

    for semantic_part, semantic_parts in parts_by_semantic.items():
        bound_assets = tuple(
            assets_by_id[asset_id]
            for part in semantic_parts
            for asset_id in _part_asset_ids(value, part)
            if asset_id in assets_by_id
        )
        if not bound_assets or all(asset.optional for asset in bound_assets):
            continue
        for direction in authored_directions:
            visible_parts = tuple(
                part for part in semantic_parts if _part_is_visible(value, part, direction)
            )
            if not visible_parts:
                continue
            if any(
                _part_selection_covers_direction(
                    value,
                    part,
                    direction,
                    assets_by_id,
                    duplicate_asset_ids,
                )
                for part in visible_parts
            ):
                continue
            diagnostics.append(
                _diagnostic(
                    ValidationCode.AUTHORED_DIRECTION_MISSING,
                    Severity.ERROR,
                    (
                        f"Non-optional semantic part '{semantic_part}' has no asset for "
                        f"authored direction '{direction.value}'."
                    ),
                    path=f"source/layers/{direction.value}",
                    location=f"assets_by_direction.{direction.value}.{semantic_part}",
                    suggestion=(
                        f"Add a '{semantic_part}' asset for direction '{direction.value}' or "
                        "mark the part optional in every authored direction."
                    ),
                )
            )


def _part_is_visible(
    value: ValidationInput,
    part: PartBinding,
    direction: Direction,
) -> bool:
    profile = value.rig.direction_profiles.get(direction)
    if profile is None:
        return part.visible
    return profile.part_visibility.get(part.part_id, part.visible)


def _part_asset_ids(value: ValidationInput, part: PartBinding) -> tuple[str, ...]:
    asset_ids = list(part.assets_by_direction.values())
    for profile in value.rig.direction_profiles.values():
        asset_id = profile.asset_selection.get(part.part_id)
        if asset_id is not None:
            asset_ids.append(asset_id)
    return tuple(asset_ids)


def _part_selection_covers_direction(
    value: ValidationInput,
    part: PartBinding,
    direction: Direction,
    assets_by_id: dict[str, AssetLayer],
    duplicate_asset_ids: set[str],
) -> bool:
    profile = value.rig.direction_profiles.get(direction)
    asset_id = (
        profile.asset_selection.get(part.part_id)
        if profile is not None and part.part_id in profile.asset_selection
        else part.assets_by_direction.get(direction)
    )
    if asset_id is None:
        return False
    if asset_id in duplicate_asset_ids:
        return True
    asset = assets_by_id.get(asset_id)
    return asset is None or asset.direction is direction


def _validate_rig_asset_references(
    value: ValidationInput,
    catalog_asset_ids: set[str],
    diagnostics: list[Diagnostic],
) -> None:
    for part_index, part in enumerate(value.rig.parts):
        for direction, asset_id in part.assets_by_direction.items():
            if asset_id in catalog_asset_ids:
                continue
            diagnostics.append(
                _diagnostic(
                    ValidationCode.ASSET_MISSING,
                    Severity.ERROR,
                    (
                        f"Rig part '{part.part_id}' references asset '{asset_id}' for direction "
                        f"'{direction.value}', but that asset is absent from the catalog."
                    ),
                    path=value.manifest.rig_path,
                    location=(f"parts[{part_index}].assets_by_direction.{direction.value}"),
                    suggestion=f"Add asset '{asset_id}' to the catalog or update the binding.",
                )
            )


def _diagnostic(
    code: ValidationCode,
    severity: Severity,
    message: str,
    *,
    path: str,
    location: str,
    suggestion: str,
) -> Diagnostic:
    return Diagnostic(
        code=code,
        severity=severity,
        message=message,
        path=path,
        location=location,
        suggestion=suggestion,
    )


__all__ = ["MAX_LAYER_DIMENSION", "validate_project_and_assets"]
