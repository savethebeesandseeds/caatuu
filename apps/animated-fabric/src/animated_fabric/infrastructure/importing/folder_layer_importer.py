"""Deterministic, bounded folder importer for prepared PNG layers."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import tempfile
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image, UnidentifiedImageError
from pydantic import TypeAdapter, ValidationError

from animated_fabric.application.import_layers import (
    ImportInspection,
    ImportLimits,
    ImportResult,
    InspectedLayer,
    LayerAssignment,
    LayerImportRequest,
)
from animated_fabric.application.ports import (
    LAYER_MANIFEST_FILENAME,
    LayerManifestRepository,
)
from animated_fabric.domain._base import SemanticId
from animated_fabric.domain.assets import AssetLayer, LayerManifest
from animated_fabric.domain.diagnostics import Diagnostic, Severity
from animated_fabric.domain.exceptions import (
    AssetImportError,
    ProjectValidationError,
    ProjectValidationKind,
    ProjectVersionError,
)
from animated_fabric.domain.geometry import IntPoint, IntSize
from animated_fabric.domain.project import Direction
from animated_fabric.domain.validation.models import ValidationCode, diagnostic_sort_key

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
LAYER_MANIFEST_FORMAT: Literal["animated-fabric.layer-manifest.v1"] = (
    "animated-fabric.layer-manifest.v1"
)
LAYER_MANIFEST_SCHEMA_VERSION = "0.1.0"

IMPORT_UNSUPPORTED_ENTRY_CODE = "AFI002"
IMPORT_SOURCE_LIMIT_CODE = "AFI003"
IMPORT_MAPPING_CODE = "AFI004"
IMPORT_DESTINATION_CODE = "AFI005"
IMPORT_PUBLICATION_CODE = "AFI006"

DEFAULT_LAYER_ALIASES: Mapping[str, str] = {
    "left_upper_arm": "upper_arm_l",
    "arm_l_upper": "upper_arm_l",
    "l_upper_arm": "upper_arm_l",
    "left_forearm": "lower_arm_l",
    "forearm_l": "lower_arm_l",
    "l_lower_arm": "lower_arm_l",
    "right_thigh": "thigh_r",
    "upper_leg_r": "thigh_r",
    "r_upper_leg": "thigh_r",
    "right_foot": "foot_r",
    "r_foot": "foot_r",
}

_SEMANTIC_ID_ADAPTER = TypeAdapter(SemanticId)


@dataclass(frozen=True, slots=True)
class _DecodedLayer:
    source_name: str
    source_canvas_size: IntSize
    alpha_origin: IntPoint | None
    alpha_size: IntSize | None
    source_sha256: str
    fully_transparent: bool
    touches_edge: bool
    rgba_bytes: bytes


@dataclass(frozen=True, slots=True)
class _PreparedLayer:
    asset: AssetLayer
    png_bytes: bytes


class _InspectionError(AssetImportError):
    """One expected source-file problem with a stable diagnostic category."""

    def __init__(self, code: str, message: str, suggestion: str) -> None:
        super().__init__(message)
        self.code = code
        self.suggestion = suggestion


class FolderLayerImporter:
    """Inspect and publish one non-recursive folder of prepared PNG layers."""

    def __init__(
        self,
        repository: LayerManifestRepository,
        *,
        limits: ImportLimits | None = None,
        aliases: Mapping[str, str] | None = None,
    ) -> None:
        self._repository = repository
        self._limits = limits or ImportLimits()
        self._aliases = self._validate_aliases(aliases or DEFAULT_LAYER_ALIASES)

    def inspect(self, source: Path) -> ImportInspection:
        """Decode direct PNG children without modifying source or project state."""
        source_root = self._existing_directory(source, "selected layer source")
        candidates, diagnostics = self._enumerate_candidates(source_root)
        if len(candidates) > self._limits.max_layers:
            diagnostics.append(
                Diagnostic(
                    code=IMPORT_SOURCE_LIMIT_CODE,
                    severity=Severity.ERROR,
                    message=(
                        f"The source contains {len(candidates)} PNG layers; the configured "
                        f"limit is {self._limits.max_layers}."
                    ),
                    path=source_root.name,
                    suggestion="Split the import into smaller reviewed folders.",
                )
            )
            return ImportInspection(diagnostics=tuple(sorted(diagnostics, key=diagnostic_sort_key)))

        inspected: list[InspectedLayer] = []
        for candidate in candidates:
            decoded, layer_diagnostics = self._inspect_candidate(source_root, candidate)
            diagnostics.extend(layer_diagnostics)
            if decoded is None:
                continue
            inspected.append(
                InspectedLayer(
                    source_name=decoded.source_name,
                    proposed_semantic_part=self._propose_semantic_part(candidate.stem),
                    source_canvas_size=decoded.source_canvas_size,
                    alpha_origin=decoded.alpha_origin,
                    alpha_size=decoded.alpha_size,
                    source_sha256=decoded.source_sha256,
                    fully_transparent=decoded.fully_transparent,
                    touches_edge=decoded.touches_edge,
                )
            )

        if not candidates:
            diagnostics.append(
                Diagnostic(
                    code=IMPORT_UNSUPPORTED_ENTRY_CODE,
                    severity=Severity.ERROR,
                    message="The selected source folder contains no PNG layers.",
                    path=source_root.name,
                    suggestion="Choose a direction-specific folder containing prepared PNGs.",
                )
            )

        return ImportInspection(
            layers=tuple(inspected),
            diagnostics=tuple(sorted(diagnostics, key=diagnostic_sort_key)),
        )

    def import_layers(self, request: LayerImportRequest) -> ImportResult:
        """Atomically publish confirmed normalized layers and the root catalog."""
        project_root = self._existing_directory(request.project_root, "approved project root")
        inspection = self.inspect(request.source)
        blocking = tuple(
            diagnostic
            for diagnostic in inspection.diagnostics
            if diagnostic.severity is Severity.ERROR
        )
        if blocking:
            raise AssetImportError(blocking[0].message)

        assignments = self._validated_assignments(inspection, request.assignments)
        source_root = self._existing_directory(request.source, "selected layer source")
        decoded_by_name: dict[str, _DecodedLayer] = {}
        for inspected in inspection.layers:
            candidate = source_root / inspected.source_name
            decoded, diagnostics = self._inspect_candidate(source_root, candidate)
            if decoded is None or any(item.severity is Severity.ERROR for item in diagnostics):
                message = (
                    diagnostics[0].message if diagnostics else "A source PNG became unavailable."
                )
                raise AssetImportError(message)
            if decoded.source_sha256 != inspected.source_sha256:
                raise AssetImportError(
                    f"Source PNG '{inspected.source_name}' changed during inspection."
                )
            decoded_by_name[inspected.source_name] = decoded

        prepared = tuple(
            self._prepare_layer(
                decoded_by_name[assignment.source_name],
                assignment,
                request.direction,
                trim=request.trim,
            )
            for assignment in assignments
        )
        existing_manifest = self._load_existing_manifest(project_root)
        catalog = self._merge_catalog(existing_manifest, prepared)
        new_layers = self._preflight_destinations(project_root, prepared, existing_manifest)
        self._publish(project_root, new_layers, catalog)

        warnings = tuple(
            item for item in inspection.diagnostics if item.severity is Severity.WARNING
        )
        return ImportResult(
            imported_assets=tuple(item.asset for item in prepared),
            catalog_assets=catalog.layers,
            manifest_path=LAYER_MANIFEST_FILENAME,
            diagnostics=warnings,
        )

    def _enumerate_candidates(
        self,
        source_root: Path,
    ) -> tuple[tuple[Path, ...], list[Diagnostic]]:
        try:
            entries = sorted(
                source_root.iterdir(),
                key=lambda path: (unicodedata.normalize("NFC", path.name).casefold(), path.name),
            )
        except OSError as error:
            raise AssetImportError("The selected layer source cannot be enumerated.") from error

        candidates: list[Path] = []
        diagnostics: list[Diagnostic] = []
        folded_names: dict[str, str] = {}
        for entry in entries:
            if entry.name == LAYER_MANIFEST_FILENAME:
                continue
            if entry.suffix.lower() != ".png":
                diagnostics.append(
                    Diagnostic(
                        code=IMPORT_UNSUPPORTED_ENTRY_CODE,
                        severity=Severity.ERROR,
                        message=f"Unsupported entry '{entry.name}' in the layer source.",
                        path=entry.name,
                        suggestion=(
                            "Keep only direct PNG layers and the optional layers.manifest.json."
                        ),
                    )
                )
                continue
            folded = unicodedata.normalize("NFC", entry.name).casefold()
            previous = folded_names.get(folded)
            if previous is not None:
                diagnostics.append(
                    Diagnostic(
                        code=IMPORT_MAPPING_CODE,
                        severity=Severity.ERROR,
                        message=(
                            f"Source filenames '{previous}' and '{entry.name}' collide when "
                            "compared case-insensitively."
                        ),
                        path=entry.name,
                        suggestion="Rename one source file before importing.",
                    )
                )
            else:
                folded_names[folded] = entry.name
            candidates.append(entry)
        return tuple(candidates), diagnostics

    def _inspect_candidate(
        self,
        source_root: Path,
        candidate: Path,
    ) -> tuple[_DecodedLayer | None, tuple[Diagnostic, ...]]:
        safe_candidate, safety_diagnostic = self._resolve_source_candidate(
            source_root,
            candidate,
        )
        if safe_candidate is None:
            assert safety_diagnostic is not None
            return None, (safety_diagnostic,)

        try:
            encoded = self._read_bounded(safe_candidate)
            decoded = self._decode_png(candidate.name, encoded)
        except _InspectionError as error:
            return (
                None,
                (
                    Diagnostic(
                        code=error.code,
                        severity=Severity.ERROR,
                        message=str(error),
                        path=candidate.name,
                        suggestion=error.suggestion,
                    ),
                ),
            )

        diagnostics: list[Diagnostic] = []
        if decoded.fully_transparent:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.TRANSPARENT_LAYER,
                    severity=Severity.WARNING,
                    message=f"Layer '{candidate.name}' is completely transparent.",
                    path=candidate.name,
                    suggestion="Confirm that an empty optional layer is intentional.",
                )
            )
        elif decoded.touches_edge:
            diagnostics.append(
                Diagnostic(
                    code=ValidationCode.ART_TOUCHES_EDGE,
                    severity=Severity.WARNING,
                    message=f"Visible art in '{candidate.name}' touches the source canvas edge.",
                    path=candidate.name,
                    suggestion="Review whether the source canvas clips intended art.",
                )
            )
        return decoded, tuple(diagnostics)

    def _decode_png(self, source_name: str, encoded: bytes) -> _DecodedLayer:
        if not encoded.startswith(PNG_SIGNATURE):
            raise _InspectionError(
                ValidationCode.PNG_UNREADABLE,
                f"Layer '{source_name}' does not have a PNG signature.",
                "Replace the file with a readable RGBA PNG.",
            )
        try:
            with Image.open(BytesIO(encoded)) as source_image:
                if source_image.format != "PNG":
                    raise _InspectionError(
                        ValidationCode.PNG_UNREADABLE,
                        f"Layer '{source_name}' is not a PNG image.",
                        "Replace the file with a readable RGBA PNG.",
                    )
                if getattr(source_image, "n_frames", 1) != 1:
                    raise _InspectionError(
                        ValidationCode.PNG_UNREADABLE,
                        f"Layer '{source_name}' must contain one PNG frame.",
                        "Use a single-frame prepared PNG layer.",
                    )
                width, height = source_image.size
                if (
                    width > self._limits.max_layer_dimension
                    or height > self._limits.max_layer_dimension
                ):
                    raise _InspectionError(
                        ValidationCode.DIMENSIONS_EXCEEDED,
                        f"Layer '{source_name}' exceeds the configured "
                        f"{self._limits.max_layer_dimension} px dimension limit.",
                        "Resize the source layer within the configured dimensions.",
                    )
                if source_image.mode == "RGBA":
                    pass
                elif source_image.mode == "P" and "transparency" in source_image.info:
                    pass
                else:
                    raise _InspectionError(
                        ValidationCode.PNG_UNREADABLE,
                        f"Layer '{source_name}' must be RGBA or indexed with transparency.",
                        "Convert the layer to RGBA or indexed PNG with transparency.",
                    )
                source_image.load()
                converted = source_image.convert("RGBA")
                rgba_bytes = converted.tobytes()
                alpha_bounds = converted.getchannel("A").getbbox()
        except _InspectionError:
            raise
        except (Image.DecompressionBombError, OSError, UnidentifiedImageError) as error:
            raise _InspectionError(
                ValidationCode.PNG_UNREADABLE,
                f"Layer '{source_name}' is not a readable PNG image.",
                "Replace the file with a readable RGBA PNG.",
            ) from error

        canvas_size = IntSize(width=width, height=height)
        if alpha_bounds is None:
            alpha_origin = None
            alpha_size = None
            touches_edge = False
        else:
            left, top, right, bottom = alpha_bounds
            alpha_origin = IntPoint(x=left, y=top)
            alpha_size = IntSize(width=right - left, height=bottom - top)
            touches_edge = left == 0 or top == 0 or right == width or bottom == height
        return _DecodedLayer(
            source_name=source_name,
            source_canvas_size=canvas_size,
            alpha_origin=alpha_origin,
            alpha_size=alpha_size,
            source_sha256=hashlib.sha256(encoded).hexdigest(),
            fully_transparent=alpha_bounds is None,
            touches_edge=touches_edge,
            rgba_bytes=rgba_bytes,
        )

    def _prepare_layer(
        self,
        decoded: _DecodedLayer,
        assignment: LayerAssignment,
        direction: Direction,
        *,
        trim: bool,
    ) -> _PreparedLayer:
        direction_value = direction.value
        source_width = decoded.source_canvas_size.width
        source_height = decoded.source_canvas_size.height
        image = Image.frombytes(
            "RGBA",
            (source_width, source_height),
            decoded.rgba_bytes,
        )
        if trim and decoded.alpha_origin is not None and decoded.alpha_size is not None:
            left = decoded.alpha_origin.x
            top = decoded.alpha_origin.y
            right = left + decoded.alpha_size.width
            bottom = top + decoded.alpha_size.height
            output_image = image.crop((left, top, right, bottom))
            trim_origin = decoded.alpha_origin
            trim_size = decoded.alpha_size
        else:
            output_image = image
            trim_origin = IntPoint(x=0, y=0)
            trim_size = decoded.source_canvas_size

        png_bytes = self._encode_rgba_png(output_image)
        direction_slug = direction_value.lower()
        asset_id = f"{direction_slug}_{assignment.semantic_part}"
        path = f"source/layers/{direction_value}/{assignment.semantic_part}.png"
        asset = AssetLayer(
            asset_id=asset_id,
            direction=direction,
            semantic_part=assignment.semantic_part,
            path=path,
            source_canvas_size=decoded.source_canvas_size,
            trim_origin=trim_origin,
            trim_size=trim_size,
            sha256=hashlib.sha256(png_bytes).hexdigest(),
            optional=assignment.optional,
        )
        return _PreparedLayer(asset=asset, png_bytes=png_bytes)

    def _validated_assignments(
        self,
        inspection: ImportInspection,
        assignments: tuple[LayerAssignment, ...],
    ) -> tuple[LayerAssignment, ...]:
        expected_names = {layer.source_name for layer in inspection.layers}
        by_name: dict[str, LayerAssignment] = {}
        semantic_parts: set[str] = set()
        for assignment in assignments:
            if (
                not assignment.source_name
                or "/" in assignment.source_name
                or "\\" in assignment.source_name
                or assignment.source_name in by_name
            ):
                raise AssetImportError(
                    "Confirmed source mappings must use each direct filename once."
                )
            if assignment.source_name not in expected_names:
                raise AssetImportError(
                    f"Confirmed mapping references unknown source '{assignment.source_name}'."
                )
            try:
                semantic_part = _SEMANTIC_ID_ADAPTER.validate_python(assignment.semantic_part)
            except ValidationError as error:
                raise AssetImportError(
                    f"Semantic part '{assignment.semantic_part}' is not lowercase ASCII snake_case."
                ) from error
            if semantic_part in semantic_parts:
                raise AssetImportError(
                    f"Semantic part '{semantic_part}' is assigned more than once in this direction."
                )
            normalized = LayerAssignment(
                source_name=assignment.source_name,
                semantic_part=semantic_part,
                optional=assignment.optional,
            )
            by_name[assignment.source_name] = normalized
            semantic_parts.add(semantic_part)

        missing = sorted(expected_names - set(by_name), key=lambda value: (value.casefold(), value))
        if missing:
            raise AssetImportError(f"Source PNG '{missing[0]}' has no confirmed semantic mapping.")
        return tuple(by_name[layer.source_name] for layer in inspection.layers)

    def _load_existing_manifest(self, project_root: Path) -> LayerManifest | None:
        try:
            return self._repository.load_layer_manifest(project_root)
        except ProjectValidationError as error:
            if error.kind is ProjectValidationKind.MISSING_DOCUMENT:
                return None
            raise AssetImportError(str(error)) from error
        except ProjectVersionError as error:
            raise AssetImportError(str(error)) from error

    @staticmethod
    def _merge_catalog(
        existing_manifest: LayerManifest | None,
        prepared: tuple[_PreparedLayer, ...],
    ) -> LayerManifest:
        existing_assets = existing_manifest.layers if existing_manifest is not None else ()
        by_asset_id = {asset.asset_id: asset for asset in existing_assets}
        by_part = {(asset.direction, asset.semantic_part): asset for asset in existing_assets}
        by_path = {asset.path: asset for asset in existing_assets}
        for item in prepared:
            asset = item.asset
            for existing in (
                by_asset_id.get(asset.asset_id),
                by_part.get((asset.direction, asset.semantic_part)),
                by_path.get(asset.path),
            ):
                if existing is not None and existing != asset:
                    raise AssetImportError(
                        f"Imported layer '{asset.asset_id}' conflicts with the existing catalog."
                    )
            by_asset_id[asset.asset_id] = asset
            by_part[(asset.direction, asset.semantic_part)] = asset
            by_path[asset.path] = asset

        layers = tuple(sorted(by_asset_id.values(), key=lambda asset: asset.asset_id))
        return LayerManifest(
            format=LAYER_MANIFEST_FORMAT,
            schema_version=LAYER_MANIFEST_SCHEMA_VERSION,
            layers=layers,
        )

    def _preflight_destinations(
        self,
        project_root: Path,
        prepared: tuple[_PreparedLayer, ...],
        existing_manifest: LayerManifest | None,
    ) -> tuple[_PreparedLayer, ...]:
        existing_by_id = {
            asset.asset_id: asset
            for asset in (existing_manifest.layers if existing_manifest is not None else ())
        }
        new_layers: list[_PreparedLayer] = []
        for item in prepared:
            target = project_root.joinpath(*item.asset.path.split("/"))
            self._require_project_destination(project_root, target)
            if target.is_symlink():
                raise AssetImportError(
                    f"Destination '{item.asset.path}' must not be a symbolic link."
                )
            if target.exists():
                if not target.is_file():
                    raise AssetImportError(
                        f"Destination '{item.asset.path}' is not a regular file."
                    )
                try:
                    existing_size = target.stat().st_size
                    if existing_size > self._limits.max_file_bytes or existing_size != len(
                        item.png_bytes
                    ):
                        raise AssetImportError(
                            f"Immutable destination '{item.asset.path}' already exists with "
                            "different content or metadata."
                        )
                    existing_bytes = target.read_bytes()
                except AssetImportError:
                    raise
                except OSError as error:
                    raise AssetImportError(
                        f"Existing destination '{item.asset.path}' cannot be read safely."
                    ) from error
                recorded = existing_by_id.get(item.asset.asset_id)
                if existing_bytes != item.png_bytes or (
                    recorded is not None and recorded != item.asset
                ):
                    raise AssetImportError(
                        f"Immutable destination '{item.asset.path}' already exists with "
                        "different content or metadata."
                    )
                continue
            new_layers.append(item)
        return tuple(new_layers)

    def _publish(
        self,
        project_root: Path,
        new_layers: tuple[_PreparedLayer, ...],
        catalog: LayerManifest,
    ) -> None:
        staging_parent = project_root / ".animated-fabric" / "import-staging"
        self._require_project_destination(project_root, staging_parent)
        try:
            staging_parent.mkdir(parents=True, exist_ok=True)
            self._require_project_destination(project_root, staging_parent)
            staging_root = Path(tempfile.mkdtemp(prefix="layers-", dir=staging_parent))
        except OSError as error:
            raise AssetImportError(
                "Unable to create a safe project import staging directory."
            ) from error

        created: list[Path] = []
        staged: list[tuple[_PreparedLayer, Path]] = []
        try:
            for index, item in enumerate(new_layers):
                temporary = staging_root / f"{index:04d}-{item.asset.asset_id}.png"
                self._write_staged_file(temporary, item.png_bytes)
                staged.append((item, temporary))

            for item, temporary in staged:
                target = project_root.joinpath(*item.asset.path.split("/"))
                self._require_project_destination(project_root, target)
                target.parent.mkdir(parents=True, exist_ok=True)
                self._require_project_destination(project_root, target)
                if target.exists() or target.is_symlink():
                    raise AssetImportError(
                        f"Immutable destination '{item.asset.path}' appeared during import."
                    )
                os.link(temporary, target)
                created.append(target)

            self._repository.save_layer_manifest(project_root, catalog)
        except (AssetImportError, OSError, ProjectValidationError, ProjectVersionError) as error:
            rollback_failed = False
            for target in reversed(created):
                try:
                    target.unlink(missing_ok=True)
                except OSError:
                    rollback_failed = True
            if rollback_failed:
                raise AssetImportError(
                    "Layer publication failed and one new destination could not be rolled back."
                ) from error
            if isinstance(error, AssetImportError):
                raise
            raise AssetImportError(
                "Layer publication failed without changing the catalog."
            ) from error
        finally:
            shutil.rmtree(staging_root, ignore_errors=True)

    def _resolve_source_candidate(
        self,
        source_root: Path,
        candidate: Path,
    ) -> tuple[Path | None, Diagnostic | None]:
        try:
            resolved = candidate.resolve(strict=True)
        except (FileNotFoundError, OSError, RuntimeError):
            return (
                None,
                Diagnostic(
                    code=ValidationCode.ASSET_MISSING,
                    severity=Severity.ERROR,
                    message=f"Source layer '{candidate.name}' is unavailable.",
                    path=candidate.name,
                    suggestion="Restore or replace the missing source PNG.",
                ),
            )
        if not resolved.is_relative_to(source_root) or not resolved.is_file():
            return (
                None,
                Diagnostic(
                    code=ValidationCode.PATH_OUTSIDE_PROJECT,
                    severity=Severity.ERROR,
                    message=f"Source layer '{candidate.name}' is not a safe in-root file.",
                    path=candidate.name,
                    suggestion="Remove links or paths that leave the selected source root.",
                ),
            )
        return resolved, None

    def _read_bounded(self, candidate: Path) -> bytes:
        try:
            size = candidate.stat().st_size
        except OSError as error:
            raise _InspectionError(
                IMPORT_SOURCE_LIMIT_CODE,
                f"Layer '{candidate.name}' cannot be inspected.",
                "Check file permissions and retry.",
            ) from error
        if size > self._limits.max_file_bytes:
            raise _InspectionError(
                IMPORT_SOURCE_LIMIT_CODE,
                f"Layer '{candidate.name}' exceeds the configured file-size limit.",
                "Reduce the encoded PNG size before importing.",
            )
        try:
            encoded = candidate.read_bytes()
        except OSError as error:
            raise _InspectionError(
                ValidationCode.PNG_UNREADABLE,
                f"Layer '{candidate.name}' cannot be read.",
                "Check file permissions or replace the PNG.",
            ) from error
        if len(encoded) > self._limits.max_file_bytes:
            raise _InspectionError(
                IMPORT_SOURCE_LIMIT_CODE,
                f"Layer '{candidate.name}' exceeds the configured file-size limit.",
                "Reduce the encoded PNG size before importing.",
            )
        return encoded

    @staticmethod
    def _encode_rgba_png(image: Image.Image) -> bytes:
        normalized = Image.frombytes("RGBA", image.size, image.tobytes())
        stream = BytesIO()
        normalized.save(stream, format="PNG", optimize=False, compress_level=9)
        return stream.getvalue()

    @staticmethod
    def _write_staged_file(path: Path, payload: bytes) -> None:
        try:
            with path.open("xb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        except OSError as error:
            raise AssetImportError("Unable to stage one normalized PNG safely.") from error

    @staticmethod
    def _existing_directory(path: Path, label: str) -> Path:
        try:
            resolved = path.resolve(strict=True)
        except (FileNotFoundError, OSError, RuntimeError) as error:
            raise AssetImportError(f"The {label} is unavailable.") from error
        if not resolved.is_dir():
            raise AssetImportError(f"The {label} is not a directory.")
        return resolved

    @staticmethod
    def _require_project_destination(project_root: Path, candidate: Path) -> None:
        try:
            resolved = candidate.resolve(strict=False)
        except (OSError, RuntimeError) as error:
            raise AssetImportError("A project destination cannot be resolved safely.") from error
        if not resolved.is_relative_to(project_root):
            raise AssetImportError("A project destination resolves outside the approved root.")

    def _propose_semantic_part(self, stem: str) -> str | None:
        normalized = unicodedata.normalize("NFKC", stem).strip().lower()
        normalized = re.sub(r"[\s-]+", "_", normalized)
        normalized = re.sub(r"_+", "_", normalized).strip("_")
        proposed = self._aliases.get(normalized, normalized)
        try:
            return _SEMANTIC_ID_ADAPTER.validate_python(proposed)
        except ValidationError:
            return None

    @staticmethod
    def _validate_aliases(aliases: Mapping[str, str]) -> dict[str, str]:
        validated: dict[str, str] = {}
        for alias, target in aliases.items():
            if alias != alias.lower() or not alias:
                raise ValueError("import aliases must use non-empty lowercase keys")
            try:
                canonical = _SEMANTIC_ID_ADAPTER.validate_python(target)
            except ValidationError as error:
                raise ValueError("import alias targets must be semantic IDs") from error
            previous = validated.get(alias)
            if previous is not None and previous != canonical:
                raise ValueError("import aliases must not be ambiguous")
            validated[alias] = canonical
        return validated


__all__ = [
    "DEFAULT_LAYER_ALIASES",
    "FolderLayerImporter",
    "IMPORT_DESTINATION_CODE",
    "IMPORT_MAPPING_CODE",
    "IMPORT_PUBLICATION_CODE",
    "IMPORT_SOURCE_LIMIT_CODE",
    "IMPORT_UNSUPPORTED_ENTRY_CODE",
    "LAYER_MANIFEST_FORMAT",
    "LAYER_MANIFEST_SCHEMA_VERSION",
    "PNG_SIGNATURE",
]
