#!/usr/bin/env python3
"""Build the deterministic reusable Memory Moon terrain tile atlas."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image


CONTENT_SIZE = 192
GUTTER_SIZE = 8
CELL_SIZE = CONTENT_SIZE + 2 * GUTTER_SIZE
ATLAS_COLUMNS = 4
ATLAS_ROWS = 5
ATLAS_SIZE = (ATLAS_COLUMNS * CELL_SIZE, ATLAS_ROWS * CELL_SIZE)

GRASS_VARIANT_COUNT = 4
PATH_VARIANT_COUNT = 16
NORTH = 1
EAST = 2
SOUTH = 4
WEST = 8

RGBArray = NDArray[np.uint8]
FloatArray = NDArray[np.float64]


def _load_rgb(path: Path) -> RGBArray:
    """Load an image and replace transparency with its own representative color."""
    with Image.open(path) as source:
        rgba = np.asarray(source.convert("RGBA"), dtype=np.float64)

    alpha = rgba[:, :, 3:4] / 255.0
    opaque = alpha[:, :, 0] >= 0.25
    if np.any(opaque):
        fill = np.median(rgba[:, :, :3][opaque], axis=0)
    else:
        fill = np.array([96.0, 96.0, 96.0], dtype=np.float64)
    rgb = rgba[:, :, :3] * alpha + fill[np.newaxis, np.newaxis, :] * (1.0 - alpha)
    return np.clip(np.rint(rgb), 0.0, 255.0).astype(np.uint8)


def _periodic_texture(source: RGBArray) -> RGBArray:
    """Heal a narrow toroidal edge band while preserving natural source content."""
    source_image = Image.fromarray(source, mode="RGB")
    width, height = source_image.size
    crop_size = max(CONTENT_SIZE, int(min(width, height) * 0.72))
    crop_size = min(crop_size, width, height)
    left = (width - crop_size) // 2
    top = (height - crop_size) // 2
    square = source_image.crop((left, top, left + crop_size, top + crop_size))
    natural = np.asarray(
        square.resize((CONTENT_SIZE, CONTENT_SIZE), Image.Resampling.LANCZOS),
        dtype=np.float64,
    )

    # Heal opposite edges pairwise, one axis at a time. This preserves the
    # natural center and avoids the corner wedges produced by a diagonal roll.
    periodic = natural.copy()
    healing_width = 24
    for offset in range(healing_width):
        phase = offset / (healing_width - 1.0)
        weight = 0.5 * (1.0 + np.cos(np.pi * phase))
        shared = 0.5 * (periodic[:, offset] + periodic[:, -1 - offset])
        periodic[:, offset] = (
            periodic[:, offset] * (1.0 - weight) + shared * weight
        )
        periodic[:, -1 - offset] = (
            periodic[:, -1 - offset] * (1.0 - weight) + shared * weight
        )
    for offset in range(healing_width):
        phase = offset / (healing_width - 1.0)
        weight = 0.5 * (1.0 + np.cos(np.pi * phase))
        shared = 0.5 * (periodic[offset] + periodic[-1 - offset])
        periodic[offset] = periodic[offset] * (1.0 - weight) + shared * weight
        periodic[-1 - offset] = (
            periodic[-1 - offset] * (1.0 - weight) + shared * weight
        )
    return np.clip(np.rint(periodic), 0.0, 255.0).astype(np.uint8)


def _restrained_grade(texture: RGBArray, *, role: str) -> RGBArray:
    """Reduce contrast and saturation, then darken the source material."""
    rgb = texture.astype(np.float64) / 255.0
    luma = np.sum(rgb * np.array([0.2126, 0.7152, 0.0722]), axis=2, keepdims=True)
    saturation = 0.68 if role == "grass" else 0.62
    rgb = luma + saturation * (rgb - luma)

    mean = np.mean(rgb, axis=(0, 1), keepdims=True)
    rgb = mean + 0.82 * (rgb - mean)
    multiplier = (
        np.array([0.76, 0.80, 0.72])
        if role == "grass"
        else np.array([0.78, 0.72, 0.65])
    )
    rgb *= multiplier[np.newaxis, np.newaxis, :]
    return np.clip(np.rint(rgb * 255.0), 0.0, 255.0).astype(np.uint8)


def _prepare_material(path: Path, *, role: str) -> RGBArray:
    material = _periodic_texture(_load_rgb(path))
    material = _restrained_grade(material, role=role)
    if not np.array_equal(material[0], material[-1]):
        raise RuntimeError(f"{role} material is not vertically periodic.")
    if not np.array_equal(material[:, 0], material[:, -1]):
        raise RuntimeError(f"{role} material is not horizontally periodic.")
    return material


def _grass_variants(base: RGBArray) -> list[RGBArray]:
    """Create restrained variations while preserving a common exact boundary."""
    axis = np.linspace(0.0, 1.0, CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(axis, axis)
    pixel_axis = np.arange(CONTENT_SIZE, dtype=np.float64)
    pixel_xx, pixel_yy = np.meshgrid(pixel_axis, pixel_axis)
    edge_distance = np.minimum.reduce(
        (
            pixel_xx,
            pixel_yy,
            CONTENT_SIZE - 1.0 - pixel_xx,
            CONTENT_SIZE - 1.0 - pixel_yy,
        )
    )
    interior_window = np.clip(edge_distance / 32.0, 0.0, 1.0)
    interior_window = interior_window * interior_window * (3.0 - 2.0 * interior_window)
    patterns = (
        np.sin(2.0 * np.pi * xx) * np.sin(2.0 * np.pi * yy),
        np.cos(2.0 * np.pi * (xx + 0.31 * yy)),
        np.sin(4.0 * np.pi * xx + 0.7) * np.cos(2.0 * np.pi * yy - 0.4),
    )
    rolls = ((37, 61), (83, 23), (119, 97))
    tints = (
        np.array([0.005, 0.008, -0.002]),
        np.array([-0.004, -0.006, 0.003]),
        np.array([0.006, 0.002, -0.004]),
    )

    base_float = base.astype(np.float64) / 255.0
    variants = [base.copy()]
    for roll, pattern, tint in zip(rolls, patterns, tints, strict=True):
        rolled = np.roll(base_float, shift=roll, axis=(0, 1))
        blend = interior_window[:, :, np.newaxis]
        tinted = base_float * (1.0 - blend) + rolled * blend
        modulation = (0.008 * pattern * interior_window)[:, :, np.newaxis]
        tinted *= 1.0 + modulation
        tinted += interior_window[:, :, np.newaxis] * tint[np.newaxis, np.newaxis, :]
        variant = np.clip(np.rint(tinted * 255.0), 0.0, 255.0).astype(np.uint8)

        # A shared border gives every grass variant identical sampling at joins.
        variant[:GUTTER_SIZE] = base[:GUTTER_SIZE]
        variant[-GUTTER_SIZE:] = base[-GUTTER_SIZE:]
        variant[:, :GUTTER_SIZE] = base[:, :GUTTER_SIZE]
        variant[:, -GUTTER_SIZE:] = base[:, -GUTTER_SIZE:]
        variants.append(variant)

    for index, variant in enumerate(variants[1:], start=1):
        if not np.array_equal(variant[0], base[0]) or not np.array_equal(
            variant[-1], base[-1]
        ):
            raise RuntimeError(f"grass variant {index} changed a horizontal edge.")
        if not np.array_equal(variant[:, 0], base[:, 0]) or not np.array_equal(
            variant[:, -1], base[:, -1]
        ):
            raise RuntimeError(f"grass variant {index} changed a vertical edge.")
    return variants


def _distance_to_segment(
    xx: FloatArray,
    yy: FloatArray,
    start: tuple[float, float],
    end: tuple[float, float],
) -> FloatArray:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    denominator = dx * dx + dy * dy
    projection = ((xx - start[0]) * dx + (yy - start[1]) * dy) / denominator
    projection = np.clip(projection, 0.0, 1.0)
    nearest_x = start[0] + projection * dx
    nearest_y = start[1] + projection * dy
    return np.hypot(xx - nearest_x, yy - nearest_y)


def _path_alpha(topology: int, *, radius: float = 35.0) -> FloatArray:
    """Return a rounded path mask for one N/E/S/W topology bit field."""
    if not 0 <= topology < PATH_VARIANT_COUNT:
        raise ValueError(f"Path topology must be between 0 and 15, got {topology}.")

    coordinates = np.arange(CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(coordinates, coordinates)
    center = (CONTENT_SIZE - 1) / 2.0
    distance = np.hypot(xx - center, yy - center) - radius
    beyond = radius + 2.0
    endpoints = {
        NORTH: (center, -beyond),
        EAST: (CONTENT_SIZE - 1 + beyond, center),
        SOUTH: (center, CONTENT_SIZE - 1 + beyond),
        WEST: (-beyond, center),
    }
    for bit, endpoint in endpoints.items():
        if topology & bit:
            arm_distance = _distance_to_segment(
                xx,
                yy,
                (center, center),
                endpoint,
            ) - radius
            distance = np.minimum(distance, arm_distance)

    # Shared integer-frequency noise prevents ruler-straight edges. It is
    # periodic across the tile, so every north connector still exactly matches
    # every south connector (and likewise east/west).
    phase_x = 2.0 * np.pi * xx / (CONTENT_SIZE - 1.0)
    phase_y = 2.0 * np.pi * yy / (CONTENT_SIZE - 1.0)
    organic_noise = (
        1.15 * np.sin(2.0 * phase_x + 3.0 * phase_y + 0.35)
        + 0.65 * np.cos(5.0 * phase_x - 2.0 * phase_y - 0.6)
        + 0.35 * np.sin(7.0 * phase_x + phase_y + 1.1)
    )
    distance -= organic_noise

    # Two-pixel analytic feathering keeps curves smooth without changing joins.
    return np.clip(0.5 - distance / 2.0, 0.0, 1.0)


def _path_tiles(grass: list[RGBArray], earth: RGBArray) -> list[RGBArray]:
    tiles: list[RGBArray] = []
    earth_float = earth.astype(np.float64)
    for topology in range(PATH_VARIANT_COUNT):
        background = grass[(topology * 3 + 1) % len(grass)].astype(np.float64)
        alpha = _path_alpha(topology)[:, :, np.newaxis]

        # A narrow, low-contrast soil edge seats the path into the grass.
        outer_alpha = _path_alpha(topology, radius=37.0)[:, :, np.newaxis]
        edge = np.clip(outer_alpha - alpha, 0.0, 1.0)
        background *= 1.0 - 0.06 * edge
        blended = earth_float * alpha + background * (1.0 - alpha)
        tiles.append(np.clip(np.rint(blended), 0.0, 255.0).astype(np.uint8))
    return tiles


def _extrude(tile: RGBArray) -> RGBArray:
    return np.pad(
        tile,
        ((GUTTER_SIZE, GUTTER_SIZE), (GUTTER_SIZE, GUTTER_SIZE), (0, 0)),
        mode="edge",
    )


def _build_atlas(tiles: list[RGBArray]) -> RGBArray:
    expected_count = ATLAS_COLUMNS * ATLAS_ROWS
    if len(tiles) != expected_count:
        raise ValueError(f"Expected {expected_count} tiles, got {len(tiles)}.")

    atlas = np.empty((ATLAS_SIZE[1], ATLAS_SIZE[0], 3), dtype=np.uint8)
    for index, tile in enumerate(tiles):
        row, column = divmod(index, ATLAS_COLUMNS)
        top = row * CELL_SIZE
        left = column * CELL_SIZE
        atlas[top : top + CELL_SIZE, left : left + CELL_SIZE] = _extrude(tile)
    return atlas


def _read_index_rows(path: Path) -> list[list[int]]:
    with path.open(encoding="utf-8") as stream:
        payload: Any = json.load(stream)
    if not isinstance(payload, dict):
        raise ValueError("Layout root must be a JSON object.")

    rows: Any = payload.get("tile_index_rows")
    terrain = payload.get("terrain")
    if rows is None and isinstance(terrain, dict):
        rows = terrain.get("tile_index_rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Layout must contain non-empty tile_index_rows.")

    normalized: list[list[int]] = []
    width: int | None = None
    for row_number, row in enumerate(rows):
        if not isinstance(row, list) or not row:
            raise ValueError(f"tile_index_rows[{row_number}] must be a non-empty array.")
        if any(isinstance(index, bool) or not isinstance(index, int) for index in row):
            raise ValueError(f"tile_index_rows[{row_number}] must contain only integers.")
        if any(index < 0 or index >= ATLAS_COLUMNS * ATLAS_ROWS for index in row):
            raise ValueError(
                f"tile_index_rows[{row_number}] contains an index outside 0..19."
            )
        if width is None:
            width = len(row)
        elif len(row) != width:
            raise ValueError("tile_index_rows must form a rectangular grid.")
        normalized.append(row)
    return normalized


def _build_preview(rows: list[list[int]], tiles: list[RGBArray]) -> RGBArray:
    height = len(rows) * CONTENT_SIZE
    width = len(rows[0]) * CONTENT_SIZE
    preview = np.empty((height, width, 3), dtype=np.uint8)
    for row_index, row in enumerate(rows):
        for column_index, tile_index in enumerate(row):
            top = row_index * CONTENT_SIZE
            left = column_index * CONTENT_SIZE
            preview[top : top + CONTENT_SIZE, left : left + CONTENT_SIZE] = tiles[
                tile_index
            ]
    return preview


def _save_png(image: RGBArray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(image, mode="RGB").save(path, format="PNG", compress_level=9)


def generate(
    *,
    grass_source: Path,
    earth_source: Path,
    atlas_out: Path,
    layout: Path | None,
    preview_out: Path | None,
) -> None:
    grass = _grass_variants(_prepare_material(grass_source, role="grass"))
    earth = _prepare_material(earth_source, role="earth")
    tiles = [*grass, *_path_tiles(grass, earth)]
    _save_png(_build_atlas(tiles), atlas_out)
    print(
        f"Wrote {atlas_out} ({ATLAS_SIZE[0]}x{ATLAS_SIZE[1]}, "
        f"{len(tiles)} reusable tiles)."
    )

    if layout is not None and preview_out is not None:
        rows = _read_index_rows(layout)
        preview = _build_preview(rows, tiles)
        _save_png(preview, preview_out)
        print(f"Wrote {preview_out} ({preview.shape[1]}x{preview.shape[0]}).")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a deterministic 4x5 terrain atlas with four grass variants "
            "and all sixteen N/E/S/W path topologies."
        )
    )
    parser.add_argument("--grass-source", required=True, type=Path)
    parser.add_argument("--earth-source", required=True, type=Path)
    parser.add_argument("--atlas-out", required=True, type=Path)
    parser.add_argument("--layout", type=Path)
    parser.add_argument("--preview-out", type=Path)
    args = parser.parse_args()
    if (args.layout is None) != (args.preview_out is None):
        parser.error("--layout and --preview-out must be supplied together.")
    return args


def main() -> int:
    args = _parse_args()
    generate(
        grass_source=args.grass_source,
        earth_source=args.earth_source,
        atlas_out=args.atlas_out,
        layout=args.layout,
        preview_out=args.preview_out,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Terrain atlas generation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
