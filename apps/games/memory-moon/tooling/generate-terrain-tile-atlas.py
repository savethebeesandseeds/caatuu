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
ATLAS_ROWS = 12
ATLAS_SIZE = (ATLAS_COLUMNS * CELL_SIZE, ATLAS_ROWS * CELL_SIZE)

GRASS_VARIANT_COUNT = 4
GRASS_ACCENT_COUNT = 8
PATH_VARIANT_COUNT = 16
PATH_FIRST_INDEX = GRASS_VARIANT_COUNT + GRASS_ACCENT_COUNT
STONE_REGION_VARIANT_COUNT = 16
STONE_REGION_FIRST_INDEX = PATH_FIRST_INDEX + PATH_VARIANT_COUNT
STONE_FULL_VARIANT_COUNT = 5
STONE_FULL_EXTRA_COUNT = STONE_FULL_VARIANT_COUNT - 1
STONE_VARIANT_BOUNDARY_BAND = 16
STONE_FULL_CANONICAL_INDEX = STONE_REGION_FIRST_INDEX + STONE_REGION_VARIANT_COUNT - 1
STONE_FULL_VISUAL_INDICES = tuple(
    range(
        STONE_FULL_CANONICAL_INDEX,
        STONE_FULL_CANONICAL_INDEX + STONE_FULL_VARIANT_COUNT,
    )
)
NORTH = 1
EAST = 2
SOUTH = 4
WEST = 8
NORTH_WEST = 1
NORTH_EAST = 2
SOUTH_EAST = 4
SOUTH_WEST = 8

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
        periodic[:, offset] = periodic[:, offset] * (1.0 - weight) + shared * weight
        periodic[:, -1 - offset] = (
            periodic[:, -1 - offset] * (1.0 - weight) + shared * weight
        )
    for offset in range(healing_width):
        phase = offset / (healing_width - 1.0)
        weight = 0.5 * (1.0 + np.cos(np.pi * phase))
        shared = 0.5 * (periodic[offset] + periodic[-1 - offset])
        periodic[offset] = periodic[offset] * (1.0 - weight) + shared * weight
        periodic[-1 - offset] = periodic[-1 - offset] * (1.0 - weight) + shared * weight
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
    graded = np.clip(np.rint(rgb * 255.0), 0.0, 255.0).astype(np.uint8)
    if role == "grass":
        # The source contains useful painterly variation, but its smallest
        # marks shimmer during camera movement. Blend in a deterministic
        # half-resolution reconstruction while retaining the authored color.
        reduced = Image.fromarray(graded, mode="RGB").resize(
            (CONTENT_SIZE // 2, CONTENT_SIZE // 2),
            Image.Resampling.BILINEAR,
        )
        softened = np.asarray(
            reduced.resize((CONTENT_SIZE, CONTENT_SIZE), Image.Resampling.BICUBIC),
            dtype=np.float64,
        )
        graded = np.clip(
            np.rint(graded.astype(np.float64) * 0.68 + softened * 0.32),
            0.0,
            255.0,
        ).astype(np.uint8)
        graded[-1] = graded[0]
        graded[:, -1] = graded[:, 0]
    return graded


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


def _ellipse_alpha(
    xx: FloatArray,
    yy: FloatArray,
    *,
    center: tuple[float, float],
    radii: tuple[float, float],
    angle: float = 0.0,
    feather: float = 1.0,
) -> FloatArray:
    """Return a softly feathered ellipse mask."""
    cosine = np.cos(angle)
    sine = np.sin(angle)
    offset_x = xx - center[0]
    offset_y = yy - center[1]
    local_x = cosine * offset_x + sine * offset_y
    local_y = -sine * offset_x + cosine * offset_y
    normalized = np.sqrt(np.square(local_x / radii[0]) + np.square(local_y / radii[1]))
    return np.clip((1.0 - normalized) / max(feather / max(radii), 1e-6), 0.0, 1.0)


def _composite_color(
    background: RGBArray,
    color: tuple[float, float, float],
    alpha: FloatArray,
) -> RGBArray:
    background_float = background.astype(np.float64)
    color_array = np.asarray(color, dtype=np.float64)
    blended = (
        background_float * (1.0 - alpha[:, :, np.newaxis])
        + color_array[np.newaxis, np.newaxis, :] * alpha[:, :, np.newaxis]
    )
    return np.clip(np.rint(blended), 0.0, 255.0).astype(np.uint8)


def _preserve_grass_boundary(tile: RGBArray, base: RGBArray) -> RGBArray:
    """Keep the exact shared grass boundary on a derived accent tile."""
    result = tile.copy()
    result[:GUTTER_SIZE] = base[:GUTTER_SIZE]
    result[-GUTTER_SIZE:] = base[-GUTTER_SIZE:]
    result[:, :GUTTER_SIZE] = base[:, :GUTTER_SIZE]
    result[:, -GUTTER_SIZE:] = base[:, -GUTTER_SIZE:]
    return result


def _flower_accent(
    background: RGBArray,
    *,
    centers: tuple[tuple[float, float], ...],
    petal_color: tuple[float, float, float],
) -> RGBArray:
    coordinates = np.arange(CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(coordinates, coordinates)
    result = background.copy()
    petal_offsets = ((0.0, -3.2), (3.0, 0.2), (0.2, 3.1), (-3.0, -0.1))
    for flower_index, center in enumerate(centers):
        angle = 0.32 * float(flower_index)
        for petal_index, offset in enumerate(petal_offsets):
            cosine = np.cos(angle)
            sine = np.sin(angle)
            rotated = (
                cosine * offset[0] - sine * offset[1],
                sine * offset[0] + cosine * offset[1],
            )
            petal = _ellipse_alpha(
                xx,
                yy,
                center=(center[0] + rotated[0], center[1] + rotated[1]),
                radii=(2.3, 3.0),
                angle=angle + float(petal_index) * np.pi * 0.5,
                feather=1.2,
            )
            result = _composite_color(result, petal_color, petal * 0.72)
        center_mask = _ellipse_alpha(
            xx,
            yy,
            center=center,
            radii=(2.1, 2.1),
            feather=0.8,
        )
        result = _composite_color(result, (188.0, 126.0, 38.0), center_mask * 0.78)
    return result


def _leaf_litter_accent(background: RGBArray) -> RGBArray:
    coordinates = np.arange(CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(coordinates, coordinates)
    result = background.copy()
    leaves = (
        (37.0, 52.0, 0.35),
        (58.0, 125.0, -0.75),
        (78.0, 73.0, 1.05),
        (101.0, 139.0, 0.58),
        (122.0, 45.0, -0.28),
        (143.0, 108.0, 0.82),
        (157.0, 151.0, -1.12),
        (46.0, 157.0, 1.34),
        (132.0, 82.0, -0.92),
    )
    colors = ((118.0, 80.0, 31.0), (155.0, 111.0, 42.0), (105.0, 72.0, 30.0))
    for index, (center_x, center_y, angle) in enumerate(leaves):
        leaf = _ellipse_alpha(
            xx,
            yy,
            center=(center_x, center_y),
            radii=(5.0, 2.2),
            angle=angle,
            feather=1.0,
        )
        result = _composite_color(result, colors[index % len(colors)], leaf * 0.48)
    return result


def _pebble_accent(background: RGBArray) -> RGBArray:
    coordinates = np.arange(CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(coordinates, coordinates)
    result = background.copy()
    pebbles = (
        (45.0, 62.0, 5.8, 4.1, 0.22),
        (73.0, 136.0, 4.2, 3.3, -0.61),
        (96.0, 87.0, 6.2, 4.4, 0.72),
        (128.0, 52.0, 4.5, 3.0, -0.18),
        (144.0, 124.0, 5.2, 3.8, 0.44),
        (119.0, 155.0, 3.8, 2.8, -0.83),
    )
    for index, (center_x, center_y, radius_x, radius_y, angle) in enumerate(pebbles):
        stone = _ellipse_alpha(
            xx,
            yy,
            center=(center_x, center_y),
            radii=(radius_x, radius_y),
            angle=angle,
            feather=1.1,
        )
        shadow = _ellipse_alpha(
            xx,
            yy,
            center=(center_x + 1.0, center_y + 1.5),
            radii=(radius_x + 1.5, radius_y + 1.2),
            angle=angle,
            feather=1.3,
        )
        result = _composite_color(result, (50.0, 48.0, 29.0), shadow * 0.18)
        stone_color = (168.0, 148.0, 96.0) if index % 2 == 0 else (139.0, 127.0, 85.0)
        result = _composite_color(result, stone_color, stone * 0.58)
    return result


def _worn_alpha(*, large: bool) -> FloatArray:
    coordinates = np.arange(CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(coordinates, coordinates)
    ellipses = (
        ((87.0, 94.0), (31.0, 20.0), 0.16),
        ((112.0, 101.0), (24.0, 17.0), -0.34),
        ((72.0, 113.0), (20.0, 14.0), 0.63),
    )
    if not large:
        ellipses = (
            ((91.0, 98.0), (22.0, 14.0), 0.21),
            ((107.0, 103.0), (14.0, 10.0), -0.38),
        )
    alpha = np.zeros((CONTENT_SIZE, CONTENT_SIZE), dtype=np.float64)
    for center, radii, angle in ellipses:
        alpha = np.maximum(
            alpha,
            _ellipse_alpha(
                xx,
                yy,
                center=center,
                radii=radii,
                angle=angle,
                feather=4.5,
            ),
        )
    phase_x = 2.0 * np.pi * xx / (CONTENT_SIZE - 1.0)
    phase_y = 2.0 * np.pi * yy / (CONTENT_SIZE - 1.0)
    variation = 0.88 + 0.12 * np.sin(3.0 * phase_x - 2.0 * phase_y + 0.4)
    return np.clip(alpha * variation, 0.0, 1.0)


def _moss_accent(
    background: RGBArray,
    *,
    color: tuple[float, float, float],
    centers: tuple[tuple[float, float], ...],
) -> RGBArray:
    coordinates = np.arange(CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(coordinates, coordinates)
    alpha = np.zeros((CONTENT_SIZE, CONTENT_SIZE), dtype=np.float64)
    for index, center in enumerate(centers):
        patch = _ellipse_alpha(
            xx,
            yy,
            center=center,
            radii=(31.0 + index * 4.0, 22.0 + index * 2.0),
            angle=(-0.35 + index * 0.62),
            feather=12.0,
        )
        alpha = np.maximum(alpha, patch)
    return _composite_color(background, color, alpha * 0.13)


def _grass_accents(grass: list[RGBArray], earth: RGBArray) -> list[RGBArray]:
    """Create quiet, human-scale accents inspired by the scenery vocabulary."""
    base = grass[0]
    cream_flowers = _flower_accent(
        grass[1],
        centers=((45.0, 55.0), (111.0, 74.0), (72.0, 137.0), (147.0, 142.0)),
        petal_color=(201.0, 190.0, 143.0),
    )
    amber_flowers = _flower_accent(
        grass[2],
        centers=((62.0, 43.0), (139.0, 69.0), (96.0, 126.0), (45.0, 151.0)),
        petal_color=(222.0, 165.0, 58.0),
    )
    leaf_litter = _leaf_litter_accent(grass[3])
    pebbles = _pebble_accent(grass[1])

    earth_float = earth.astype(np.float64)
    worn_tiles: list[RGBArray] = []
    for large, background in ((False, grass[2]), (True, grass[3])):
        alpha = (_worn_alpha(large=large) * (0.48 if large else 0.38))[:, :, np.newaxis]
        blended = earth_float * alpha + background.astype(np.float64) * (1.0 - alpha)
        worn_tiles.append(np.clip(np.rint(blended), 0.0, 255.0).astype(np.uint8))

    cool_moss = _moss_accent(
        grass[2],
        color=(20.0, 95.0, 91.0),
        centers=((68.0, 76.0), (125.0, 119.0)),
    )
    warm_moss = _moss_accent(
        grass[3],
        color=(112.0, 120.0, 32.0),
        centers=((119.0, 67.0), (73.0, 128.0)),
    )
    accents = [
        cream_flowers,
        amber_flowers,
        leaf_litter,
        pebbles,
        *worn_tiles,
        cool_moss,
        warm_moss,
    ]
    if len(accents) != GRASS_ACCENT_COUNT:
        raise RuntimeError(
            f"Expected {GRASS_ACCENT_COUNT} grass accents, got {len(accents)}."
        )

    preserved = [_preserve_grass_boundary(tile, base) for tile in accents]
    for index, tile in enumerate(preserved):
        if not np.array_equal(tile[0], base[0]) or not np.array_equal(
            tile[-1], base[-1]
        ):
            raise RuntimeError(f"grass accent {index} changed a horizontal edge.")
        if not np.array_equal(tile[:, 0], base[:, 0]) or not np.array_equal(
            tile[:, -1], base[:, -1]
        ):
            raise RuntimeError(f"grass accent {index} changed a vertical edge.")
    return preserved


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
            arm_distance = (
                _distance_to_segment(
                    xx,
                    yy,
                    (center, center),
                    endpoint,
                )
                - radius
            )
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


def _validate_path_edges(grass_base: RGBArray, paths: list[RGBArray]) -> None:
    """Require all cardinal connector edges to share an exact pixel contract."""
    if len(paths) != PATH_VARIANT_COUNT:
        raise RuntimeError(
            f"Expected {PATH_VARIANT_COUNT} path tiles, got {len(paths)}."
        )
    north_edge = paths[NORTH][0]
    east_edge = paths[EAST][:, -1]
    south_edge = paths[SOUTH][-1]
    west_edge = paths[WEST][:, 0]
    for topology, tile in enumerate(paths):
        expected_north = north_edge if topology & NORTH else grass_base[0]
        expected_east = east_edge if topology & EAST else grass_base[:, -1]
        expected_south = south_edge if topology & SOUTH else grass_base[-1]
        expected_west = west_edge if topology & WEST else grass_base[:, 0]
        if not np.array_equal(tile[0], expected_north):
            raise RuntimeError(f"path topology {topology} changed its north edge.")
        if not np.array_equal(tile[:, -1], expected_east):
            raise RuntimeError(f"path topology {topology} changed its east edge.")
        if not np.array_equal(tile[-1], expected_south):
            raise RuntimeError(f"path topology {topology} changed its south edge.")
        if not np.array_equal(tile[:, 0], expected_west):
            raise RuntimeError(f"path topology {topology} changed its west edge.")


def _stone_base_material() -> RGBArray:
    """Build a quiet periodic cream-stone field without a tile-sized grid."""
    axis = np.linspace(0.0, 1.0, CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(axis, axis)
    phase_x = 2.0 * np.pi * xx
    phase_y = 2.0 * np.pi * yy

    broad_variation = 0.038 * np.sin(phase_x + phase_y + 0.25) + 0.021 * np.cos(
        2.0 * phase_x - phase_y - 0.7
    )
    stone_color = np.asarray((185.0, 162.0, 112.0), dtype=np.float64)
    stone = stone_color[np.newaxis, np.newaxis, :] * (
        1.0 + broad_variation[:, :, np.newaxis]
    )
    result = np.clip(np.rint(stone), 0.0, 255.0).astype(np.uint8)

    result[-1] = result[0]
    result[:, -1] = result[:, 0]
    return result


def _voronoi_stone(
    base: RGBArray,
    *,
    points: tuple[tuple[float, float], ...],
) -> RGBArray:
    """Lay broad irregular flagstones over a periodic cream-stone field."""
    axis = np.linspace(0.0, 1.0, CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(axis, axis)
    distances: list[FloatArray] = []
    for point_x, point_y in points:
        distance_x = np.abs(xx - point_x)
        distance_y = np.abs(yy - point_y)
        distance_x = np.minimum(distance_x, 1.0 - distance_x)
        distance_y = np.minimum(distance_y, 1.0 - distance_y)
        distances.append(np.square(distance_x) + np.square(distance_y))

    distance_stack = np.stack(distances, axis=0)
    nearest_index = np.argmin(distance_stack, axis=0)
    nearest_two = np.partition(distance_stack, 1, axis=0)[:2]
    boundary_gap = np.sqrt(nearest_two[1]) - np.sqrt(nearest_two[0])
    mortar_alpha = np.clip((0.024 - boundary_gap) / 0.018, 0.0, 1.0)

    tones = np.asarray(
        tuple((((index * 5) % 9) - 4) / 100.0 for index in range(len(points))),
        dtype=np.float64,
    )
    cell_tone = tones[nearest_index]
    surface = base.astype(np.float64) * (1.0 + cell_tone[:, :, np.newaxis])
    mortar = np.asarray((83.0, 72.0, 51.0), dtype=np.float64)
    mortar_strength = 0.25 * mortar_alpha[:, :, np.newaxis]
    surface = surface * (1.0 - mortar_strength)
    surface += mortar[np.newaxis, np.newaxis, :] * mortar_strength
    result = np.clip(np.rint(surface), 0.0, 255.0).astype(np.uint8)
    result[-1] = result[0]
    result[:, -1] = result[:, 0]
    return result


def _stone_materials() -> list[RGBArray]:
    """Create deterministic full-court variants with a shared boundary band."""
    shared_perimeter = (
        (0.18, 0.055),
        (0.64, 0.045),
        (0.94, 0.20),
        (0.955, 0.64),
        (0.80, 0.945),
        (0.36, 0.955),
        (0.055, 0.80),
        (0.045, 0.36),
    )
    interiors = (
        ((0.28, 0.27), (0.66, 0.28), (0.31, 0.62), (0.70, 0.67)),
        ((0.23, 0.34), (0.57, 0.24), (0.77, 0.53), (0.43, 0.74)),
        ((0.35, 0.20), (0.74, 0.35), (0.22, 0.58), (0.61, 0.76)),
        ((0.22, 0.23), (0.52, 0.42), (0.80, 0.30), (0.66, 0.73)),
        ((0.38, 0.31), (0.72, 0.20), (0.21, 0.70), (0.58, 0.64)),
    )
    point_sets = tuple(shared_perimeter + interior for interior in interiors)
    base = _stone_base_material()
    raw = [_voronoi_stone(base, points=points) for points in point_sets]
    canonical = raw[0]
    materials = [canonical]
    for index, candidate in enumerate(raw[1:], start=1):
        variant = candidate.copy()
        variant[:STONE_VARIANT_BOUNDARY_BAND] = canonical[:STONE_VARIANT_BOUNDARY_BAND]
        variant[-STONE_VARIANT_BOUNDARY_BAND:] = canonical[
            -STONE_VARIANT_BOUNDARY_BAND:
        ]
        variant[:, :STONE_VARIANT_BOUNDARY_BAND] = canonical[
            :, :STONE_VARIANT_BOUNDARY_BAND
        ]
        variant[:, -STONE_VARIANT_BOUNDARY_BAND:] = canonical[
            :, -STONE_VARIANT_BOUNDARY_BAND:
        ]
        if not np.array_equal(
            variant[:STONE_VARIANT_BOUNDARY_BAND],
            canonical[:STONE_VARIANT_BOUNDARY_BAND],
        ) or not np.array_equal(
            variant[-STONE_VARIANT_BOUNDARY_BAND:],
            canonical[-STONE_VARIANT_BOUNDARY_BAND:],
        ):
            raise RuntimeError(
                f"moonstone full variant {index} changed a horizontal boundary band."
            )
        if not np.array_equal(
            variant[:, :STONE_VARIANT_BOUNDARY_BAND],
            canonical[:, :STONE_VARIANT_BOUNDARY_BAND],
        ) or not np.array_equal(
            variant[:, -STONE_VARIANT_BOUNDARY_BAND:],
            canonical[:, -STONE_VARIANT_BOUNDARY_BAND:],
        ):
            raise RuntimeError(
                f"moonstone full variant {index} changed a vertical boundary band."
            )
        materials.append(variant)

    if len(materials) != STONE_FULL_VARIANT_COUNT:
        raise RuntimeError(
            f"Expected {STONE_FULL_VARIANT_COUNT} full-stone variants, "
            f"got {len(materials)}."
        )
    return materials


def _stone_region_alpha(topology: int, *, threshold: float) -> FloatArray:
    """Return a grass/stone blob mask from NW/NE/SE/SW corner occupancy."""
    if not 0 <= topology < STONE_REGION_VARIANT_COUNT:
        raise ValueError(
            f"Stone-region topology must be between 0 and 15, got {topology}."
        )

    axis = np.linspace(0.0, 1.0, CONTENT_SIZE, dtype=np.float64)
    xx, yy = np.meshgrid(axis, axis)
    smooth_x = xx * xx * (3.0 - 2.0 * xx)
    smooth_y = yy * yy * (3.0 - 2.0 * yy)
    north_west = float(bool(topology & NORTH_WEST))
    north_east = float(bool(topology & NORTH_EAST))
    south_east = float(bool(topology & SOUTH_EAST))
    south_west = float(bool(topology & SOUTH_WEST))
    north = north_west * (1.0 - smooth_x) + north_east * smooth_x
    south = south_west * (1.0 - smooth_x) + south_east * smooth_x
    field = north * (1.0 - smooth_y) + south * smooth_y

    # Resolve the two diagonal saddles as connected regions. The bump is zero
    # at every edge, so it cannot change compatibility with adjacent tiles.
    if topology in (NORTH_WEST | SOUTH_EAST, NORTH_EAST | SOUTH_WEST):
        interior_window = 16.0 * xx * (1.0 - xx) * yy * (1.0 - yy)
        field += 0.075 * interior_window

    phase_x = 2.0 * np.pi * xx
    phase_y = 2.0 * np.pi * yy
    organic_noise = 0.018 * np.sin(2.0 * phase_x + phase_y + 0.35) + 0.011 * np.cos(
        phase_x - 3.0 * phase_y - 0.55
    )
    organic_noise[-1] = organic_noise[0]
    organic_noise[:, -1] = organic_noise[:, 0]
    field += organic_noise
    return np.clip(0.5 + (field - threshold) / 0.024, 0.0, 1.0)


def _stone_region_tiles(grass_base: RGBArray, stone: RGBArray) -> list[RGBArray]:
    """Create sixteen large-region tiles with a corner occupancy contract."""
    tiles: list[RGBArray] = []
    grass_float = grass_base.astype(np.float64)
    stone_float = stone.astype(np.float64)
    ink = np.asarray((23.0, 21.0, 15.0), dtype=np.float64)
    for topology in range(STONE_REGION_VARIANT_COUNT):
        if topology == 0:
            tiles.append(grass_base.copy())
            continue
        if topology == STONE_REGION_VARIANT_COUNT - 1:
            tiles.append(stone.copy())
            continue

        alpha = _stone_region_alpha(topology, threshold=0.5)
        outer_alpha = _stone_region_alpha(topology, threshold=0.455)
        contour = np.clip(outer_alpha - alpha, 0.0, 1.0)
        seated_grass = grass_float * (1.0 - 0.34 * contour[:, :, np.newaxis])
        seated_grass += ink[np.newaxis, np.newaxis, :] * (
            0.34 * contour[:, :, np.newaxis]
        )
        blended = stone_float * alpha[:, :, np.newaxis] + seated_grass * (
            1.0 - alpha[:, :, np.newaxis]
        )
        tiles.append(np.clip(np.rint(blended), 0.0, 255.0).astype(np.uint8))
    return tiles


def _validate_stone_region_edges(
    grass_base: RGBArray,
    stone: RGBArray,
    regions: list[RGBArray],
) -> None:
    """Require exact edges for every compatible corner-mask adjacency."""
    if len(regions) != STONE_REGION_VARIANT_COUNT:
        raise RuntimeError(
            f"Expected {STONE_REGION_VARIANT_COUNT} stone-region tiles, "
            f"got {len(regions)}."
        )
    if not np.array_equal(regions[0], grass_base):
        raise RuntimeError("Stone-region mask 0 must equal the base grass tile.")
    if not np.array_equal(regions[-1], stone):
        raise RuntimeError("Stone-region mask 15 must be a full stone tile.")

    for left_mask, left_tile in enumerate(regions):
        for right_mask, right_tile in enumerate(regions):
            horizontal_match = bool(left_mask & NORTH_EAST) == bool(
                right_mask & NORTH_WEST
            ) and bool(left_mask & SOUTH_EAST) == bool(right_mask & SOUTH_WEST)
            if horizontal_match and not np.array_equal(
                left_tile[:, -1], right_tile[:, 0]
            ):
                raise RuntimeError(
                    "Stone-region horizontal edge mismatch between masks "
                    f"{left_mask} and {right_mask}."
                )

            vertical_match = bool(left_mask & SOUTH_WEST) == bool(
                right_mask & NORTH_WEST
            ) and bool(left_mask & SOUTH_EAST) == bool(right_mask & NORTH_EAST)
            if vertical_match and not np.array_equal(left_tile[-1], right_tile[0]):
                raise RuntimeError(
                    "Stone-region vertical edge mismatch between masks "
                    f"{left_mask} and {right_mask}."
                )


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
            raise ValueError(
                f"tile_index_rows[{row_number}] must be a non-empty array."
            )
        if any(isinstance(index, bool) or not isinstance(index, int) for index in row):
            raise ValueError(
                f"tile_index_rows[{row_number}] must contain only integers."
            )
        if any(index < 0 or index >= ATLAS_COLUMNS * ATLAS_ROWS for index in row):
            maximum_index = ATLAS_COLUMNS * ATLAS_ROWS - 1
            raise ValueError(
                f"tile_index_rows[{row_number}] contains an index outside "
                f"0..{maximum_index}."
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
            visual_index = tile_index
            if (
                tile_index == STONE_FULL_CANONICAL_INDEX
                and len(tiles) >= STONE_FULL_VISUAL_INDICES[-1] + 1
            ):
                variation = (
                    column_index * 7 + row_index * 11 + column_index * row_index * 3
                ) % len(STONE_FULL_VISUAL_INDICES)
                visual_index = STONE_FULL_VISUAL_INDICES[variation]
            top = row_index * CONTENT_SIZE
            left = column_index * CONTENT_SIZE
            preview[top : top + CONTENT_SIZE, left : left + CONTENT_SIZE] = tiles[
                visual_index
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
    accents = _grass_accents(grass, earth)
    paths = _path_tiles(grass, earth)
    _validate_path_edges(grass[0], paths)
    stone_materials = _stone_materials()
    stone_regions = _stone_region_tiles(grass[0], stone_materials[0])
    _validate_stone_region_edges(grass[0], stone_materials[0], stone_regions)
    stone_full_extras = stone_materials[1:]
    if len(stone_full_extras) != STONE_FULL_EXTRA_COUNT:
        raise RuntimeError(
            f"Expected {STONE_FULL_EXTRA_COUNT} extra full-stone variants, "
            f"got {len(stone_full_extras)}."
        )
    tiles = [*grass, *accents, *paths, *stone_regions, *stone_full_extras]
    _save_png(_build_atlas(tiles), atlas_out)
    print(
        f"Wrote {atlas_out} ({ATLAS_SIZE[0]}x{ATLAS_SIZE[1]}, "
        f"{len(tiles)} reusable tiles: {len(grass)} grass, "
        f"{len(accents)} accents, {len(paths)} paths starting at "
        f"index {PATH_FIRST_INDEX}, and {len(stone_regions)} stone regions "
        f"starting at index {STONE_REGION_FIRST_INDEX}, and "
        f"{len(stone_full_extras)} extra full-stone variants)."
    )

    if layout is not None and preview_out is not None:
        rows = _read_index_rows(layout)
        preview = _build_preview(rows, tiles)
        _save_png(preview, preview_out)
        print(f"Wrote {preview_out} ({preview.shape[1]}x{preview.shape[0]}).")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a deterministic 4x12 terrain atlas with four grass variants, "
            "eight grass accents, sixteen N/E/S/W path topologies, and sixteen "
            "NW/NE/SE/SW cream-stone region topologies plus four full-court "
            "visual variants."
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
