import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const defaultSourceDir = path.join(root, "data", "models", "czech-finetuned", "training-data", "translation-cs-en-001");
const defaultOutDir = path.join(root, "data", "models", "czech-finetuned", "training-data", "translation-cs-en-qwen3-chat-001");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJsonl(file, rows) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function userPrompt(czechText) {
  return [
    "Translate this Czech sentence into simple English.",
    "Return only the English sentence.",
    `Czech: ${String(czechText || "").trim()}`,
    "English:",
  ].join("\n");
}

function toTrainRow(row, index, split) {
  const czechText = String(row.czech_text || "").trim();
  const englishText = String(row.english_text || row.expected_english_text || "").trim();
  if (!czechText) throw new Error(`${split} row ${index + 1}: blank czech_text`);
  if (!englishText) throw new Error(`${split} row ${index + 1}: blank english text`);
  return {
    messages: [
      { role: "user", content: userPrompt(czechText) },
      { role: "assistant", content: englishText },
    ],
    task: "translation_cs_en_qwen_chat",
    czech_text: czechText,
    english_text: englishText,
    source_id: row.source_id || row.id || "",
    source_dataset: row.source_dataset || "",
    source_kind: row.source_kind || "",
    topic: row.topic || "",
    difficulty: row.difficulty ?? null,
    prompt_template: "translate_cs_to_en_qwen_chat_v1",
  };
}

const sourceDir = path.resolve(argValue("--source-dir", defaultSourceDir));
const outDir = path.resolve(argValue("--out-dir", defaultOutDir));
const trainRows = (await readJsonl(path.join(sourceDir, "train.jsonl"))).map((row, index) => toTrainRow(row, index, "train"));
const valRows = (await readJsonl(path.join(sourceDir, "benchmark.jsonl"))).map((row, index) => toTrainRow(row, index, "val"));
const trainAllRows = [...trainRows, ...valRows];

await writeJsonl(path.join(outDir, "train.jsonl"), trainRows);
await writeJsonl(path.join(outDir, "val.jsonl"), valRows);
await writeJsonl(path.join(outDir, "train_all.jsonl"), trainAllRows);
await fs.writeFile(
  path.join(outDir, "summary.json"),
  JSON.stringify(
    {
      task: "translation_cs_en_qwen_chat",
      generated_at: new Date().toISOString(),
      source_dir: path.relative(root, sourceDir).replaceAll("\\", "/"),
      train_examples: trainRows.length,
      val_examples: valRows.length,
      train_all_examples: trainAllRows.length,
      prompt_template: "translate_cs_to_en_qwen_chat_v1",
      note: "Derived chat-template dataset for Qwen. train_all.jsonl intentionally appends the benchmark rows for final release training after validation is complete.",
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(JSON.stringify({ out_dir: path.relative(root, outDir), train: trainRows.length, val: valRows.length, train_all: trainAllRows.length }, null, 2));
