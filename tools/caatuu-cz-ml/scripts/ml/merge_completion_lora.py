#!/usr/bin/env python3
"""Merge a PEFT LoRA adapter into a standalone Hugging Face causal LM."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
HF_CACHE = ROOT / "english-base" / "hf-cache"


def normalize_tokenizer_config_for_gguf(out_dir: Path) -> None:
    config_path = out_dir / "tokenizer_config.json"
    if not config_path.is_file():
        return
    config = json.loads(config_path.read_text(encoding="utf-8"))
    extra_special_tokens = config.get("extra_special_tokens")
    if isinstance(extra_special_tokens, list):
        config.setdefault("additional_special_tokens", extra_special_tokens)
        config["extra_special_tokens"] = {}
        config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", default="BUT-FIT/CSTinyLlama-1.2B")
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-shard-size", default="2GB")
    parser.add_argument("--cpu", action="store_true")
    args = parser.parse_args()

    adapter_dir = Path(args.adapter)
    out_dir = Path(args.out)
    if not adapter_dir.exists():
        raise FileNotFoundError(f"Adapter path does not exist: {adapter_dir}")

    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    use_cuda = torch.cuda.is_available() and not args.cpu
    dtype = torch.float16 if use_cuda else torch.float32

    tokenizer = AutoTokenizer.from_pretrained(args.model_id, cache_dir=HF_CACHE, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    load_kwargs = {
        "cache_dir": HF_CACHE,
        "torch_dtype": dtype,
        "trust_remote_code": True,
        "low_cpu_mem_usage": True,
    }
    if use_cuda:
        load_kwargs["device_map"] = "auto"

    base = AutoModelForCausalLM.from_pretrained(args.model_id, **load_kwargs)
    model = PeftModel.from_pretrained(base, adapter_dir)
    model.eval()
    merged = model.merge_and_unload()
    merged.config.use_cache = True
    merged.save_pretrained(out_dir, safe_serialization=True, max_shard_size=args.max_shard_size)
    tokenizer.save_pretrained(out_dir)
    normalize_tokenizer_config_for_gguf(out_dir)

    metadata = {
        "base_model": args.model_id,
        "adapter_dir": str(adapter_dir),
        "merged_hf_dir": str(out_dir),
        "seconds": round(time.time() - started, 3),
        "device": "cuda" if use_cuda else "cpu",
        "dtype": str(dtype).replace("torch.", ""),
    }
    (out_dir.parent / "merge-manifest.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
