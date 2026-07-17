#!/usr/bin/env python3
"""Run a clean Czech quality benchmark for the base and tuned Qwen3 models."""

from __future__ import annotations

import argparse
import gc
import json
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
HF_CACHE = ROOT / "english-base" / "hf-cache"
DEFAULT_BASE_MODEL = "Qwen/Qwen3-1.7B"
DEFAULT_TUNED_MODEL = ROOT / "czech-finetuned" / "exports" / "qwen3-1.7b-lora-003-hard" / "merged-hf"
BENCHMARK_DIR = ROOT / "benchmarks"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


@dataclass(frozen=True)
class Probe:
    id: str
    category: str
    prompt: str
    target: str | None = None
    acceptable: tuple[str, ...] = ()
    required: tuple[str, ...] = ()
    forbidden: tuple[str, ...] = ()
    max_new_tokens: int = 80
    max_chars: int = 360


PROBES = [
    Probe(
        id="diacritics_shop",
        category="diacritics",
        prompt="Oprav diakritiku. Vrať pouze opravenou větu: Dobry den, chtel bych dve kavy a jeden ucet prosim.",
        target="Dobrý den, chtěl bych dvě kávy a jeden účet, prosím.",
        acceptable=("Dobrý den, chtěl bych dvě kávy a jeden účet, prosím.",),
    ),
    Probe(
        id="diacritics_station",
        category="diacritics",
        prompt="Oprav diakritiku. Vrať pouze opravenou větu: Prosim vas, kde je nadrazi?",
        target="Prosím vás, kde je nádraží?",
        acceptable=("Prosím vás, kde je nádraží?",),
    ),
    Probe(
        id="diacritics_food",
        category="diacritics",
        prompt="Oprav diakritiku. Vrať pouze opravenou větu: Mam rad ceskou kavu a cerstvy chleb.",
        target="Mám rád českou kávu a čerstvý chléb.",
        acceptable=("Mám rád českou kávu a čerstvý chléb.",),
    ),
    Probe(
        id="translate_bus",
        category="translation",
        prompt="Přelož do češtiny. Vrať pouze český výraz: bus",
        acceptable=("autobus",),
    ),
    Probe(
        id="translate_station_question",
        category="translation",
        prompt="Přelož do češtiny. Vrať pouze větu: Where is the station?",
        acceptable=("Kde je nádraží?", "Kde je stanice?"),
    ),
    Probe(
        id="translate_i_do_not_understand",
        category="translation",
        prompt="Přelož do češtiny. Vrať pouze větu: I do not understand.",
        acceptable=("Nerozumím.", "Já nerozumím.", "Nerozumím tomu."),
    ),
    Probe(
        id="verb_i_speak",
        category="verb_form",
        prompt="Přelož do češtiny. Vrať pouze tvar slovesa: I speak",
        acceptable=("mluvím",),
    ),
    Probe(
        id="verb_we_pay",
        category="verb_form",
        prompt="Přelož do češtiny. Vrať pouze tvar slovesa: we pay",
        acceptable=("platíme",),
    ),
    Probe(
        id="case_to_shop",
        category="case_usage",
        prompt="Napiš česky pouze větu: I am going to the shop.",
        acceptable=("Jdu do obchodu.", "Jdu do obchodu"),
        required=("do obchodu",),
    ),
    Probe(
        id="case_two_coffees",
        category="case_usage",
        prompt="Napiš česky pouze větu: I would like two coffees.",
        acceptable=("Chtěl bych dvě kávy.", "Chtěla bych dvě kávy.", "Dal bych si dvě kávy."),
        required=("dvě kávy",),
    ),
    Probe(
        id="greetings_short_list",
        category="controlled_generation",
        prompt="Napiš česky krátký seznam přesně tří pozdravů. Bez vysvětlení.",
        required=("ahoj", "dobrý den"),
        forbidden=("hello", "good morning"),
        max_new_tokens=64,
    ),
    Probe(
        id="shop_dialogue_required_words",
        category="controlled_generation",
        prompt=(
            "Napiš česky čtyři krátké repliky v obchodě. "
            "Použij slova: rohlíky, mléko, účet, prosím, děkuji."
        ),
        required=("rohlíky", "mléko", "účet", "prosím", "děkuji"),
        forbidden=("roll", "milk", "bill", "please", "thank"),
        max_new_tokens=120,
        max_chars=520,
    ),
    Probe(
        id="please_vs_thanks",
        category="explanation",
        prompt="Vysvětli česky ve dvou krátkých větách rozdíl mezi „prosím“ a „děkuji“.",
        required=("prosím", "děkuji"),
        forbidden=("please", "thanks"),
        max_new_tokens=100,
        max_chars=420,
    ),
    Probe(
        id="question_ticket",
        category="phrase_generation",
        prompt="Napiš česky pouze otázku: Can I buy a ticket here?",
        acceptable=("Mohu si tady koupit jízdenku?", "Můžu si tady koupit jízdenku?", "Mohu si zde koupit jízdenku?"),
        required=("koupit", "jízdenku"),
    ),
    Probe(
        id="simple_weather",
        category="phrase_generation",
        prompt="Napiš česky pouze větu: Today it is cold and raining.",
        required=("dnes", "zima"),
        acceptable=("Dnes je zima a prší.",),
    ),
    Probe(
        id="no_mojibake",
        category="orthography",
        prompt="Napiš česky jednu krátkou větu se slovy: český, nádraží, účet.",
        required=("česk", "nádraží", "účet"),
        max_new_tokens=64,
    ),
]

MOJIBAKE_RE = re.compile(r"[ÃÄÅâ€œ€]")
THINK_RE = re.compile(r"<think>.*?</think>\s*", re.IGNORECASE | re.DOTALL)
ENGLISH_RE = re.compile(r"\b(the|hello|please|thanks|thank you|good morning|station|ticket|shop|coffee|bus)\b", re.IGNORECASE)
CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")


def normalize(text: str) -> str:
    text = THINK_RE.sub("", text)
    text = unicodedata.normalize("NFC", text)
    text = text.strip().lower()
    text = re.sub(r"^[\s\"'“”„.,:;!?-]+|[\s\"'“”„.,:;!?-]+$", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def compact(text: str) -> str:
    return re.sub(r"[\s\"'“”„.,:;!?-]+", "", normalize(text))


def has_diacritic(char: str) -> bool:
    return any(unicodedata.category(part) == "Mn" for part in unicodedata.normalize("NFD", char))


def diacritic_accuracy(output: str, target: str | None) -> float:
    if not target:
        return 1.0
    output_c = compact(output)
    target_c = compact(target)
    accented_positions = [
        index for index, char in enumerate(target_c)
        if has_diacritic(char)
    ]
    if not accented_positions:
        return 1.0
    hits = 0
    for index in accented_positions:
        if index < len(output_c) and output_c[index] == target_c[index]:
            hits += 1
    return hits / len(accented_positions)


def clean_output(text: str) -> str:
    return THINK_RE.sub("", text).strip()


def chat_prompt(tokenizer: Any, user: str) -> str:
    messages = [{"role": "user", "content": user}]
    try:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
    except TypeError:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


def load_model(model_id: str, device: str):
    tokenizer = AutoTokenizer.from_pretrained(model_id, cache_dir=HF_CACHE, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        cache_dir=HF_CACHE if not Path(model_id).exists() else None,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        trust_remote_code=True,
        low_cpu_mem_usage=True,
    )
    model.to(device)
    model.eval()
    return tokenizer, model


def run_generation(tokenizer: Any, model: Any, device: str, probe: Probe) -> dict[str, Any]:
    prompt = chat_prompt(tokenizer, probe.prompt)
    inputs = tokenizer(prompt, return_tensors="pt").to(device)
    started = time.time()
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            max_new_tokens=probe.max_new_tokens,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    elapsed = time.time() - started
    new_tokens = generated[0, inputs["input_ids"].shape[-1] :]
    raw = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
    return {
        "id": probe.id,
        "category": probe.category,
        "prompt": probe.prompt,
        "target": probe.target,
        "acceptable": list(probe.acceptable),
        "required": list(probe.required),
        "forbidden": list(probe.forbidden),
        "raw_output": raw,
        "output": clean_output(raw),
        "seconds": round(elapsed, 3),
        "max_chars": probe.max_chars,
    }


def score_result(row: dict[str, Any]) -> dict[str, Any]:
    output = row["output"]
    norm = normalize(output)
    compact_out = compact(output)
    reasons: list[str] = []

    exact_match = False
    match_score = 0.0
    if row["category"] == "diacritics" and row["target"]:
        similarity = SequenceMatcher(None, compact_out, compact(row["target"])).ratio()
        accent_score = diacritic_accuracy(output, row["target"])
        match_score = 0.4 * similarity + 0.6 * accent_score
        exact_match = compact_out == compact(row["target"])
        reasons.append(f"target similarity {similarity:.2f}")
        reasons.append(f"diacritic accuracy {accent_score:.2f}")
    elif row["acceptable"]:
        acceptable_compact = [compact(item) for item in row["acceptable"]]
        if compact_out in acceptable_compact:
            match_score = 1.0
            exact_match = True
            reasons.append("exact acceptable match")
        else:
            closest = max(SequenceMatcher(None, compact_out, item).ratio() for item in acceptable_compact)
            if row["category"] in {"translation", "verb_form"}:
                match_score = 0.0
                reasons.append(f"no exact translation/form match; closest similarity {closest:.2f}")
            else:
                match_score = closest if closest >= 0.82 else 0.0
                reasons.append(f"closest acceptable similarity {closest:.2f}")
    elif row["target"]:
        match_score = SequenceMatcher(None, compact_out, compact(row["target"])).ratio()
        reasons.append(f"target similarity {match_score:.2f}")

    required = [normalize(item) for item in row["required"]]
    required_hits = [item for item in required if item and item in norm]
    required_score = len(required_hits) / len(required) if required else 1.0
    if required:
        reasons.append(f"required terms {len(required_hits)}/{len(required)}")

    forbidden = [item for item in row["forbidden"] if item and re.search(re.escape(item), output, re.IGNORECASE)]
    forbidden_penalty = min(0.3, 0.12 * len(forbidden))
    if forbidden:
        reasons.append(f"forbidden terms: {', '.join(forbidden)}")

    mojibake_penalty = 0.3 if MOJIBAKE_RE.search(output) else 0.0
    if mojibake_penalty:
        reasons.append("mojibake detected")

    english_penalty = 0.15 if ENGLISH_RE.search(output) else 0.0
    if english_penalty:
        reasons.append("English leakage detected")

    cyrillic_penalty = 0.3 if CYRILLIC_RE.search(output) else 0.0
    if cyrillic_penalty:
        reasons.append("Cyrillic characters detected")

    length_penalty = 0.1 if len(output) > row.get("max_chars", 360) else 0.0
    if length_penalty:
        reasons.append("too verbose")

    if row["category"] == "diacritics":
        positive = match_score
    elif row["acceptable"] or row["target"]:
        positive = match_score if not row["required"] else 0.7 * match_score + 0.3 * required_score
    else:
        positive = required_score

    score = max(
        0.0,
        min(1.0, positive - forbidden_penalty - mojibake_penalty - english_penalty - cyrillic_penalty - length_penalty),
    )
    return {
        "score": round(score, 3),
        "match_score": round(match_score, 3) if (row["acceptable"] or row["target"]) else None,
        "exact_match": exact_match,
        "required_score": round(required_score, 3),
        "has_mojibake": bool(mojibake_penalty),
        "has_english_leakage": bool(english_penalty),
        "has_cyrillic": bool(cyrillic_penalty),
        "too_verbose": bool(length_penalty),
        "reasons": reasons,
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    categories: dict[str, list[float]] = {}
    for row in rows:
        categories.setdefault(row["category"], []).append(row["score"]["score"])
    return {
        "overall_score": round(sum(row["score"]["score"] for row in rows) / len(rows), 3),
        "pass_at_0_8": sum(1 for row in rows if row["score"]["score"] >= 0.8),
        "count": len(rows),
        "category_scores": {
            category: round(sum(values) / len(values), 3)
            for category, values in sorted(categories.items())
        },
    }


def unload(model: Any) -> None:
    del model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def run_model(label: str, model_id: str, device: str) -> dict[str, Any]:
    tokenizer, model = load_model(model_id, device)
    started = time.time()
    rows = []
    for probe in PROBES:
        row = run_generation(tokenizer, model, device, probe)
        row["score"] = score_result(row)
        rows.append(row)
        print(f"{label} {probe.id}: {row['score']['score']:.3f} :: {row['output'][:120]}")
    total_seconds = round(time.time() - started, 3)
    unload(model)
    return {
        "label": label,
        "model_id": model_id,
        "device": device,
        "total_seconds": total_seconds,
        "summary": summarize(rows),
        "prompts": rows,
    }


def write_report(result: dict[str, Any], out: Path) -> None:
    models = result["models"]
    base = models["base"]
    tuned = models["tuned"]
    lines = [
        "# Czech Language Benchmark",
        "",
        f"- Date: `{result['created_at']}`",
        f"- Device: `{result['device']}`",
        f"- Base model: `{base['model_id']}`",
        f"- Tuned model: `{tuned['model_id']}`",
        f"- Prompt policy: no system prompt; each probe includes only the user instruction.",
        f"- Scoring: rule-based exact/substring/similarity checks plus penalties for mojibake, English leakage, and verbosity.",
        "",
        "## Summary",
        "",
        "| Model | Overall | Pass >= 0.8 | Time |",
        "| --- | ---: | ---: | ---: |",
        f"| Base | {base['summary']['overall_score']:.3f} | {base['summary']['pass_at_0_8']}/{base['summary']['count']} | {base['total_seconds']}s |",
        f"| Tuned | {tuned['summary']['overall_score']:.3f} | {tuned['summary']['pass_at_0_8']}/{tuned['summary']['count']} | {tuned['total_seconds']}s |",
        "",
        "## Category Scores",
        "",
        "| Category | Base | Tuned |",
        "| --- | ---: | ---: |",
    ]
    categories = sorted(set(base["summary"]["category_scores"]) | set(tuned["summary"]["category_scores"]))
    for category in categories:
        lines.append(
            f"| {category} | {base['summary']['category_scores'].get(category, 0):.3f} | "
            f"{tuned['summary']['category_scores'].get(category, 0):.3f} |"
        )
    tuned_by_id = {row["id"]: row for row in tuned["prompts"]}
    lines.extend(["", "## Prompt Results", ""])
    for base_row in base["prompts"]:
        tuned_row = tuned_by_id[base_row["id"]]
        lines.extend(
            [
                f"### {base_row['id']}",
                "",
                f"Category: `{base_row['category']}`",
                "",
                f"Prompt: {base_row['prompt']}",
                "",
                f"Base score: `{base_row['score']['score']}`",
                "",
                "```text",
                base_row["output"],
                "```",
                "",
                f"Tuned score: `{tuned_row['score']['score']}`",
                "",
                "```text",
                tuned_row["output"],
                "```",
                "",
            ]
        )
    out.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--tuned-model", default=str(DEFAULT_TUNED_MODEL))
    parser.add_argument("--out-json", default=str(BENCHMARK_DIR / "czech-language-benchmark-qwen3-1.7b-lora-003-hard.json"))
    parser.add_argument("--out-md", default=str(BENCHMARK_DIR / "czech-language-benchmark-qwen3-1.7b-lora-003-hard.md"))
    parser.add_argument("--score-existing", action="store_true", help="Re-score an existing output JSON without regenerating.")
    args = parser.parse_args()

    out_json = Path(args.out_json)
    out_md = Path(args.out_md)
    if args.score_existing:
        result = json.loads(out_json.read_text(encoding="utf-8"))
        for model_result in result["models"].values():
            for row in model_result["prompts"]:
                row["score"] = score_result(row)
            model_result["summary"] = summarize(model_result["prompts"])
        out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_report(result, out_md)
        print(f"Re-scored {out_json}")
        print(f"Wrote {out_md}")
        return 0

    device = "cuda" if torch.cuda.is_available() else "cpu"
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    result = {
        "version": 1,
        "created_at": created_at,
        "device": device,
        "probe_count": len(PROBES),
        "models": {},
    }

    result["models"]["base"] = run_model("base", args.base_model, device)
    result["models"]["tuned"] = run_model("tuned", args.tuned_model, device)

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(result, out_md)
    print(f"Wrote {out_json}")
    print(f"Wrote {out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
