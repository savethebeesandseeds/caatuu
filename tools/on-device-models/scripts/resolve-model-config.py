#!/usr/bin/env python3
"""Resolve a phone-bench model config into shell exports."""

from __future__ import annotations

import argparse
import json
import shlex
from pathlib import Path
from typing import Any


TOOL_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = TOOL_DIR / "model-configs.json"


def resolve_path(value: str | None) -> str:
    if not value:
        return ""
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str((TOOL_DIR / path).resolve())


def shell_export(name: str, value: Any) -> str:
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return f"export {name}={shlex.quote(str(value))}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_key", nargs="?", help="Model key from model-configs.json.")
    args = parser.parse_args()

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    model_key = args.model_key or config["default_model"]
    models = config["models"]
    if model_key not in models:
        known = ", ".join(sorted(models))
        raise SystemExit(f"Unknown model key '{model_key}'. Known models: {known}")

    model = models[model_key]
    source_type = model["source_type"]
    hf_dir = ""
    if source_type == "local_hf":
        hf_dir = resolve_path(model["model_hf_dir"])
    elif source_type == "hf_snapshot":
        hf_dir = resolve_path(model["snapshot_dir"])
    else:
        raise SystemExit(f"Unsupported source_type '{source_type}' for {model_key}.")

    artifact_dir = resolve_path(f"artifacts/models/{model.get('artifact_subdir', model_key)}")

    exports = {
        "DEFAULT_MODEL_KEY": config["default_model"],
        "MODEL_KEY": model_key,
        "MODEL_LABEL": model["label"],
        "RUN_ID": model["run_id"],
        "MODEL_SOURCE_TYPE": source_type,
        "MODEL_REPO_ID": model["repo_id"],
        "MODEL_LICENSE": model["license"],
        "MODEL_HF_DIR": hf_dir,
        "MODEL_BASENAME": model["model_basename"],
        "MODEL_QUANTIZATION": model.get("quantization", "Q4_K_M"),
        "OUT_DIR": artifact_dir,
        "MODEL_NOTES_JSON": model.get("notes", []),
    }

    for key, value in exports.items():
        print(shell_export(key, value))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
