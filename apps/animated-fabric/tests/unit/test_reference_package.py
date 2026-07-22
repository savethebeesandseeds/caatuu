from __future__ import annotations

import json
import os
import shutil
from collections.abc import Callable
from pathlib import Path

import pytest
from PIL import Image

from scripts.prepare_macaw_reference_package import (
    PARTS_PROMPT_SOURCE,
    SPLIT_EVIDENCE_SOURCE,
    main,
    prepare_macaw_reference_package,
)
from tools import reference_package
from tools.reference_package import (
    EXPECTED_FILE_PATHS,
    EXPECTED_PROP_SCOPE,
    GROUND_ROW_PX,
    MAX_FILE_BYTES,
    MAX_IMAGE_DIMENSION,
    OWNER_APPROVAL_EVIDENCE_ID,
    RIGHTS_STATEMENT,
    SOURCE_APPROVAL_FORMAT,
    VIEW_ORDER,
    canonical_json_bytes,
    foreground_height_variance_percent,
    sha256_file,
    verify_reference_package,
)

DECIDED_AT = "2026-07-22T05:01:45Z"


def _write_png(path: Path, mode: str, size: tuple[int, int], color: tuple[int, ...]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new(mode, size, color).save(path, format="PNG", compress_level=9)


def _write_sheet(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGB", (20, 704))
    pixels = sheet.load()
    assert pixels is not None
    for y in range(sheet.height):
        for x in range(sheet.width):
            pixels[x, y] = ((x * 11 + y) % 256, (x * 7 + y * 3) % 256, (x + y * 5) % 256)
    sheet.save(path, format="PNG", compress_level=9)


def _fixture(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    repository = tmp_path / "repository"
    review_root = tmp_path / "review"
    destination = tmp_path / "package"

    neutral_relative = (
        "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/layers/neutral-reference.png"
    )
    parts_relative = (
        "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/"
        "originals/macaw-traveler-parts-sheet-v1.png"
    )
    walk_relative = "apps/launcher/static/assets/macaw/walk/originals/macaw-walk-sheet-v1.png"
    rig_relative = "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/rig.json"
    prompt_relative = (
        "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/generation-prompt.md"
    )
    split_relative = (
        "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/"
        "split_manifest.candidate-v1.json"
    )
    split_neutral_relative = (
        "apps/launcher/static/assets/character-rigs/macaw-traveler-v1/"
        "split-candidate-v1/macaw-traveler-part_012.png"
    )

    neutral = repository.joinpath(*neutral_relative.split("/"))
    parts = repository.joinpath(*parts_relative.split("/"))
    walk = repository.joinpath(*walk_relative.split("/"))
    rig = repository.joinpath(*rig_relative.split("/"))
    prompt = repository.joinpath(*prompt_relative.split("/"))
    split = repository.joinpath(*split_relative.split("/"))
    split_neutral = repository.joinpath(*split_neutral_relative.split("/"))
    _write_png(neutral, "RGBA", (377, 414), (10, 90, 130, 255))
    _write_png(parts, "RGB", (16, 12), (120, 30, 90))
    _write_png(walk, "RGB", (18, 10), (80, 110, 20))
    rig.parent.mkdir(parents=True, exist_ok=True)
    rig.write_text('{"legacy": true}\n', encoding="utf-8")
    prompt.write_text("# Historical prompt\n", encoding="utf-8")
    split.write_text(
        json.dumps(
            {
                "sprites": [
                    {
                        "index": 12,
                        "output_size": [377, 414],
                        "source_slot": 12,
                    }
                ],
                "warnings": [],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    split_neutral.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(neutral, split_neutral)

    candidate = review_root / "turnaround.png"
    _write_sheet(candidate)
    review = {
        "approval": None,
        "format": "animated-fabric.reference-review.v1",
        "gait": "anthropomorphic_traveler",
        "prop_scope": {
            "requires_approval": True,
            "staff": "separate_prop_excluded_from_base_actor_and_first_walk",
        },
        "schema_version": "0.1.0",
        "source_evidence": [
            {
                "path": neutral_relative,
                "role": "identity_and_assembled_proportions",
                "sha256": sha256_file(neutral),
            },
            {
                "path": parts_relative,
                "role": "component_and_joint_intent",
                "sha256": sha256_file(parts),
            },
            {
                "path": walk_relative,
                "role": "anthropomorphic_gait_reference",
                "sha256": sha256_file(walk),
            },
            {
                "path": rig_relative,
                "role": "existing_articulation_intent",
                "sha256": sha256_file(rig),
            },
        ],
        "status": "candidate",
        "ticket": "AF-054",
        "turnaround": {
            "file": candidate.name,
            "generation": {
                "attempt": 2,
                "authoring_tool": "OpenAI built-in image generation",
                "inferred_content": True,
            },
            "height_px": 704,
            "normalization_review": {
                "candidate_ground_row_px": 664,
                "crop_and_padding_preserve_source_pixels": True,
                "foreground_height_range_px": [645, 655],
                "maximum_scale_drift_percent": 1.55,
                "scale_normalization_requires_resampling_or_corrected_art": True,
            },
            "sha256": sha256_file(candidate),
            "view_convention": {
                "actor_forward_axis": "+Y",
                "actor_right_axis": "+X",
                "back_camera_axis": "-Y",
                "front_camera_axis": "+Y",
                "left_beak_points": "screen_left",
                "left_camera_axis": "-X",
                "right_beak_points": "screen_right",
                "right_camera_axis": "+X",
                "up_axis": "+Z",
            },
            "views": [
                {
                    "candidate_crop_xywh": [0, 0, 8, 704],
                    "foreground_bounds_xywh": [1, 10, 6, 655],
                    "id": "front",
                },
                {
                    "candidate_crop_xywh": [8, 0, 7, 704],
                    "foreground_bounds_xywh": [9, 20, 5, 645],
                    "id": "left",
                },
                {
                    "candidate_crop_xywh": [0, 0, 6, 704],
                    "foreground_bounds_xywh": [1, 15, 4, 650],
                    "id": "back",
                },
                {
                    "candidate_crop_xywh": [15, 0, 5, 704],
                    "foreground_bounds_xywh": [15, 18, 5, 647],
                    "id": "right",
                },
            ],
            "width_px": 20,
        },
        "unresolved_inferences": ["hidden geometry remains inferred"],
    }
    review_path = review_root / "review.json"
    review_path.write_text(json.dumps(review, indent=2) + "\n", encoding="utf-8")
    approval_path = review_root / "source-approval.json"
    approval = {
        "accepted_limitations": [
            "The four generated views remain inferred modeling references, not recovered geometry.",
            (
                "The disclosed 645-655 px silhouette-height variance (maximum 1.55%) is accepted "
                "at one common 1:1 sheet scale."
            ),
            (
                "Tail, talon, hand, toe, backpack, hidden joint, and rear-surface details require "
                "modeling judgment."
            ),
        ],
        "accepted_scope": {
            "foreground_height_range_px": [645, 655],
            "gait": "anthropomorphic_traveler",
            "generated_views_remain_inferred_modeling_references": True,
            "maximum_visual_height_variance_percent": 1.55,
            "prop_scope": EXPECTED_PROP_SCOPE,
        },
        "approval_evidence_id": OWNER_APPROVAL_EVIDENCE_ID,
        "approved_inputs": [
            {
                "id": "identity-neutral-reference",
                "sha256": sha256_file(neutral),
                "source_path": neutral_relative,
            },
            {
                "id": "prepared-parts-sheet",
                "sha256": sha256_file(parts),
                "source_path": parts_relative,
            },
            {
                "id": "prepared-parts-prompt",
                "sha256": sha256_file(prompt),
                "source_path": PARTS_PROMPT_SOURCE,
            },
            {
                "id": "prepared-parts-split-evidence",
                "sha256": sha256_file(split),
                "source_path": SPLIT_EVIDENCE_SOURCE,
            },
            {
                "id": "legacy-rig",
                "sha256": sha256_file(rig),
                "source_path": rig_relative,
            },
            {
                "id": "side-walk-sheet",
                "sha256": sha256_file(walk),
                "source_path": walk_relative,
            },
            {
                "id": "turnaround",
                "sha256": sha256_file(candidate),
                "source_path": candidate.name,
            },
        ],
        "decided_at_utc": DECIDED_AT,
        "decision": "approved",
        "format": SOURCE_APPROVAL_FORMAT,
        "package_id": "macaw-traveler-v1",
        "provenance_confirmation": {
            "turnaround_authoring_tool": "OpenAI built-in image generation",
            "turnaround_generation_attempt": 2,
            "turnaround_inferred_content": True,
        },
        "review": {
            "path": review_path.name,
            "sha256": sha256_file(review_path),
        },
        "reviewer_role": "product_owner",
        "rights_confirmation": {
            "created_from_scratch_for_caatuu": True,
            "scope": "only_the_eight_exact_png_identities_listed_in_the_package_notice",
            "scoped_cc0_authorized": True,
        },
        "rights_statement": RIGHTS_STATEMENT,
        "schema_version": "0.1.0",
        "ticket": "AF-054",
    }
    approval_path.write_bytes(canonical_json_bytes(approval))
    return repository, review_path, approval_path, destination


def _prepare(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    repository, review, approval, destination = _fixture(tmp_path)
    prepare_macaw_reference_package(
        review,
        approval,
        repository,
        destination,
    )
    return repository, review, approval, destination


def _tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def _write_canonical(path: Path, document: object) -> None:
    path.write_bytes(canonical_json_bytes(document))


def _set_nested(document: dict[str, object], path: tuple[str, ...], value: object) -> None:
    cursor = document
    for key in path[:-1]:
        child = cursor[key]
        assert isinstance(child, dict)
        cursor = child
    cursor[path[-1]] = value


def test_preparer_is_idempotent_and_preserves_exact_sources_and_crop_pixels(
    tmp_path: Path,
) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    repository_snapshot = _tree_bytes(repository)
    review_snapshot = _tree_bytes(review.parent)

    first = prepare_macaw_reference_package(
        review,
        approval,
        repository,
        destination,
    )
    first_bytes = _tree_bytes(destination)
    second = prepare_macaw_reference_package(
        review,
        approval,
        repository,
        destination,
    )

    assert first == second
    assert _tree_bytes(destination) == first_bytes
    assert _tree_bytes(repository) == repository_snapshot
    assert _tree_bytes(review.parent) == review_snapshot
    assert set(first_bytes) == EXPECTED_FILE_PATHS
    assert (
        first.ordered_view_set_sha256
        == json.loads((destination / "reference.json").read_text(encoding="utf-8"))[
            "ordered_view_set"
        ]["sha256"]
    )

    review_document = json.loads(review.read_text(encoding="utf-8"))
    with Image.open(review.parent / "turnaround.png") as sheet:
        sheet.load()
        for view in review_document["turnaround"]["views"]:
            x, y, width, height = view["candidate_crop_xywh"]
            left_padding = (512 - width) // 2
            right_padding = 512 - width - left_padding
            with Image.open(destination / "views" / f"{view['id']}.png") as actual:
                actual.load()
                assert actual.mode == "RGB"
                assert actual.size == (512, 704)
                assert (
                    actual.crop((left_padding, 0, left_padding + width, height)).tobytes()
                    == sheet.crop((x, y, x + width, y + height)).tobytes()
                )
                for row in (0, height // 2, height - 1):
                    left_edge = sheet.getpixel((x, y + row))
                    right_edge = sheet.getpixel((x + width - 1, y + row))
                    if left_padding:
                        assert actual.getpixel((0, row)) == left_edge
                        assert actual.getpixel((left_padding - 1, row)) == left_edge
                    if right_padding:
                        assert actual.getpixel((left_padding + width, row)) == right_edge
                        assert actual.getpixel((511, row)) == right_edge
                foreground_y = view["foreground_bounds_xywh"][1]
                foreground_height = view["foreground_bounds_xywh"][3]
                assert foreground_y + foreground_height - y - 1 == GROUND_ROW_PX

    assert (destination / "sources" / "identity" / "neutral-reference.png").read_bytes() == (
        repository
        / "apps"
        / "launcher"
        / "static"
        / "assets"
        / "character-rigs"
        / "macaw-traveler-v1"
        / "layers"
        / "neutral-reference.png"
    ).read_bytes()


def test_verifier_rejects_tampering_reordering_and_extra_files(tmp_path: Path) -> None:
    _repository, _review, _approval, destination = _prepare(tmp_path)
    mutations: list[tuple[str, Callable[[Path], None], str]] = [
        (
            "view",
            lambda root: (root / "views" / "front.png").write_bytes(b"tampered"),
            "view hash mismatch",
        ),
        (
            "source",
            lambda root: (root / "sources" / "side-walk" / "macaw-walk-sheet-v1.png").write_bytes(
                b"tampered"
            ),
            "source hash mismatch",
        ),
        (
            "extra",
            lambda root: (root / "unexpected.txt").write_text("extra", encoding="utf-8"),
            "file set mismatch",
        ),
    ]
    for name, mutate, message in mutations:
        candidate = tmp_path / f"tamper-{name}"
        shutil.copytree(destination, candidate)
        mutate(candidate)
        with pytest.raises(ValueError, match=message):
            verify_reference_package(candidate)

    reordered = tmp_path / "reordered"
    shutil.copytree(destination, reordered)
    manifest_path = reordered / "reference.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["views"][0], manifest["views"][1] = manifest["views"][1], manifest["views"][0]
    _write_canonical(manifest_path, manifest)
    with pytest.raises(ValueError, match="view order"):
        verify_reference_package(reordered)


@pytest.mark.parametrize(
    ("field_path", "value", "message"),
    [
        (("manifest", "sha256"), "0" * 64, "exact manifest"),
        (("ordered_view_set", "sha256"), "0" * 64, "ordered view set"),
        (("decision",), "rejected", "does not authorize"),
        (("reviewer_role",), "contributor", "reviewer role"),
        (("decided_at_utc",), "2026-07-22T05:01Z", "second-precision"),
        (("decided_at_utc",), "2026-02-30T05:01:45Z", "real UTC date"),
        (("approval_evidence_id",), "forged", "rights evidence"),
        (("rights_statement",), "changed", "rights evidence"),
        (
            ("accepted_scope", "generated_views_remain_inferred_modeling_references"),
            False,
            "approval scope",
        ),
        (("accepted_limitations",), [], "approval limitations"),
        (("source_approval", "sha256"), "0" * 64, "source approval"),
    ],
    ids=[
        "manifest-hash",
        "view-set-hash",
        "decision",
        "reviewer-role",
        "timestamp-shape",
        "timestamp-date",
        "evidence-id",
        "rights-statement",
        "scope",
        "limitations",
        "source-approval-hash",
    ],
)
def test_approval_rejects_tampered_authority_and_bindings(
    tmp_path: Path,
    field_path: tuple[str, ...],
    value: object,
    message: str,
) -> None:
    _repository, _review, _source_approval, destination = _prepare(tmp_path)
    approval_path = destination / "approval.json"
    approval = json.loads(approval_path.read_text(encoding="utf-8"))
    _set_nested(approval, field_path, value)
    _write_canonical(approval_path, approval)

    with pytest.raises(ValueError, match=message):
        verify_reference_package(destination)


def test_preparer_rejects_traversal_duplicate_keys_and_changed_sources(tmp_path: Path) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    document = json.loads(review.read_text(encoding="utf-8"))
    document["source_evidence"][0]["path"] = "../outside.png"
    review.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="unsafe"):
        prepare_macaw_reference_package(
            review,
            approval,
            repository,
            destination,
        )

    repository, review, approval, destination = _fixture(tmp_path / "duplicate")
    duplicate = review.read_text(encoding="utf-8").replace(
        "{", '{\n  "format": "animated-fabric.reference-review.v1",', 1
    )
    review.write_text(duplicate, encoding="utf-8")
    with pytest.raises(ValueError, match="Duplicate JSON key"):
        prepare_macaw_reference_package(
            review,
            approval,
            repository,
            destination,
        )

    repository, review, approval, destination = _fixture(tmp_path / "changed")
    source = (
        repository
        / "apps"
        / "launcher"
        / "static"
        / "assets"
        / "macaw"
        / "walk"
        / "originals"
        / "macaw-walk-sheet-v1.png"
    )
    source.write_bytes(b"changed")
    with pytest.raises(ValueError, match="source hash mismatch"):
        prepare_macaw_reference_package(
            review,
            approval,
            repository,
            destination,
        )
    assert not destination.exists()


def test_preparer_rejects_duplicate_source_roles(tmp_path: Path) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    document = json.loads(review.read_text(encoding="utf-8"))
    document["source_evidence"].append(dict(document["source_evidence"][0]))
    review.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="incomplete or duplicated"):
        prepare_macaw_reference_package(review, approval, repository, destination)


def test_preparer_computes_and_enforces_height_variance(tmp_path: Path) -> None:
    assert foreground_height_variance_percent(645, 655) == 1.55
    repository, review, approval, destination = _fixture(tmp_path)
    document = json.loads(review.read_text(encoding="utf-8"))
    document["turnaround"]["normalization_review"]["maximum_scale_drift_percent"] = 1.65
    review.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="normalization disclosure"):
        prepare_macaw_reference_package(review, approval, repository, destination)


def test_verifier_rejects_height_disclosure_not_bound_to_review(tmp_path: Path) -> None:
    _repository, _review, _approval, destination = _prepare(tmp_path)
    manifest_path = destination / "reference.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["common_view"]["observed_foreground_height_range_px"] = [645, 645]
    manifest["common_view"]["approved_maximum_visual_height_variance_percent"] = 0.0
    _write_canonical(manifest_path, manifest)

    with pytest.raises(ValueError, match="normalization differs from the approved review"):
        verify_reference_package(destination)


def test_verifier_binds_machine_manifest_to_exact_human_review(tmp_path: Path) -> None:
    _repository, _review, _approval, destination = _prepare(tmp_path)
    manifest_path = destination / "reference.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["unresolved_inferences"] = []
    _write_canonical(manifest_path, manifest)
    approval_path = destination / "approval.json"
    machine_approval = json.loads(approval_path.read_text(encoding="utf-8"))
    machine_approval["manifest"]["sha256"] = sha256_file(manifest_path)
    _write_canonical(approval_path, machine_approval)

    with pytest.raises(ValueError, match="unresolved inferences differ"):
        verify_reference_package(destination)


def test_preparer_rejects_unapproved_prompt_and_split_evidence_drift(tmp_path: Path) -> None:
    for name in ("prompt", "split"):
        repository, review, approval, destination = _fixture(tmp_path / name)
        if name == "prompt":
            path = repository.joinpath(*PARTS_PROMPT_SOURCE.split("/"))
            path.write_text("# Changed historical prompt\n", encoding="utf-8")
        else:
            path = repository.joinpath(*SPLIT_EVIDENCE_SOURCE.split("/"))
            document = json.loads(path.read_text(encoding="utf-8"))
            document["unapproved_note"] = "changed"
            path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

        with pytest.raises(ValueError, match="exact approved inputs"):
            prepare_macaw_reference_package(review, approval, repository, destination)
        assert not destination.exists()


def test_preparer_requires_canonical_source_approval(tmp_path: Path) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    document = json.loads(approval.read_text(encoding="utf-8"))
    approval.write_text(json.dumps(document, indent=4) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="not canonically encoded"):
        prepare_macaw_reference_package(review, approval, repository, destination)


def test_preparer_rejects_oversized_turnaround_before_decoding_pixels(tmp_path: Path) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    turnaround = review.parent / "turnaround.png"
    Image.new("RGB", (MAX_IMAGE_DIMENSION + 1, 1), (255, 255, 255)).save(
        turnaround,
        format="PNG",
    )
    document = json.loads(review.read_text(encoding="utf-8"))
    document["turnaround"]["width_px"] = MAX_IMAGE_DIMENSION + 1
    document["turnaround"]["height_px"] = 1
    document["turnaround"]["sha256"] = sha256_file(turnaround)
    review.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="exceeds the dimension limit"):
        prepare_macaw_reference_package(review, approval, repository, destination)


@pytest.mark.parametrize("input_name", ["review", "approval"])
def test_preparer_rejects_oversized_json_inputs(tmp_path: Path, input_name: str) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    target = review if input_name == "review" else approval
    target.write_bytes(b" " * (MAX_FILE_BYTES + 1))

    with pytest.raises(ValueError, match="exceeds the byte limit"):
        prepare_macaw_reference_package(review, approval, repository, destination)


def test_preparer_rejects_linked_input_and_destination_parents(tmp_path: Path) -> None:
    repository, review, approval, _destination = _fixture(tmp_path / "fixture")
    linked_review_parent = tmp_path / "linked-review"
    real_output_parent = tmp_path / "real-output"
    linked_output_parent = tmp_path / "linked-output"
    real_output_parent.mkdir()
    try:
        linked_review_parent.symlink_to(review.parent, target_is_directory=True)
        linked_output_parent.symlink_to(real_output_parent, target_is_directory=True)
    except OSError:
        pytest.skip("Filesystem does not permit directory symbolic links.")

    with pytest.raises(ValueError, match="contains a link or junction"):
        prepare_macaw_reference_package(
            linked_review_parent / review.name,
            approval,
            repository,
            tmp_path / "unused-output" / "package",
        )
    with pytest.raises(ValueError, match="contains a link or junction"):
        prepare_macaw_reference_package(
            review,
            approval,
            repository,
            linked_output_parent / "package",
        )


def test_preparer_rejects_hard_linked_approval_input(tmp_path: Path) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    hard_link = approval.parent / "hard-linked-approval.json"
    try:
        os.link(approval, hard_link)
    except OSError:
        pytest.skip("Filesystem does not permit hard links.")

    with pytest.raises(ValueError, match="hard-linked"):
        prepare_macaw_reference_package(review, hard_link, repository, destination)


def test_verifier_rejects_a_package_changed_during_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repository, _review, _approval, destination = _prepare(tmp_path)
    original_reader = reference_package.read_regular_file_bytes
    changed = False

    def mutate_after_snapshot(path: Path) -> bytes:
        nonlocal changed
        payload = original_reader(path)
        if (
            not changed
            and path.is_relative_to(destination)
            and path.relative_to(destination).as_posix() == "views/front.png"
        ):
            path.write_bytes(b"changed after snapshot")
            changed = True
        return payload

    monkeypatch.setattr(reference_package, "read_regular_file_bytes", mutate_after_snapshot)
    with pytest.raises(ValueError, match="changed during verification"):
        verify_reference_package(destination)
    assert changed


def test_preparer_never_replaces_a_different_valid_versioned_package(tmp_path: Path) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    prepare_macaw_reference_package(
        review,
        approval,
        repository,
        destination,
    )
    previous = _tree_bytes(destination)
    changed_approval = json.loads(approval.read_text(encoding="utf-8"))
    changed_approval["decided_at_utc"] = "2026-07-22T06:00:00Z"
    _write_canonical(approval, changed_approval)

    with pytest.raises(ValueError, match="Refusing to replace"):
        prepare_macaw_reference_package(
            review,
            approval,
            repository,
            destination,
        )

    assert _tree_bytes(destination) == previous
    assert list(destination.parent.glob(f".{destination.name}.stage-*")) == []


def test_verifier_rejects_symbolic_links(tmp_path: Path) -> None:
    _repository, _review, _approval, destination = _prepare(tmp_path)
    symlink_package = tmp_path / "symlink-package"
    shutil.copytree(destination, symlink_package)
    target = symlink_package / "views" / "front.png"
    external = tmp_path / "outside.png"
    shutil.copyfile(target, external)
    target.unlink()
    try:
        target.symlink_to(external)
    except OSError:
        pytest.skip("Filesystem does not permit symbolic links.")
    with pytest.raises(ValueError, match="link or junction"):
        verify_reference_package(symlink_package)


def test_verifier_rejects_hard_links(tmp_path: Path) -> None:
    _repository, _review, _approval, destination = _prepare(tmp_path)
    hardlink_package = tmp_path / "hardlink-package"
    shutil.copytree(destination, hardlink_package)
    target = hardlink_package / "views" / "front.png"
    external_hardlink = tmp_path / "outside-hardlink.png"
    shutil.copyfile(target, external_hardlink)
    target.unlink()
    try:
        os.link(external_hardlink, target)
    except OSError:
        pytest.skip("Filesystem does not permit hard links.")
    with pytest.raises(ValueError, match="hard-linked"):
        verify_reference_package(hardlink_package)


def test_cli_reports_success_and_tampering_without_exposing_a_traceback(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    repository, review, approval, destination = _fixture(tmp_path)
    assert (
        main(
            [
                "prepare",
                "--review",
                str(review),
                "--approval",
                str(approval),
                "--source-repository-root",
                str(repository),
                "--out",
                str(destination),
            ]
        )
        == 0
    )
    output = capsys.readouterr()
    assert "Prepared AF-054 reference package" in output.out
    assert "Manifest SHA-256" in output.out

    (destination / "approval.json").write_bytes(b"broken")
    assert main(["verify", "--package", str(destination)]) == 5
    output = capsys.readouterr()
    assert "AF-054 reference package operation failed" in output.err
    assert "Traceback" not in output.err


def test_tracked_package_has_pinned_approved_identity() -> None:
    package = (
        Path(__file__).resolve().parents[2] / "assets" / "reference-packages" / "macaw-traveler-v1"
    )
    assert package.is_dir(), "The acceptance-critical AF-054 package must remain tracked."
    verified = verify_reference_package(package)
    assert (
        verified.manifest_sha256
        == "a88520b026a4c48b98c6b50785fe49ffa60d01f1e94157650dbfbbb754b11f77"
    )
    assert (
        verified.approval_sha256
        == "e6dc9202b6608ab5821c2fb9c76811a5a69296061bf20314b6c7ea3bafa142bc"
    )
    assert (
        verified.ordered_view_set_sha256
        == "3c625d9ff3e87567d2e1eb2878866243629c2af18ed0af011fe2526c2aee9311"
    )
    assert tuple(path.stem for path in verified.ordered_view_paths) == VIEW_ORDER
