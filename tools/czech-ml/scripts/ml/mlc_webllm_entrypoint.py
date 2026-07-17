#!/usr/bin/env python3
"""Run MLC WebLLM conversion inside the Caatuu MLC Docker image."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path("/models")
SPEC_PATH = ROOT / "export-spec.json"


def load_run(run_id: str) -> dict:
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    for run in spec["runs"]:
        if run["id"] == run_id:
            return run
    known = ", ".join(run["id"] for run in spec["runs"])
    raise SystemExit(f"Unknown run id {run_id!r}. Known runs: {known}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--skip-convert", action="store_true")
    parser.add_argument("--skip-config", action="store_true")
    args = parser.parse_args()

    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    run = load_run(args.run_id or spec["default_run_id"])
    webllm = run["webllm"]
    merged_dir = ROOT / run["merged_hf_dir"]
    model_dir = ROOT / webllm["model_dir"]
    model_dir.mkdir(parents=True, exist_ok=True)

    config_arg = str(merged_dir)
    quantization = webllm["quantization"]
    if not args.skip_convert:
        from mlc_llm.cli.convert_weight import main as convert_weight_main

        convert_weight_main([
            config_arg,
            "--quantization",
            quantization,
            "--device",
            "cpu",
            "--source-format",
            "huggingface-safetensor",
            "-o",
            str(model_dir),
        ])

    if not args.skip_config:
        from mlc_llm.cli.gen_config import main as gen_config_main

        gen_config_main([
            config_arg,
            "--quantization",
            quantization,
            "--conv-template",
            webllm["conv_template"],
            "-o",
            str(model_dir),
        ])

    print(json.dumps({
        "run_id": run["id"],
        "model_id": webllm["model_id"],
        "model_dir": str(model_dir),
        "files": sorted(item.name for item in model_dir.iterdir() if item.is_file()),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
