#!/usr/bin/env python3
"""Benchmark a base or LoRA-adapted model on fixed Czech probes."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
HF_CACHE = ROOT / "english-base" / "hf-cache"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_PROMPTS = [
    {
        "id": "diacritics_shop",
        "system": "Jsi český korektor. Odpovídej pouze opravenou větou.",
        "user": "Oprav pravopis a diakritiku: Dobry den, chtel bych dve kavy a jeden ucet prosim.",
    },
    {
        "id": "shop_dialogue",
        "system": "Odpovídej pouze česky. Piš přirozeně, krátce a bez angličtiny.",
        "user": "Napiš čtyři krátké repliky v obchodě se slovy: rohlíky, mléko, účet, prosím, děkuji.",
    },
    {
        "id": "please_thanks",
        "system": "Jsi trpělivý učitel češtiny pro začátečníky. Odpovídej jednoduše a přesně.",
        "user": "Vysvětli jednoduše rozdíl mezi „prosím“ a „děkuji“.",
    },
    {
        "id": "station",
        "system": "Jsi český korektor. Odpovídej pouze opravenou větou.",
        "user": "Oprav: Prosim vas, kde je nadrazi?",
    },
    {
        "id": "food_words",
        "system": "Jsi český korektor. Odpovídej pouze opravenou větou.",
        "user": "Oprav: Mam rad ceskou kavu a cerstvy chleba.",
    },
]


def chat_prompt(tokenizer, system: str, user: str) -> str:
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    try:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
    except TypeError:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", default="Qwen/Qwen3-1.7B")
    parser.add_argument("--adapter", default=None)
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-new-tokens", type=int, default=120)
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(args.model_id, cache_dir=HF_CACHE, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model_id,
        cache_dir=HF_CACHE,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        trust_remote_code=True,
        low_cpu_mem_usage=True,
    )
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter)
    model.to(device)
    model.eval()

    outputs = []
    started = time.time()
    for item in DEFAULT_PROMPTS:
        prompt = chat_prompt(tokenizer, item["system"], item["user"])
        inputs = tokenizer(prompt, return_tensors="pt").to(device)
        t0 = time.time()
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        elapsed = time.time() - t0
        new_tokens = generated[0, inputs["input_ids"].shape[-1] :]
        text = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
        outputs.append({**item, "output": text, "seconds": round(elapsed, 3)})

    result = {
        "model_id": args.model_id,
        "adapter": args.adapter,
        "device": device,
        "total_seconds": round(time.time() - started, 3),
        "prompts": outputs,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
