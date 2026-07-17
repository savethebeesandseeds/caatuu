#!/usr/bin/env python3
"""Evaluate a Czech-to-English utility LoRA with simple generation checks."""

from __future__ import annotations

import argparse
import difflib
import json
import re
from pathlib import Path
from typing import Any

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
HF_CACHE = ROOT / "english-base" / "hf-cache"
WORD_RE = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
CZECH_MARK_RE = re.compile(r"[\u00e1\u010d\u010f\u00e9\u011b\u00ed\u0148\u00f3\u0159\u0161\u0165\u00fa\u016f\u00fd\u017e]", re.I)
META_RE = re.compile(r"\b(translation|translate|czech|english|sentence|means|word)\b", re.I)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def clean_output(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = text.split("\n", 1)[0].strip()
    match = re.search(r"^(.+?[.!?])(?:\s|$)", text)
    if match:
        return match.group(1).strip()
    return text


def normalize(text: str) -> str:
    text = text.casefold()
    text = re.sub(r"[^a-z0-9' -]+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def word_set(text: str) -> set[str]:
    return {match.group(0).casefold() for match in WORD_RE.finditer(text)}


def similarity_metrics(actual: str, expected: str) -> dict[str, float | bool]:
    actual_norm = normalize(actual)
    expected_norm = normalize(expected)
    if not actual_norm or not expected_norm:
        return {
            "normalized_exact": False,
            "sequence_similarity": 0.0,
            "word_precision": 0.0,
            "word_recall": 0.0,
            "word_f1": 0.0,
            "similarity": 0.0,
        }
    sequence = difflib.SequenceMatcher(None, actual_norm, expected_norm).ratio()
    actual_words = word_set(actual_norm)
    expected_words = word_set(expected_norm)
    overlap = len(actual_words & expected_words)
    precision = overlap / len(actual_words) if actual_words else 0.0
    recall = overlap / len(expected_words) if expected_words else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "normalized_exact": actual_norm == expected_norm,
        "sequence_similarity": sequence,
        "word_precision": precision,
        "word_recall": recall,
        "word_f1": f1,
        "similarity": max(sequence, f1),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", default="BUT-FIT/CSTinyLlama-1.2B")
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--benchmark", required=True)
    parser.add_argument("--out-jsonl", required=True)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--limit", type=int, default=0, help="0 evaluates the full benchmark.")
    parser.add_argument("--max-new-tokens", type=int, default=48)
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
    model = PeftModel.from_pretrained(model, args.adapter)
    model.to(device)
    model.eval()

    rows = read_jsonl(Path(args.benchmark))
    if args.limit:
        rows = rows[: args.limit]

    results: list[dict[str, Any]] = []
    for idx, row in enumerate(rows, start=1):
        prompt = row["prompt"]
        expected = row["expected_english_text"]
        inputs = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(device)
        with torch.no_grad():
            generated = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )
        new_ids = generated[0, inputs["input_ids"].shape[1] :]
        raw_output = tokenizer.decode(new_ids, skip_special_tokens=True)
        output = clean_output(raw_output)
        metrics = similarity_metrics(output, expected)
        score = float(metrics["similarity"])
        english_ok = bool(WORD_RE.search(output)) and not CZECH_MARK_RE.search(output)
        concise_ok = 1 <= len(word_set(output)) <= 20
        meta_ok = not META_RE.search(output)
        passed = bool(score >= 0.72 and english_ok and concise_ok and meta_ok)
        result = {
            "id": row.get("id", idx),
            "czech_text": row.get("czech_text", ""),
            "expected_english_text": expected,
            "raw_output": raw_output,
            "output": output,
            "similarity": round(score, 4),
            "normalized_exact": metrics["normalized_exact"],
            "sequence_similarity": round(float(metrics["sequence_similarity"]), 4),
            "word_precision": round(float(metrics["word_precision"]), 4),
            "word_recall": round(float(metrics["word_recall"]), 4),
            "word_f1": round(float(metrics["word_f1"]), 4),
            "english_ok": english_ok,
            "concise_ok": concise_ok,
            "meta_ok": meta_ok,
            "passed": passed,
        }
        results.append(result)
        print(json.dumps(result, ensure_ascii=False))

    summary = {
        "model_id": args.model_id,
        "adapter": args.adapter,
        "examples": len(results),
        "passed": sum(1 for row in results if row["passed"]),
        "normalized_exact": sum(1 for row in results if row["normalized_exact"]),
        "english_ok": sum(1 for row in results if row["english_ok"]),
        "concise_ok": sum(1 for row in results if row["concise_ok"]),
        "meta_ok": sum(1 for row in results if row["meta_ok"]),
        "average_similarity": round(
            sum(row["similarity"] for row in results) / len(results),
            4,
        )
        if results
        else 0.0,
        "average_word_f1": round(
            sum(row["word_f1"] for row in results) / len(results),
            4,
        )
        if results
        else 0.0,
    }
    summary["pass_rate"] = summary["passed"] / summary["examples"] if summary["examples"] else 0

    Path(args.out_jsonl).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_jsonl).write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in results),
        encoding="utf-8",
    )
    Path(args.out_json).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
