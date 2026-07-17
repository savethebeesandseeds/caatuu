#!/usr/bin/env python3
"""Build the deterministic macaw foot-rig layers inside the Tukevejtso container."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


SCALE = 4
CANVAS = (420, 440)

# The polygons follow the visible leg, toes, and claws in macaw-walk_005.png.
# They intentionally overlap the robe hem slightly so the animated seam remains
# behind the body layer at game scale.
NEAR_FOOT = [
    (148, 353), (169, 352), (181, 364), (180, 376), (195, 385),
    (190, 411), (91, 414), (85, 405), (86, 386), (105, 373),
    (137, 371),
]
FAR_FOOT = [
    (281, 353), (303, 350), (314, 357), (322, 375), (325, 396),
    (309, 414), (269, 414), (230, 400), (230, 382), (255, 369),
    (270, 360),
]


def polygon_mask(points: list[tuple[int, int]], feather: float = 0.65) -> Image.Image:
    mask = Image.new("L", (CANVAS[0] * SCALE, CANVAS[1] * SCALE), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon([(x * SCALE, y * SCALE) for x, y in points], fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather * SCALE))
    return mask.resize(CANVAS, Image.Resampling.LANCZOS)


def pixels(image: Image.Image):
    getter = getattr(image, "get_flattened_data", image.getdata)
    return getter()


def multiply_alpha(source: Image.Image, mask: Image.Image) -> Image.Image:
    result = source.copy()
    original_alpha = source.getchannel("A")
    combined = Image.new("L", CANVAS)
    combined.putdata([(a * b) // 255 for a, b in zip(pixels(original_alpha), pixels(mask))])
    result.putalpha(combined)
    # Zero hidden RGB so later compositing cannot reveal dark color fringes.
    result.putdata([
        (red, green, blue, alpha) if alpha else (0, 0, 0, 0)
        for red, green, blue, alpha in pixels(result)
    ])
    return result


def subtract_alpha(source: Image.Image, masks: list[Image.Image]) -> Image.Image:
    keep = Image.new("L", CANVAS, 255)
    keep_pixels = list(pixels(keep))
    for mask in masks:
        keep_pixels = [min(value, 255 - cut) for value, cut in zip(keep_pixels, pixels(mask))]
    keep.putdata(keep_pixels)
    return multiply_alpha(source, keep)


def checkerboard(size: tuple[int, int], tile: int = 20) -> Image.Image:
    image = Image.new("RGB", size, "#293a33")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], tile):
        for x in range(0, size[0], tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill="#43574d")
    return image


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_rig_assets.py SOURCE.png OUTPUT_DIR")

    source_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    source = Image.open(source_path).convert("RGBA")
    if source.size != CANVAS:
        raise SystemExit(f"expected {CANVAS}, got {source.size}")

    near_mask = polygon_mask(NEAR_FOOT)
    far_mask = polygon_mask(FAR_FOOT)
    near = multiply_alpha(source, near_mask)
    far = multiply_alpha(source, far_mask)
    body = subtract_alpha(source, [near_mask, far_mask])

    body.save(output_dir / "macaw-rig-body.png")
    near.save(output_dir / "macaw-rig-foot-near.png")
    far.save(output_dir / "macaw-rig-foot-far.png")
    near_mask.save(output_dir / "macaw-rig-foot-near-mask.png")
    far_mask.save(output_dir / "macaw-rig-foot-far-mask.png")

    preview = checkerboard((CANVAS[0] * 3, CANVAS[1] * 2))
    panels = [source, body, near, far]
    for index, panel in enumerate(panels):
        x = (index % 3) * CANVAS[0]
        y = (index // 3) * CANVAS[1]
        preview.paste(panel, (x, y), panel)

    assembled = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    assembled.alpha_composite(far)
    assembled.alpha_composite(near)
    assembled.alpha_composite(body)
    preview.paste(assembled, (CANVAS[0] * 2, CANVAS[1]), assembled)
    preview.save(output_dir / "macaw-rig-preview.png")

    metadata = {
        "canvas": {"width": CANVAS[0], "height": CANVAS[1]},
        "source": "../side/macaw-walk_005.png",
        "layers_back_to_front": [
            "macaw-rig-foot-far.png",
            "macaw-rig-foot-near.png",
            "macaw-rig-body.png",
        ],
        "pivots": {
            "near": {"x_percent": 38.0, "y_percent": 80.0},
            "far": {"x_percent": 69.0, "y_percent": 79.0},
        },
        "masks": {"near_polygon": NEAR_FOOT, "far_polygon": FAR_FOOT},
        "build_environment": "tukevejtso container; Pillow from /opt/tukevejtso-venvs/cutout",
    }
    (output_dir / "rig.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
