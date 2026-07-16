"""Pure immutable affine transformations for column-vector canvas geometry."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Self, cast

from animated_fabric.domain.geometry import Transform2D, Vec2

type MatrixValues = tuple[
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
]


@dataclass(frozen=True, slots=True)
class Matrix3:
    """An immutable row-major 3x3 matrix applied to column vectors."""

    values: MatrixValues

    def __post_init__(self) -> None:
        if len(self.values) != 9:
            raise ValueError("Matrix3 requires exactly nine values")
        normalized = tuple(_finite_float(value) for value in self.values)
        object.__setattr__(self, "values", normalized)

    @classmethod
    def from_rows(
        cls,
        first: tuple[float, float, float],
        second: tuple[float, float, float],
        third: tuple[float, float, float],
    ) -> Self:
        """Construct a matrix from three row tuples."""
        return cls((*first, *second, *third))

    @property
    def shape(self) -> tuple[int, int]:
        """Return the fixed matrix dimensions."""
        return (3, 3)

    @property
    def rows(
        self,
    ) -> tuple[
        tuple[float, float, float],
        tuple[float, float, float],
        tuple[float, float, float],
    ]:
        """Return the matrix as immutable row tuples."""
        return (
            (self.values[0], self.values[1], self.values[2]),
            (self.values[3], self.values[4], self.values[5]),
            (self.values[6], self.values[7], self.values[8]),
        )

    def at(self, row: int, column: int) -> float:
        """Return one value by zero-based row and column."""
        if not 0 <= row < 3 or not 0 <= column < 3:
            raise IndexError("matrix index is outside the 3x3 bounds")
        return self.values[row * 3 + column]


def _finite_float(value: float) -> float:
    normalized = float(value)
    if not math.isfinite(normalized):
        raise ValueError("affine values must be finite")
    return normalized


def identity_matrix() -> Matrix3:
    """Return a fresh immutable 3x3 identity matrix."""
    return Matrix3.from_rows(
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0),
    )


def translation_matrix(offset: Vec2) -> Matrix3:
    """Return a matrix translating column-vector points by ``offset`` pixels."""
    return Matrix3.from_rows(
        (1.0, 0.0, offset.x),
        (0.0, 1.0, offset.y),
        (0.0, 0.0, 1.0),
    )


def rotation_matrix(rotation_deg: float) -> Matrix3:
    """Return the y-down matrix for a visually clockwise positive rotation."""
    radians = math.radians(_finite_float(rotation_deg))
    cosine = math.cos(radians)
    sine = math.sin(radians)
    return Matrix3.from_rows(
        (cosine, -sine, 0.0),
        (sine, cosine, 0.0),
        (0.0, 0.0, 1.0),
    )


def scale_matrix(factors: Vec2) -> Matrix3:
    """Return a matrix scaling column-vector points by each component."""
    return Matrix3.from_rows(
        (factors.x, 0.0, 0.0),
        (0.0, factors.y, 0.0),
        (0.0, 0.0, 1.0),
    )


def _multiply(left: Matrix3, right: Matrix3) -> Matrix3:
    values = tuple(
        math.fsum(left.at(row, inner) * right.at(inner, column) for inner in range(3))
        for row in range(3)
        for column in range(3)
    )
    return Matrix3(cast(MatrixValues, values))


def multiply_matrices(*matrices: Matrix3) -> Matrix3:
    """Multiply matrices in written order, returning a fresh immutable result."""
    result = identity_matrix()
    for matrix in matrices:
        if not isinstance(matrix, Matrix3):
            raise TypeError("multiply_matrices accepts only Matrix3 values")
        result = _multiply(result, matrix)
    return result


def transform_matrix(transform: Transform2D) -> Matrix3:
    """Compose one local transform in the normative ``T * R * S`` order."""
    return multiply_matrices(
        translation_matrix(transform.position),
        rotation_matrix(transform.rotation_deg),
        scale_matrix(transform.scale),
    )


def transform_point(matrix: Matrix3, point: Vec2) -> Vec2:
    """Transform one affine point as a homogeneous column vector."""
    if not isinstance(matrix, Matrix3):
        raise TypeError("transform_point requires a Matrix3")
    x = math.fsum((matrix.at(0, 0) * point.x, matrix.at(0, 1) * point.y, matrix.at(0, 2)))
    y = math.fsum((matrix.at(1, 0) * point.x, matrix.at(1, 1) * point.y, matrix.at(1, 2)))
    return Vec2(x=_finite_float(x), y=_finite_float(y))


__all__ = [
    "Matrix3",
    "identity_matrix",
    "multiply_matrices",
    "rotation_matrix",
    "scale_matrix",
    "transform_matrix",
    "transform_point",
    "translation_matrix",
]
