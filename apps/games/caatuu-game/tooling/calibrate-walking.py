"""Measure the selected side-profile transfer poses in caatuu-dev.

Run from /workspace. Source PNG pixels are read-only; update only calibration and
manifest metadata. Foot-color segmentation estimates average stride, not an
exact contact constraint for every held animation frame.
"""
import hashlib
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2] / "lab/assets/macaw/walk"


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def foot_centres(path):
    with Image.open(path) as image:
        pixels = np.array(image)
    if pixels.shape != (512, 512, 4):
        raise ValueError("Expected the selected 512-square RGBA source.")
    mask = ((pixels[:, :, 0] > 220) & (pixels[:, :, 1] > 120) &
            (pixels[:, :, 1] < 240) & (pixels[:, :, 2] < 100) &
            (pixels[:, :, 3] >= 128))
    mask[:410, :] = False
    components = []
    for y, x in np.argwhere(mask):
        if not mask[y, x]:
            continue
        queue = deque([(int(y), int(x))])
        mask[y, x] = False
        points = []
        while queue:
            a, b = queue.popleft()
            points.append((b, a))
            for c, d in ((a - 1, b), (a + 1, b), (a, b - 1), (a, b + 1)):
                if 0 <= c < 512 and 0 <= d < 512 and mask[c, d]:
                    mask[c, d] = False
                    queue.append((c, d))
        if len(points) >= 500:
            components.append({"pixels": len(points), "centre": np.mean(points, axis=0).tolist()})
    if len(components) != 2:
        raise ValueError(f"Expected two separate golden feet: {path}")
    return sorted(components, key=lambda component: component["centre"][0])


manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
samples = []
for slot in (2, 6):
    frame = next(frame for frame in manifest["frames"] if frame["id"] == f"E-walk-{slot:02d}")
    path = ROOT / frame["file"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != frame["sha256"]:
        raise ValueError("Source hash mismatch; review changed poses before recalibration.")
    feet = foot_centres(path)
    samples.append({"frame": frame["id"], "file": frame["file"], "sha256": frame["sha256"],
                    "feet": feet, "step_pixels": feet[1]["centre"][0] - feet[0]["centre"][0]})
step_pixels = sum(sample["step_pixels"] for sample in samples) / len(samples)
profile = {"canvas_pixels": 512, "frames_per_cycle": 8, "steps_per_cycle": 2,
           "fps": 8, "stride_pixels": round(step_pixels * 2, 6),
           "calibration": "stride-calibration.json"}
write(ROOT / "stride-calibration.json", {
    "method": "Average horizontal foot-centroid separation at the two side-profile transfer poses; two steps per full cycle.",
    "reference_direction": "E", "samples": samples, "step_pixels": step_pixels,
    "stride_pixels": profile["stride_pixels"],
    "segmentation": {"minimum_y": 410, "red_above": 220, "green_between_exclusive": [120, 240],
                     "blue_below": 100, "minimum_alpha": 128, "minimum_component_pixels": 500},
    "limitations": "Average stride calibration. Eight held drawings and regenerated foot shapes do not provide continuous exact foot locking.",
    "conversion": "world distance per cycle = stride_pixels / canvas_pixels * displayed canvas world size; speed = cycle distance * fps / frames_per_cycle. Camera zoom cancels."
})
manifest.update(status="selected corrected walking and standing source", candidate_id="macaw-walk-v1",
                source_selection="provenance/selection.json", locomotion={"walk": profile})
manifest.pop("preserved_draft", None)
manifest["normalization"]["report"] = "provenance/mass-normalization.json"
for strip in manifest["exports"]["direction_strips"]:
    strip["file"] = strip["file"].replace("images/strips/", "strips/")
manifest["provenance"] = {"walking": "provenance/generation.json", "standing": "provenance/standing-generation.json",
                          "video_sources": "provenance/video-sources.json", "registration": "provenance/registration.json"}
manifest["processing_summary"] = "45 selected transparent frames with shared direction scale, eight verified strips and measured average walking stride. Original videos retained; intermediate image workspaces retired."
write(ROOT / "manifest.json", manifest)
print(json.dumps({"step_pixels": step_pixels, "stride_pixels": profile["stride_pixels"],
                  "speed_at_canvas_world_size_2_1": profile["stride_pixels"] / 512 * 2.1}))
