"""Prepare small UI derivatives of existing art inside caatuu-dev.

docker exec -w /workspace caatuu-dev python3 apps/language-runtime/tooling/prepare-campaign-art.py
Pass --trophy-source PATH to also prepare the approved generated trophy source.
The original launcher catalog remains authoritative and is never modified.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import unquote

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "apps/launcher/static/assets"
OUTPUT = ROOT / "apps/language-runtime/static/assets/campaign"


def prepare(source, name, size):
    image = Image.open(source).convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if bounds:
        image = image.crop(bounds)
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    image.save(OUTPUT / name, "WEBP", quality=88, method=6)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trophy-source", type=Path)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    robots = json.loads((SOURCE / "robots/keymap.json").read_text(encoding="utf-8"))
    for index in range(1, 34):
        path = f"/assets/robots/robot%20({index}).png"
        if path not in robots:
            raise ValueError(f"Missing authoritative robot: {path}")
        prepare(SOURCE / unquote(path.removeprefix("/assets/")), f"robot-{index:02d}.webp", 192)
    for name, path in {
        "lantern": "macaw/actions/047-light_lantern.png",
        "chest": "macaw/actions/035-search_chest.png",
        "astronaut": "icons/hello.png",
        "jump": "macaw/actions/013-jump_forward.png",
        "balance": "macaw/actions/018-balance.png",
        "lever": "macaw/actions/044-pull_lever.png",
        "high-five": "macaw/actions/083-high_five.png",
    }.items():
        prepare(SOURCE / path, f"macaw-{name}.webp", 360)
    if args.trophy_source:
        prepare(args.trophy_source, "cycle-trophy.webp", 240)
    print(f"Prepared 33 distinct robots and 7 macaw scenes in {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
