#!/usr/bin/env python3
"""Finalize a WebLLM export after MLC weight conversion."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
SPEC_PATH = ROOT / "export-spec.json"
TOKENIZER_FILES = [
    "tokenizer.json",
    "vocab.json",
    "merges.txt",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "chat_template.jinja",
]
RESOLVE_ROOT = "resolve"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def resolve_run(run_id: str) -> dict[str, Any]:
    spec = load_json(SPEC_PATH)
    for run in spec["runs"]:
        if run["id"] == run_id:
            return run
    known = ", ".join(run["id"] for run in spec["runs"])
    raise SystemExit(f"Unknown run id {run_id!r}. Known runs: {known}")


def serve_subdir(run: dict[str, Any]) -> Path:
    revision = run["webllm"].get("servable_revision", "main")
    return Path(RESOLVE_ROOT) / revision


def copy_tokenizers(merged_dir: Path, model_dir: Path) -> list[str]:
    copied: list[str] = []
    for name in TOKENIZER_FILES:
        source = merged_dir / name
        if source.exists():
            shutil.copy2(source, model_dir / name)
            copied.append(name)
    return copied


def link_or_copy(source: Path, target: Path) -> str:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    try:
        os.link(source, target)
        return "hardlink"
    except OSError:
        shutil.copy2(source, target)
        return "copy"


def refresh_servable_view(model_dir: Path, subdir: Path) -> dict[str, Any]:
    serve_dir = model_dir / subdir
    linked: list[str] = []
    copied: list[str] = []
    skipped: list[str] = []

    for source in sorted(item for item in model_dir.iterdir() if item.is_file()):
        target = serve_dir / source.name
        method = link_or_copy(source, target)
        if method == "hardlink":
            linked.append(source.name)
        else:
            copied.append(source.name)

    for item in sorted(model_dir.iterdir()):
        if item.is_dir() and item.name != RESOLVE_ROOT:
            skipped.append(item.name)

    return {
        "status": "ready",
        "path": subdir.as_posix(),
        "hardlinked_files": linked,
        "copied_files": copied,
        "skipped_directories": skipped,
    }


def install_prebuilt_config(run: dict[str, Any], model_dir: Path, force: bool) -> dict[str, Any]:
    target = model_dir / "mlc-chat-config.json"
    if target.exists() and not force:
        return {"status": "kept-existing", "path": target.name}

    reuse = run["webllm"].get("reuse_prebuilt_model_lib_from")
    if not reuse:
        return {"status": "skipped-no-prebuilt-source"}

    url = f"https://huggingface.co/mlc-ai/{reuse}/resolve/main/mlc-chat-config.json"
    with urllib.request.urlopen(url, timeout=60) as response:
        data = json.loads(response.read().decode("utf-8"))

    if run["webllm"].get("conv_template"):
        data.setdefault("conv_template", {})["name"] = run["webllm"]["conv_template"]
    conv_template = data.setdefault("conv_template", {})
    conv_template["system_template"] = ""
    conv_template["system_message"] = ""
    conv_template["add_role_after_system_message"] = False
    data["model_type"] = "qwen3"
    data["quantization"] = run["webllm"]["quantization"]
    write_json(target, data)
    return {
        "status": "installed-prebuilt",
        "source": url,
        "path": target.name,
        "system_prompt_removed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--force-config", action="store_true")
    args = parser.parse_args()

    spec = load_json(SPEC_PATH)
    run = resolve_run(args.run_id or spec["default_run_id"])
    merged_dir = ROOT / run["merged_hf_dir"]
    model_dir = ROOT / run["webllm"]["model_dir"]
    subdir = serve_subdir(run)
    serve_dir = model_dir / subdir
    model_dir.mkdir(parents=True, exist_ok=True)

    copied = copy_tokenizers(merged_dir, model_dir)
    config = install_prebuilt_config(run, model_dir, args.force_config)
    servable_view = refresh_servable_view(model_dir, subdir)
    report = {
        "run_id": run["id"],
        "model_id": run["webllm"]["model_id"],
        "model_dir": run["webllm"]["model_dir"],
        "servable_model_dir": f"{run['webllm']['model_dir']}/{subdir.as_posix()}",
        "copied_tokenizer_files": copied,
        "config": config,
        "servable_view": servable_view,
        "required_files": {
            "mlc_chat_config": (serve_dir / "mlc-chat-config.json").exists(),
            "tensor_cache": (serve_dir / "tensor-cache.json").exists(),
            "params_shards": sorted(item.name for item in serve_dir.glob("params_shard_*.bin")),
        },
    }
    write_json(model_dir / "finalize-report.json", report)
    link_or_copy(model_dir / "finalize-report.json", serve_dir / "finalize-report.json")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
