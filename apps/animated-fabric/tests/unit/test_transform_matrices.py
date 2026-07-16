"""Tests for normative immutable affine transformation matrices."""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from animated_fabric.domain.geometry import Transform2D, Vec2
from animated_fabric.domain.transforms import (
    Matrix3,
    identity_matrix,
    multiply_matrices,
    rotation_matrix,
    scale_matrix,
    transform_matrix,
    transform_point,
    translation_matrix,
)


def assert_matrix_contract(matrix: Matrix3) -> None:
    assert matrix.shape == (3, 3)
    assert len(matrix.values) == 9
    assert all(type(value) is float for value in matrix.values)
    assert isinstance(matrix.rows, tuple)
    assert all(isinstance(row, tuple) for row in matrix.rows)


def test_identity_is_exact_fresh_and_immutable() -> None:
    first = identity_matrix()
    second = identity_matrix()

    assert first.rows == (
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0),
    )
    assert_matrix_contract(first)
    assert first == second
    assert first is not second
    with pytest.raises(FrozenInstanceError):
        first.values = (0.0,) * 9
    with pytest.raises(TypeError):
        first.values[0] = 2.0


def test_translation_and_scale_have_exact_column_vector_layout() -> None:
    translation = translation_matrix(Vec2(x=5.5, y=-3.0))
    scale = scale_matrix(Vec2(x=2.0, y=0.5))

    assert translation.rows == (
        (1.0, 0.0, 5.5),
        (0.0, 1.0, -3.0),
        (0.0, 0.0, 1.0),
    )
    assert scale.rows == (
        (2.0, 0.0, 0.0),
        (0.0, 0.5, 0.0),
        (0.0, 0.0, 1.0),
    )
    assert_matrix_contract(translation)
    assert_matrix_contract(scale)


def test_positive_rotation_is_visually_clockwise_in_y_down_coordinates() -> None:
    matrix = rotation_matrix(90.0)

    assert matrix.values == pytest.approx(
        (0.0, -1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        abs=1e-12,
    )
    point = transform_point(matrix, Vec2(x=1.0, y=0.0))
    assert point.x == pytest.approx(0.0, abs=1e-12)
    assert point.y == pytest.approx(1.0, abs=1e-12)
    assert_matrix_contract(matrix)


def test_transform_matrix_uses_normative_translation_rotation_scale_order() -> None:
    transform = Transform2D(
        position=Vec2(x=10.0, y=20.0),
        rotation_deg=90.0,
        scale=Vec2(x=2.0, y=3.0),
    )

    matrix = transform_matrix(transform)
    expected = multiply_matrices(
        translation_matrix(transform.position),
        rotation_matrix(transform.rotation_deg),
        scale_matrix(transform.scale),
    )

    assert matrix == expected
    transformed = transform_point(matrix, Vec2(x=1.0, y=2.0))
    assert transformed.x == pytest.approx(4.0, abs=1e-12)
    assert transformed.y == pytest.approx(22.0, abs=1e-12)
    assert_matrix_contract(matrix)


def test_multiplication_applies_the_rightmost_matrix_first() -> None:
    point = Vec2(x=1.0, y=1.0)
    translated_after_scale = multiply_matrices(
        translation_matrix(Vec2(x=10.0, y=0.0)),
        scale_matrix(Vec2(x=2.0, y=2.0)),
    )
    scaled_after_translation = multiply_matrices(
        scale_matrix(Vec2(x=2.0, y=2.0)),
        translation_matrix(Vec2(x=10.0, y=0.0)),
    )

    assert transform_point(translated_after_scale, point) == Vec2(x=12.0, y=2.0)
    assert transform_point(scaled_after_translation, point) == Vec2(x=22.0, y=2.0)


def test_empty_and_single_multiplication_return_fresh_immutable_results() -> None:
    empty_first = multiply_matrices()
    empty_second = multiply_matrices()
    source = translation_matrix(Vec2(x=4.0, y=7.0))
    copied = multiply_matrices(source)

    assert empty_first == identity_matrix()
    assert copied == source
    assert empty_first is not empty_second
    assert copied is not source
    assert copied.values is not source.values
    assert_matrix_contract(empty_first)
    assert_matrix_contract(copied)


def test_matrix_construction_rejects_wrong_size_and_nonfinite_values() -> None:
    with pytest.raises(ValueError, match="nine values"):
        Matrix3((1.0,) * 8)
    with pytest.raises(ValueError, match="finite"):
        Matrix3((float("inf"), 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0))


def test_operations_reject_non_matrix_and_nonfinite_rotation_inputs() -> None:
    with pytest.raises(TypeError, match="Matrix3"):
        multiply_matrices(((1.0, 0.0, 0.0),) * 3)
    with pytest.raises(TypeError, match="Matrix3"):
        transform_point(((1.0, 0.0, 0.0),) * 3, Vec2(x=0.0, y=0.0))
    with pytest.raises(ValueError, match="finite"):
        rotation_matrix(float("inf"))


def test_matrix_indexing_has_explicit_bounds() -> None:
    matrix = identity_matrix()

    assert matrix.at(2, 2) == 1.0
    with pytest.raises(IndexError, match="outside"):
        matrix.at(3, 0)
    with pytest.raises(IndexError, match="outside"):
        matrix.at(0, -1)


def test_repeated_composition_is_bitwise_deterministic() -> None:
    transform = Transform2D(
        position=Vec2(x=12.25, y=-4.5),
        rotation_deg=17.75,
        scale=Vec2(x=0.75, y=1.25),
    )

    first = transform_matrix(transform)
    second = transform_matrix(transform)

    assert first == second
    assert first.values == second.values
    assert transform == Transform2D(
        position=Vec2(x=12.25, y=-4.5),
        rotation_deg=17.75,
        scale=Vec2(x=0.75, y=1.25),
    )
