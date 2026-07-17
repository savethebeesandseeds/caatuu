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

function normalizeText(text, locale = "cs-CZ") {
  return String(text || "")
    .normalize("NFC")
    .toLocaleLowerCase(locale)
    .replace(/\s+/gu, " ")
    .trim();
}

function pairKey(row) {
  const englishText = row.english_text || row.expected_english_text;
  return `${normalizeText(row.czech_text)}\n${normalizeText(englishText, "en-US")}`;
}

function assertDisjoint(left, right, label) {
  const leftPairs = new Set(left.map(pairKey));
  const pairOverlap = right.filter((row) => leftPairs.has(pairKey(row)));
  if (pairOverlap.length) throw new Error(`${label}: found ${pairOverlap.length} overlapping Czech/English pairs.`);

  const leftSources = new Set(left.map((row) => normalizeText(row.czech_text)));
  const sourceOverlap = right.filter((row) => leftSources.has(normalizeText(row.czech_text)));
  if (sourceOverlap.length) throw new Error(`${label}: found ${sourceOverlap.length} repeated Czech source prompts.`);
}

const sourceDir = path.resolve(argValue("--source-dir", defaultSourceDir));
const outDir = path.resolve(argValue("--out-dir", defaultOutDir));
const sourceTrainRows = await readJsonl(path.join(sourceDir, "train.jsonl"));
const sourceValRows = await readJsonl(path.join(sourceDir, "val.jsonl"));
const sourceTestRows = await readJsonl(path.join(sourceDir, "benchmark.jsonl"));
assertDisjoint(sourceTrainRows, sourceValRows, "train/validation leakage");
assertDisjoint(sourceTrainRows, sourceTestRows, "train/test leakage");
assertDisjoint(sourceValRows, sourceTestRows, "validation/test leakage");

const trainRows = sourceTrainRows.map((row, index) => toTrainRow(row, index, "train"));
const valRows = sourceValRows.map((row, index) => toTrainRow(row, index, "val"));
const testRows = sourceTestRows.map((row, index) => toTrainRow(row, index, "test"));
const trainAllRows = [...trainRows, ...valRows];

await writeJsonl(path.join(outDir, "train.jsonl"), trainRows);
await writeJsonl(path.join(outDir, "val.jsonl"), valRows);
await writeJsonl(path.join(outDir, "test.jsonl"), testRows);
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
      test_examples: testRows.length,
      train_all_examples: trainAllRows.length,
      prompt_template: "translate_cs_to_en_qwen_chat_v1",
      split_policy: "train, validation, and test Czech/English pairs and normalized Czech source prompts are disjoint.",
      note: "Derived chat-template dataset for Qwen. train_all.jsonl contains train + validation only; test.jsonl and the source benchmark stay held out.",
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(JSON.stringify({
  out_dir: path.relative(root, outDir),
  train: trainRows.length,
  val: valRows.length,
  test: testRows.length,
  train_all: trainAllRows.length,
}, null, 2));
