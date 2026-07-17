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
const translationValidationRows = argInt("--translation-validation-rows", 400);
const wordValidationWords = argInt("--word-validation-words", 80);
const wordValidationExamplesPerWord = argInt("--word-validation-examples-per-word", 2);
const wordUnseenBenchmarkWords = argInt("--word-unseen-benchmark-words", Math.floor(benchmarkRows / 2));
const maxExamplesPerWord = argInt("--max-examples-per-word", 24);
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

function normalizeText(text, locale = "cs-CZ") {
  return String(text || "")
    .normalize("NFC")
    .toLocaleLowerCase(locale)
    .replace(/\s+/gu, " ")
    .trim();
}

function translationPairKey(row) {
  return `${normalizeText(row.czech_text)}\n${normalizeText(row.english_text, "en-US")}`;
}

function dedupeBilingualRows(items) {
  const unique = new Map();
  const duplicates = [];
  for (const row of items) {
    const key = translationPairKey(row);
    if (unique.has(key)) {
      duplicates.push({ kept: unique.get(key), removed: row });
      continue;
    }
    unique.set(key, row);
  }
  return { rows: [...unique.values()], duplicates };
}

function dedupeTranslationSources(items) {
  const unique = new Map();
  const duplicates = [];
  for (const row of items) {
    const key = normalizeText(row.czech_text);
    if (unique.has(key)) {
      duplicates.push({ kept: unique.get(key), removed: row });
      continue;
    }
    unique.set(key, row);
  }
  return { rows: [...unique.values()], duplicates };
}

function translationExample(row) {
  return {
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
  };
}

async function buildTranslationDataset(items, duplicatePairsRemoved, duplicateCzechPromptsRemoved) {
  const allExamples = items.map(translationExample);
  const benchmarkSource = sampleStratified(allExamples, benchmarkRows, seed + 1);
  const benchmarkKeys = new Set(benchmarkSource.map(translationPairKey));
  const afterBenchmark = allExamples.filter((row) => !benchmarkKeys.has(translationPairKey(row)));
  const validation = sampleStratified(afterBenchmark, translationValidationRows, seed + 2);
  const validationKeys = new Set(validation.map(translationPairKey));
  const train = afterBenchmark.filter((row) => !validationKeys.has(translationPairKey(row)));

  shuffle(train, seed + 3);
  shuffle(validation, seed + 4);
  const trainAll = shuffle([...train, ...validation], seed + 5);
  const benchmark = benchmarkSource.map((row, index) => ({
    id: `translate-cs-en-${String(index + 1).padStart(4, "0")}`,
    split: "test",
    prompt: row.prompt,
    czech_text: row.czech_text,
    expected_english_text: row.english_text,
    source_id: row.source_id,
    source_dataset: row.source_dataset,
    topic: row.topic,
    difficulty: row.difficulty,
    expected: "one simple English translation, no explanation",
  }));

  const summary = summaryFor("translation_cs_en", allExamples, train, validation, benchmark, {
    source_examples_before_dedupe: allExamples.length + duplicatePairsRemoved + duplicateCzechPromptsRemoved,
    duplicate_pairs_removed: duplicatePairsRemoved,
    duplicate_czech_prompts_removed: duplicateCzechPromptsRemoved,
    validation_split: true,
    prompt_template: "translate_cs_to_en_v1",
    direction: "cs->en",
    split_policy: "Exact bilingual pairs and repeated normalized Czech prompts are deduplicated before assignment to disjoint train, validation, and test splits.",
    release_training_file: "train_all.jsonl contains train + validation only; benchmark.jsonl remains held out.",
  });
  await writeDataset(translationOutDir, { train, validation, trainAll, all: allExamples, benchmark }, summary);
  return compactSummary(translationOutDir, summary);
}

async function buildWordSentenceDataset(items, duplicateRowsRemoved) {
  const rawExamples = [];
  const wordCounts = new Map();
  const sentenceCounts = new Map();
  for (const row of items) {
    const words = candidateWords(row.czech_text).slice(0, maxWordsPerSentence);
    if (!words.length) continue;
    sentenceCounts.set(row.source_dataset, (sentenceCounts.get(row.source_dataset) || 0) + 1);
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      rawExamples.push({
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

  const dedupedWordRows = dedupeRowsByKey(rawExamples, (row) => `${normalizeText(row.word)}\n${normalizeText(row.czech_text)}`);
  const allExamples = dedupedWordRows.rows;

  const groups = groupByWord(allExamples);
  const eligibleWords = [...groups.entries()]
    .filter(([word, rows]) => rows.length >= 2 && word.length >= 3 && word.length <= 16)
    .map(([word]) => word);
  eligibleWords.sort((left, right) => stableSeed(left, seed + 11) - stableSeed(right, seed + 11) || left.localeCompare(right, "cs"));

  const seenBenchmarkWords = benchmarkRows - wordUnseenBenchmarkWords;
  const requiredEligibleWords = wordValidationWords + wordUnseenBenchmarkWords + seenBenchmarkWords;
  if (eligibleWords.length < requiredEligibleWords) {
    throw new Error(`Need ${requiredEligibleWords} eligible word targets, found ${eligibleWords.length}.`);
  }

  const validationWords = new Set(eligibleWords.slice(0, wordValidationWords));
  const unseenWords = new Set(eligibleWords.slice(wordValidationWords, wordValidationWords + wordUnseenBenchmarkWords));
  const seenPool = eligibleWords.slice(wordValidationWords + wordUnseenBenchmarkWords);

  const validation = [];
  for (const word of validationWords) {
    const rows = shuffle([...groups.get(word)], stableSeed(word, seed + 1000));
    validation.push(...rows.slice(0, wordValidationExamplesPerWord));
  }

  const trainCandidates = allExamples.filter((row) => !validationWords.has(row.word) && !unseenWords.has(row.word));
  const train = capWordExamples(trainCandidates, maxExamplesPerWord, seed + 2000);
  const trainGroups = groupByWord(train);
  const availableSeenWords = seenPool.filter((word) => trainGroups.has(word));
  if (availableSeenWords.length < seenBenchmarkWords) {
    throw new Error(`Need ${seenBenchmarkWords} seen benchmark words, found ${availableSeenWords.length}.`);
  }

  const seenBenchmark = availableSeenWords.slice(0, seenBenchmarkWords).map((word) => ({
    word,
    target_input: word,
    target_mode: "surface",
    prompt: cleanWordSentencePrompt(word),
    split: "seen",
    training_hits: trainGroups.get(word).length,
    source_hits: groups.get(word).length,
    expected: "one short natural Czech sentence containing the exact target form, with no meta-language",
  }));
  const unseenBenchmark = [...unseenWords].map((word) => ({
    word,
    target_input: word,
    target_mode: "surface",
    prompt: cleanWordSentencePrompt(word),
    split: "unseen",
    training_hits: 0,
    source_hits: groups.get(word).length,
    expected: "one short natural Czech sentence containing the exact target form, with no meta-language",
  }));
  const benchmark = shuffle([...seenBenchmark, ...unseenBenchmark], seed + 12).map((row, index) => ({
    id: `czech-word-sentence-${String(index + 1).padStart(4, "0")}`,
    ...row,
  }));
  const benchmarkSeen = benchmark.filter((row) => row.split === "seen");
  const benchmarkUnseen = benchmark.filter((row) => row.split === "unseen");

  shuffle(validation, seed + 13);
  const trainAll = shuffle([...train, ...validation], seed + 14);
  const trainWordCounts = countBy(train, (row) => row.word);
  const summary = summaryFor("czech_word_sentence", allExamples, train, validation, benchmark, {
    source_examples_before_dedupe: items.length + duplicateRowsRemoved,
    duplicate_sentence_pairs_removed: duplicateRowsRemoved,
    duplicate_word_task_rows_removed: dedupedWordRows.duplicates,
    validation_split: true,
    prompt_template: cleanWordSentencePrompt("{target}"),
    max_words_per_sentence: maxWordsPerSentence,
    max_examples_per_word: maxExamplesPerWord,
    unique_target_words: wordCounts.size,
    training_target_words: trainWordCounts.size,
    validation_heldout_words: validationWords.size,
    benchmark_seen_words: benchmarkSeen.length,
    benchmark_unseen_words: benchmarkUnseen.length,
    training_sentence_source_counts: Object.fromEntries([...sentenceCounts.entries()].sort()),
    top_target_words_before_balancing: topEntries(wordCounts, 40),
    top_target_words_after_balancing: topEntries(trainWordCounts, 40),
    split_policy: "Stable word-keyed ranking assigns validation and test targets; validation and unseen-test targets are absent from training, and seen/unseen benchmark results are reported separately.",
    source_note: "Uses curated Czech curriculum rows only; no synthetic copy anchors and no external Czech story corpus.",
  });
  await writeDataset(
    wordSentenceOutDir,
    {
      train,
      validation,
      trainAll,
      all: allExamples,
      benchmark,
      benchmarkSeen,
      benchmarkUnseen,
    },
    summary,
  );
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

function stableSeed(text, baseSeed = 0) {
  let hash = (2166136261 ^ (baseSeed >>> 0)) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function sampleStratified(examples, limit, sampleSeed) {
  const grouped = new Map();
  for (const row of examples) {
    const key = `${row.source_dataset}:${row.topic || "none"}:${row.difficulty || "none"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const selected = [];
  const groups = [...grouped.values()];
  for (const [index, group] of groups.entries()) shuffle(group, sampleSeed + index + group.length);
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

function groupByWord(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.word)) groups.set(row.word, []);
    groups.get(row.word).push(row);
  }
  return groups;
}

function dedupeRowsByKey(rows, keyFn) {
  const unique = new Map();
  let duplicates = 0;
  for (const row of rows) {
    const key = keyFn(row);
    if (unique.has(key)) {
      duplicates += 1;
      continue;
    }
    unique.set(key, row);
  }
  return { rows: [...unique.values()], duplicates };
}

function capWordExamples(rows, limit, capSeed) {
  const capped = [];
  for (const [word, group] of groupByWord(rows)) {
    shuffle(group, stableSeed(word, capSeed));
    capped.push(...group.slice(0, limit));
  }
  return shuffle(capped, capSeed + 100000);
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function topEntries(counts, limit) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "cs")).slice(0, limit);
}

function countFields(rows) {
  const sourceCounts = {};
  const topicCounts = {};
  const difficultyCounts = {};
  for (const row of rows) {
    sourceCounts[row.source_dataset || "unknown"] = (sourceCounts[row.source_dataset || "unknown"] || 0) + 1;
    topicCounts[row.topic || "unknown"] = (topicCounts[row.topic || "unknown"] || 0) + 1;
    difficultyCounts[row.difficulty ?? "unknown"] = (difficultyCounts[row.difficulty ?? "unknown"] || 0) + 1;
  }
  return {
    source_counts: sortObject(sourceCounts),
    topic_counts: sortObject(topicCounts),
    difficulty_counts: sortObject(difficultyCounts),
  };
}

function summaryFor(taskName, all, train, validation, benchmark, extra) {
  return {
    task: taskName,
    generated_at: new Date().toISOString(),
    all_examples: all.length,
    train_examples: train.length,
    validation_examples: validation.length,
    train_all_examples: train.length + validation.length,
    benchmark_examples: benchmark.length,
    source_files: sourceFiles.map((source) => path.relative(fromRoot(), source.file).replaceAll("\\", "/")),
    ...countFields(train),
    all_counts: countFields(all),
    ...extra,
  };
}

async function writeDataset(outDir, dataset, summary) {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "train.jsonl"), toJsonl(dataset.train), "utf8");
  await fs.writeFile(path.join(outDir, "val.jsonl"), toJsonl(dataset.validation), "utf8");
  await fs.writeFile(path.join(outDir, "train_all.jsonl"), toJsonl(dataset.trainAll), "utf8");
  await fs.writeFile(path.join(outDir, "all.jsonl"), toJsonl(dataset.all), "utf8");
  await fs.writeFile(path.join(outDir, "benchmark.jsonl"), toJsonl(dataset.benchmark), "utf8");
  if (dataset.benchmarkSeen) {
    await fs.writeFile(path.join(outDir, "benchmark-seen.jsonl"), toJsonl(dataset.benchmarkSeen), "utf8");
  }
  if (dataset.benchmarkUnseen) {
    await fs.writeFile(path.join(outDir, "benchmark-unseen.jsonl"), toJsonl(dataset.benchmarkUnseen), "utf8");
  }
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
    validation_examples: summary.validation_examples,
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
  const deduped = dedupeBilingualRows(rows);
  const translationDeduped = dedupeTranslationSources(deduped.rows);

  const results = {};
  if (task === "all" || task === "translation-cs-en") {
    results.translation_cs_en = await buildTranslationDataset(
      translationDeduped.rows,
      deduped.duplicates.length,
      translationDeduped.duplicates.length,
    );
  }
  if (task === "all" || task === "czech-word-sentence") {
    results.czech_word_sentence = await buildWordSentenceDataset(deduped.rows, deduped.duplicates.length);
  }
  if (!Object.keys(results).length) {
    throw new Error(`Unknown --task ${task}. Use all, translation-cs-en, or czech-word-sentence.`);
  }

  console.log(JSON.stringify(results, null, 2));
}

await main();
