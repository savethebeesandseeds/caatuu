#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromModels, fromRoot } from "./paths.mjs";
import { shuffle, toJsonl, writeJson } from "./jsonl.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function argInt(name, fallback) {
  const value = argValue(name, null);
  return value === null ? fallback : Number.parseInt(value, 10);
}

const seed = argInt("--seed", 73);
const task = argValue("--task", "all");
const benchmarkRows = argInt("--benchmark-rows", 420);
const maxWordsPerSentence = argInt("--max-words-per-sentence", 4);
const translationOutDir = path.resolve(
  argValue("--translation-out-dir", fromModels("czech-finetuned", "training-data", "translation-cs-en-001")),
);
const wordSentenceOutDir = path.resolve(
  argValue("--word-sentence-out-dir", fromModels("czech-finetuned", "training-data", "czech-word-sentence-001")),
);

const sourceFiles = [
  {
    dataset: "curriculum-core-v0.2",
    kind: "curriculum_core",
    file: fromRoot("data", "curriculum", "core-v0.2", "curated", "curriculum-core.en.jsonl"),
  },
  {
    dataset: "common-phrases-v0.1",
    kind: "common_phrases",
    file: fromRoot("data", "curriculum", "common-phrases-v0.1", "curated", "common-phrases.en.jsonl"),
  },
];

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${file}:${index + 1}: ${error.message}`);
    }
  });
}

function assertBilingualRows(items) {
  if (!items.length) throw new Error("No curriculum rows found.");
  const errors = [];
  const ids = new Set();
  for (const [index, row] of items.entries()) {
    const rowLabel = `${row.source_dataset}:${row.id || index + 1}`;
    if (ids.has(rowLabel)) errors.push(`${rowLabel}: duplicate source/id pair`);
    ids.add(rowLabel);
    if (!String(row.english_text || "").trim()) errors.push(`${rowLabel}: blank english_text`);
    if (!String(row.czech_text || "").trim()) errors.push(`${rowLabel}: blank czech_text`);
    if (row.english_text === row.czech_text) errors.push(`${rowLabel}: English and Czech text are identical`);
    if (/[�]/u.test(row.czech_text)) errors.push(`${rowLabel}: replacement character in czech_text`);
  }
  if (errors.length) {
    throw new Error(`Invalid bilingual corpus:\n${errors.slice(0, 80).join("\n")}`);
  }
}

async function buildTranslationDataset(items) {
  const examples = items.map((row) => ({
    task: "translation_cs_en",
    prompt: `Úkol: Přelož českou větu do jednoduché angličtiny.\nČeština: ${row.czech_text}\nAngličtina:`,
    completion: ` ${row.english_text}`,
    czech_text: row.czech_text,
    english_text: row.english_text,
    source_id: row.id,
    source_dataset: row.source_dataset,
    source_kind: row.source_kind,
    difficulty: row.difficulty,
    cefr: row.cefr,
    age_band: row.age_band,
    topic: row.topic,
    prompt_template: "translate_cs_to_en_v1",
  }));
  shuffle(examples, seed);
  const benchmark = sampleBenchmark(examples, benchmarkRows, seed + 1).map((row, index) => ({
    id: `translate-cs-en-${String(index + 1).padStart(4, "0")}`,
    prompt: row.prompt,
    czech_text: row.czech_text,
    expected_english_text: row.english_text,
    source_id: row.source_id,
    source_dataset: row.source_dataset,
    topic: row.topic,
    expected: "one simple English translation, no explanation",
  }));
  const summary = summaryFor("translation_cs_en", examples, benchmark, {
    validation_split: false,
    prompt_template: "translate_cs_to_en_v1",
    direction: "cs->en",
    source_note: "Uses every curated bilingual row for training. benchmark.jsonl is a generation check, not a held-out loss split.",
  });
  await writeDataset(translationOutDir, examples, benchmark, summary);
  return compactSummary(translationOutDir, summary);
}

async function buildWordSentenceDataset(items) {
  const examples = [];
  const wordCounts = new Map();
  const sentenceCounts = new Map();
  for (const row of items) {
    const words = candidateWords(row.czech_text).slice(0, maxWordsPerSentence);
    if (!words.length) continue;
    sentenceCounts.set(row.source_dataset, (sentenceCounts.get(row.source_dataset) || 0) + 1);
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      examples.push({
        task: "czech_word_sentence",
        prompt: cleanWordSentencePrompt(word),
        completion: ` ${row.czech_text}`,
        word,
        target_input: word,
        target_mode: "surface",
        matched_surface: word,
        czech_text: row.czech_text,
        english_text: row.english_text,
        source_id: row.id,
        source_dataset: row.source_dataset,
        source_kind: row.source_kind,
        difficulty: row.difficulty,
        cefr: row.cefr,
        age_band: row.age_band,
        topic: row.topic,
        prompt_template: "clean_czech_word_sentence_v1",
      });
    }
  }
  shuffle(examples, seed + 10);
  const benchmarkWords = Array.from(wordCounts.entries())
    .filter(([word, count]) => count >= 2 && word.length >= 3 && word.length <= 16)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "cs"));
  shuffle(benchmarkWords, seed + 11);
  const benchmark = benchmarkWords.slice(0, benchmarkRows).map(([word, training_hits], index) => ({
    id: `czech-word-sentence-${String(index + 1).padStart(4, "0")}`,
    word,
    target_input: word,
    target_mode: "surface",
    prompt: cleanWordSentencePrompt(word),
    training_hits,
    expected: "one short natural Czech sentence containing the exact target form, with no meta-language",
  }));
  const summary = summaryFor("czech_word_sentence", examples, benchmark, {
    validation_split: false,
    prompt_template: cleanWordSentencePrompt("{target}"),
    max_words_per_sentence: maxWordsPerSentence,
    unique_target_words: wordCounts.size,
    training_sentence_source_counts: Object.fromEntries(Array.from(sentenceCounts.entries()).sort()),
    top_target_words: Array.from(wordCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "cs")).slice(0, 40),
    source_note: "Uses simple curated Czech curriculum rows only; no synthetic copy anchors and no external Czech story corpus.",
  });
  await writeDataset(wordSentenceOutDir, examples, benchmark, summary);
  return compactSummary(wordSentenceOutDir, summary);
}

function cleanWordSentencePrompt(word) {
  return `Cíl: ${word}\nNapiš jednu krátkou běžnou českou větu. Nevysvětluj.\nVěta:`;
}

function candidateWords(sentence) {
  const found = Array.from(String(sentence || "").matchAll(/\p{L}+(?:[-']\p{L}+)?/gu), (match) => match[0]);
  const seen = new Set();
  const candidates = [];
  for (const word of found) {
    const lower = word.toLocaleLowerCase("cs-CZ");
    const folded = asciiFold(lower);
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (lower.length < 3 || lower.length > 18) continue;
    if (czechStopWords.has(folded)) continue;
    if (/^(anna|tom|praha)$/iu.test(lower)) continue;
    candidates.push(lower);
  }
  return candidates.sort((left, right) => wordPriority(right) - wordPriority(left) || left.localeCompare(right, "cs"));
}

function wordPriority(word) {
  let score = 0;
  if (/[áčďéěíňóřšťúůýž]/u.test(word)) score += 5;
  if (word.length >= 4 && word.length <= 9) score += 3;
  if (word.length >= 10) score += 1;
  return score;
}

const czechStopWords = new Set([
  "aby", "ale", "ani", "ano", "asi", "az", "bez", "by", "byl", "byla", "byli", "bylo", "byt",
  "co", "dalsi", "do", "ho", "jak", "jako", "je", "jeho", "jeji", "jejich", "jsem", "jsi",
  "jsme", "jsou", "jste", "kde", "kdo", "kdyz", "ma", "mam", "mas", "mame", "mate", "me",
  "mi", "mne", "na", "nad", "nam", "nas", "ne", "nebo", "neni", "nic", "o", "od", "on",
  "ona", "oni", "ono", "po", "pod", "pro", "pred", "pri", "se", "si", "tak", "take", "tam",
  "ten", "tento", "teto", "tim", "to", "toho", "tom", "tomu", "tu", "ty", "u", "uz", "v",
  "vam", "vas", "ve", "vy", "z", "za", "ze", "tady", "dnes", "ted", "prosim",
]);

function asciiFold(text) {
  return String(text || "").toLocaleLowerCase("cs-CZ").normalize("NFD").replace(/\p{M}/gu, "");
}

function sampleBenchmark(examples, limit, sampleSeed) {
  const grouped = new Map();
  for (const row of examples) {
    const key = `${row.source_dataset}:${row.topic || "none"}:${row.difficulty || "none"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const selected = [];
  const groups = Array.from(grouped.values());
  for (const group of groups) shuffle(group, sampleSeed + group.length);
  let cursor = 0;
  while (selected.length < Math.min(limit, examples.length)) {
    let added = false;
    for (const group of groups) {
      if (group[cursor]) {
        selected.push(group[cursor]);
        added = true;
        if (selected.length >= limit) break;
      }
    }
    if (!added) break;
    cursor += 1;
  }
  return selected;
}

function summaryFor(taskName, examples, benchmark, extra) {
  const sourceCounts = {};
  const topicCounts = {};
  const difficultyCounts = {};
  for (const row of examples) {
    sourceCounts[row.source_dataset] = (sourceCounts[row.source_dataset] || 0) + 1;
    topicCounts[row.topic] = (topicCounts[row.topic] || 0) + 1;
    difficultyCounts[row.difficulty] = (difficultyCounts[row.difficulty] || 0) + 1;
  }
  return {
    task: taskName,
    generated_at: new Date().toISOString(),
    train_examples: examples.length,
    benchmark_examples: benchmark.length,
    source_files: sourceFiles.map((source) => path.relative(fromRoot(), source.file).replaceAll("\\", "/")),
    source_counts: sortObject(sourceCounts),
    topic_counts: sortObject(topicCounts),
    difficulty_counts: sortObject(difficultyCounts),
    ...extra,
  };
}

async function writeDataset(outDir, examples, benchmark, summary) {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "train.jsonl"), toJsonl(examples), "utf8");
  await fs.writeFile(path.join(outDir, "all.jsonl"), toJsonl(examples), "utf8");
  await fs.writeFile(path.join(outDir, "benchmark.jsonl"), toJsonl(benchmark), "utf8");
  await writeJson(path.join(outDir, "summary.json"), summary);
  await writeJson(path.join(outDir, "sources.json"), {
    sources: sourceFiles.map((source) => ({
      dataset: source.dataset,
      kind: source.kind,
      file: path.relative(fromRoot(), source.file).replaceAll("\\", "/"),
      license: "project-local",
    })),
  });
}

function compactSummary(outDir, summary) {
  return {
    out_dir: outDir,
    task: summary.task,
    train_examples: summary.train_examples,
    benchmark_examples: summary.benchmark_examples,
  };
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => String(a).localeCompare(String(b))));
}

async function main() {
  const rows = [];
  for (const source of sourceFiles) {
    for (const row of await readJsonl(source.file)) {
      rows.push({ ...row, source_dataset: source.dataset, source_kind: source.kind });
    }
  }

  assertBilingualRows(rows);

  const results = {};
  if (task === "all" || task === "translation-cs-en") {
    results.translation_cs_en = await buildTranslationDataset(rows);
  }
  if (task === "all" || task === "czech-word-sentence") {
    results.czech_word_sentence = await buildWordSentenceDataset(rows);
  }
  if (!Object.keys(results).length) {
    throw new Error(`Unknown --task ${task}. Use all, translation-cs-en, or czech-word-sentence.`);
  }

  console.log(JSON.stringify(results, null, 2));
}

await main();
