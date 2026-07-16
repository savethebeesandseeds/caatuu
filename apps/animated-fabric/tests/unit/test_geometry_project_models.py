"""Contracts for the fundamental geometry, project, and asset models."""

from __future__ import annotations

import copy
import json
import math

import pytest
from pydantic import TypeAdapter, ValidationError

from animated_fabric.domain._base import (
    DomainModel,
    JsonValue,
    ProjectPath,
    SchemaVersion,
    SemanticId,
    Sha256Digest,
)
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.geometry import IntPoint, IntSize, SelectionEllipse, Transform2D, Vec2
from animated_fabric.domain.project import (
    CanvasDefinition,
    Direction,
    DirectionDefinition,
    DirectionMode,
    PixelSnap,
    ProjectManifest,
)


class JsonEnvelope(DomainModel):
    """Test-only carrier for the recursive JSON value alias."""

    value: JsonValue


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
    "animation_paths": [
        "animations/idle.animated-clip.json",
        "animations/walk.animated-clip.json",
    ],
    "export_profiles": ["default_grid"],
    "selection_ellipse": {
        "center_offset": [0.0, -2.0],
        "radius_x": 20.0,
        "radius_y": 9.0,
    },
}


ASSET_DATA: dict[str, object] = {
    "asset_id": "se_torso",
    "direction": "SE",
    "semantic_part": "torso",
    "path": "source/layers/SE/torso.png",
    "source_canvas_size": [192, 192],
    "trim_origin": [64, 42],
    "trim_size": [52, 91],
    "sha256": "a" * 64,
    "optional": False,
}


@pytest.mark.parametrize(
    ("model_type", "pair", "expected_fields", "expected_json"),
    [
        (Vec2, [1.5, -2.0], (1.5, -2.0), "[1.5,-2.0]"),
        (IntPoint, (3, -4), (3, -4), "[3,-4]"),
        (IntSize, [192, 128], (192, 128), "[192,128]"),
    ],
)
def test_pair_models_accept_sequences_and_serialize_as_arrays(
    model_type: type[Vec2] | type[IntPoint] | type[IntSize],
    pair: list[float] | tuple[int, int] | list[int],
    expected_fields: tuple[float, float] | tuple[int, int],
    expected_json: str,
) -> None:
    value = model_type.model_validate(pair)

    if isinstance(value, IntSize):
        assert (value.width, value.height) == expected_fields
    else:
        assert (value.x, value.y) == expected_fields
    assert value.model_dump() == list(expected_fields)
    assert value.model_dump_json() == expected_json


def test_pair_models_still_accept_named_fields() -> None:
    assert Vec2(x=2.0, y=3.0).model_dump() == [2.0, 3.0]
    assert IntPoint(x=-2, y=3).model_dump() == [-2, 3]
    assert IntSize(width=2, height=3).model_dump() == [2, 3]


@pytest.mark.parametrize("pair", [[], [1.0], [1.0, 2.0, 3.0], (1, 2, 3)])
def test_pair_models_reject_wrong_sequence_length(pair: object) -> None:
    with pytest.raises(ValidationError, match="exactly two items"):
        Vec2.model_validate(pair)


def test_geometry_models_are_strict_frozen_and_forbid_extras() -> None:
    with pytest.raises(ValidationError):
        Vec2(x="1.0", y=2.0)  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        IntPoint(x=1.0, y=2)
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        Vec2.model_validate({"x": 1.0, "y": 2.0, "z": 3.0})

    vector = Vec2(x=1.0, y=2.0)
    with pytest.raises(ValidationError, match="Instance is frozen"):
        vector.x = 3.0


@pytest.mark.parametrize("invalid", [math.inf, -math.inf, math.nan])
def test_all_floating_point_geometry_must_be_finite(invalid: float) -> None:
    with pytest.raises(ValidationError, match="finite number"):
        Vec2(x=invalid, y=0.0)
    with pytest.raises(ValidationError, match="finite number"):
        Transform2D(rotation_deg=invalid)


@pytest.mark.parametrize(("width", "height"), [(0, 1), (1, 0), (-1, 2), (2, -1)])
def test_integer_sizes_must_be_positive(width: int, height: int) -> None:
    with pytest.raises(ValidationError, match="greater than 0"):
        IntSize(width=width, height=height)


def test_transform_defaults_are_independent_and_use_normative_values() -> None:
    first = Transform2D()
    second = Transform2D()

    assert first.model_dump(mode="json") == {
        "position": [0.0, 0.0],
        "rotation_deg": 0.0,
        "scale": [1.0, 1.0],
    }
    assert first.position is not second.position
    assert first.scale is not second.scale


@pytest.mark.parametrize(("radius_x", "radius_y"), [(0.0, 1.0), (1.0, 0.0), (-1.0, 2.0)])
def test_selection_ellipse_requires_positive_radii(radius_x: float, radius_y: float) -> None:
    with pytest.raises(ValidationError, match="greater than 0"):
        SelectionEllipse(
            center_offset=Vec2(x=0.0, y=0.0),
            radius_x=radius_x,
            radius_y=radius_y,
        )


def test_canvas_uses_normative_pixel_snap_default() -> None:
    canvas = CanvasDefinition(
        width=192,
        height=192,
        ground_anchor=Vec2(x=96.0, y=160.0),
    )

    assert canvas.pixel_snap is PixelSnap.NONE
    assert canvas.model_dump(mode="json") == {
        "width": 192,
        "height": 192,
        "ground_anchor": [96.0, 160.0],
        "pixel_snap": "none",
    }


@pytest.mark.parametrize(("width", "height"), [(0, 192), (192, 0), (-1, 192)])
def test_canvas_dimensions_must_be_positive(width: int, height: int) -> None:
    with pytest.raises(ValidationError, match="greater than 0"):
        CanvasDefinition(
            width=width,
            height=height,
            ground_anchor=Vec2(x=0.0, y=0.0),
        )


def test_direction_definition_enforces_local_source_invariant() -> None:
    authored = DirectionDefinition(mode=DirectionMode.AUTHORED)
    mirrored = DirectionDefinition(mode=DirectionMode.MIRROR, source=Direction.SE)

    assert authored.source is None
    assert mirrored.source is Direction.SE
    with pytest.raises(ValidationError, match="requires a source"):
        DirectionDefinition(mode=DirectionMode.MIRROR)
    with pytest.raises(ValidationError, match="must not declare a source"):
        DirectionDefinition(mode=DirectionMode.AUTHORED, source=Direction.SE)


def test_direction_definition_is_strict_for_python_but_accepts_normative_json() -> None:
    with pytest.raises(ValidationError):
        DirectionDefinition(mode="authored")  # type: ignore[arg-type]

    parsed = DirectionDefinition.model_validate_json('{"mode":"mirror","source":"NE"}')
    assert parsed == DirectionDefinition(mode=DirectionMode.MIRROR, source=Direction.NE)


def test_project_manifest_round_trips_the_normative_json_shape() -> None:
    manifest = ProjectManifest.model_validate_json(json.dumps(MANIFEST_DATA))

    assert manifest.directions[Direction.SW].source is Direction.SE
    assert manifest.canvas.ground_anchor == Vec2(x=96.0, y=160.0)
    assert manifest.animation_paths == (
        "animations/idle.animated-clip.json",
        "animations/walk.animated-clip.json",
    )
    assert manifest.model_dump(mode="json") == MANIFEST_DATA
    assert ProjectManifest.model_validate_json(manifest.model_dump_json()) == manifest


@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("format", "animated-fabric.rig.v1"),
        ("schema_version", "01.0.0"),
        ("schema_version", "1.0"),
        ("project_id", "a987fbc9-4bed-3078-cf07-9141ba07c9f3"),
        ("slug", "AB"),
        ("slug", "Eva-Mage"),
        ("template_id", "Humanoid-V1"),
        ("display_name", ""),
    ],
)
def test_project_manifest_rejects_invalid_scalar_contracts(field: str, invalid: object) -> None:
    data = copy.deepcopy(MANIFEST_DATA)
    data[field] = invalid

    with pytest.raises(ValidationError):
        ProjectManifest.model_validate_json(json.dumps(data))


def test_project_manifest_forbids_unknown_fields() -> None:
    data = copy.deepcopy(MANIFEST_DATA)
    data["unknown"] = True

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ProjectManifest.model_validate_json(json.dumps(data))


def test_manifest_leaves_direction_cross_references_for_af_012() -> None:
    data = copy.deepcopy(MANIFEST_DATA)
    data["directions"] = {"SE": {"mode": "mirror", "source": "SE"}}

    manifest = ProjectManifest.model_validate_json(json.dumps(data))
    assert manifest.directions[Direction.SE].source is Direction.SE


def test_asset_layer_round_trips_and_preserves_trim_geometry() -> None:
    asset = AssetLayer.model_validate_json(json.dumps(ASSET_DATA))

    assert asset.direction is Direction.SE
    assert (asset.trim_origin.x, asset.trim_origin.y) == (64, 42)
    assert (asset.trim_size.width, asset.trim_size.height) == (52, 91)
    assert asset.model_dump(mode="json") == ASSET_DATA
    assert AssetLayer.model_validate_json(asset.model_dump_json()) == asset


def test_asset_optional_default_is_false() -> None:
    data = copy.deepcopy(ASSET_DATA)
    del data["optional"]

    asset = AssetLayer.model_validate_json(json.dumps(data))
    assert asset.optional is False


@pytest.mark.parametrize(
    ("origin", "trim_size", "message"),
    [
        ([-1, 0], [1, 1], "trim_origin"),
        ([0, -1], [1, 1], "trim_origin"),
        ([150, 0], [43, 1], "horizontal trim bounds"),
        ([0, 150], [1, 43], "vertical trim bounds"),
    ],
)
def test_asset_trim_must_stay_within_source_canvas(
    origin: list[int], trim_size: list[int], message: str
) -> None:
    data = copy.deepcopy(ASSET_DATA)
    data["trim_origin"] = origin
    data["trim_size"] = trim_size

    with pytest.raises(ValidationError, match=message):
        AssetLayer.model_validate_json(json.dumps(data))


@pytest.mark.parametrize(
    "path",
    [
        "",
        "/source/head.png",
        "C:/source/head.png",
        "../head.png",
        "source/../head.png",
        "source/./head.png",
        "source//head.png",
        "source/head.png/",
        "source\\head.png",
        "source/\x00head.png",
    ],
)
def test_project_paths_reject_unsafe_or_noncanonical_values(path: str) -> None:
    adapter = TypeAdapter(ProjectPath)
    with pytest.raises(ValidationError):
        adapter.validate_python(path)


def test_project_paths_accept_safe_forward_slash_paths() -> None:
    adapter = TypeAdapter(ProjectPath)
    assert adapter.validate_python("source/layers/SE/head.png") == "source/layers/SE/head.png"


@pytest.mark.parametrize("value", ["", "UpperArm", "upper-arm", "2d_actor", "arm.r"])
def test_semantic_ids_require_ascii_snake_case(value: str) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(SemanticId).validate_python(value)


@pytest.mark.parametrize("value", ["0.1.0", "1.2.3-alpha.1", "2.0.0+linux.1"])
def test_schema_versions_accept_semver(value: str) -> None:
    assert TypeAdapter(SchemaVersion).validate_python(value) == value


@pytest.mark.parametrize("value", ["1", "1.2", "01.2.3", "1.2.3-01", "v1.2.3"])
def test_schema_versions_reject_non_semver_values(value: str) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(SchemaVersion).validate_python(value)


@pytest.mark.parametrize("value", ["a" * 63, "A" * 64, "g" * 64])
def test_sha256_digest_requires_canonical_lowercase_hex(value: str) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(Sha256Digest).validate_python(value)


def test_recursive_json_value_accepts_json_and_rejects_non_json_values() -> None:
    value: JsonValue = {"name": "actor", "values": [1, 2.5, True, None]}
    envelope = JsonEnvelope(value=value)
    assert envelope.model_dump(mode="json") == {"value": value}

    with pytest.raises(ValidationError):
        JsonEnvelope(value={"invalid": object()})
    with pytest.raises(ValidationError, match="finite number"):
        JsonEnvelope(value={"invalid": math.inf})
