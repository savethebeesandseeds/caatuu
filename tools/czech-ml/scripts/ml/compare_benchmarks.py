#!/usr/bin/env python3
"""Create a compact side-by-side benchmark report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--finetuned", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    base = read_json(Path(args.base))
    tuned = read_json(Path(args.finetuned))
    tuned_by_id = {row["id"]: row for row in tuned["prompts"]}

    lines = [
        "# Qwen3-1.7B Czech LoRA Benchmark",
        "",
        f"- Base model: `{base['model_id']}`",
        f"- Adapter: `{tuned['adapter']}`",
        f"- Device: `{tuned['device']}`",
        f"- Base total generation time: `{base['total_seconds']}s`",
        f"- Fine-tuned total generation time: `{tuned['total_seconds']}s`",
        "",
        "## Side-by-side",
        "",
    ]

    for base_row in base["prompts"]:
        tuned_row = tuned_by_id[base_row["id"]]
        lines.extend(
            [
                f"### {base_row['id']}",
                "",
                f"Prompt: {base_row['user']}",
                "",
                "Base:",
                "",
                "```text",
                base_row["output"],
                "```",
                "",
                "Fine-tuned:",
                "",
                "```text",
                tuned_row["output"],
                "```",
                "",
            ]
        )

    lines.extend(
        [
            "## Notes",
            "",
            "- The adapter improved direct diacritic restoration in several cases.",
            "- The adapter is not production-ready: it still makes Czech lexical errors and collapsed the open shop-dialogue prompt.",
            "- This run is useful as proof that LoRA training works on the local GPU, not as the final Czech model.",
            "",
        ]
    )
    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
