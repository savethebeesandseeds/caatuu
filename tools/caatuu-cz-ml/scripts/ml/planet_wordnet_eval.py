#!/usr/bin/env python3
"""Evaluate a Planet Word Net utility model with natural-sentence checks."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
HF_CACHE = ROOT / "english-base" / "hf-cache"
WORD_RE = re.compile(r"\w+(?:[-']\w+)*", re.UNICODE)
CZECH_LETTER_RE = re.compile(r"[a-z\u00e1\u010d\u010f\u00e9\u011b\u00ed\u0148\u00f3\u0159\u0161\u0165\u00fa\u016f\u00fd\u017e]", re.I)
ENGLISH_RE = re.compile(r"\b(the|and|with|word|sentence|please|house|dog|cat|coffee|means|example)\b", re.I)
FUNCTION_WORDS = {
    "a",
    "i",
    "je",
    "jsou",
    "ma",
    "mam",
    "na",
    "s",
    "se",
    "si",
    "ta",
    "ten",
    "to",
    "u",
    "v",
    "ve",
}
META_TERMS = {
    "anglicky",
    "casovani",
    "cesky",
    "grammar",
    "gramatika",
    "meaning",
    "means",
    "napsat",
    "objevuje",
    "obsahuje",
    "pojem",
    "pouziva",
    "preklad",
    "priklad",
    "rict",
    "sentence",
    "sklonovani",
    "slovo",
    "translation",
    "tvar",
    "veta",
    "vyraz",
    "vyslovit",
    "vyznam",
    "word",
    "znamena",
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def lower_cs(text: str) -> str:
    return text.casefold()


def ascii_fold(text: str) -> str:
    normalized = unicodedata.normalize("NFD", lower_cs(text))
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def tokens(text: str) -> list[str]:
    return [lower_cs(item.group(0)) for item in WORD_RE.finditer(text)]


def folded_tokens(text: str) -> list[str]:
    return [ascii_fold(item.group(0)) for item in WORD_RE.finditer(text)]


def first_sentence(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = text.split("\n", 1)[0].strip()
    match = re.search(r"^(.+?[.!?])(?:\s|$)", text)
    if match:
        return match.group(1).strip()
    return text


def looks_czech(text: str) -> bool:
    if not text:
        return False
    if ENGLISH_RE.search(text):
        return False
    return bool(CZECH_LETTER_RE.search(text))


def has_meta_language(text: str) -> bool:
    return any(token in META_TERMS for token in folded_tokens(text))


def sentence_skeleton(text: str, target: str) -> str:
    target_folded = ascii_fold(target)
    parts: list[str] = []
    for token in folded_tokens(text):
        if token == target_folded:
            parts.append("TARGET")
        elif token in FUNCTION_WORDS:
            parts.append(token.upper())
        elif len(token) <= 3:
            parts.append("SHORT")
        else:
            parts.append("WORD")
    return " ".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", default="BUT-FIT/CSTinyLlama-1.2B")
    parser.add_argument("--adapter", default=None)
    parser.add_argument("--benchmark", required=True)
    parser.add_argument("--out-jsonl", required=True)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--limit", type=int, default=0, help="0 evaluates the full benchmark.")
    parser.add_argument("--max-new-tokens", type=int, default=48)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--min-tokens", type=int, default=2)
    parser.add_argument("--max-tokens", type=int, default=16)
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

    rows = read_jsonl(Path(args.benchmark))
    if args.limit:
        rows = rows[: args.limit]

    results: list[dict[str, Any]] = []
    for idx, row in enumerate(rows, start=1):
        prompt = row["prompt"]
        word = lower_cs(row.get("target_input") or row["word"])
        inputs = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(device)
        with torch.no_grad():
            generated = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                do_sample=args.temperature > 0,
                temperature=args.temperature if args.temperature > 0 else None,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )
        new_ids = generated[0, inputs["input_ids"].shape[1] :]
        raw_output = tokenizer.decode(new_ids, skip_special_tokens=True)
        sentence = first_sentence(raw_output)
        output_tokens = tokens(sentence)
        token_count = len(output_tokens)
        contains_word = word in output_tokens
        target_ok = contains_word
        one_sentence = bool(sentence) and "\n" not in sentence and len(re.findall(r"[.!?]", sentence)) <= 1
        length_ok = 4 <= len(sentence) <= 140 and args.min_tokens <= token_count <= args.max_tokens
        czech_ok = looks_czech(sentence)
        meta_ok = not has_meta_language(sentence)
        english_ok = not ENGLISH_RE.search(sentence)
        passed = bool(target_ok and one_sentence and length_ok and czech_ok and meta_ok and english_ok)
        result = {
            "id": row.get("id", idx),
            "word": row["word"],
            "target_input": row.get("target_input") or row["word"],
            "target_mode": row.get("target_mode", "surface"),
            "benchmark_split": row.get("split", "unspecified"),
            "training_hits": row.get("training_hits"),
            "source_hits": row.get("source_hits"),
            "prompt": prompt,
            "raw_output": raw_output,
            "sentence": sentence,
            "contains_word": contains_word,
            "target_ok": target_ok,
            "one_sentence": one_sentence,
            "length_ok": length_ok,
            "czech_ok": czech_ok,
            "meta_ok": meta_ok,
            "english_ok": english_ok,
            "token_count": token_count,
            "sentence_skeleton": sentence_skeleton(sentence, word),
            "passed": passed,
        }
        results.append(result)
        print(json.dumps(result, ensure_ascii=False))

    skeleton_counts: dict[str, int] = {}
    for row in results:
        skeleton_counts[row["sentence_skeleton"]] = skeleton_counts.get(row["sentence_skeleton"], 0) + 1

    summary = {
        "model_id": args.model_id,
        "adapter": args.adapter,
        "examples": len(results),
        "passed": sum(1 for row in results if row["passed"]),
        "contains_word": sum(1 for row in results if row["contains_word"]),
        "target_ok": sum(1 for row in results if row["target_ok"]),
        "one_sentence": sum(1 for row in results if row["one_sentence"]),
        "length_ok": sum(1 for row in results if row["length_ok"]),
        "czech_ok": sum(1 for row in results if row["czech_ok"]),
        "meta_ok": sum(1 for row in results if row["meta_ok"]),
        "english_ok": sum(1 for row in results if row["english_ok"]),
        "unique_skeletons": len(skeleton_counts),
        "top_skeletons": [
            {"skeleton": skeleton, "count": count}
            for skeleton, count in sorted(skeleton_counts.items(), key=lambda item: (-item[1], item[0]))[:10]
        ],
    }
    summary["pass_rate"] = summary["passed"] / summary["examples"] if summary["examples"] else 0
    summary["contains_word_rate"] = summary["contains_word"] / summary["examples"] if summary["examples"] else 0
    summary["validated_success_at_1"] = summary["pass_rate"]
    summary["meta_failure_rate"] = (
        sum(1 for row in results if not row["meta_ok"]) / len(results) if results else 0
    )
    summary["missing_target_rate"] = (
        sum(1 for row in results if not row["target_ok"]) / len(results) if results else 0
    )
    summary["splits"] = {}
    for split in sorted({row["benchmark_split"] for row in results}):
        split_rows = [row for row in results if row["benchmark_split"] == split]
        split_examples = len(split_rows)
        split_passed = sum(1 for row in split_rows if row["passed"])
        split_contains = sum(1 for row in split_rows if row["contains_word"])
        summary["splits"][split] = {
            "examples": split_examples,
            "passed": split_passed,
            "pass_rate": split_passed / split_examples if split_examples else 0,
            "contains_word": split_contains,
            "contains_word_rate": split_contains / split_examples if split_examples else 0,
        }

    Path(args.out_jsonl).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_jsonl).write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in results),
        encoding="utf-8",
    )
    Path(args.out_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_json).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
