#!/usr/bin/env python3
"""Build compact Home artwork without changing the original launcher artwork.

Run with the existing, pinned Pillow environment in caatuu-dev:
  docker exec -w /workspace caatuu-dev python \
    /workspace/apps/language-runtime/tooling/build-home-art.py
Append --check to verify the committed runtime files without writing them.
"""

import argparse
import io
import json
from pathlib import Path

from PIL import Image


WORKSPACE = Path(__file__).resolve().parents[3]
SOURCE_DIRECTORY = WORKSPACE / "apps/launcher/static/assets/icons"
SHIP_DIRECTORY = WORKSPACE / "apps/launcher/static/assets/ships"
OUTPUT_DIRECTORY = WORKSPACE / "apps/language-runtime/static/assets/home"
# Keep full canvases and alpha; the 304px mascot supports Home at display size
# while leaving room for resident game code and the setup gallery.
MAX_EDGES = {
    "home_icon.png": 192,
    "homebase_icon.png": 192,
    "social_icon.png": 192,
    "games_icon.png": 192,
    "backpack_icon.png": 192,
    "items_icon.png": 192,
    "gear_icon.png": 192,
    "stats_icon.png": 192,
    "english_flag.png": 256,
    "spain_flag.png": 256,
    "icon_gem.png": 256,
    "streak_icon.png": 256,
    "store_icon.png": 256,
    "hello.png": 304,
}
MAX_BYTES = 256 * 1024
# A resident, transparent ship gallery makes first-install setup independent of
# download order. The full-size ships remain untouched in the shared catalog.
SETUP_SHIPS = (1, 8, 15, 22)
# Retain smooth alpha while keeping the four resident previews below 50 KB.
SETUP_SHIPS_QUALITY = 84
SETUP_SHIPS_MAX_BYTES = 50_000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    records = []
    jobs = [(SOURCE_DIRECTORY / name, name, edge, "PNG")
            for name, edge in MAX_EDGES.items()]
    jobs.extend((SHIP_DIRECTORY / f"ship ({number}).png",
                 f"setup-ship-{number}.webp", 256, "WEBP")
                for number in SETUP_SHIPS)
    setup_ship_bytes = 0
    for source, name, max_edge, image_format in jobs:
        destination = OUTPUT_DIRECTORY / name
        with Image.open(source) as original:
            source_size = original.size
            image = original.convert("RGBA")
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        if image_format == "WEBP":
            image.save(encoded, format="WEBP", quality=SETUP_SHIPS_QUALITY, method=6)
            setup_ship_bytes += encoded.tell()
            if setup_ship_bytes > SETUP_SHIPS_MAX_BYTES:
                raise ValueError("Setup ships exceed their resident artwork byte budget")
        else:
            image.save(encoded, format="PNG", optimize=True, compress_level=9)
        data = encoded.getvalue()
        if len(data) > MAX_BYTES:
            raise ValueError(f"{name} exceeds the Home artwork byte budget")
        if args.check:
            if not destination.is_file() or destination.read_bytes() != data:
                raise ValueError(f"Regenerate stale Home artwork: {destination}")
        else:
            OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        records.append({
            "source": source.relative_to(WORKSPACE).as_posix(),
            "sourceDimensions": source_size,
            "sourceBytes": source.stat().st_size,
            "output": destination.relative_to(WORKSPACE).as_posix(),
            "dimensions": image.size,
            "bytes": len(data),
        })
    print(json.dumps({"checked": args.check, "assets": records}, indent=2))


if __name__ == "__main__":
    main()
