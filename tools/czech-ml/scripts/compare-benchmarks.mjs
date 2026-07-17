#!/usr/bin/env node
import fs from "node:fs/promises";
import { readJson } from "./jsonl.mjs";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const basePath = arg("--base");
const tunedPath = arg("--finetuned");
const outPath = arg("--out");

if (!basePath || !tunedPath || !outPath) {
  console.error("Usage: node scripts/compare-benchmarks.mjs --base base.json --finetuned tuned.json --out report.md");
  process.exit(2);
}

const base = await readJson(basePath);
const tuned = await readJson(tunedPath);
const tunedById = new Map(tuned.prompts.map((row) => [row.id, row]));

const lines = [
  "# Qwen3-1.7B Czech LoRA Benchmark",
  "",
  `- Base model: \`${base.model_id}\``,
  `- Adapter: \`${tuned.adapter}\``,
  `- Device: \`${tuned.device}\``,
  `- Base total generation time: \`${base.total_seconds}s\``,
  `- Fine-tuned total generation time: \`${tuned.total_seconds}s\``,
  "",
  "## Side-by-side",
  ""
];

for (const baseRow of base.prompts) {
  const tunedRow = tunedById.get(baseRow.id);
  lines.push(
    `### ${baseRow.id}`,
    "",
    `Prompt: ${baseRow.user}`,
    "",
    "Base:",
    "",
    "```text",
    baseRow.output || "",
    "```",
    "",
    "Fine-tuned:",
    "",
    "```text",
    tunedRow?.output || "",
    "```",
    ""
  );
}

await fs.mkdir(outPath.replace(/[\\/][^\\/]*$/, ""), { recursive: true });
await fs.writeFile(outPath, lines.join("\n"), "utf8");
console.log(outPath);
