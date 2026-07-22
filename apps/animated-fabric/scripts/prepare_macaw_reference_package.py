"""Prepare or verify the approved, self-contained AF-054 macaw reference package."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import sys
import tempfile
from collections.abc import Mapping, Sequence
from io import BytesIO
from pathlib import Path, PurePosixPath

from PIL import Image

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from tools.reference_package import (  # noqa: E402
    APPROVAL_FORMAT,
    APPROVAL_PATH,
    C2PA_RECORDS,
    COMMON_VIEW_SIZE,
    EXPECTED_AXES,
    EXPECTED_PROP_SCOPE,
    EXPECTED_PROVENANCE_LIMITATIONS,
    GROUND_ROW_PX,
    LICENSE_PATH,
    MAX_FILE_BYTES,
    MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS,
    NORMALIZATION,
    OWNER_APPROVAL_EVIDENCE_ID,
    PACKAGE_ID,
    README_PATH,
    REFERENCE_FORMAT,
    REFERENCE_PATH,
    REVIEW_FORMAT,
    REVIEW_RECORD_PATH,
    RIGHTS_STATEMENT,
    SCHEMA_VERSION,
    SOURCE_APPROVAL_FORMAT,
    SOURCE_APPROVAL_PATH,
    SOURCE_IMPORT_COMMIT,
    SOURCE_LAYOUT,
    TICKET,
    TURNAROUND_C2PA,
    TURNAROUND_PATH,
    VIEW_BEAK_DIRECTIONS,
    VIEW_CAMERA_AXES,
    VIEW_CLASSIFICATION,
    VIEW_ORDER,
    VIEW_PATHS,
    VIEW_SET_FORMAT,
    VerifiedReferencePackage,
    canonical_json_bytes,
    foreground_height_variance_percent,
    normalize_review_crop,
    ordered_view_set_sha256,
    read_regular_file_bytes,
    scoped_cc0_notice,
    sha256_file,
    validate_utc_timestamp,
    verify_reference_package,
)

PARTS_PROMPT_SOURCE = (
    "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/generation-prompt.md"
)
SPLIT_EVIDENCE_SOURCE = (
    "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/split_manifest.candidate-v1.json"
)
SPLIT_NEUTRAL_SOURCE = (
    "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/"
    "split-candidate-v1/macaw-traveler-part_012.png"
)


def prepare_macaw_reference_package(
    review_path: Path,
    source_approval_path: Path,
    source_repository_root: Path,
    destination: Path,
) -> VerifiedReferencePackage:
    """Build, verify, and atomically publish the exact approved AF-054 package."""
    review_file = _regular_file_without_links(review_path)
    review = _load_json_object(review_file)
    source_approval_file = _regular_file_without_links(source_approval_path)
    source_approval = _load_canonical_json_object(source_approval_file)
    repo_root = _regular_directory_without_links(source_repository_root)
    review_contract = _validate_review(review, review_file.parent)

    source_inputs = _source_inputs(review, repo_root)
    turnaround_input = _regular_file_without_links(
        review_file.parent / review_contract["turnaround_file"]
    )
    if sha256_file(turnaround_input) != review_contract["turnaround_sha256"]:
        raise ValueError("Approved turnaround hash does not match its review record.")
    _verify_neutral_derivation(source_inputs, repo_root)
    _validate_source_approval(
        source_approval,
        review_file,
        source_inputs,
        turnaround_input,
        review,
    )
    input_hashes = {
        path: sha256_file(path)
        for path in (
            *source_inputs.values(),
            turnaround_input,
            review_file,
            source_approval_file,
        )
    }

    destination_parent = destination.parent
    _reject_link_like_ancestors(destination_parent)
    destination_parent.mkdir(parents=True, exist_ok=True)
    _reject_link_like_ancestors(destination)
    stage = Path(tempfile.mkdtemp(prefix=f".{destination.name}.stage-", dir=destination_parent))
    try:
        manifest = _write_package_stage(
            stage,
            review,
            review_file,
            source_approval,
            source_approval_file,
            source_inputs,
            turnaround_input,
        )
        _write_approval(stage, manifest, source_approval, source_approval_file)
        verify_reference_package(stage)
        for path, expected_hash in input_hashes.items():
            if sha256_file(path) != expected_hash:
                raise ValueError(f"Immutable AF-054 input changed during preparation: {path}")
        if destination.exists():
            _publish_idempotently(stage, destination)
            return verify_reference_package(destination)
        _fsync_directory(stage)
        os.replace(stage, destination)
        _fsync_directory(destination_parent)
        return verify_reference_package(destination)
    except Exception:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)
        raise


def _write_package_stage(
    stage: Path,
    review: Mapping[str, object],
    review_file: Path,
    source_approval: Mapping[str, object],
    source_approval_file: Path,
    source_inputs: Mapping[str, Path],
    turnaround_input: Path,
) -> dict[str, object]:
    review_target = stage.joinpath(*PurePosixPath(REVIEW_RECORD_PATH).parts)
    source_approval_target = stage.joinpath(*PurePosixPath(SOURCE_APPROVAL_PATH).parts)
    _copy_exact(review_file, review_target)
    _copy_exact(source_approval_file, source_approval_target)
    decided_at_utc = _string(source_approval, "decided_at_utc")
    approval_evidence_id = _string(source_approval, "approval_evidence_id")
    source_records: list[dict[str, object]] = []
    for source_id, package_path, role in SOURCE_LAYOUT:
        source = source_inputs[source_id]
        target = stage.joinpath(*PurePosixPath(package_path).parts)
        _copy_exact(source, target)
        record: dict[str, object] = {
            "id": source_id,
            "media_type": _media_type(package_path),
            "path": package_path,
            "provenance": _source_provenance(source_id, source, approval_evidence_id),
            "repository_source_path": _source_repository_path(source_id, review),
            "role": role,
            "sha256": sha256_file(target),
        }
        if package_path.endswith(".png"):
            record.update(_image_identity(target))
        source_records.append(record)

    turnaround_target = stage.joinpath(*PurePosixPath(TURNAROUND_PATH).parts)
    _copy_exact(turnaround_input, turnaround_target)
    turnaround_identity = _image_identity(turnaround_target)
    turnaround_sha256 = sha256_file(turnaround_target)
    turnaround_record: dict[str, object] = {
        "c2pa": TURNAROUND_C2PA,
        "classification": "approved_generated_inferred_combined_review_sheet",
        "media_type": "image/png",
        "original_review_filename": turnaround_input.name,
        "path": TURNAROUND_PATH,
        "provenance": {
            "author_provider": "Caatuu-directed OpenAI image generation",
            "created_date": "2026-07-21",
            "generation_attempt": 2,
            "input_evidence_sha256": [
                _string(item, "sha256") for item in _object_list(review, "source_evidence")
            ],
            "modifications": "Copied byte for byte without modification; embedded claim retained.",
            "review_record_sha256": sha256_file(review_file),
        },
        "sha256": turnaround_sha256,
        **turnaround_identity,
    }

    views = _write_views(stage, turnaround_target, review, turnaround_sha256)
    view_set_digest = ordered_view_set_sha256(views)
    visual_hashes = {
        "sources/identity/neutral-reference.png": _record_hash(
            source_records, "identity-neutral-reference"
        ),
        "sources/prepared-parts/macaw-traveler-parts-sheet-v1.png": _record_hash(
            source_records, "prepared-parts-sheet"
        ),
        "sources/side-walk/macaw-walk-sheet-v1.png": _record_hash(
            source_records, "side-walk-sheet"
        ),
        TURNAROUND_PATH: turnaround_sha256,
        **{_string(view, "path"): _string(view, "sha256") for view in views},
    }
    license_target = stage / LICENSE_PATH
    _write_bytes(license_target, scoped_cc0_notice(visual_hashes).encode("utf-8"))
    readme_target = stage / README_PATH
    _write_bytes(
        readme_target,
        _readme_text(decided_at_utc, approval_evidence_id).encode("utf-8"),
    )

    normalization = _object(_object(review, "turnaround"), "normalization_review")
    manifest: dict[str, object] = {
        "actor_axes": EXPECTED_AXES,
        "approval_record": {
            "path": APPROVAL_PATH,
            "required_before_ticket": "AF-056",
        },
        "combined_review_sheet": turnaround_record,
        "common_view": {
            "approved_maximum_visual_height_variance_percent": _number(
                normalization, "maximum_scale_drift_percent"
            ),
            "ground_row_px": GROUND_ROW_PX,
            "height_px": COMMON_VIEW_SIZE[1],
            "mode": "RGB",
            "normalization": NORMALIZATION,
            "observed_foreground_height_range_px": _int_list(
                normalization, "foreground_height_range_px", expected_length=2
            ),
            "scale_basis": "one_to_one_pixels_from_one_combined_sheet",
            "width_px": COMMON_VIEW_SIZE[0],
        },
        "documentation": {
            "path": README_PATH,
            "sha256": sha256_file(readme_target),
        },
        "format": REFERENCE_FORMAT,
        "gait": "anthropomorphic_traveler",
        "license": {
            "attribution_required": False,
            "expression": "CC0-1.0",
            "notice_path": LICENSE_PATH,
            "notice_sha256": sha256_file(license_target),
            "scope": "only_the_eight_exact_png_identities_listed_in_the_notice",
        },
        "ordered_view_set": {
            "format": VIEW_SET_FORMAT,
            "order": list(VIEW_ORDER),
            "sha256": view_set_digest,
        },
        "package_id": PACKAGE_ID,
        "prop_scope": EXPECTED_PROP_SCOPE,
        "provenance_limitations": EXPECTED_PROVENANCE_LIMITATIONS,
        "rights_evidence": {
            "approval_evidence_id": approval_evidence_id,
            "grant": "owner-approved scoped CC0 for rights Caatuu owns or may exercise",
            "release_surfaces": [
                "public GitHub source",
                "developer documentation",
                "offline modeling reference input",
            ],
            "source_approval_sha256": sha256_file(source_approval_target),
        },
        "review_evidence": {
            "review_path": REVIEW_RECORD_PATH,
            "review_sha256": sha256_file(review_target),
            "source_approval_path": SOURCE_APPROVAL_PATH,
            "source_approval_sha256": sha256_file(source_approval_target),
        },
        "schema_version": SCHEMA_VERSION,
        "sources": source_records,
        "status": "approved",
        "ticket": TICKET,
        "unresolved_inferences": _string_list(review, "unresolved_inferences"),
        "views": views,
    }
    _write_bytes(stage / REFERENCE_PATH, canonical_json_bytes(manifest))
    return manifest


def _write_views(
    stage: Path,
    turnaround_path: Path,
    review: Mapping[str, object],
    turnaround_sha256: str,
) -> list[dict[str, object]]:
    turnaround = _object(review, "turnaround")
    review_views = _object_list(turnaround, "views")
    views: list[dict[str, object]] = []
    with Image.open(BytesIO(read_regular_file_bytes(turnaround_path))) as decoded:
        decoded.load()
        if decoded.format != "PNG" or decoded.mode != "RGB":
            raise ValueError("Approved turnaround must remain an RGB PNG.")
        sheet = decoded.copy()
    for review_view, view_id, view_path, camera_axis, beak_direction in zip(
        review_views,
        VIEW_ORDER,
        VIEW_PATHS,
        VIEW_CAMERA_AXES,
        VIEW_BEAK_DIRECTIONS,
        strict=True,
    ):
        crop = _int_list(review_view, "candidate_crop_xywh", expected_length=4)
        foreground = _int_list(review_view, "foreground_bounds_xywh", expected_length=4)
        normalized = normalize_review_crop(sheet, crop)
        encoded = BytesIO()
        normalized.save(encoded, format="PNG", compress_level=9, optimize=False)
        target = stage.joinpath(*PurePosixPath(view_path).parts)
        _write_bytes(target, encoded.getvalue())
        views.append(
            {
                "beak_direction": beak_direction,
                "camera_axis": camera_axis,
                "classification": VIEW_CLASSIFICATION,
                "crop_xywh": crop,
                "foreground_bounds_sheet_xywh": foreground,
                "id": view_id,
                "normalization": NORMALIZATION,
                "path": view_path,
                "placement_xy": [(COMMON_VIEW_SIZE[0] - crop[2]) // 2, 0],
                "sha256": sha256_file(target),
                "source_sheet_path": TURNAROUND_PATH,
                "source_sheet_sha256": turnaround_sha256,
            }
        )
    return views


def _write_approval(
    stage: Path,
    manifest: Mapping[str, object],
    source_approval: Mapping[str, object],
    source_approval_file: Path,
) -> None:
    views = _object_list(manifest, "views")
    view_set_digest = ordered_view_set_sha256(views)
    approval = {
        "accepted_limitations": _string_list(source_approval, "accepted_limitations"),
        "accepted_scope": _object(source_approval, "accepted_scope"),
        "approval_evidence_id": _string(source_approval, "approval_evidence_id"),
        "decided_at_utc": _string(source_approval, "decided_at_utc"),
        "decision": _string(source_approval, "decision"),
        "format": APPROVAL_FORMAT,
        "manifest": {
            "path": REFERENCE_PATH,
            "sha256": sha256_file(stage / REFERENCE_PATH),
        },
        "ordered_view_set": {
            "format": VIEW_SET_FORMAT,
            "order": list(VIEW_ORDER),
            "sha256": view_set_digest,
        },
        "package_id": PACKAGE_ID,
        "reviewer_role": _string(source_approval, "reviewer_role"),
        "rights_statement": _string(source_approval, "rights_statement"),
        "schema_version": SCHEMA_VERSION,
        "source_approval": {
            "path": SOURCE_APPROVAL_PATH,
            "sha256": sha256_file(source_approval_file),
        },
        "ticket": TICKET,
    }
    _write_bytes(stage / APPROVAL_PATH, canonical_json_bytes(approval))


def _validate_review(
    review: Mapping[str, object],
    review_root: Path,
) -> dict[str, str]:
    if (
        _string(review, "format") != REVIEW_FORMAT
        or _string(review, "schema_version") != SCHEMA_VERSION
        or _string(review, "ticket") != TICKET
        or _string(review, "status") != "candidate"
        or _string(review, "gait") != "anthropomorphic_traveler"
        or review.get("approval") is not None
    ):
        raise ValueError("AF-054 review record is not the expected unmodified candidate contract.")
    prop_scope = _object(review, "prop_scope")
    if _string(
        prop_scope, "staff"
    ) != "separate_prop_excluded_from_base_actor_and_first_walk" or not _boolean(
        prop_scope, "requires_approval"
    ):
        raise ValueError("AF-054 review prop scope is invalid.")

    turnaround = _object(review, "turnaround")
    filename = _string(turnaround, "file")
    if PurePosixPath(filename).name != filename:
        raise ValueError("AF-054 turnaround filename must not contain a path.")
    width = _integer(turnaround, "width_px")
    height = _integer(turnaround, "height_px")
    with Image.open(
        BytesIO(read_regular_file_bytes(_regular_file_without_links(review_root / filename)))
    ) as decoded:
        _validate_image_dimensions(decoded, filename)
        if decoded.format != "PNG" or decoded.mode != "RGB" or decoded.size != (width, height):
            raise ValueError("AF-054 turnaround media identity does not match review.json.")
        decoded.load()

    convention = _object(turnaround, "view_convention")
    if convention != {
        "actor_forward_axis": "+Y",
        "actor_right_axis": "+X",
        "up_axis": "+Z",
        "front_camera_axis": "+Y",
        "left_camera_axis": "-X",
        "back_camera_axis": "-Y",
        "right_camera_axis": "+X",
        "left_beak_points": "screen_left",
        "right_beak_points": "screen_right",
    }:
        raise ValueError("AF-054 turnaround axes or view convention is invalid.")
    generation = _object(turnaround, "generation")
    if (
        _string(generation, "authoring_tool") != "OpenAI built-in image generation"
        or _integer(generation, "attempt") != 2
        or not _boolean(generation, "inferred_content")
    ):
        raise ValueError("AF-054 turnaround generation record is invalid.")
    views = _object_list(turnaround, "views")
    if tuple(_string(view, "id") for view in views) != VIEW_ORDER:
        raise ValueError("AF-054 review views must be ordered front, left, back, right.")
    heights: list[int] = []
    for view in views:
        crop = _int_list(view, "candidate_crop_xywh", expected_length=4)
        foreground = _int_list(view, "foreground_bounds_xywh", expected_length=4)
        x, y, crop_width, crop_height = crop
        foreground_x, foreground_y, foreground_width, foreground_height = foreground
        if (
            min(crop) < 0
            or min(foreground) < 0
            or crop_width > COMMON_VIEW_SIZE[0]
            or crop_height != COMMON_VIEW_SIZE[1]
            or x + crop_width > width
            or y + crop_height > height
            or not (
                x <= foreground_x
                and y <= foreground_y
                and foreground_x + foreground_width <= x + crop_width
                and foreground_y + foreground_height <= y + crop_height
            )
            or foreground_y + foreground_height - y - 1 != GROUND_ROW_PX
        ):
            raise ValueError("AF-054 review crop geometry is invalid.")
        heights.append(foreground_height)
    normalization = _object(turnaround, "normalization_review")
    expected_variance = foreground_height_variance_percent(min(heights), max(heights))
    if (
        _integer(normalization, "candidate_ground_row_px") != GROUND_ROW_PX
        or _int_list(normalization, "foreground_height_range_px", expected_length=2)
        != [min(heights), max(heights)]
        or _number(normalization, "maximum_scale_drift_percent") != expected_variance
        or not _boolean(normalization, "crop_and_padding_preserve_source_pixels")
        or not _boolean(normalization, "scale_normalization_requires_resampling_or_corrected_art")
    ):
        raise ValueError("AF-054 review normalization disclosure is invalid.")
    return {
        "turnaround_file": filename,
        "turnaround_sha256": _sha256_value(turnaround, "sha256"),
    }


def _source_inputs(
    review: Mapping[str, object],
    repository_root: Path,
) -> dict[str, Path]:
    evidence = _object_list(review, "source_evidence")
    by_role = {_string(item, "role"): item for item in evidence}
    required_roles = {
        "identity_and_assembled_proportions",
        "component_and_joint_intent",
        "anthropomorphic_gait_reference",
        "existing_articulation_intent",
    }
    if (
        len(evidence) != len(required_roles)
        or len(by_role) != len(required_roles)
        or set(by_role) != required_roles
    ):
        raise ValueError("AF-054 review source evidence is incomplete or duplicated.")

    role_to_id = {
        "identity_and_assembled_proportions": "identity-neutral-reference",
        "component_and_joint_intent": "prepared-parts-sheet",
        "anthropomorphic_gait_reference": "side-walk-sheet",
        "existing_articulation_intent": "legacy-rig",
    }
    result: dict[str, Path] = {}
    for role, source_id in role_to_id.items():
        item = by_role[role]
        path = _repository_file(repository_root, _string(item, "path"))
        if sha256_file(path) != _sha256_value(item, "sha256"):
            raise ValueError(f"AF-054 immutable source hash mismatch: {role}")
        result[source_id] = path
    result["prepared-parts-prompt"] = _repository_file(repository_root, PARTS_PROMPT_SOURCE)
    result["prepared-parts-split-evidence"] = _repository_file(
        repository_root, SPLIT_EVIDENCE_SOURCE
    )
    return result


def _verify_neutral_derivation(inputs: Mapping[str, Path], repository_root: Path) -> None:
    split_neutral = _repository_file(repository_root, SPLIT_NEUTRAL_SOURCE)
    if read_regular_file_bytes(split_neutral) != read_regular_file_bytes(
        inputs["identity-neutral-reference"]
    ):
        raise ValueError(
            "Neutral identity reference is not byte-identical to prepared-parts slot 12."
        )
    split_manifest = _load_json_object(inputs["prepared-parts-split-evidence"])
    sprites = _object_list(split_manifest, "sprites")
    slot_twelve = [item for item in sprites if item.get("source_slot") == 12]
    if len(slot_twelve) != 1 or _int_list(slot_twelve[0], "output_size", expected_length=2) != [
        377,
        414,
    ]:
        raise ValueError("Prepared-parts split evidence does not identify the neutral slot.")
    warnings = split_manifest.get("warnings")
    if warnings != []:
        raise ValueError("Prepared-parts split evidence contains warnings.")


def _validate_source_approval(
    approval: Mapping[str, object],
    review_file: Path,
    source_inputs: Mapping[str, Path],
    turnaround_input: Path,
    review: Mapping[str, object],
) -> None:
    _expect_keys(
        approval,
        {
            "accepted_limitations",
            "accepted_scope",
            "approval_evidence_id",
            "approved_inputs",
            "decided_at_utc",
            "decision",
            "format",
            "package_id",
            "provenance_confirmation",
            "review",
            "reviewer_role",
            "rights_confirmation",
            "rights_statement",
            "schema_version",
            "ticket",
        },
        "source approval",
    )
    if (
        _string(approval, "format") != SOURCE_APPROVAL_FORMAT
        or _string(approval, "schema_version") != SCHEMA_VERSION
        or _string(approval, "package_id") != PACKAGE_ID
        or _string(approval, "ticket") != TICKET
        or _string(approval, "decision") != "approved"
        or _string(approval, "reviewer_role") != "product_owner"
        or _string(approval, "approval_evidence_id") != OWNER_APPROVAL_EVIDENCE_ID
        or _string(approval, "rights_statement") != RIGHTS_STATEMENT
    ):
        raise ValueError("AF-054 source approval identity or authority is invalid.")
    validate_utc_timestamp(_string(approval, "decided_at_utc"))
    review_identity = _object(approval, "review")
    if _string(review_identity, "path") != review_file.name or _sha256_value(
        review_identity, "sha256"
    ) != sha256_file(review_file):
        raise ValueError("AF-054 source approval is not bound to the exact review record.")
    if _object(approval, "rights_confirmation") != {
        "created_from_scratch_for_caatuu": True,
        "scope": "only_the_eight_exact_png_identities_listed_in_the_package_notice",
        "scoped_cc0_authorized": True,
    }:
        raise ValueError("AF-054 source approval rights confirmation is invalid.")
    if _object(approval, "provenance_confirmation") != {
        "turnaround_authoring_tool": "OpenAI built-in image generation",
        "turnaround_generation_attempt": 2,
        "turnaround_inferred_content": True,
    }:
        raise ValueError("AF-054 source approval provenance confirmation is invalid.")

    normalization = _object(_object(review, "turnaround"), "normalization_review")
    height_range = _int_list(normalization, "foreground_height_range_px", expected_length=2)
    variance = foreground_height_variance_percent(*height_range)
    expected_scope = {
        "foreground_height_range_px": height_range,
        "gait": "anthropomorphic_traveler",
        "generated_views_remain_inferred_modeling_references": True,
        "maximum_visual_height_variance_percent": variance,
        "prop_scope": EXPECTED_PROP_SCOPE,
    }
    if _object(approval, "accepted_scope") != expected_scope:
        raise ValueError("AF-054 source approval scope is invalid.")
    if _string_list(approval, "accepted_limitations") != _accepted_limitations(
        height_range, variance
    ):
        raise ValueError("AF-054 source approval limitations are invalid.")

    expected_inputs = [
        {
            "id": source_id,
            "sha256": sha256_file(source_inputs[source_id]),
            "source_path": _source_repository_path(source_id, review),
        }
        for source_id, _package_path, _role in SOURCE_LAYOUT
    ]
    expected_inputs.append(
        {
            "id": "turnaround",
            "sha256": sha256_file(turnaround_input),
            "source_path": turnaround_input.name,
        }
    )
    approved_inputs = _object_list(approval, "approved_inputs")
    for record in approved_inputs:
        _expect_keys(record, {"id", "sha256", "source_path"}, "approved input")
        _sha256_value(record, "sha256")
    if approved_inputs != expected_inputs:
        raise ValueError("AF-054 source approval does not match the exact approved inputs.")


def _accepted_limitations(height_range: Sequence[int], variance: float) -> list[str]:
    minimum, maximum = height_range
    return [
        "The four generated views remain inferred modeling references, not recovered geometry.",
        (
            f"The disclosed {minimum}-{maximum} px silhouette-height variance "
            f"(maximum {variance:.2f}%) is accepted at one common 1:1 sheet scale."
        ),
        (
            "Tail, talon, hand, toe, backpack, hidden joint, and rear-surface details require "
            "modeling judgment."
        ),
    ]


def _source_provenance(
    source_id: str,
    source: Path,
    approval_evidence_id: str,
) -> dict[str, object]:
    common: dict[str, object] = {
        "approval_evidence_id": approval_evidence_id,
        "copied_without_modification": True,
        "imported_date": "2026-07-17",
        "repository_import_commit": SOURCE_IMPORT_COMMIT,
        "source_sha256": sha256_file(source),
    }
    if source_id == "identity-neutral-reference":
        common.update(
            {
                "author_provider": "Caatuu project contributors using the prepared-parts workflow",
                "derivation": (
                    "Byte-identical to prepared-parts split slot 12 after documented alpha "
                    "extraction."
                ),
                "embedded_c2pa": "none; lineage points to the credentialed prepared-parts sheet",
            }
        )
    elif source_id in C2PA_RECORDS:
        common.update(
            {
                "author_provider": "Caatuu-directed OpenAI image generation",
                "c2pa": C2PA_RECORDS[source_id],
                "modifications": "None in this package; embedded claim bytes retained.",
            }
        )
    elif source_id == "legacy-rig":
        common.update(
            {
                "author_provider": "Caatuu project contributors",
                "limitations": (
                    "Evidence only; its legacy relative layer references are not resolved by this "
                    "package."
                ),
            }
        )
    else:
        common.update(
            {
                "author_provider": "Caatuu project contributors",
                "purpose": "Self-contained historical provenance evidence.",
            }
        )
    return common


def _source_repository_path(source_id: str, review: Mapping[str, object]) -> str:
    if source_id == "prepared-parts-prompt":
        return PARTS_PROMPT_SOURCE
    if source_id == "prepared-parts-split-evidence":
        return SPLIT_EVIDENCE_SOURCE
    roles = {
        "identity-neutral-reference": "identity_and_assembled_proportions",
        "prepared-parts-sheet": "component_and_joint_intent",
        "legacy-rig": "existing_articulation_intent",
        "side-walk-sheet": "anthropomorphic_gait_reference",
    }
    role = roles[source_id]
    for item in _object_list(review, "source_evidence"):
        if _string(item, "role") == role:
            return _string(item, "path")
    raise ValueError(f"Unable to find review source role: {role}")


def _image_identity(path: Path) -> dict[str, object]:
    with Image.open(BytesIO(read_regular_file_bytes(path))) as decoded:
        if decoded.format != "PNG":
            raise ValueError(f"AF-054 visual source is not PNG: {path}")
        _validate_image_dimensions(decoded, str(path))
        decoded.load()
        return {
            "height_px": decoded.height,
            "mode": decoded.mode,
            "width_px": decoded.width,
        }


def _readme_text(decided_at_utc: str, approval_evidence_id: str) -> str:
    return f"""# Macaw traveler reference package v1

This is the approved AF-054 modeling reference package for the traveler macaw. Its four
authoritative views are ordered `front`, `left`, `back`, `right` on a common 512 x 704 RGB canvas,
one 1:1 source-sheet pixel scale, and zero-based ground row 664.

The views are generated and inferred references accepted for human-reviewed modeling. They are not
recovered geometry, a mesh, a rig, an animation, or hidden-surface truth. The legacy rig is retained
only as articulation evidence. The staff is separate and excluded from the first actor and walk;
a compatible hand socket is required later, but AF-054 does not invent its identifier.

Approval was recorded at `{decided_at_utc}` by the `product_owner` under evidence ID
`{approval_evidence_id}`. `review/source-approval.json` preserves that separately supplied decision;
`approval.json` carries its normative fields and binds the exact canonical `reference.json` hash and
ordered view-set digest. `LICENSE-CC0.md` applies only to the eight exact PNG hashes it names.

The generated sheets retain their embedded C2PA claim bytes. Those claims were detected and
recorded but not cryptographically validated. Derived views deliberately omit copied metadata.

Reproduce into an ignored workspace and verify inside the offline Linux development container:

```bash
docker compose run --rm -v ../..:/caatuu:ro animated-fabric-dev \\
  python scripts/prepare_macaw_reference_package.py prepare \\
  --review /workspace/assets/reference-packages/macaw-traveler-v1/review/review.json \\
  --approval /workspace/assets/reference-packages/macaw-traveler-v1/review/source-approval.json \\
  --source-repository-root /caatuu \\
  --out /workspace/.tmp/af054-rebuild/macaw-traveler-v1
docker compose run --rm animated-fabric-dev \\
  python scripts/prepare_macaw_reference_package.py verify \\
  --package /workspace/assets/reference-packages/macaw-traveler-v1
```
"""


def _publish_idempotently(stage: Path, destination: Path) -> None:
    verified_destination = verify_reference_package(destination)
    del verified_destination
    stage_files = _relative_file_bytes(stage)
    destination_files = _relative_file_bytes(destination)
    if stage_files != destination_files:
        raise ValueError("Refusing to replace the immutable macaw-traveler-v1 reference package.")
    shutil.rmtree(stage)


def _relative_file_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): read_regular_file_bytes(path)
        for path in root.rglob("*")
        if path.is_file()
    }


def _copy_exact(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = read_regular_file_bytes(source)
    with destination.open("xb") as output_stream:
        output_stream.write(payload)
        output_stream.flush()
        os.fsync(output_stream.fileno())


def _write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _regular_directory_without_links(path: Path) -> Path:
    _reject_link_like_ancestors(path)
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise ValueError(f"Directory does not exist: {path}") from error
    if not resolved.is_dir():
        raise ValueError(f"Expected directory: {path}")
    return resolved


def _regular_file_without_links(path: Path) -> Path:
    _reject_link_like_ancestors(path)
    try:
        resolved = path.resolve(strict=True)
        status = resolved.stat(follow_symlinks=False)
    except OSError as error:
        raise ValueError(f"File does not exist: {path}") from error
    if not stat.S_ISREG(status.st_mode):
        raise ValueError(f"Expected regular file: {path}")
    if status.st_nlink != 1:
        raise ValueError(f"File must not be hard-linked: {path}")
    if status.st_size > MAX_FILE_BYTES:
        raise ValueError(f"File exceeds the byte limit: {path}")
    return resolved


def _repository_file(root: Path, value: str) -> Path:
    if "\\" in value:
        raise ValueError(f"Repository source path must use '/' separators: {value}")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError(f"Repository source path is unsafe: {value}")
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        if _is_link_like(cursor):
            raise ValueError(f"Repository source path contains a link or junction: {value}")
    resolved = _regular_file_without_links(cursor)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError(f"Repository source path escaped its root: {value}") from error
    return resolved


def _load_json_object(path: Path) -> dict[str, object]:
    return _decode_json_object(path, read_regular_file_bytes(path))


def _decode_json_object(path: Path, payload: bytes) -> dict[str, object]:
    try:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to decode JSON object: {path}") from error
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def _load_canonical_json_object(path: Path) -> dict[str, object]:
    payload = read_regular_file_bytes(path)
    value = _decode_json_object(path, payload)
    if payload != canonical_json_bytes(value):
        raise ValueError(f"JSON document is not canonically encoded: {path}")
    return value


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _expect_keys(mapping: Mapping[str, object], expected: set[str], location: str) -> None:
    actual = set(mapping)
    if actual != expected:
        raise ValueError(
            f"Unexpected keys at {location}; missing={sorted(expected - actual)}, "
            f"extra={sorted(actual - expected)}."
        )


def _is_link_like(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def _reject_link_like_ancestors(path: Path) -> None:
    cursor = path.absolute()
    while True:
        if _is_link_like(cursor):
            raise ValueError(f"Path contains a link or junction: {cursor}")
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def _validate_image_dimensions(image: Image.Image, label: str) -> None:
    if (
        image.width > MAX_IMAGE_DIMENSION
        or image.height > MAX_IMAGE_DIMENSION
        or image.width * image.height > MAX_IMAGE_PIXELS
    ):
        raise ValueError(f"AF-054 image exceeds the dimension limit: {label}")


def _media_type(path: str) -> str:
    if path.endswith(".png"):
        return "image/png"
    if path.endswith(".json"):
        return "application/json"
    if path.endswith(".md"):
        return "text/markdown"
    raise ValueError(f"Unsupported AF-054 evidence type: {path}")


def _record_hash(records: Sequence[Mapping[str, object]], source_id: str) -> str:
    for record in records:
        if _string(record, "id") == source_id:
            return _sha256_value(record, "sha256")
    raise ValueError(f"Missing source record: {source_id}")


def _object(mapping: Mapping[str, object], key: str) -> dict[str, object]:
    value = mapping.get(key)
    if not isinstance(value, dict) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Expected object at {key}.")
    return value


def _object_list(mapping: Mapping[str, object], key: str) -> list[dict[str, object]]:
    value = mapping.get(key)
    if not isinstance(value, list):
        raise ValueError(f"Expected array at {key}.")
    result: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict) or not all(isinstance(name, str) for name in item):
            raise ValueError(f"Expected object entries at {key}.")
        result.append(item)
    return result


def _string(mapping: Mapping[str, object], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str):
        raise ValueError(f"Expected string at {key}.")
    return value


def _string_list(mapping: Mapping[str, object], key: str) -> list[str]:
    value = mapping.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Expected string array at {key}.")
    return [item for item in value if isinstance(item, str)]


def _integer(mapping: Mapping[str, object], key: str) -> int:
    value = mapping.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"Expected integer at {key}.")
    return value


def _boolean(mapping: Mapping[str, object], key: str) -> bool:
    value = mapping.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"Expected boolean at {key}.")
    return value


def _number(mapping: Mapping[str, object], key: str) -> int | float:
    value = mapping.get(key)
    if not isinstance(value, int | float) or isinstance(value, bool):
        raise ValueError(f"Expected number at {key}.")
    return value


def _sha256_value(mapping: Mapping[str, object], key: str) -> str:
    value = _string(mapping, key)
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ValueError(f"Expected lowercase SHA-256 at {key}.")
    return value


def _int_list(
    mapping: Mapping[str, object],
    key: str,
    *,
    expected_length: int,
) -> list[int]:
    value = mapping.get(key)
    if (
        not isinstance(value, list)
        or len(value) != expected_length
        or not all(isinstance(item, int) and not isinstance(item, bool) for item in value)
    ):
        raise ValueError(f"Expected {expected_length} integers at {key}.")
    return list(value)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare", help="Prepare the approved package atomically.")
    prepare.add_argument("--review", required=True, type=Path)
    prepare.add_argument("--approval", required=True, type=Path)
    prepare.add_argument("--source-repository-root", required=True, type=Path)
    prepare.add_argument("--out", required=True, type=Path)
    verify = subparsers.add_parser("verify", help="Verify an existing approved package.")
    verify.add_argument("--package", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "prepare":
            verified = prepare_macaw_reference_package(
                arguments.review,
                arguments.approval,
                arguments.source_repository_root,
                arguments.out,
            )
            action = "Prepared"
        else:
            verified = verify_reference_package(arguments.package)
            action = "Verified"
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        print(f"AF-054 reference package operation failed: {error}", file=sys.stderr)
        return 5
    print(f"{action} AF-054 reference package: {verified.root}")
    print(f"Manifest SHA-256: {verified.manifest_sha256}")
    print(f"Ordered view-set SHA-256: {verified.ordered_view_set_sha256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
