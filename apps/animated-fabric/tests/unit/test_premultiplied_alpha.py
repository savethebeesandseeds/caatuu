"""Tests for strict immutable premultiplied-alpha image operations."""

from __future__ import annotations

import math

import numpy as np
import pytest

from animated_fabric.domain.exceptions import RenderError
from animated_fabric.infrastructure.imaging.alpha import (
    apply_opacity,
    sanitize_premultiplied,
    source_over,
    to_premultiplied_rgba,
    to_straight_rgba,
)


def assert_read_only(image: np.ndarray[tuple[int, ...], np.dtype[np.generic]]) -> None:
    assert not image.flags.writeable
    with pytest.raises(ValueError):
        image.flat[0] = 0


def test_uint8_rgba_converts_to_normalized_premultiplied_float32() -> None:
    image = np.array([[[200, 100, 50, 128], [9, 8, 7, 0]]], dtype=np.uint8)
    before = image.copy()

    result = to_premultiplied_rgba(image)

    alpha = np.float32(128.0 / 255.0)
    assert result.dtype == np.float32
    np.testing.assert_allclose(
        result,
        np.array(
            [
                [
                    [
                        np.float32(200.0 / 255.0) * alpha,
                        np.float32(100.0 / 255.0) * alpha,
                        np.float32(50.0 / 255.0) * alpha,
                        alpha,
                    ],
                    [0.0, 0.0, 0.0, 0.0],
                ]
            ],
            dtype=np.float32,
        ),
        rtol=0.0,
        atol=1e-7,
    )
    np.testing.assert_array_equal(image, before)
    assert image.flags.writeable
    assert_read_only(result)


@pytest.mark.parametrize(
    "image",
    [
        np.zeros((2, 2, 3), dtype=np.uint8),
        np.zeros((0, 2, 4), dtype=np.uint8),
        np.zeros((2, 2, 4), dtype=np.float32),
    ],
)
def test_straight_input_requires_nonempty_uint8_rgba(image: np.ndarray) -> None:
    with pytest.raises(RenderError):
        to_premultiplied_rgba(image)  # type: ignore[arg-type]


def test_sanitization_clamps_cubic_overshoot_to_premultiplied_invariants() -> None:
    image = np.array(
        [
            [
                [-0.2, 0.4, 1.4, 0.5],
                [0.2, 0.3, 0.4, -0.1],
                [2.0, 1.5, 1.25, 1.2],
            ]
        ],
        dtype=np.float32,
    )
    before = image.copy()

    result = sanitize_premultiplied(image)

    np.testing.assert_allclose(
        result,
        np.array(
            [[[0.0, 0.4, 0.5, 0.5], [0.0, 0.0, 0.0, 0.0], [1.0, 1.0, 1.0, 1.0]]],
            dtype=np.float32,
        ),
    )
    np.testing.assert_array_equal(image, before)
    assert_read_only(result)


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_nonfinite_premultiplied_values_raise_render_error(value: float) -> None:
    image = np.zeros((1, 1, 4), dtype=np.float32)
    image[0, 0, 0] = value

    with pytest.raises(RenderError, match="finite"):
        sanitize_premultiplied(image)


def test_opacity_scales_every_channel_without_mutating_input() -> None:
    image = np.array([[[0.4, 0.2, 0.1, 0.5]]], dtype=np.float32)
    before = image.copy()

    result = apply_opacity(image, 0.25)

    np.testing.assert_allclose(result, [[[0.1, 0.05, 0.025, 0.125]]])
    np.testing.assert_array_equal(image, before)
    assert_read_only(result)


@pytest.mark.parametrize("opacity", [-0.01, 1.01, math.nan, math.inf, True])
def test_opacity_rejects_invalid_values(opacity: float) -> None:
    image = np.zeros((1, 1, 4), dtype=np.float32)

    with pytest.raises(RenderError, match="Opacity"):
        apply_opacity(image, opacity)


def test_opacity_wraps_numeric_conversion_overflow_as_render_error() -> None:
    image = np.zeros((1, 1, 4), dtype=np.float32)

    with pytest.raises(RenderError, match="Opacity"):
        apply_opacity(image, 10**10000)


def test_source_over_uses_normative_premultiplied_equation() -> None:
    source = np.array([[[0.5, 0.0, 0.0, 0.5]]], dtype=np.float32)
    destination = np.array([[[0.0, 0.0, 0.5, 0.5]]], dtype=np.float32)
    source_before = source.copy()
    destination_before = destination.copy()

    result = source_over(source, destination)

    np.testing.assert_allclose(result, [[[0.5, 0.0, 0.25, 0.75]]])
    np.testing.assert_array_equal(source, source_before)
    np.testing.assert_array_equal(destination, destination_before)
    assert_read_only(result)


def test_source_over_requires_matching_float32_rgba_images() -> None:
    valid = np.zeros((1, 1, 4), dtype=np.float32)
    wrong_size = np.zeros((2, 1, 4), dtype=np.float32)
    wrong_dtype = np.zeros((1, 1, 4), dtype=np.float64)

    with pytest.raises(RenderError, match="identical"):
        source_over(valid, wrong_size)
    with pytest.raises(RenderError, match="float32"):
        source_over(valid, wrong_dtype)  # type: ignore[arg-type]


def test_straight_conversion_is_safe_and_zeros_transparent_rgb() -> None:
    image = np.array(
        [
            [
                [0.25, 0.125, 0.0, 0.5],
                [0.4, 0.2, 0.1, 0.0],
                [1e-9, 1e-9, 1e-9, 1e-9],
            ]
        ],
        dtype=np.float32,
    )
    before = image.copy()

    result = to_straight_rgba(image)

    assert result.dtype == np.uint8
    np.testing.assert_array_equal(
        result,
        np.array([[[128, 64, 0, 128], [0, 0, 0, 0], [0, 0, 0, 0]]], dtype=np.uint8),
    )
    np.testing.assert_array_equal(image, before)
    assert_read_only(result)


def test_premultiplied_round_trip_preserves_representative_rgba_within_one_level() -> None:
    image = np.array(
        [[[17, 83, 241, 64], [255, 128, 0, 255], [20, 40, 60, 0]]],
        dtype=np.uint8,
    )

    result = to_straight_rgba(to_premultiplied_rgba(image))

    np.testing.assert_allclose(result[..., :3][..., :2, :], image[..., :3][..., :2, :], atol=1)
    np.testing.assert_array_equal(result[..., 3], image[..., 3])
    np.testing.assert_array_equal(result[..., :3][..., 2, :], 0)
