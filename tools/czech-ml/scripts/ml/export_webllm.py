#!/usr/bin/env python3
"""Export a Caatuu Czech LoRA run toward a WebLLM-compatible package."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
HF_CACHE = ROOT / "english-base" / "hf-cache"
SPEC_PATH = ROOT / "export-spec.json"
WEBLLM_TOKENIZER_FILES = [
    "tokenizer.json",
    "vocab.json",
    "merges.txt",
    "tokenizer_config.json",
]
WEBLLM_RESOLVE_ROOT = "resolve"


def root_rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def static_rel(path: Path) -> str:
    return f"data/models/{root_rel(path)}"


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


def webllm_serve_subdir(run: dict[str, Any]) -> Path:
    revision = run["webllm"].get("servable_revision", "main")
    return Path(WEBLLM_RESOLVE_ROOT) / revision


def collect_files(path: Path, hash_limit_mb: int) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    limit = hash_limit_mb * 1024 * 1024
    rows: list[dict[str, Any]] = []
    for item in sorted(p for p in path.rglob("*") if p.is_file()):
        size = item.stat().st_size
        row: dict[str, Any] = {"path": item.relative_to(path).as_posix(), "bytes": size}
        if size <= limit:
            row["sha256"] = sha256(item)
        else:
            row["sha256"] = None
            row["sha256_note"] = f"Skipped because file is larger than {hash_limit_mb} MB."
        rows.append(row)
    return rows


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_command(command: list[str], log_path: Path) -> dict[str, Any]:
    started = time.time()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as log:
        log.write("$ " + " ".join(command) + "\n\n")
        process = subprocess.run(command, text=True, stdout=log, stderr=subprocess.STDOUT)
    return {
        "command": command,
        "returncode": process.returncode,
        "seconds": round(time.time() - started, 3),
        "log": root_rel(log_path),
    }


def mlc_available() -> dict[str, Any]:
    command = [sys.executable, "-m", "mlc_llm", "--help"]
    try:
        process = subprocess.run(command, capture_output=True, text=True, timeout=30)
    except Exception as error:  # pragma: no cover - environment probe
        return {"available": False, "command": command, "error": str(error)}
    return {
        "available": process.returncode == 0,
        "command": command,
        "returncode": process.returncode,
        "stdout_head": process.stdout[:500],
        "stderr_head": process.stderr[:500],
    }


def merge_lora(run: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    adapter_dir = ROOT / run["adapter_dir"]
    merged_dir = ROOT / run["merged_hf_dir"]
    if not adapter_dir.exists():
        raise FileNotFoundError(f"Adapter path does not exist: {adapter_dir}")

    started = time.time()
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    load_kwargs: dict[str, Any] = {
        "cache_dir": HF_CACHE,
        "torch_dtype": dtype,
        "trust_remote_code": True,
        "low_cpu_mem_usage": True,
    }
    if torch.cuda.is_available() and not args.cpu:
        load_kwargs["device_map"] = "auto"

    tokenizer = AutoTokenizer.from_pretrained(adapter_dir, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    base = AutoModelForCausalLM.from_pretrained(run["base_model"], **load_kwargs)
    model = PeftModel.from_pretrained(base, adapter_dir)
    model.eval()
    merged = model.merge_and_unload()
    merged.config.use_cache = True

    merged_dir.mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(merged_dir, safe_serialization=True, max_shard_size=args.max_shard_size)
    tokenizer.save_pretrained(merged_dir)

    return {
        "status": "ready",
        "seconds": round(time.time() - started, 3),
        "base_model": run["base_model"],
        "adapter_dir": root_rel(adapter_dir),
        "merged_hf_dir": root_rel(merged_dir),
        "device": "cuda" if torch.cuda.is_available() and not args.cpu else "cpu",
        "dtype": str(dtype).replace("torch.", ""),
        "files": collect_files(merged_dir, args.hash_limit_mb),
    }


def webllm_status(run: dict[str, Any], commands: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    webllm = run["webllm"]
    model_dir = ROOT / webllm["model_dir"]
    serve_dir = model_dir / webllm_serve_subdir(run)
    model_lib = ROOT / webllm["model_lib"]
    config = serve_dir / "mlc-chat-config.json"
    tensor_cache = serve_dir / "tensor-cache.json"
    shards = sorted(serve_dir.glob("params_shard_*.bin"))
    tokenizer_status = {name: (serve_dir / name).exists() for name in WEBLLM_TOKENIZER_FILES}
    has_reused_library = bool(webllm.get("reuse_prebuilt_model_lib_from"))
    has_library = model_lib.exists() or has_reused_library
    ready = (
        config.exists()
        and tensor_cache.exists()
        and bool(shards)
        and has_library
        and all(tokenizer_status.values())
    )
    if ready:
        status = "ready"
    elif model_dir.exists():
        status = "partial"
    else:
        status = "not-exported"
    return {
        "status": status,
        "model_id": webllm["model_id"],
        "model_dir": root_rel(model_dir),
        "servable_model_dir": root_rel(serve_dir),
        "model_url": static_rel(serve_dir) + "/",
        "model_lib": root_rel(model_lib),
        "model_lib_url": static_rel(model_lib) if model_lib.exists() else None,
        "reuse_prebuilt_model_lib_from": webllm.get("reuse_prebuilt_model_lib_from"),
        "quantization": webllm["quantization"],
        "conv_template": webllm["conv_template"],
        "required_features": webllm.get("required_features", []),
        "required_files": {
            "mlc_chat_config": config.exists(),
            "tensor_cache": tensor_cache.exists(),
            "params_shards": [item.name for item in shards],
            "model_lib_wasm": model_lib.exists(),
            "tokenizer_files": tokenizer_status,
        },
        "commands": commands or [],
    }


def run_mlc_export(run: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    merged_dir = ROOT / run["merged_hf_dir"]
    if not merged_dir.exists():
        return {
            **webllm_status(run),
            "status": "blocked-missing-merged-hf",
            "message": "Run the merge stage before MLC export.",
        }

    availability = mlc_available()
    if not availability["available"]:
        return {
            **webllm_status(run),
            "status": "blocked-missing-mlc-llm",
            "mlc_probe": availability,
            "install_hint": (
                f"{sys.executable} -m pip install --pre -U -f https://mlc.ai/wheels "
                "mlc-llm-nightly-cu128 mlc-ai-nightly-cu128"
            ),
            "install_note": (
                "Verify with `python -m mlc_llm --help` after install. On this native Windows "
                "Python 3.12 environment the official wheel command installed placeholder "
                "packages but did not expose an importable mlc_llm module; a conda/Python 3.13 "
                "environment or WSL/Linux may be needed for the MLC stage."
            ),
        }

    webllm = run["webllm"]
    model_dir = ROOT / webllm["model_dir"]
    logs_dir = ROOT / "logs" / "exports" / run["id"]
    commands = [
        run_command(
            [
                sys.executable,
                "-m",
                "mlc_llm",
                "convert_weight",
                str(merged_dir),
                "--quantization",
                webllm["quantization"],
                "-o",
                str(model_dir),
            ],
            logs_dir / "mlc-convert-weight.log",
        )
    ]
    if commands[-1]["returncode"] == 0:
        commands.append(
            run_command(
                [
                    sys.executable,
                    "-m",
                    "mlc_llm",
                    "gen_config",
                    str(merged_dir),
                    "--quantization",
                    webllm["quantization"],
                    "--conv-template",
                    webllm["conv_template"],
                    "-o",
                    str(model_dir),
                ],
                logs_dir / "mlc-gen-config.log",
            )
        )

    if args.compile_webgpu and all(command["returncode"] == 0 for command in commands):
        model_lib = ROOT / webllm["model_lib"]
        commands.append(
            run_command(
                [
                    sys.executable,
                    "-m",
                    "mlc_llm",
                    "compile",
                    str(model_dir / "mlc-chat-config.json"),
                    "--device",
                    "webgpu",
                    "-o",
                    str(model_lib),
                ],
                logs_dir / "mlc-compile-webgpu.log",
            )
        )

    status = webllm_status(run, commands)
    if any(command["returncode"] != 0 for command in commands):
        status["status"] = "failed"
    return status


def build_manifest(
    run: dict[str, Any],
    merge: dict[str, Any] | None,
    webllm: dict[str, Any] | None,
    args: argparse.Namespace,
) -> dict[str, Any]:
    existing: dict[str, Any] = {}
    manifest_path = ROOT / run["export_manifest"]
    if manifest_path.exists():
        existing = load_json(manifest_path)
    return {
        "version": 1,
        "run_id": run["id"],
        "label": run["label"],
        "created_at_unix": int(time.time()),
        "base_model": run["base_model"],
        "adapter_dir": run["adapter_dir"],
        "training_run": run["training_run"],
        "stages_requested": args.stage,
        "merge": merge or existing.get("merge") or {
            "status": "ready" if (ROOT / run["merged_hf_dir"]).exists() else "not-run",
            "merged_hf_dir": run["merged_hf_dir"],
        },
        "webllm": webllm or webllm_status(run),
        "docs": {
            "webllm": "https://llm.mlc.ai/docs/deploy/webllm.html",
            "convert_weights": "https://llm.mlc.ai/docs/compilation/convert_weights.html",
            "install_mlc_llm": "https://llm.mlc.ai/docs/install/mlc_llm.html",
        },
        "environment": {
            "python": sys.executable,
            "python_version": sys.version.split()[0],
            "cwd": os.getcwd(),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--stage", choices=["merge", "mlc", "all", "status"], default="all")
    parser.add_argument("--compile-webgpu", action="store_true")
    parser.add_argument("--cpu", action="store_true")
    parser.add_argument("--max-shard-size", default="2GB")
    parser.add_argument("--hash-limit-mb", type=int, default=20)
    args = parser.parse_args()

    spec = load_json(SPEC_PATH)
    run = resolve_run(args.run_id or spec["default_run_id"])

    merge: dict[str, Any] | None = None
    webllm: dict[str, Any] | None = None
    if args.stage in {"merge", "all"}:
        merge = merge_lora(run, args)
    if args.stage in {"mlc", "all"}:
        webllm = run_mlc_export(run, args)

    manifest = build_manifest(run, merge, webllm, args)
    manifest_path = ROOT / run["export_manifest"]
    write_json(manifest_path, manifest)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"\nWrote {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
