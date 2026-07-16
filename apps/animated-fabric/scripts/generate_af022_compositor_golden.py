"""Generate the tiny owned AF-022 source-over compositor golden image."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def build_golden() -> Image.Image:
    """Return a hand-authored 4x3 RGBA result independent of renderer code."""
    pixels = [
        (0, 0, 0, 0),
        (0, 0, 0, 0),
        (0, 0, 0, 0),
        (0, 0, 0, 0),
        (0, 0, 0, 0),
        (0, 0, 255, 255),
        (128, 0, 127, 255),
        (255, 0, 0, 128),
        (0, 0, 0, 0),
        (0, 0, 255, 255),
        (0, 0, 255, 255),
        (0, 0, 0, 0),
    ]
    image = Image.new("RGBA", (4, 3))
    image.putdata(pixels)
    return image


def main() -> int:
    """Write the deterministic golden to the requested repository path."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("tests/golden/af022_compositor.png"),
    )
    args = parser.parse_args()
    output: Path = args.out
    output.parent.mkdir(parents=True, exist_ok=True)
    build_golden().save(output, format="PNG", optimize=False, compress_level=9)
    print(f"Generated AF-022 compositor golden at {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
