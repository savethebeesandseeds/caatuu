"""Generate deterministic geometric layer assets for the M0 humanoid fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from PIL import Image, ImageDraw

from animated_fabric.infrastructure.fixtures import (
    CANVAS_SIZE,
    DIRECTIONS,
    FIXTURE_ID,
    GROUND_ANCHOR,
    PART_NAMES,
    write_stick_humanoid_project,
)

Point = tuple[int, int]
Color = tuple[int, int, int, int]
ShapeKind = Literal["ellipse", "polygon"]

OUTLINE: Color = (35, 39, 47, 255)
SKIN: Color = (238, 177, 126, 255)
SHIRT: Color = (65, 126, 178, 255)
TROUSERS: Color = (83, 74, 112, 255)
BOOTS: Color = (91, 60, 42, 255)


@dataclass(frozen=True, slots=True)
class Shape:
    """A raster-friendly primitive described entirely with integer coordinates."""

    kind: ShapeKind
    points: tuple[Point, ...]
    fill: Color
    outline_width: int = 2


def _ellipse(box: tuple[int, int, int, int], fill: Color) -> Shape:
    left, top, right, bottom = box
    return Shape("ellipse", ((left, top), (right, bottom)), fill)


def _polygon(points: tuple[Point, ...], fill: Color) -> Shape:
    return Shape("polygon", points, fill)


def _se_shapes() -> dict[str, tuple[Shape, ...]]:
    return {
        "torso": (
            _polygon(((79, 65), (105, 61), (116, 78), (108, 111), (80, 110), (74, 80)), SHIRT),
        ),
        "head": (
            _ellipse((80, 31, 111, 62), SKIN),
            _ellipse((101, 44, 106, 49), OUTLINE),
        ),
        "upper_arm_l": (_polygon(((80, 68), (88, 73), (75, 96), (65, 91)), SHIRT),),
        "lower_arm_l": (_polygon(((67, 87), (77, 94), (67, 118), (58, 112)), SKIN),),
        "hand_l": (_ellipse((54, 108, 68, 123), SKIN),),
        "upper_arm_r": (_polygon(((103, 64), (113, 68), (126, 91), (116, 97)), SHIRT),),
        "lower_arm_r": (_polygon(((116, 89), (126, 85), (136, 111), (126, 116)), SKIN),),
        "hand_r": (_ellipse((125, 108, 139, 123), SKIN),),
        "thigh_l": (_polygon(((82, 103), (96, 104), (89, 133), (76, 132)), TROUSERS),),
        "shin_l": (_polygon(((76, 126), (89, 127), (84, 154), (72, 154)), TROUSERS),),
        "foot_l": (_polygon(((70, 149), (84, 149), (91, 158), (68, 160)), BOOTS),),
        "thigh_r": (_polygon(((96, 104), (108, 101), (118, 130), (105, 134)), TROUSERS),),
        "shin_r": (_polygon(((105, 128), (118, 125), (125, 151), (113, 155)), TROUSERS),),
        "foot_r": (_polygon(((112, 149), (125, 146), (135, 154), (116, 160)), BOOTS),),
    }


def _ne_shapes() -> dict[str, tuple[Shape, ...]]:
    return {
        "torso": (
            _polygon(((82, 62), (107, 66), (116, 82), (108, 110), (80, 109), (74, 77)), SHIRT),
        ),
        "head": (
            _ellipse((80, 30, 111, 61), SKIN),
            _ellipse((102, 40, 107, 45), OUTLINE),
        ),
        "upper_arm_l": (_polygon(((82, 64), (91, 70), (77, 93), (67, 87)), SHIRT),),
        "lower_arm_l": (_polygon(((69, 84), (79, 91), (67, 115), (58, 109)), SKIN),),
        "hand_l": (_ellipse((54, 105, 68, 120), SKIN),),
        "upper_arm_r": (_polygon(((105, 68), (114, 65), (126, 89), (117, 95)), SHIRT),),
        "lower_arm_r": (_polygon(((117, 87), (127, 83), (136, 108), (126, 113)), SKIN),),
        "hand_r": (_ellipse((125, 105, 139, 120), SKIN),),
        "thigh_l": (_polygon(((81, 102), (94, 105), (87, 134), (74, 131)), TROUSERS),),
        "shin_l": (_polygon(((75, 126), (88, 129), (82, 154), (70, 152)), TROUSERS),),
        "foot_l": (_polygon(((69, 148), (82, 150), (89, 158), (66, 158)), BOOTS),),
        "thigh_r": (_polygon(((94, 104), (108, 102), (117, 132), (104, 134)), TROUSERS),),
        "shin_r": (_polygon(((104, 128), (117, 126), (124, 152), (112, 155)), TROUSERS),),
        "foot_r": (_polygon(((111, 150), (124, 147), (134, 155), (114, 160)), BOOTS),),
    }


def _draw_layer(shapes: tuple[Shape, ...]) -> Image.Image:
    image = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for shape in shapes:
        if shape.kind == "ellipse":
            draw.ellipse(
                (shape.points[0], shape.points[1]),
                fill=shape.fill,
                outline=OUTLINE,
                width=shape.outline_width,
            )
        else:
            draw.polygon(
                shape.points,
                fill=shape.fill,
                outline=OUTLINE,
                width=shape.outline_width,
            )
    return image


def _write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(".png.tmp")
    image.save(
        temporary_path,
        format="PNG",
        optimize=False,
        compress_level=9,
        pnginfo=None,
    )
    temporary_path.replace(path)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_manifest(path: Path, manifest: dict[str, object]) -> None:
    payload = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary_path = path.with_suffix(".json.tmp")
    temporary_path.write_text(payload, encoding="utf-8", newline="\n")
    temporary_path.replace(path)


def generate_fixture_assets(output_root: Path) -> Path:
    """Generate the authored SE and NE layers and return the fixture root."""

    fixture_root = output_root / FIXTURE_ID
    definitions = {"SE": _se_shapes(), "NE": _ne_shapes()}
    layers: list[dict[str, object]] = []

    for direction in DIRECTIONS:
        direction_root = fixture_root / "source" / "layers" / direction
        for part_name in PART_NAMES:
            image_path = direction_root / f"{part_name}.png"
            _write_png(image_path, _draw_layer(definitions[direction][part_name]))
            layers.append(
                {
                    "direction": direction,
                    "part": part_name,
                    "path": image_path.relative_to(fixture_root).as_posix(),
                    "sha256": _sha256(image_path),
                }
            )

    manifest: dict[str, object] = {
        "schema_version": "0.1.0",
        "fixture_id": FIXTURE_ID,
        "template_id": "humanoid_v1",
        "canvas": {
            "width": CANVAS_SIZE[0],
            "height": CANVAS_SIZE[1],
            "ground_anchor": list(GROUND_ANCHOR),
        },
        "directions": list(DIRECTIONS),
        "layers": layers,
    }
    _write_manifest(fixture_root / "fixture_manifest.json", manifest)
    write_stick_humanoid_project(fixture_root)
    return fixture_root


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate deterministic geometric PNG layers for the humanoid fixture."
    )
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Output directory that will contain the stick_humanoid fixture.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    fixture_root = generate_fixture_assets(arguments.out)
    print(f"Generated geometric fixture at {fixture_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
