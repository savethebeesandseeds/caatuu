"""Strict layer-catalog domain contract tests."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable

import pytest
from pydantic import ValidationError

from animated_fabric.domain.assets import LayerManifest


def _asset(
    asset_id: str,
    direction: str,
    semantic_part: str,
    *,
    path: str | None = None,
) -> dict[str, object]:
    return {
        "asset_id": asset_id,
        "direction": direction,
        "semantic_part": semantic_part,
        "path": path or f"source/layers/{direction}/{semantic_part}.png",
        "source_canvas_size": [192, 192],
        "trim_origin": [4, 6],
        "trim_size": [32, 48],
        "sha256": "a" * 64,
        "optional": False,
    }


def _payload() -> dict[str, object]:
    return {
        "format": "animated-fabric.layer-manifest.v1",
        "schema_version": "0.1.0",
        "layers": [
            _asset("ne_head", "NE", "head"),
            _asset("se_head", "SE", "head"),
        ],
    }


def test_layer_manifest_round_trips_through_strict_json_model() -> None:
    manifest = LayerManifest.model_validate_json(json.dumps(_payload()))

    assert manifest.format == "animated-fabric.layer-manifest.v1"
    assert tuple(asset.asset_id for asset in manifest.layers) == ("ne_head", "se_head")
    assert LayerManifest.model_validate_json(manifest.model_dump_json()) == manifest


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (
            lambda payload: payload["layers"].append(_asset("ne_head", "SE", "head_duplicate_id")),
            "duplicate asset_id",
        ),
        (
            lambda payload: payload["layers"].append(
                _asset("se_head_copy", "NE", "head", path="source/layers/NE/head_copy.png")
            ),
            "duplicate semantic_part",
        ),
        (
            lambda payload: payload["layers"].append(
                _asset("se_hat", "SE", "hat", path="source/layers/SE/head.png")
            ),
            "duplicate asset path",
        ),
        (lambda payload: payload.update(layers=list(reversed(payload["layers"]))), "ordered"),
    ],
)
def test_layer_manifest_rejects_ambiguous_or_unstable_catalogs(
    change: Callable[[dict[str, object]], object],
    message: str,
) -> None:
    payload = _payload()
    layers = payload["layers"]
    assert isinstance(layers, list)
    change(payload)

    with pytest.raises(ValidationError, match=message):
        LayerManifest.model_validate_json(json.dumps(payload))


@pytest.mark.parametrize(
    "path",
    [
        "../head.png",
        "/source/layers/SE/head.png",
        "C:/source/layers/SE/head.png",
        "source\\layers\\SE\\head.png",
        "source/layers/../head.png",
    ],
)
def test_layer_manifest_rejects_non_project_relative_asset_paths(path: str) -> None:
    payload = copy.deepcopy(_payload())
    layers = payload["layers"]
    assert isinstance(layers, list)
    first = layers[0]
    assert isinstance(first, dict)
    first["path"] = path

    with pytest.raises(ValidationError, match="relative|separators|segments"):
        LayerManifest.model_validate_json(json.dumps(payload))
