"""Strict declarative contracts for built-in rig templates."""

from __future__ import annotations

from typing import Literal, Self

from pydantic import Field, field_validator, model_validator

from animated_fabric.domain._base import DomainModel, SchemaVersion, SemanticId


class TemplateBone(DomainModel):
    """One named bone and its parent in a template hierarchy."""

    bone_id: SemanticId
    parent_id: SemanticId | None = None


class TemplatePart(DomainModel):
    """One canonical visual part and its default owning bone."""

    part_id: SemanticId
    bone_id: SemanticId


class TemplateAliasGroup(DomainModel):
    """Import aliases that resolve to one canonical template part."""

    canonical_part: SemanticId
    aliases: tuple[SemanticId, ...] = Field(min_length=1, max_length=64)


class TemplateSocket(DomainModel):
    """A socket identity with its default bone and semantic draw slot."""

    socket_id: SemanticId
    bone_id: SemanticId
    default_draw_slot: SemanticId


class TemplateNumericLimit(DomainModel):
    """Inclusive numeric bounds for one named template value."""

    value_id: SemanticId
    minimum: float
    maximum: float

    @model_validator(mode="after")
    def validate_order(self) -> Self:
        """Require a non-inverted inclusive interval."""
        if self.minimum > self.maximum:
            raise ValueError("minimum must be less than or equal to maximum")
        return self


class TemplateInitialValue(DomainModel):
    """One named numeric default used when a template is later applied."""

    value_id: SemanticId
    value: float


class RigTemplateSummary(DomainModel):
    """Stable metadata returned when listing templates."""

    template_id: SemanticId
    display_name: str = Field(min_length=1, max_length=120)


class RigTemplate(DomainModel):
    """A validated, immutable, and non-executable anatomical template."""

    format: Literal["animated-fabric.rig-template.v1"]
    schema_version: SchemaVersion
    template_id: SemanticId
    display_name: str = Field(min_length=1, max_length=120)
    bones: tuple[TemplateBone, ...] = Field(min_length=1, max_length=256)
    required_parts: tuple[TemplatePart, ...] = Field(min_length=1, max_length=512)
    optional_parts: tuple[TemplatePart, ...] = Field(max_length=512)
    import_aliases: tuple[TemplateAliasGroup, ...] = Field(max_length=512)
    default_sockets: tuple[TemplateSocket, ...] = Field(max_length=256)
    draw_slots: tuple[SemanticId, ...] = Field(min_length=1, max_length=128)
    compatible_generators: tuple[SemanticId, ...] = Field(max_length=64)
    limits: tuple[TemplateNumericLimit, ...] = Field(min_length=1, max_length=128)
    initial_values: tuple[TemplateInitialValue, ...] = Field(min_length=1, max_length=128)

    @field_validator("schema_version")
    @classmethod
    def validate_supported_schema_family(cls, value: str) -> str:
        """Accept stable 0.1.x template resources only."""
        version_without_build = value.split("+", maxsplit=1)[0]
        if "-" in version_without_build:
            raise ValueError("prerelease template schemas are not supported")
        major, minor, _patch = version_without_build.split(".")
        if (major, minor) != ("0", "1"):
            raise ValueError("supported template schema family is 0.1.x")
        return value

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str) -> str:
        """Reject invisible or multiline template labels."""
        if value != value.strip() or not value.strip() or any(char in value for char in "\r\n"):
            raise ValueError("must be a single non-blank line without surrounding whitespace")
        return value

    @model_validator(mode="after")
    def validate_relationships(self) -> Self:
        """Validate all cross-references and deterministic uniqueness rules."""
        bone_ids = tuple(bone.bone_id for bone in self.bones)
        _require_unique(bone_ids, "bone ID")
        bone_id_set = set(bone_ids)

        roots = tuple(bone.bone_id for bone in self.bones if bone.parent_id is None)
        if roots != ("root",):
            found = ", ".join(repr(root) for root in roots) or "none"
            raise ValueError(
                "template hierarchy must contain exactly one parentless bone named "
                f"'root'; found {found}"
            )
        parents = {bone.bone_id: bone.parent_id for bone in self.bones}
        for bone in self.bones:
            if bone.parent_id is not None and bone.parent_id not in bone_id_set:
                raise ValueError(
                    f"bone '{bone.bone_id}' references missing parent '{bone.parent_id}'"
                )
        _validate_acyclic_hierarchy(parents)

        required_ids = tuple(part.part_id for part in self.required_parts)
        optional_ids = tuple(part.part_id for part in self.optional_parts)
        _require_unique(required_ids, "required part ID")
        _require_unique(optional_ids, "optional part ID")
        overlap = set(required_ids).intersection(optional_ids)
        if overlap:
            duplicate = next(part_id for part_id in required_ids if part_id in overlap)
            raise ValueError(f"part '{duplicate}' cannot be both required and optional")
        canonical_parts = set(required_ids).union(optional_ids)
        for part in (*self.required_parts, *self.optional_parts):
            if part.bone_id not in bone_id_set:
                raise ValueError(f"part '{part.part_id}' references missing bone '{part.bone_id}'")

        draw_slots = tuple(self.draw_slots)
        _require_unique(draw_slots, "draw slot")
        draw_slot_set = set(draw_slots)

        socket_ids = tuple(socket.socket_id for socket in self.default_sockets)
        _require_unique(socket_ids, "socket ID")
        for socket in self.default_sockets:
            if socket.bone_id not in bone_id_set:
                raise ValueError(
                    f"socket '{socket.socket_id}' references missing bone '{socket.bone_id}'"
                )
            if socket.default_draw_slot not in draw_slot_set:
                raise ValueError(
                    f"socket '{socket.socket_id}' references unknown draw slot "
                    f"'{socket.default_draw_slot}'"
                )

        canonical_alias_targets = tuple(
            alias_group.canonical_part for alias_group in self.import_aliases
        )
        _require_unique(canonical_alias_targets, "alias target")
        all_aliases: list[str] = []
        for alias_group in self.import_aliases:
            if alias_group.canonical_part not in canonical_parts:
                raise ValueError(
                    f"alias target '{alias_group.canonical_part}' is not a declared part"
                )
            aliases = tuple(alias_group.aliases)
            _require_unique(aliases, "import alias")
            for alias in aliases:
                if alias in canonical_parts:
                    raise ValueError(f"import alias '{alias}' collides with a canonical part")
            all_aliases.extend(aliases)
        _require_unique(tuple(all_aliases), "import alias")

        _require_unique(tuple(self.compatible_generators), "compatible generator ID")

        limit_ids = tuple(limit.value_id for limit in self.limits)
        initial_ids = tuple(initial.value_id for initial in self.initial_values)
        _require_unique(limit_ids, "limit value ID")
        _require_unique(initial_ids, "initial value ID")
        if set(limit_ids) != set(initial_ids):
            raise ValueError("limits and initial values must declare the same value IDs")
        initial_by_id = {initial.value_id: initial.value for initial in self.initial_values}
        for limit in self.limits:
            initial = initial_by_id[limit.value_id]
            if not limit.minimum <= initial <= limit.maximum:
                raise ValueError(
                    f"initial value '{limit.value_id}' must be within its inclusive limit"
                )
        return self


def _require_unique(values: tuple[str, ...], label: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ValueError(f"duplicate {label} '{value}'")
        seen.add(value)


def _validate_acyclic_hierarchy(parents: dict[str, str | None]) -> None:
    for bone_id in parents:
        path: set[str] = set()
        current: str | None = bone_id
        while current is not None:
            if current in path:
                raise ValueError(f"template hierarchy contains a bone cycle at '{current}'")
            path.add(current)
            current = parents[current]


__all__ = [
    "RigTemplate",
    "RigTemplateSummary",
    "TemplateAliasGroup",
    "TemplateBone",
    "TemplateInitialValue",
    "TemplateNumericLimit",
    "TemplatePart",
    "TemplateSocket",
]
