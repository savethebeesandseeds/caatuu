#!/usr/bin/env python3
"""Download a Hugging Face model snapshot for local GGUF conversion."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from huggingface_hub import snapshot_download


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--revision", default=None)
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    snapshot_path = snapshot_download(
        repo_id=args.repo_id,
        revision=args.revision,
        local_dir=str(out_dir),
        local_dir_use_symlinks=False,
    )

    manifest = {
        "repo_id": args.repo_id,
        "revision": args.revision or "main",
        "snapshot_path": str(Path(snapshot_path).resolve()),
        "downloaded_at_unix": int(time.time()),
    }
    (out_dir / "caatuu-download-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
