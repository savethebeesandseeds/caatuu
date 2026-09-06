#!/usr/bin/env python3
"""Normalize reviewed RGBA frames and build editable strips in a fresh directory.

Run with Pillow in the established Tukevejtso container. Input is a read-only
snapshot containing manifest.json and its images; this never edits that input.
"""
import argparse
import copy
import hashlib
import json
import math
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw

CELL = 512
BASELINE = 480
AUTHORED = ("S", "N", "E", "SE", "NE")
ACTIONS = ("idle", "walk", "run")
DIRECTION_SOURCES = {"S": "S", "N": "N", "E": "E", "SE": "SE", "NE": "NE", "W": "E", "SW": "SE", "NW": "NE"}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def area(image):
    return sum(value * count / 255 for value, count in enumerate(image.getchannel("A").histogram()))


def alpha_metadata(image):
    histogram = image.getchannel("A").histogram()
    return {"has_alpha_channel": True, "transparent_fraction": histogram[0] / (CELL * CELL),
            "partial_fraction": sum(histogram[1:255]) / (CELL * CELL)}


def ordered_frames(frames, direction, action):
    return sorted((frame for frame in frames if frame["direction"] == direction and
                   (action == "all" or frame["action"] == action)),
                  key=lambda frame: (ACTIONS.index(frame["action"]), frame["phase"]))


def preview(source, output, frames):
    # Same display scale in every cell: never fit individual bounding boxes.
    sheet = Image.new("RGB", (10 * 184, 3 * 210), "#152724")
    draw = ImageDraw.Draw(sheet)
    for row, action in enumerate(ACTIONS):
        for column, direction in enumerate(AUTHORED):
            frame = ordered_frames(frames, direction, action)[0]
            for version, root in enumerate((source, output)):
                im = Image.open(root / frame["file"]).convert("RGBA")
                im = im.resize((176, 176), Image.Resampling.NEAREST)
                x, y = (column * 2 + version) * 184, row * 210
                sheet.paste(im, (x + 4, y + 10), im)
                draw.text((x + 5, y + 188), f"{direction} {action} {'before' if version == 0 else 'after'}", fill="#eed09c")
    sheet.save(output / "mass-comparison.png")


def normalize(source, output, target_area, source_revision, source_archive):
    source, output = source.resolve(), output.resolve()
    if output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Source and output directories must not overlap.")
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8-sig"))
    if manifest.get("normalization"):
        raise ValueError("Use the pre-normalization snapshot to avoid compounding resampling.")
    if output.exists():
        raise ValueError("Output must be a new isolated directory.")
    frames = manifest["frames"]
    expected_ids = {f"{direction}-idle" for direction in AUTHORED}
    expected_ids |= {f"{direction}-{action}-{phase:02d}" for direction in AUTHORED
                     for action, count in (("walk", 4), ("run", 6)) for phase in range(1, count + 1)}
    if len(frames) != 55 or {frame["id"] for frame in frames} != expected_ids:
        raise ValueError("Expected the complete 55-frame macaw set.")
    directions = manifest.get("directions", [])
    if len(directions) != 8 or {entry.get("id") for entry in directions} != set(DIRECTION_SOURCES):
        raise ValueError("Expected exactly eight canonical direction mappings.")
    for entry in directions:
        origin = DIRECTION_SOURCES[entry["id"]]
        if entry.get("source") != origin or entry.get("mirror") is not (origin != entry["id"]):
            raise ValueError("Incorrect source or mirror in direction mapping.")
    images, groups = {}, {}
    seen_paths = set()
    for frame in frames:
        parts = frame["id"].split("-")
        if (frame["direction"], frame["action"], frame["phase"]) != (parts[0], parts[1], int(parts[2]) if len(parts) == 3 else 0):
            raise ValueError(f"Frame metadata mismatch: {frame['id']}")
        relative = frame.get("file", "")
        if not isinstance(relative, str) or not re.fullmatch(rf"images/{re.escape(frame['id'].lower())}-sheet-v[12]\.png", relative) or relative in seen_paths:
            raise ValueError(f"Unsafe or duplicate frame path: {frame['id']}")
        seen_paths.add(relative)
        path = (source / frame["file"]).resolve()
        if not path.is_relative_to(source.resolve()) or sha256(path) != frame["sha256"]:
            raise ValueError(f"Unsafe path or changed source: {frame['id']}")
        image = Image.open(path)
        if image.mode != "RGBA" or image.size != (CELL, CELL) or not image.getchannel("A").getbbox():
            raise ValueError(f"Expected a nonempty 512-square RGBA frame: {frame['id']}")
        images[frame["id"]] = image.copy()
        # Standing shares the walking factor, avoiding a size jump when stopping.
        group = f"{frame['direction']}-{'run' if frame['action'] == 'run' else 'walk'}"
        groups.setdefault(group, []).append(frame["id"])
    summary = []
    factors = {}
    for group, ids in groups.items():
        median = statistics.median(area(images[identity]) for identity in ids)
        factor = math.sqrt(target_area / median)
        summary.append({"group": group, "frame_ids": ids, "source_median_area": round(median, 3),
                        "scale": factor})
        for identity in ids:
            factors[identity] = factor

    # Preflight every transformed bound before creating any output.
    prepared, records = {}, []
    for frame in frames:
        identity = frame["id"]
        image, factor = images[identity], factors[identity]
        bounds = image.getchannel("A").getbbox()
        prior = copy.deepcopy(frame["registration"])
        lift = prior.get("flight_lift", 0)
        anchor_x = prior.get("head_anchor_x", CELL / 2)
        baseline = BASELINE - lift
        if bounds[3] != baseline:
            raise ValueError(f"Unexpected foot anchor: {identity}")
        crop = image.crop(bounds)
        size = tuple(round(length * factor) for length in crop.size)
        scaled = crop.resize(size, Image.Resampling.NEAREST)
        left = round(anchor_x + (bounds[0] - anchor_x) * factor)
        top = baseline - size[1]
        transformed = [left, top, left + size[0], baseline]
        if min(left, top, CELL - transformed[2], CELL - transformed[3]) < 8:
            raise ValueError(f"Insufficient canvas margin for {identity}: {transformed}; lower common target area.")
        result = Image.new("RGBA", (CELL, CELL))
        result.paste(scaled, (left, top))
        actual_bounds = list(result.getchannel("A").getbbox())
        if actual_bounds != transformed:
            raise ValueError(f"Resampling lost an anchor: {identity}")
        prepared[identity] = result
        records.append({"id": identity, "source_sha256": frame["sha256"],
                        "source_registration": prior, "source_bounds": list(bounds),
                        "source_area": round(area(image), 3), "scale": factor,
                        "result_bounds": actual_bounds, "result_area": round(area(result), 3),
                        "anchor_x": anchor_x, "ground_baseline": BASELINE, "flight_lift": lift})
        frame["registration"] = {"source": "pre-normalization registered frame",
                                 "source_alpha_bounds": list(bounds),
                                 "registered_alpha_bounds": actual_bounds,
                                 "translation": [left, top], "scale": factor,
                                 "head_anchor_x": anchor_x, "ground_baseline": BASELINE, "flight_lift": lift}
        frame["visual_notes"] = frame.get("visual_notes", "").replace(
            "Original registered pixels preserved.", "Original registered pixels preserved in the pre-normalization archive.")
        frame["visual_notes"] += " Uniform group scale applied; see mass-normalization.json."

    output.mkdir(parents=True)
    for frame, record in zip(frames, records):
        path = output / frame["file"]
        path.parent.mkdir(parents=True, exist_ok=True)
        prepared[frame["id"]].save(path)
        frame["sha256"] = record["result_sha256"] = sha256(path)
        frame["alpha"] = alpha_metadata(prepared[frame["id"]])
    for group in summary:
        group["result_median_area"] = round(statistics.median(area(prepared[identity]) for identity in group["frame_ids"]), 3)

    strips = []
    for direction in manifest["directions"]:
        for action, count in (("walk", 5), ("run", 7), ("all", 11)):
            sequence = ordered_frames(frames, direction["source"], action)
            if action != "all":
                sequence = ordered_frames(frames, direction["source"], "idle") + sequence
            if len(sequence) != count:
                raise ValueError("Incomplete strip sequence.")
            strip = Image.new("RGBA", (CELL * count, CELL))
            for index, frame in enumerate(sequence):
                sprite = prepared[frame["id"]]
                if direction["mirror"]:
                    sprite = sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                strip.paste(sprite, (index * CELL, 0))
            relative = f"images/strips/{direction['id'].lower()}-{action}.png"
            path = output / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            strip.save(path)
            # Verify the encoded file, every cell, true alpha, order and mirrors.
            encoded = Image.open(path)
            for index, frame in enumerate(sequence):
                expected = prepared[frame["id"]]
                if direction["mirror"]:
                    expected = expected.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                if encoded.crop((index * CELL, 0, (index + 1) * CELL, CELL)).tobytes() != expected.tobytes():
                    raise ValueError(f"Strip cell mismatch: {relative} cell {index}")
            strips.append({"direction": direction["id"], "action": action, "mirror": direction["mirror"],
                           "file": relative, "width": CELL * count, "height": CELL,
                           "frame_ids": [frame["id"] for frame in sequence], "sha256": sha256(path)})

    report = {"schema_version": 1, "source_revision": source_revision, "source_archive": source_archive,
              "method": "Alpha-weighted silhouette area; one uniform scale per direction and gait. Idle shares walk scale.",
              "target_median_area": target_area, "resampling": "nearest", "cell_size": [CELL, CELL],
              "minimum_canvas_margin": 8, "ground_baseline": BASELINE, "flight_lift": 32,
              "groups": summary, "frames": records, "warnings": []}
    manifest["normalization"] = {"report": "mass-normalization.json", "target_median_area": target_area,
                                 "method": report["method"], "resampling": "nearest"}
    manifest["exports"] = {"cell_width": CELL, "cell_height": CELL,
                           "complete_order": "idle, walk 1-4, run 1-6", "direction_strips": strips}
    manifest["processing_summary"] = "55 transparent registered frames with common apparent scale across directions and gaits. 24 editable horizontal direction strips; mirrors baked into export pixels."
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    manifest["review"]["scale_refinement"] = "Direction/gait area normalized; head and torso proportions still require visual review."
    manifest["review"]["historical_walk_accepted_unchanged_frames"] = manifest["review"].pop("accepted_unchanged_frames", 24)
    for filename, data in (("manifest.json", manifest), ("mass-normalization.json", report)):
        (output / filename).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    preview(source, output, frames)
    print(json.dumps({"frames": len(frames), "strips": len(strips), "warnings": [], "groups": summary}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target-area", type=float, default=66000)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--source-archive", required=True)
    args = parser.parse_args()
    if not math.isfinite(args.target_area) or args.target_area <= 0:
        parser.error("Target area must be finite and positive.")
    normalize(args.source, args.output, args.target_area, args.source_revision, args.source_archive)
