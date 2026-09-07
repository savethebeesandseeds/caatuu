#!/usr/bin/env python3
"""Build the small Home PNGs without changing the original launcher artwork.

Run with the existing, pinned Pillow environment in caatuu-dev:
  docker exec -w /workspace caatuu-dev caatuu-animated-fabric python \
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
OUTPUT_DIRECTORY = WORKSPACE / "apps/language-runtime/static/assets/home"
# Keep full canvases and alpha; the 512px mascot also supports larger Home art.
MAX_EDGES = {
    "english_flag.png": 256,
    "spain_flag.png": 256,
    "icon_gem.png": 256,
    "streak_icon.png": 256,
    "store_icon.png": 256,
    "hello.png": 512,
}
MAX_BYTES = 256 * 1024


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    records = []
    for name, max_edge in MAX_EDGES.items():
        source = SOURCE_DIRECTORY / name
        destination = OUTPUT_DIRECTORY / name
        with Image.open(source) as original:
            source_size = original.size
            image = original.convert("RGBA")
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
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
