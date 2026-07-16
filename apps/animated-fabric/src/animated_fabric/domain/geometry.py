"""Serializable geometry primitives used by domain contracts."""

from __future__ import annotations

from pydantic import Field, model_serializer, model_validator

from animated_fabric.domain._base import DomainModel


def _pair_input(value: object, first: str, second: str) -> object:
    """Translate the normative two-item JSON representation into model fields."""
    if isinstance(value, (list, tuple)):
        if len(value) != 2:
            raise ValueError("coordinate pairs must contain exactly two items")
        return {first: value[0], second: value[1]}
    return value


class Vec2(DomainModel):
    """A finite two-dimensional floating-point vector."""

    x: float
    y: float

    @model_validator(mode="before")
    @classmethod
    def _from_pair(cls, value: object) -> object:
        return _pair_input(value, "x", "y")

    @model_serializer(mode="plain")
    def _as_pair(self) -> list[float]:
        return [self.x, self.y]


class IntPoint(DomainModel):
    """A two-dimensional point expressed in integer pixels."""

    x: int
    y: int

    @model_validator(mode="before")
    @classmethod
    def _from_pair(cls, value: object) -> object:
        return _pair_input(value, "x", "y")

    @model_serializer(mode="plain")
    def _as_pair(self) -> list[int]:
        return [self.x, self.y]


class IntSize(DomainModel):
    """A non-empty image or canvas size expressed in integer pixels."""

    width: int = Field(gt=0)
    height: int = Field(gt=0)

    @model_validator(mode="before")
    @classmethod
    def _from_pair(cls, value: object) -> object:
        return _pair_input(value, "width", "height")

    @model_serializer(mode="plain")
    def _as_pair(self) -> list[int]:
        return [self.width, self.height]


class Transform2D(DomainModel):
    """A local translation, clockwise rotation, and component scale."""

    position: Vec2 = Field(default_factory=lambda: Vec2(x=0.0, y=0.0))
    rotation_deg: float = 0.0
    scale: Vec2 = Field(default_factory=lambda: Vec2(x=1.0, y=1.0))


class SelectionEllipse(DomainModel):
    """Ground-relative selection bounds displayed for an actor."""

    center_offset: Vec2
    radius_x: float = Field(gt=0.0)
    radius_y: float = Field(gt=0.0)
