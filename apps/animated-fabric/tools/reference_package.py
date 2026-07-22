"""Strict integrity contract for the reviewed AF-054 reference package."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from io import BytesIO
from pathlib import Path, PurePosixPath

from PIL import Image

REFERENCE_FORMAT = "animated-fabric.reference-package.v1"
APPROVAL_FORMAT = "animated-fabric.reference-approval.v1"
VIEW_SET_FORMAT = "animated-fabric.reference-view-set.v1"
SOURCE_APPROVAL_FORMAT = "animated-fabric.reference-review-approval.v1"
SCHEMA_VERSION = "0.1.0"
PACKAGE_ID = "macaw-traveler-v1"
TICKET = "AF-054"
REVIEW_FORMAT = "animated-fabric.reference-review.v1"
OWNER_APPROVAL_EVIDENCE_ID = "CAATUU-AF054-OWNER-APPROVAL-2026-07-22"
SOURCE_IMPORT_COMMIT = "2cfa4398e443a5beb786305d1e2bb0a40feb833a"
RIGHTS_STATEMENT = (
    "The product owner confirmed that Caatuu created the character material from scratch and "
    "approved public reuse under the scoped CC0 notice only for rights Caatuu owns or is "
    "authorized to exercise."
)

C2PA_RECORDS: dict[str, dict[str, object]] = {
    "prepared-parts-sheet": {
        "claim_manifest_id": "urn:c2pa:12281797-1ae4-43ed-a50a-1f29c4dfd7fd",
        "instance_id": "xmp:iid:09bf7ca9-6db3-4727-a185-94c944ffc4bb",
        "recorded_action": "trainedAlgorithmicMedia",
        "recorded_created_date": "2026-07-14",
        "recorded_generator": "gpt-image 2.0",
        "recorded_provider": "OpenAI Media Service API",
        "verification": "embedded_claim_detected_not_cryptographically_validated",
    },
    "side-walk-sheet": {
        "claim_manifest_id": "urn:c2pa:d668b86a-16c3-4239-af8b-255963e6cb99",
        "instance_id": "xmp:iid:d7518a6b-30bc-4c82-9943-34e8ff437f80",
        "recorded_action": "trainedAlgorithmicMedia",
        "recorded_created_date": "2026-07-14",
        "recorded_generator": "gpt-image 2.0",
        "recorded_provider": "OpenAI Media Service API",
        "verification": "embedded_claim_detected_not_cryptographically_validated",
    },
}
TURNAROUND_C2PA: dict[str, object] = {
    "claim_manifest_id": "urn:c2pa:c9b53b89-c905-4753-bdc8-5034535363e6",
    "instance_id": "xmp:iid:4f442129-f3c4-4164-989c-df43c732e763",
    "recorded_action": "trainedAlgorithmicMedia",
    "recorded_created_date": "2026-07-21",
    "recorded_generator": "gpt-image 2.0",
    "recorded_provider": "OpenAI Media Service API",
    "verification": "embedded_claim_detected_not_cryptographically_validated",
}
EXPECTED_PROVENANCE_LIMITATIONS = [
    "Embedded C2PA claims were detected but not cryptographically validated.",
    "The historical prepared-parts prompt names two inputs without stable identities.",
    "The historical side-walk prompt and input lineage were not preserved.",
    "Generated views are proposals accepted for modeling reference, not recovered geometry.",
]

VIEW_ORDER = ("front", "left", "back", "right")
VIEW_PATHS = tuple(f"views/{view_id}.png" for view_id in VIEW_ORDER)
VIEW_CAMERA_AXES = ("+Y", "-X", "-Y", "+X")
VIEW_BEAK_DIRECTIONS = ("not_applicable", "screen_left", "not_applicable", "screen_right")
COMMON_VIEW_SIZE = (512, 704)
GROUND_ROW_PX = 664

SOURCE_LAYOUT = (
    (
        "identity-neutral-reference",
        "sources/identity/neutral-reference.png",
        "identity_and_assembled_proportions",
    ),
    (
        "prepared-parts-sheet",
        "sources/prepared-parts/macaw-traveler-parts-sheet-v1.png",
        "component_and_joint_intent",
    ),
    (
        "prepared-parts-prompt",
        "sources/prepared-parts/generation-prompt.md",
        "prepared_parts_generation_prompt",
    ),
    (
        "prepared-parts-split-evidence",
        "sources/prepared-parts/split-manifest.json",
        "neutral_reference_derivation_evidence",
    ),
    (
        "legacy-rig",
        "sources/prepared-parts/legacy-rig.json",
        "existing_articulation_intent_evidence_only",
    ),
    (
        "side-walk-sheet",
        "sources/side-walk/macaw-walk-sheet-v1.png",
        "anthropomorphic_gait_reference",
    ),
)
TURNAROUND_PATH = "review/macaw-traveler-turnaround-candidate-v1.png"
REVIEW_RECORD_PATH = "review/review.json"
SOURCE_APPROVAL_PATH = "review/source-approval.json"
REFERENCE_PATH = "reference.json"
APPROVAL_PATH = "approval.json"
LICENSE_PATH = "LICENSE-CC0.md"
README_PATH = "README.md"

EXPECTED_FILE_PATHS = frozenset(
    {
        REFERENCE_PATH,
        APPROVAL_PATH,
        LICENSE_PATH,
        README_PATH,
        TURNAROUND_PATH,
        REVIEW_RECORD_PATH,
        SOURCE_APPROVAL_PATH,
        *VIEW_PATHS,
        *(path for _source_id, path, _role in SOURCE_LAYOUT),
    }
)

EXPECTED_AXES = {
    "actor_forward": "+Y",
    "actor_right": "+X",
    "up": "+Z",
}
EXPECTED_PROP_SCOPE = {
    "staff": "separate",
    "base_actor": "excluded",
    "first_walk": "excluded",
    "future_compatible_hand_socket_required": True,
}
NORMALIZATION = "one_to_one_crop_with_horizontal_edge_extension"
VIEW_CLASSIFICATION = "approved_generated_inferred_modeling_reference"
MAX_PACKAGE_BYTES = 32 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = 16_000_000
UTC_TIMESTAMP_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


@dataclass(frozen=True, slots=True)
class VerifiedReferencePackage:
    """Verified immutable identities needed by the later actor-authoring gate."""

    root: Path
    manifest_sha256: str
    approval_sha256: str
    ordered_view_set_sha256: str
    ordered_view_paths: tuple[Path, ...]
    source_paths: tuple[Path, ...]


def canonical_json_bytes(document: object) -> bytes:
    """Encode persisted JSON with the repository's canonical formatting."""
    return (
        json.dumps(
            document,
            allow_nan=False,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    """Return a lowercase SHA-256 digest."""
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    """Hash one bounded regular-file snapshot without following its final path."""
    return sha256_bytes(read_regular_file_bytes(path))


def foreground_height_variance_percent(minimum: int, maximum: int) -> float:
    """Return the disclosed height spread relative to the smallest view, rounded half-up."""
    if minimum <= 0 or maximum < minimum:
        raise ValueError("Foreground height range is invalid.")
    percentage = Decimal((maximum - minimum) * 100) / Decimal(minimum)
    return float(percentage.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def validate_utc_timestamp(value: str) -> str:
    """Require the fixed second-precision RFC 3339 UTC representation."""
    if UTC_TIMESTAMP_PATTERN.fullmatch(value) is None:
        raise ValueError("Approval time must use second-precision RFC 3339 UTC.")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise ValueError("Approval time must be a real UTC date and time.") from error
    if parsed.tzinfo != UTC:
        raise ValueError("Approval time must use UTC.")
    return value


def ordered_view_set_document(views: Sequence[Mapping[str, object]]) -> dict[str, object]:
    """Build the exact ordered view identity document used by both records."""
    identities: list[dict[str, str]] = []
    for expected_id, view in zip(VIEW_ORDER, views, strict=True):
        view_id = _string(view, "id")
        if view_id != expected_id:
            raise ValueError("Reference views must be ordered front, left, back, right.")
        identities.append(
            {
                "id": view_id,
                "path": _string(view, "path"),
                "sha256": _sha256_value(view, "sha256"),
            }
        )
    if len(views) != len(VIEW_ORDER):
        raise ValueError("Reference package must contain exactly four ordered views.")
    return {"format": VIEW_SET_FORMAT, "views": identities}


def ordered_view_set_sha256(views: Sequence[Mapping[str, object]]) -> str:
    """Hash the canonical ordered view identity document."""
    return sha256_bytes(canonical_json_bytes(ordered_view_set_document(views)))


def normalize_review_crop(sheet: Image.Image, crop_xywh: Sequence[int]) -> Image.Image:
    """Crop at 1:1 scale and extend only the two background edge columns."""
    if sheet.mode != "RGB":
        raise ValueError("The approved turnaround must be an RGB image.")
    x, y, width, height = _four_ints(crop_xywh, "crop_xywh")
    if height != COMMON_VIEW_SIZE[1] or width > COMMON_VIEW_SIZE[0]:
        raise ValueError("Review crop cannot fit the common 512 x 704 reference canvas.")
    if min(x, y, width, height) < 0 or width == 0 or height == 0:
        raise ValueError("Review crop has invalid bounds.")
    if x + width > sheet.width or y + height > sheet.height:
        raise ValueError("Review crop escapes the approved turnaround.")

    crop = sheet.crop((x, y, x + width, y + height))
    left_padding = (COMMON_VIEW_SIZE[0] - width) // 2
    right_padding = COMMON_VIEW_SIZE[0] - width - left_padding
    normalized = Image.new("RGB", COMMON_VIEW_SIZE)
    if left_padding:
        left_column = crop.crop((0, 0, 1, height)).resize(
            (left_padding, height),
            resample=Image.Resampling.NEAREST,
        )
        normalized.paste(left_column, (0, 0))
    normalized.paste(crop, (left_padding, 0))
    if right_padding:
        right_column = crop.crop((width - 1, 0, width, height)).resize(
            (right_padding, height),
            resample=Image.Resampling.NEAREST,
        )
        normalized.paste(right_column, (left_padding + width, 0))
    return normalized


def scoped_cc0_notice(visual_hashes: Mapping[str, str]) -> str:
    """Create the exact conservative CC0 notice for the approved PNG allowlist."""
    expected_visuals = (
        "sources/identity/neutral-reference.png",
        "sources/prepared-parts/macaw-traveler-parts-sheet-v1.png",
        "sources/side-walk/macaw-walk-sheet-v1.png",
        TURNAROUND_PATH,
        *VIEW_PATHS,
    )
    if tuple(visual_hashes) != expected_visuals:
        raise ValueError("CC0 scope must name the exact eight approved PNG files in order.")
    lines = [
        "# CC0 dedication for the AF-054 macaw reference art",
        "",
        "SPDX-License-Identifier: CC0-1.0",
        "",
        "Caatuu dedicates under CC0 1.0 only the copyright and related rights it owns or is",
        "authorized to exercise in these exact PNG files and SHA-256 identities:",
        "",
    ]
    lines.extend(f"- `{path}` — `{visual_hashes[path]}`" for path in expected_visuals)
    lines.extend(
        [
            "",
            "No attribution is required. The CC0 1.0 Universal legal code is available at",
            "<https://creativecommons.org/publicdomain/zero/1.0/legalcode>.",
            "",
            "This dedication does not grant rights in trademarks, privacy or publicity interests,",
            "third-party source material, software, JSON, manifests, prompts, models, containers,",
            "or later derivatives unless expressly listed above. Provenance records are retained",
            "for audit. All package files not named above remain under their recorded repository",
            "terms.",
            "",
        ]
    )
    return "\n".join(lines)


def verify_reference_package(
    root: Path,
    *,
    require_approved: bool = True,
) -> VerifiedReferencePackage:
    """Verify one stable private snapshot of the fixed AF-054 package."""
    original_root = _verified_root(root)
    original_files = _exact_regular_files(original_root)
    original_payloads: dict[str, bytes] = {}
    with tempfile.TemporaryDirectory(prefix="animated-fabric-af054-verify-") as temporary:
        snapshot_root = Path(temporary) / PACKAGE_ID
        snapshot_root.mkdir()
        for relative, source in original_files.items():
            payload = read_regular_file_bytes(source)
            original_payloads[relative] = payload
            target = snapshot_root.joinpath(*PurePosixPath(relative).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        verified = _verify_reference_package_snapshot(
            snapshot_root,
            require_approved=require_approved,
        )

    current_files = _exact_regular_files(original_root)
    if set(current_files) != set(original_payloads):
        raise ValueError("Reference package file set changed during verification.")
    for relative, expected in original_payloads.items():
        if read_regular_file_bytes(current_files[relative]) != expected:
            raise ValueError(f"Reference package changed during verification: {relative}")
    return VerifiedReferencePackage(
        root=original_root,
        manifest_sha256=verified.manifest_sha256,
        approval_sha256=verified.approval_sha256,
        ordered_view_set_sha256=verified.ordered_view_set_sha256,
        ordered_view_paths=tuple(current_files[path] for path in VIEW_PATHS),
        source_paths=tuple(current_files[path] for _source_id, path, _role in SOURCE_LAYOUT),
    )


def _verify_reference_package_snapshot(
    package_root: Path,
    *,
    require_approved: bool,
) -> VerifiedReferencePackage:
    files = _exact_regular_files(package_root)
    manifest_path = files[REFERENCE_PATH]
    approval_path = files[APPROVAL_PATH]
    manifest = _canonical_json_object(manifest_path)
    approval = _canonical_json_object(approval_path)

    _verify_manifest_header(manifest, require_approved=require_approved)
    review, source_approval = _verify_review_evidence(package_root, files, manifest)
    _verify_review_contract(review, manifest)
    source_paths = _verify_sources(package_root, files, manifest)
    sheet, sheet_record = _verify_turnaround(package_root, files, manifest)
    views = _object_list(manifest, "views")
    view_paths = _verify_views(package_root, files, sheet, sheet_record, views)
    _verify_view_height_disclosure(manifest, views)
    view_set_digest = ordered_view_set_sha256(views)
    view_set = _object(manifest, "ordered_view_set")
    _expect_keys(view_set, {"format", "order", "sha256"}, "manifest ordered view set")
    if _string(view_set, "format") != VIEW_SET_FORMAT:
        raise ValueError("Reference manifest has an unsupported ordered view-set format.")
    if tuple(_string_list(view_set, "order")) != VIEW_ORDER:
        raise ValueError("Reference manifest view-set order is invalid.")
    if _sha256_value(view_set, "sha256") != view_set_digest:
        raise ValueError("Reference manifest ordered view-set digest mismatch.")

    _verify_documentation_and_license(package_root, files, manifest, views)
    manifest_digest = sha256_file(manifest_path)
    _verify_approval(
        approval,
        manifest,
        source_approval,
        manifest_digest,
        view_set_digest,
        require_approved=require_approved,
    )
    return VerifiedReferencePackage(
        root=package_root,
        manifest_sha256=manifest_digest,
        approval_sha256=sha256_file(approval_path),
        ordered_view_set_sha256=view_set_digest,
        ordered_view_paths=view_paths,
        source_paths=source_paths,
    )


def _verified_root(root: Path) -> Path:
    _reject_link_like_ancestors(root)
    try:
        resolved = root.resolve(strict=True)
    except OSError as error:
        raise ValueError(f"Reference package does not exist: {root}") from error
    if not resolved.is_dir():
        raise ValueError("Reference package root must be a directory.")
    return resolved


def _exact_regular_files(root: Path) -> dict[str, Path]:
    found: dict[str, Path] = {}
    total_bytes = 0
    for candidate in root.rglob("*"):
        relative = candidate.relative_to(root).as_posix()
        _reject_link_like_ancestors(candidate, stop=root)
        if _is_link_like(candidate):
            raise ValueError(f"Reference package contains a link or junction: {relative}")
        status = candidate.stat(follow_symlinks=False)
        if stat.S_ISDIR(status.st_mode):
            continue
        if not stat.S_ISREG(status.st_mode):
            raise ValueError(f"Reference package entry is not a regular file: {relative}")
        if status.st_nlink != 1:
            raise ValueError(f"Reference package file must not be hard-linked: {relative}")
        if status.st_size > MAX_FILE_BYTES:
            raise ValueError(f"Reference package file exceeds the byte limit: {relative}")
        total_bytes += status.st_size
        found[relative] = candidate
    if total_bytes > MAX_PACKAGE_BYTES:
        raise ValueError("Reference package exceeds the total byte limit.")
    actual = frozenset(found)
    if actual != EXPECTED_FILE_PATHS:
        missing = sorted(EXPECTED_FILE_PATHS - actual)
        extra = sorted(actual - EXPECTED_FILE_PATHS)
        raise ValueError(f"Reference package file set mismatch; missing={missing}, extra={extra}.")
    return found


def _verify_manifest_header(manifest: Mapping[str, object], *, require_approved: bool) -> None:
    _expect_keys(
        manifest,
        {
            "actor_axes",
            "approval_record",
            "combined_review_sheet",
            "common_view",
            "documentation",
            "format",
            "gait",
            "license",
            "ordered_view_set",
            "package_id",
            "prop_scope",
            "provenance_limitations",
            "review_evidence",
            "rights_evidence",
            "schema_version",
            "sources",
            "status",
            "ticket",
            "unresolved_inferences",
            "views",
        },
        "reference manifest",
    )
    if _string(manifest, "format") != REFERENCE_FORMAT:
        raise ValueError("Reference manifest format is invalid.")
    if _string(manifest, "schema_version") != SCHEMA_VERSION:
        raise ValueError("Reference manifest schema version is invalid.")
    if _string(manifest, "package_id") != PACKAGE_ID or _string(manifest, "ticket") != TICKET:
        raise ValueError("Reference manifest identity is invalid.")
    status_value = _string(manifest, "status")
    if status_value not in {"candidate", "approved", "rejected"}:
        raise ValueError("Reference manifest status is invalid.")
    if require_approved and status_value != "approved":
        raise ValueError("Reference package has not been approved.")
    if _string(manifest, "gait") != "anthropomorphic_traveler":
        raise ValueError("Reference manifest gait is invalid.")
    if _object(manifest, "actor_axes") != EXPECTED_AXES:
        raise ValueError("Reference manifest actor axes are invalid.")
    if _object(manifest, "prop_scope") != EXPECTED_PROP_SCOPE:
        raise ValueError("Reference manifest prop scope is invalid.")
    if _object(manifest, "approval_record") != {
        "path": APPROVAL_PATH,
        "required_before_ticket": "AF-056",
    }:
        raise ValueError("Reference manifest approval gate is invalid.")
    if _string_list(manifest, "provenance_limitations") != EXPECTED_PROVENANCE_LIMITATIONS:
        raise ValueError("Reference manifest provenance limitations are invalid.")
    common = _object(manifest, "common_view")
    _expect_keys(
        common,
        {
            "approved_maximum_visual_height_variance_percent",
            "ground_row_px",
            "height_px",
            "mode",
            "normalization",
            "observed_foreground_height_range_px",
            "scale_basis",
            "width_px",
        },
        "common view",
    )
    if (_integer(common, "width_px"), _integer(common, "height_px")) != COMMON_VIEW_SIZE:
        raise ValueError("Reference views must use the common 512 x 704 canvas.")
    if _integer(common, "ground_row_px") != GROUND_ROW_PX:
        raise ValueError("Reference views must share ground row 664.")
    if _string(common, "mode") != "RGB" or _string(common, "normalization") != NORMALIZATION:
        raise ValueError("Reference view normalization contract is invalid.")
    if _string(common, "scale_basis") != "one_to_one_pixels_from_one_combined_sheet":
        raise ValueError("Reference view scale basis is invalid.")
    height_range = _two_ints(
        _sequence(common, "observed_foreground_height_range_px"),
        "observed_foreground_height_range_px",
    )
    expected_variance = foreground_height_variance_percent(*height_range)
    if _number(common, "approved_maximum_visual_height_variance_percent") != expected_variance:
        raise ValueError("Reference view height-variance disclosure is invalid.")


def _verify_review_evidence(
    root: Path,
    files: Mapping[str, Path],
    manifest: Mapping[str, object],
) -> tuple[dict[str, object], dict[str, object]]:
    evidence = _object(manifest, "review_evidence")
    _expect_keys(
        evidence,
        {"review_path", "review_sha256", "source_approval_path", "source_approval_sha256"},
        "manifest review evidence",
    )
    if (
        _string(evidence, "review_path") != REVIEW_RECORD_PATH
        or _string(evidence, "source_approval_path") != SOURCE_APPROVAL_PATH
    ):
        raise ValueError("Reference review-evidence paths are invalid.")
    review_path = _declared_file(root, files, REVIEW_RECORD_PATH)
    source_approval_path = _declared_file(root, files, SOURCE_APPROVAL_PATH)
    if sha256_file(review_path) != _sha256_value(evidence, "review_sha256"):
        raise ValueError("Reference review record hash mismatch.")
    if sha256_file(source_approval_path) != _sha256_value(evidence, "source_approval_sha256"):
        raise ValueError("Reference source-approval hash mismatch.")
    turnaround = _object(manifest, "combined_review_sheet")
    provenance = _object(turnaround, "provenance")
    if _sha256_value(provenance, "review_record_sha256") != _sha256_value(
        evidence, "review_sha256"
    ):
        raise ValueError("Reference turnaround is not bound to its exact review record.")
    review = _json_object(review_path)
    source_approval = _canonical_json_object(source_approval_path)
    _verify_source_approval_identity(source_approval, review_path)
    return review, source_approval


def _verify_review_contract(
    review: Mapping[str, object],
    manifest: Mapping[str, object],
) -> None:
    _expect_keys(
        review,
        {
            "approval",
            "format",
            "gait",
            "prop_scope",
            "schema_version",
            "source_evidence",
            "status",
            "ticket",
            "turnaround",
            "unresolved_inferences",
        },
        "review record",
    )
    if (
        _string(review, "format") != REVIEW_FORMAT
        or _string(review, "schema_version") != SCHEMA_VERSION
        or _string(review, "ticket") != TICKET
        or _string(review, "status") != "candidate"
        or _string(review, "gait") != _string(manifest, "gait")
        or review.get("approval") is not None
    ):
        raise ValueError("Reference manifest is not bound to the approved review identity.")
    if _object(review, "prop_scope") != {
        "requires_approval": True,
        "staff": "separate_prop_excluded_from_base_actor_and_first_walk",
    }:
        raise ValueError("Approved review prop scope is invalid.")

    turnaround = _object(review, "turnaround")
    _expect_keys(
        turnaround,
        {
            "file",
            "generation",
            "height_px",
            "normalization_review",
            "sha256",
            "view_convention",
            "views",
            "width_px",
        },
        "review turnaround",
    )
    filename = _string(turnaround, "file")
    if PurePosixPath(filename).name != filename:
        raise ValueError("Approved review turnaround filename is unsafe.")
    sheet = _object(manifest, "combined_review_sheet")
    _expect_keys(
        sheet,
        {
            "c2pa",
            "classification",
            "height_px",
            "media_type",
            "mode",
            "original_review_filename",
            "path",
            "provenance",
            "sha256",
            "width_px",
        },
        "combined review sheet",
    )
    if (
        filename != _string(sheet, "original_review_filename")
        or _sha256_value(turnaround, "sha256") != _sha256_value(sheet, "sha256")
        or _integer(turnaround, "width_px") != _integer(sheet, "width_px")
        or _integer(turnaround, "height_px") != _integer(sheet, "height_px")
        or _string(sheet, "classification") != "approved_generated_inferred_combined_review_sheet"
        or _string(sheet, "media_type") != "image/png"
        or _object(sheet, "c2pa") != TURNAROUND_C2PA
    ):
        raise ValueError("Reference combined sheet differs from the approved review.")

    generation = _object(turnaround, "generation")
    if not {"attempt", "authoring_tool", "inferred_content"}.issubset(generation) or not set(
        generation
    ).issubset({"attempt", "authoring_tool", "inferred_content", "notes"}):
        raise ValueError("Approved review generation record has unexpected fields.")
    if "notes" in generation:
        _string(generation, "notes")
    if (
        _integer(generation, "attempt") != 2
        or _string(generation, "authoring_tool") != "OpenAI built-in image generation"
        or not _boolean(generation, "inferred_content")
    ):
        raise ValueError("Approved review generation record is invalid.")

    source_evidence = _object_list(review, "source_evidence")
    expected_source_roles = {
        "identity_and_assembled_proportions": "identity-neutral-reference",
        "component_and_joint_intent": "prepared-parts-sheet",
        "anthropomorphic_gait_reference": "side-walk-sheet",
        "existing_articulation_intent": "legacy-rig",
    }
    by_role: dict[str, Mapping[str, object]] = {}
    for record in source_evidence:
        _expect_keys(record, {"path", "role", "sha256"}, "review source evidence")
        role = _string(record, "role")
        if role in by_role:
            raise ValueError("Approved review source roles are duplicated.")
        by_role[role] = record
    if set(by_role) != set(expected_source_roles):
        raise ValueError("Approved review source evidence is incomplete.")
    manifest_sources = {
        _string(record, "id"): record for record in _object_list(manifest, "sources")
    }
    for role, source_id in expected_source_roles.items():
        approved = by_role[role]
        packaged = manifest_sources.get(source_id)
        if packaged is None or (
            _string(approved, "path") != _string(packaged, "repository_source_path")
            or _sha256_value(approved, "sha256") != _sha256_value(packaged, "sha256")
        ):
            raise ValueError("Reference source differs from the approved review evidence.")

    provenance = _object(sheet, "provenance")
    _expect_keys(
        provenance,
        {
            "author_provider",
            "created_date",
            "generation_attempt",
            "input_evidence_sha256",
            "modifications",
            "review_record_sha256",
        },
        "combined sheet provenance",
    )
    if (
        _string(provenance, "author_provider") != "Caatuu-directed OpenAI image generation"
        or _string(provenance, "created_date") != "2026-07-21"
        or _integer(provenance, "generation_attempt") != _integer(generation, "attempt")
        or _string_list(provenance, "input_evidence_sha256")
        != [_sha256_value(record, "sha256") for record in source_evidence]
        or _string(provenance, "modifications")
        != "Copied byte for byte without modification; embedded claim retained."
    ):
        raise ValueError("Reference combined-sheet provenance differs from the approved review.")

    expected_convention = {
        "actor_forward_axis": "+Y",
        "actor_right_axis": "+X",
        "back_camera_axis": "-Y",
        "front_camera_axis": "+Y",
        "left_beak_points": "screen_left",
        "left_camera_axis": "-X",
        "right_beak_points": "screen_right",
        "right_camera_axis": "+X",
        "up_axis": "+Z",
    }
    if _object(turnaround, "view_convention") != expected_convention:
        raise ValueError("Approved review view convention is invalid.")

    review_views = _object_list(turnaround, "views")
    manifest_views = _object_list(manifest, "views")
    if len(review_views) != len(VIEW_ORDER) or len(manifest_views) != len(VIEW_ORDER):
        raise ValueError("Approved review must bind exactly four reference views.")
    for review_view, packaged_view, view_id in zip(
        review_views, manifest_views, VIEW_ORDER, strict=True
    ):
        _expect_keys(
            review_view,
            {"candidate_crop_xywh", "foreground_bounds_xywh", "id"},
            "review view",
        )
        if _string(review_view, "id") != view_id or _string(packaged_view, "id") != view_id:
            raise ValueError("Reference view order differs from the approved review.")
        if _four_ints(
            _sequence(review_view, "candidate_crop_xywh"), "candidate_crop_xywh"
        ) != _four_ints(_sequence(packaged_view, "crop_xywh"), "crop_xywh") or _four_ints(
            _sequence(review_view, "foreground_bounds_xywh"),
            "foreground_bounds_xywh",
        ) != _four_ints(
            _sequence(packaged_view, "foreground_bounds_sheet_xywh"),
            "foreground_bounds_sheet_xywh",
        ):
            raise ValueError("Reference view geometry differs from the approved review.")

    normalization = _object(turnaround, "normalization_review")
    _expect_keys(
        normalization,
        {
            "candidate_ground_row_px",
            "crop_and_padding_preserve_source_pixels",
            "foreground_height_range_px",
            "maximum_scale_drift_percent",
            "scale_normalization_requires_resampling_or_corrected_art",
        },
        "review normalization",
    )
    common = _object(manifest, "common_view")
    if (
        _integer(normalization, "candidate_ground_row_px") != _integer(common, "ground_row_px")
        or _two_ints(
            _sequence(normalization, "foreground_height_range_px"),
            "foreground_height_range_px",
        )
        != _two_ints(
            _sequence(common, "observed_foreground_height_range_px"),
            "observed_foreground_height_range_px",
        )
        or _number(normalization, "maximum_scale_drift_percent")
        != _number(common, "approved_maximum_visual_height_variance_percent")
        or not _boolean(normalization, "crop_and_padding_preserve_source_pixels")
        or not _boolean(normalization, "scale_normalization_requires_resampling_or_corrected_art")
    ):
        raise ValueError("Reference normalization differs from the approved review.")
    if _string_list(review, "unresolved_inferences") != _string_list(
        manifest, "unresolved_inferences"
    ):
        raise ValueError("Reference unresolved inferences differ from the approved review.")


def _verify_sources(
    root: Path,
    files: Mapping[str, Path],
    manifest: Mapping[str, object],
) -> tuple[Path, ...]:
    records = _object_list(manifest, "sources")
    if len(records) != len(SOURCE_LAYOUT):
        raise ValueError("Reference manifest source inventory is incomplete.")
    resolved: list[Path] = []
    for record, (source_id, expected_path, expected_role) in zip(
        records, SOURCE_LAYOUT, strict=True
    ):
        expected_keys = {
            "id",
            "media_type",
            "path",
            "provenance",
            "repository_source_path",
            "role",
            "sha256",
        }
        if expected_path.endswith(".png"):
            expected_keys.update({"height_px", "mode", "width_px"})
        _expect_keys(record, expected_keys, f"source record {source_id}")
        if (
            _string(record, "id") != source_id
            or _string(record, "path") != expected_path
            or _string(record, "role") != expected_role
            or _string(record, "media_type") != _expected_media_type(expected_path)
        ):
            raise ValueError("Reference manifest source order or identity is invalid.")
        _verify_source_provenance(record, source_id)
        path = _declared_file(root, files, expected_path)
        if sha256_file(path) != _sha256_value(record, "sha256"):
            raise ValueError(f"Reference source hash mismatch: {expected_path}")
        if expected_path.endswith(".png"):
            _verify_png_record(path, record)
        resolved.append(path)
    return tuple(resolved)


def _verify_source_provenance(record: Mapping[str, object], source_id: str) -> None:
    expected: dict[str, object] = {
        "approval_evidence_id": OWNER_APPROVAL_EVIDENCE_ID,
        "copied_without_modification": True,
        "imported_date": "2026-07-17",
        "repository_import_commit": SOURCE_IMPORT_COMMIT,
        "source_sha256": _sha256_value(record, "sha256"),
    }
    if source_id == "identity-neutral-reference":
        expected.update(
            {
                "author_provider": "Caatuu project contributors using the prepared-parts workflow",
                "derivation": (
                    "Byte-identical to prepared-parts split slot 12 after documented alpha "
                    "extraction."
                ),
                "embedded_c2pa": ("none; lineage points to the credentialed prepared-parts sheet"),
            }
        )
    elif source_id in C2PA_RECORDS:
        expected.update(
            {
                "author_provider": "Caatuu-directed OpenAI image generation",
                "c2pa": C2PA_RECORDS[source_id],
                "modifications": "None in this package; embedded claim bytes retained.",
            }
        )
    elif source_id == "legacy-rig":
        expected.update(
            {
                "author_provider": "Caatuu project contributors",
                "limitations": (
                    "Evidence only; its legacy relative layer references are not resolved by this "
                    "package."
                ),
            }
        )
    else:
        expected.update(
            {
                "author_provider": "Caatuu project contributors",
                "purpose": "Self-contained historical provenance evidence.",
            }
        )
    if _object(record, "provenance") != expected:
        raise ValueError(f"Reference source provenance is invalid: {source_id}")


def _expected_media_type(path: str) -> str:
    if path.endswith(".png"):
        return "image/png"
    if path.endswith(".json"):
        return "application/json"
    if path.endswith(".md"):
        return "text/markdown"
    raise ValueError(f"Unsupported reference source type: {path}")


def _verify_turnaround(
    root: Path,
    files: Mapping[str, Path],
    manifest: Mapping[str, object],
) -> tuple[Image.Image, Mapping[str, object]]:
    record = _object(manifest, "combined_review_sheet")
    if _string(record, "path") != TURNAROUND_PATH:
        raise ValueError("Reference manifest turnaround path is invalid.")
    path = _declared_file(root, files, TURNAROUND_PATH)
    if sha256_file(path) != _sha256_value(record, "sha256"):
        raise ValueError("Approved turnaround hash mismatch.")
    _verify_png_record(path, record)
    with Image.open(BytesIO(read_regular_file_bytes(path))) as decoded:
        decoded.load()
        return decoded.copy(), record


def _verify_views(
    root: Path,
    files: Mapping[str, Path],
    sheet: Image.Image,
    sheet_record: Mapping[str, object],
    views: Sequence[Mapping[str, object]],
) -> tuple[Path, ...]:
    if len(views) != len(VIEW_ORDER):
        raise ValueError("Reference manifest must contain exactly four views.")
    resolved: list[Path] = []
    for index, (record, view_id, expected_path, camera_axis, beak_direction) in enumerate(
        zip(
            views,
            VIEW_ORDER,
            VIEW_PATHS,
            VIEW_CAMERA_AXES,
            VIEW_BEAK_DIRECTIONS,
            strict=True,
        )
    ):
        del index
        _expect_keys(
            record,
            {
                "beak_direction",
                "camera_axis",
                "classification",
                "crop_xywh",
                "foreground_bounds_sheet_xywh",
                "id",
                "normalization",
                "path",
                "placement_xy",
                "sha256",
                "source_sheet_path",
                "source_sheet_sha256",
            },
            f"reference view {view_id}",
        )
        if (
            _string(record, "id") != view_id
            or _string(record, "path") != expected_path
            or _string(record, "camera_axis") != camera_axis
            or _string(record, "beak_direction") != beak_direction
        ):
            raise ValueError("Reference view order, camera, or beak convention is invalid.")
        if _string(record, "classification") != VIEW_CLASSIFICATION:
            raise ValueError("Reference view classification is invalid.")
        if _string(record, "normalization") != NORMALIZATION:
            raise ValueError("Reference view normalization is invalid.")
        if _string(record, "source_sheet_path") != _string(sheet_record, "path"):
            raise ValueError("Reference view names the wrong combined sheet.")
        if _sha256_value(record, "source_sheet_sha256") != _sha256_value(sheet_record, "sha256"):
            raise ValueError("Reference view names the wrong combined-sheet identity.")

        crop = _four_ints(_sequence(record, "crop_xywh"), "crop_xywh")
        foreground = _four_ints(
            _sequence(record, "foreground_bounds_sheet_xywh"),
            "foreground_bounds_sheet_xywh",
        )
        placement = _two_ints(_sequence(record, "placement_xy"), "placement_xy")
        _verify_crop_geometry(crop, foreground, placement, sheet.size)

        path = _declared_file(root, files, expected_path)
        if sha256_file(path) != _sha256_value(record, "sha256"):
            raise ValueError(f"Reference view hash mismatch: {view_id}")
        with Image.open(BytesIO(read_regular_file_bytes(path))) as decoded:
            if decoded.format != "PNG" or decoded.mode != "RGB" or decoded.size != COMMON_VIEW_SIZE:
                raise ValueError(f"Reference view is not a 512 x 704 RGB PNG: {view_id}")
            decoded.load()
            expected = normalize_review_crop(sheet, crop)
            if decoded.tobytes() != expected.tobytes():
                raise ValueError(f"Reference view pixels do not match the approved crop: {view_id}")
        resolved.append(path)
    return tuple(resolved)


def _verify_crop_geometry(
    crop: tuple[int, int, int, int],
    foreground: tuple[int, int, int, int],
    placement: tuple[int, int],
    sheet_size: tuple[int, int],
) -> None:
    x, y, width, height = crop
    foreground_x, foreground_y, foreground_width, foreground_height = foreground
    if (
        min(x, y, width, height, foreground_x, foreground_y, foreground_width, foreground_height)
        < 0
    ):
        raise ValueError("Reference crop geometry contains a negative value.")
    if width == 0 or height == 0 or foreground_width == 0 or foreground_height == 0:
        raise ValueError("Reference crop geometry contains an empty rectangle.")
    if x + width > sheet_size[0] or y + height > sheet_size[1]:
        raise ValueError("Reference crop escapes the combined sheet.")
    if not (
        x <= foreground_x
        and y <= foreground_y
        and foreground_x + foreground_width <= x + width
        and foreground_y + foreground_height <= y + height
    ):
        raise ValueError("Reference crop does not contain its foreground bounds.")
    if foreground_y + foreground_height - y - 1 != GROUND_ROW_PX:
        raise ValueError("Reference foreground does not end on ground row 664.")
    expected_x = (COMMON_VIEW_SIZE[0] - width) // 2
    if placement != (expected_x, 0):
        raise ValueError("Reference crop placement is not centered on the common canvas.")


def _verify_view_height_disclosure(
    manifest: Mapping[str, object],
    views: Sequence[Mapping[str, object]],
) -> None:
    heights = [
        _four_ints(
            _sequence(view, "foreground_bounds_sheet_xywh"),
            "foreground_bounds_sheet_xywh",
        )[3]
        for view in views
    ]
    if not heights:
        raise ValueError("Reference package has no foreground-height evidence.")
    common = _object(manifest, "common_view")
    declared = _two_ints(
        _sequence(common, "observed_foreground_height_range_px"),
        "observed_foreground_height_range_px",
    )
    observed = (min(heights), max(heights))
    if declared != observed:
        raise ValueError("Reference view height range does not match its crop geometry.")


def _verify_documentation_and_license(
    root: Path,
    files: Mapping[str, Path],
    manifest: Mapping[str, object],
    views: Sequence[Mapping[str, object]],
) -> None:
    documentation = _object(manifest, "documentation")
    _expect_keys(documentation, {"path", "sha256"}, "reference documentation")
    if _string(documentation, "path") != README_PATH:
        raise ValueError("Reference package documentation path is invalid.")
    readme = _declared_file(root, files, README_PATH)
    if sha256_file(readme) != _sha256_value(documentation, "sha256"):
        raise ValueError("Reference package README hash mismatch.")

    license_record = _object(manifest, "license")
    _expect_keys(
        license_record,
        {"attribution_required", "expression", "notice_path", "notice_sha256", "scope"},
        "reference license",
    )
    if (
        _string(license_record, "expression") != "CC0-1.0"
        or _string(license_record, "notice_path") != LICENSE_PATH
        or _boolean(license_record, "attribution_required")
        or _string(license_record, "scope")
        != "only_the_eight_exact_png_identities_listed_in_the_notice"
    ):
        raise ValueError("Reference package visual license record is invalid.")
    notice = _declared_file(root, files, LICENSE_PATH)
    if sha256_file(notice) != _sha256_value(license_record, "notice_sha256"):
        raise ValueError("Reference package CC0 notice hash mismatch.")

    source_records = _object_list(manifest, "sources")
    visual_hashes: dict[str, str] = {}
    for source in source_records:
        path = _string(source, "path")
        if path.endswith(".png"):
            visual_hashes[path] = _sha256_value(source, "sha256")
    sheet = _object(manifest, "combined_review_sheet")
    visual_hashes[_string(sheet, "path")] = _sha256_value(sheet, "sha256")
    for view in views:
        visual_hashes[_string(view, "path")] = _sha256_value(view, "sha256")
    expected_notice = scoped_cc0_notice(visual_hashes).encode("utf-8")
    if read_regular_file_bytes(notice) != expected_notice:
        raise ValueError("Reference package CC0 notice does not match the exact visual hashes.")


def _verify_approval(
    approval: Mapping[str, object],
    manifest: Mapping[str, object],
    source_approval: Mapping[str, object],
    manifest_digest: str,
    view_set_digest: str,
    *,
    require_approved: bool,
) -> None:
    _expect_keys(
        approval,
        {
            "accepted_limitations",
            "accepted_scope",
            "approval_evidence_id",
            "decided_at_utc",
            "decision",
            "format",
            "manifest",
            "ordered_view_set",
            "package_id",
            "reviewer_role",
            "rights_statement",
            "schema_version",
            "source_approval",
            "ticket",
        },
        "approval",
    )
    if (
        _string(approval, "format") != APPROVAL_FORMAT
        or _string(approval, "schema_version") != SCHEMA_VERSION
        or _string(approval, "package_id") != PACKAGE_ID
        or _string(approval, "ticket") != TICKET
    ):
        raise ValueError("Reference approval identity is invalid.")
    decision = _string(approval, "decision")
    if decision not in {"approved", "rejected"}:
        raise ValueError("Reference approval decision is invalid.")
    if require_approved and decision != "approved":
        raise ValueError("Reference approval does not authorize consumption.")
    if _string(approval, "reviewer_role") != "product_owner":
        raise ValueError("Reference approval reviewer role is invalid.")
    validate_utc_timestamp(_string(approval, "decided_at_utc"))
    if (
        _string(approval, "approval_evidence_id") != OWNER_APPROVAL_EVIDENCE_ID
        or _string(approval, "rights_statement") != RIGHTS_STATEMENT
    ):
        raise ValueError("Reference approval rights evidence is invalid.")
    manifest_identity = _object(approval, "manifest")
    _expect_keys(manifest_identity, {"path", "sha256"}, "approval manifest identity")
    if (
        _string(manifest_identity, "path") != REFERENCE_PATH
        or _sha256_value(manifest_identity, "sha256") != manifest_digest
    ):
        raise ValueError("Reference approval is not bound to this exact manifest.")
    view_set = _object(approval, "ordered_view_set")
    _expect_keys(
        view_set,
        {"format", "order", "sha256"},
        "approval ordered view-set identity",
    )
    if (
        _string(view_set, "format") != VIEW_SET_FORMAT
        or tuple(_string_list(view_set, "order")) != VIEW_ORDER
        or _sha256_value(view_set, "sha256") != view_set_digest
    ):
        raise ValueError("Reference approval is not bound to this ordered view set.")
    approval_scope = _object(approval, "accepted_scope")
    _verify_accepted_scope(approval_scope)
    common = _object(manifest, "common_view")
    if approval_scope.get("foreground_height_range_px") != common.get(
        "observed_foreground_height_range_px"
    ) or approval_scope.get("maximum_visual_height_variance_percent") != common.get(
        "approved_maximum_visual_height_variance_percent"
    ):
        raise ValueError("Reference approval does not match the manifest height disclosure.")
    if _string_list(approval, "accepted_limitations") != _expected_accepted_limitations(
        _object(approval, "accepted_scope")
    ):
        raise ValueError("Reference approval limitations are invalid.")

    source_identity = _object(approval, "source_approval")
    _expect_keys(source_identity, {"path", "sha256"}, "approval source identity")
    review_evidence = _object(manifest, "review_evidence")
    if _string(source_identity, "path") != SOURCE_APPROVAL_PATH or _sha256_value(
        source_identity, "sha256"
    ) != _sha256_value(review_evidence, "source_approval_sha256"):
        raise ValueError("Reference approval is not bound to its source approval.")
    for key in (
        "accepted_limitations",
        "accepted_scope",
        "approval_evidence_id",
        "decided_at_utc",
        "decision",
        "reviewer_role",
        "rights_statement",
    ):
        if approval.get(key) != source_approval.get(key):
            raise ValueError(f"Reference approval changed source-approved field: {key}")

    rights_evidence = _object(manifest, "rights_evidence")
    _expect_keys(
        rights_evidence,
        {"approval_evidence_id", "grant", "release_surfaces", "source_approval_sha256"},
        "manifest rights evidence",
    )
    if (
        _string(rights_evidence, "approval_evidence_id") != OWNER_APPROVAL_EVIDENCE_ID
        or _string(rights_evidence, "grant")
        != "owner-approved scoped CC0 for rights Caatuu owns or may exercise"
        or _string_list(rights_evidence, "release_surfaces")
        != [
            "public GitHub source",
            "developer documentation",
            "offline modeling reference input",
        ]
        or _sha256_value(rights_evidence, "source_approval_sha256")
        != _sha256_value(review_evidence, "source_approval_sha256")
    ):
        raise ValueError("Reference manifest rights evidence is not approval-bound.")
    _verify_approved_input_identities(source_approval, manifest)


def _verify_source_approval_identity(
    source_approval: Mapping[str, object],
    review_path: Path,
) -> None:
    _expect_keys(
        source_approval,
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
        _string(source_approval, "format") != SOURCE_APPROVAL_FORMAT
        or _string(source_approval, "schema_version") != SCHEMA_VERSION
        or _string(source_approval, "package_id") != PACKAGE_ID
        or _string(source_approval, "ticket") != TICKET
        or _string(source_approval, "decision") != "approved"
        or _string(source_approval, "reviewer_role") != "product_owner"
        or _string(source_approval, "approval_evidence_id") != OWNER_APPROVAL_EVIDENCE_ID
        or _string(source_approval, "rights_statement") != RIGHTS_STATEMENT
    ):
        raise ValueError("Source approval identity or authority is invalid.")
    validate_utc_timestamp(_string(source_approval, "decided_at_utc"))
    review = _object(source_approval, "review")
    _expect_keys(review, {"path", "sha256"}, "source approval review identity")
    if _string(review, "path") != review_path.name or _sha256_value(
        review, "sha256"
    ) != sha256_file(review_path):
        raise ValueError("Source approval is not bound to the exact review record.")
    rights = _object(source_approval, "rights_confirmation")
    if rights != {
        "created_from_scratch_for_caatuu": True,
        "scope": "only_the_eight_exact_png_identities_listed_in_the_package_notice",
        "scoped_cc0_authorized": True,
    }:
        raise ValueError("Source approval rights confirmation is invalid.")
    provenance = _object(source_approval, "provenance_confirmation")
    if provenance != {
        "turnaround_authoring_tool": "OpenAI built-in image generation",
        "turnaround_generation_attempt": 2,
        "turnaround_inferred_content": True,
    }:
        raise ValueError("Source approval provenance confirmation is invalid.")
    scope = _object(source_approval, "accepted_scope")
    _verify_accepted_scope(scope)
    if _string_list(source_approval, "accepted_limitations") != _expected_accepted_limitations(
        scope
    ):
        raise ValueError("Source approval limitations are invalid.")


def _verify_accepted_scope(scope: Mapping[str, object]) -> None:
    _expect_keys(
        scope,
        {
            "foreground_height_range_px",
            "gait",
            "generated_views_remain_inferred_modeling_references",
            "maximum_visual_height_variance_percent",
            "prop_scope",
        },
        "approved scope",
    )
    if (
        _string(scope, "gait") != "anthropomorphic_traveler"
        or _object(scope, "prop_scope") != EXPECTED_PROP_SCOPE
        or not _boolean(scope, "generated_views_remain_inferred_modeling_references")
    ):
        raise ValueError("Reference approval scope is invalid.")
    height_range = _two_ints(
        _sequence(scope, "foreground_height_range_px"),
        "foreground_height_range_px",
    )
    variance = _number(scope, "maximum_visual_height_variance_percent")
    if variance != foreground_height_variance_percent(*height_range):
        raise ValueError("Reference approval height variance is invalid.")


def _expected_accepted_limitations(scope: Mapping[str, object]) -> list[str]:
    variance = _number(scope, "maximum_visual_height_variance_percent")
    minimum, maximum = _two_ints(
        _sequence(scope, "foreground_height_range_px"),
        "foreground_height_range_px",
    )
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


def _verify_approved_input_identities(
    source_approval: Mapping[str, object],
    manifest: Mapping[str, object],
) -> None:
    expected: list[dict[str, str]] = []
    for record in _object_list(manifest, "sources"):
        expected.append(
            {
                "id": _string(record, "id"),
                "source_path": _string(record, "repository_source_path"),
                "sha256": _sha256_value(record, "sha256"),
            }
        )
    sheet = _object(manifest, "combined_review_sheet")
    expected.append(
        {
            "id": "turnaround",
            "source_path": _string(sheet, "original_review_filename"),
            "sha256": _sha256_value(sheet, "sha256"),
        }
    )
    approved = _object_list(source_approval, "approved_inputs")
    for record in approved:
        _expect_keys(record, {"id", "sha256", "source_path"}, "approved input")
        _sha256_value(record, "sha256")
    if approved != expected:
        raise ValueError("Source approval is not bound to the exact package inputs.")


def _verify_png_record(path: Path, record: Mapping[str, object]) -> None:
    with Image.open(BytesIO(read_regular_file_bytes(path))) as decoded:
        if decoded.format != "PNG":
            raise ValueError(f"Reference image is not a PNG: {path.name}")
        if (
            decoded.width > MAX_IMAGE_DIMENSION
            or decoded.height > MAX_IMAGE_DIMENSION
            or decoded.width * decoded.height > MAX_IMAGE_PIXELS
        ):
            raise ValueError(f"Reference image exceeds the dimension limit: {path.name}")
        if decoded.mode != _string(record, "mode"):
            raise ValueError(f"Reference image mode mismatch: {path.name}")
        if decoded.width != _integer(record, "width_px") or decoded.height != _integer(
            record, "height_px"
        ):
            raise ValueError(f"Reference image dimensions mismatch: {path.name}")
        decoded.load()


def _declared_file(root: Path, files: Mapping[str, Path], value: str) -> Path:
    relative = _safe_relative_path(value)
    normalized = relative.as_posix()
    if normalized not in files:
        raise ValueError(f"Reference package declares an unavailable path: {value}")
    candidate = files[normalized]
    try:
        candidate.resolve(strict=True).relative_to(root)
    except (OSError, ValueError) as error:
        raise ValueError(f"Reference package path escaped its root: {value}") from error
    return candidate


def _safe_relative_path(value: str) -> PurePosixPath:
    if "\\" in value:
        raise ValueError(f"Reference package path must use '/' separators: {value}")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"Reference package path is unsafe: {value}")
    return path


def _json_object(path: Path) -> dict[str, object]:
    return _decode_json_object(path, read_regular_file_bytes(path))


def _decode_json_object(path: Path, payload: bytes) -> dict[str, object]:
    try:
        document = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to decode JSON: {path.name}") from error
    if not isinstance(document, dict) or not all(isinstance(key, str) for key in document):
        raise ValueError(f"JSON document must be an object: {path.name}")
    return document


def _canonical_json_object(path: Path) -> dict[str, object]:
    payload = read_regular_file_bytes(path)
    document = _decode_json_object(path, payload)
    if payload != canonical_json_bytes(document):
        raise ValueError(f"JSON document is not canonically encoded: {path.name}")
    return document


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


def read_regular_file_bytes(path: Path) -> bytes:
    """Read one stable, bounded regular-file snapshot through a no-follow descriptor."""
    _reject_link_like_ancestors(path)
    try:
        before = path.stat(follow_symlinks=False)
    except OSError as error:
        raise ValueError(f"Unable to inspect regular file: {path}") from error
    _validate_regular_file_status(before, path)

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError(f"Unable to open regular file without following links: {path}") from error
    try:
        opened = os.fstat(descriptor)
        _validate_regular_file_status(opened, path)
        if not os.path.samestat(before, opened):
            raise ValueError(f"Regular file changed before it could be opened: {path}")
        blocks: list[bytes] = []
        total = 0
        while True:
            block = os.read(descriptor, 1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > MAX_FILE_BYTES:
                raise ValueError(f"Regular file exceeds the byte limit: {path}")
            blocks.append(block)
        after = os.fstat(descriptor)
        if (
            not os.path.samestat(opened, after)
            or after.st_size != opened.st_size
            or after.st_mtime_ns != opened.st_mtime_ns
            or total != after.st_size
        ):
            raise ValueError(f"Regular file changed while it was read: {path}")
    finally:
        os.close(descriptor)

    if _is_link_like(path):
        raise ValueError(f"Regular file path became a link or junction while read: {path}")
    try:
        current = path.stat(follow_symlinks=False)
    except OSError as error:
        raise ValueError(f"Regular file disappeared while it was read: {path}") from error
    if not os.path.samestat(opened, current):
        raise ValueError(f"Regular file path changed while it was read: {path}")
    return b"".join(blocks)


def _validate_regular_file_status(status: os.stat_result, path: Path) -> None:
    if not stat.S_ISREG(status.st_mode):
        raise ValueError(f"Expected regular file: {path}")
    if status.st_nlink != 1:
        raise ValueError(f"Regular file must not be hard-linked: {path}")
    if status.st_size > MAX_FILE_BYTES:
        raise ValueError(f"Regular file exceeds the byte limit: {path}")


def _reject_link_like_ancestors(path: Path, *, stop: Path | None = None) -> None:
    cursor = path.absolute()
    stop_at = stop.absolute() if stop is not None else None
    while True:
        if _is_link_like(cursor):
            raise ValueError(f"Path contains a link or junction: {cursor}")
        if cursor == stop_at or cursor.parent == cursor:
            return
        cursor = cursor.parent


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


def _sequence(mapping: Mapping[str, object], key: str) -> list[object]:
    value = mapping.get(key)
    if not isinstance(value, list):
        raise ValueError(f"Expected array at {key}.")
    return value


def _string(mapping: Mapping[str, object], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str):
        raise ValueError(f"Expected string at {key}.")
    return value


def _string_list(mapping: Mapping[str, object], key: str) -> list[str]:
    value = _sequence(mapping, key)
    if not all(isinstance(item, str) for item in value):
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


def _two_ints(values: Sequence[object], location: str) -> tuple[int, int]:
    if len(values) != 2 or not all(
        isinstance(value, int) and not isinstance(value, bool) for value in values
    ):
        raise ValueError(f"Expected two integers at {location}.")
    return values[0], values[1]  # type: ignore[return-value]


def _four_ints(values: Sequence[object], location: str) -> tuple[int, int, int, int]:
    if len(values) != 4 or not all(
        isinstance(value, int) and not isinstance(value, bool) for value in values
    ):
        raise ValueError(f"Expected four integers at {location}.")
    return values[0], values[1], values[2], values[3]  # type: ignore[return-value]
