#!/usr/bin/env python3
"""Write the static phone-bench model catalog from prepared GGUF manifests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


TOOL_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = TOOL_DIR / "model-configs.json"


def artifact_dir(model_key: str, model: dict[str, Any]) -> Path:
    subdir = model.get("artifact_subdir", model_key)
    if subdir:
        return TOOL_DIR / "artifacts" / "models" / subdir
    return TOOL_DIR / "artifacts" / "models"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_manifest(model_key: str, model: dict[str, Any], target_dir: Path) -> dict[str, Any] | None:
    candidates = [
        target_dir / f"{model_key}.manifest.json",
        artifact_dir(model_key, model) / "manifest.json",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return read_json(candidate)
    return None


def model_entry(model_key: str, model: dict[str, Any], manifest: dict[str, Any], target_dir: Path) -> dict[str, Any] | None:
    model_file = manifest.get("model_file") or f"{model['model_basename']}-q4_k_m.gguf"
    target_model = target_dir / model_file
    target_sha = target_dir / f"{model_file}.sha256"
    if not target_model.is_file() and not (artifact_dir(model_key, model) / model_file).is_file():
        return None

    sha256 = manifest.get("sha256", "")
    if not sha256 and target_sha.is_file():
        sha256 = target_sha.read_text(encoding="utf-8").split()[0]

    return {
        "key": model_key,
        "label": model.get("app_label") or model["label"],
        "short_label": model.get("short_label") or model.get("app_label") or model["label"],
        "run_id": model["run_id"],
        "repo_id": model["repo_id"],
        "license": model["license"],
        "base_model": model.get("base_model", ""),
        "adapter": model.get("adapter", ""),
        "intended_use": model.get("intended_use", ""),
        "status": model.get("status", "active"),
        "deprecated": bool(model.get("deprecated", False)),
        "replacement_status": model.get("replacement_status", ""),
        # Legacy model definitions remain setup-required. New catalogs can
        # explicitly make large weights optional without changing old builds.
        "install_policy": model.get("install_policy", "setup_required"),
        "supports_thinking": bool(model.get("supports_thinking", False)),
        "runtime": manifest.get("runtime", "llama.cpp"),
        "format": manifest.get("format", "gguf"),
        "quantization": manifest.get("quantization", model.get("quantization", "Q4_K_M")),
        "model_file": model_file,
        "manifest_file": f"{model_key}.manifest.json",
        "bytes": int(manifest.get("bytes", target_model.stat().st_size if target_model.is_file() else 0)),
        "sha256": sha256,
        "notes": manifest.get("notes", model.get("notes", [])),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-dir", required=True)
    parser.add_argument("--base-url", default="https://caatuu.waajacu.com/cz/data/models/phone-bench")
    parser.add_argument("--include-deprecated", action="store_true")
    args = parser.parse_args()

    target_dir = Path(args.target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    config = read_json(CONFIG_PATH)
    entries = []
    for model_key, model in config["models"].items():
        if not args.include_deprecated and (model.get("deprecated") or model.get("status") != "active"):
            continue
        manifest = read_manifest(model_key, model, target_dir)
        if not manifest:
            continue
        entry = model_entry(model_key, model, manifest, target_dir)
        if entry:
            entries.append(entry)

    catalog = {
        "version": 1,
        "default_model": config["default_model"],
        "base_url": args.base_url,
        "models": entries,
    }
    (target_dir / "models.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {target_dir / 'models.json'} with {len(entries)} model(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
