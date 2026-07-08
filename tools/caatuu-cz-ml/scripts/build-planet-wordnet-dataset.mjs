#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { appDataRoot, fromRoot } from "./paths.mjs";
import { readJson, shuffle, toJsonl, writeJson } from "./jsonl.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function argInt(name, fallback) {
  const value = argValue(name, null);
  return value === null ? fallback : Number.parseInt(value, 10);
}

const seed = argInt("--seed", 19);
const maxRows = argInt("--max-rows", 140000);
const maxWordsPerSentence = argInt("--max-words-per-sentence", 4);
const benchmarkWords = argInt("--benchmark-words", 420);
const anchorRepeats = argInt("--anchor-repeats", 0);
const standardPromptOnly = process.argv.includes("--standard-prompt-only");
const cleanSft = process.argv.includes("--clean-sft");
const cleanMaxTokens = argInt("--clean-max-tokens", 16);
const outDir = path.resolve(
  argValue("--out-dir", fromRoot("data", "models", "czech-finetuned", "training-data", "planet-wordnet-001")),
);
const planetCorpusDir = path.resolve(argValue("--corpus-dir", fromRoot("data", "corpus", "planet-wordnet")));
const existingCorpusJsonl = path.resolve(
  argValue("--existing-corpus", fromRoot("data", "corpus", "processed", "czech_seed_corpus.jsonl")),
);

const userAgent = "CaatuuPlanetWordNetDatasetBuilder/0.1";
const czechUpper = "A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ";
const czechDiacritics = /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/u;
const mojibake = /[�ÃÄÅâ×]/u;
const wordPattern = /\p{L}+(?:[-']\p{L}+)*/gu;

const stopWords = new Set(
  [
    "aby", "ale", "ani", "ano", "asi", "až", "bez", "by", "byl", "byla", "byli", "bylo", "být",
    "co", "což", "čím", "další", "dle", "do", "ho", "i", "jak", "jako", "je", "jeho", "její",
    "jejich", "jen", "ještě", "ji", "jiné", "jsem", "jsi", "jsme", "jsou", "jste", "k", "kam",
    "kde", "kdo", "když", "ke", "která", "které", "který", "kteří", "má", "mají", "mezi", "mi",
    "mně", "moc", "mohl", "může", "my", "na", "nad", "nám", "nás", "ne", "nebo", "nebyl",
    "něco", "něj", "někde", "němu", "němž", "není", "nic", "nich", "ním", "o", "od", "on", "ona",
    "oni", "ono", "pak", "po", "pod", "podle", "pokud", "pro", "proto", "protože", "před", "při",
    "s", "se", "sem", "si", "sobě", "tak", "také", "tam", "tato", "tedy", "ten", "tento", "této",
    "tím", "to", "toho", "tom", "tomu", "toto", "tu", "ty", "u", "už", "v", "vám", "vás", "ve",
    "více", "však", "vše", "vy", "z", "za", "zde", "že",
  ].map((item) => item.toLocaleLowerCase("cs-CZ")),
);

for (const item of [
  "bych",
  "bychom",
  "bys",
  "byste",
  "dalších",
  "obě",
  "oba",
  "vámi",
]) {
  stopWords.add(item.toLocaleLowerCase("cs-CZ"));
}

const projectGutenbergSources = [
  {
    id: "59765",
    title: "Cítanka pro skoly obecné. Díl I",
    url: "https://www.gutenberg.org/ebooks/59765.txt.utf-8",
    source_type: "project_gutenberg_reader",
    difficulty_hint: "simple",
  },
  {
    id: "29592",
    title: "Pasáček Ali: Pověst z východu",
    url: "https://www.gutenberg.org/ebooks/29592.txt.utf-8",
    source_type: "project_gutenberg_story",
    difficulty_hint: "medium",
  },
  {
    id: "29648",
    title: "Štafeta",
    url: "https://www.gutenberg.org/ebooks/29648.txt.utf-8",
    source_type: "project_gutenberg_story",
    difficulty_hint: "medium",
  },
  {
    id: "47754",
    title: "Blesky nad Beskydami",
    url: "https://www.gutenberg.org/ebooks/47754.txt.utf-8",
    source_type: "project_gutenberg_story",
    difficulty_hint: "medium",
  },
  {
    id: "27960",
    title: "Hore dědinú: A jiné povídky",
    url: "https://www.gutenberg.org/ebooks/27960.txt.utf-8",
    source_type: "project_gutenberg_story",
    difficulty_hint: "medium",
  },
  {
    id: "27974",
    title: "Vlci proti Mustangům",
    url: "https://www.gutenberg.org/ebooks/27974.txt.utf-8",
    source_type: "project_gutenberg_story",
    difficulty_hint: "medium",
  },
  {
    id: "50595",
    title: "Bohemian Grammar",
    url: "https://www.gutenberg.org/ebooks/50595.txt.utf-8",
    source_type: "project_gutenberg_reader",
    difficulty_hint: "simple",
  },
];

function normalizeText(text) {
  return String(text || "")
    .replace(/\ufeff/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[„]/g, "\"")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripGutenberg(text) {
  return normalizeText(text)
    .replace(/[\s\S]*?\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i, "")
    .replace(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*/i, "")
    .replace(/End of (?:the )?Project Gutenberg[\s\S]*/i, "")
    .trim();
}

function sentenceSplit(text) {
  return normalizeText(text)
    .replace(/\s+/g, " ")
    .split(new RegExp(`(?<=[.!?])\\s+(?=[${czechUpper}0-9"])`, "u"))
    .map((item) => item.trim())
    .filter(Boolean);
}

function words(text) {
  return Array.from(String(text || "").matchAll(wordPattern), (match) => match[0]);
}

function lowerCs(text) {
  return String(text || "").toLocaleLowerCase("cs-CZ");
}

function asciiFold(text) {
  return lowerCs(text).normalize("NFD").replace(/\p{M}/gu, "");
}

function cleanSentence(sentence) {
  return normalizeText(sentence)
    .replace(/^[-*•\d.)\s]+/u, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

const metaTerms = [
  "anglicky",
  "casovani",
  "cesky",
  "gramatika",
  "napsat",
  "objevuje",
  "obsahuje",
  "pojem",
  "pouziva",
  "preklad",
  "priklad",
  "rict",
  "sklonovani",
  "slovo",
  "tvar",
  "veta",
  "vyraz",
  "vyslovit",
  "vyznam",
  "znamena",
];

function containsMetaLanguage(sentence) {
  const folded = asciiFold(sentence);
  if (/\b(word|sentence|example|means|meaning|contains|translation|grammar)\b/iu.test(folded)) return true;
  return metaTerms.some((term) => new RegExp(`\\b${term}\\b`, "u").test(folded));
}

function cleanSftRejectionReason(sentence) {
  const tokenCount = words(sentence).length;
  if (tokenCount < 4 || tokenCount > cleanMaxTokens) return "token_count";
  if (containsMetaLanguage(sentence)) return "meta_language";
  if (/["'`]/u.test(sentence)) return "quoted_or_dictionary_like";
  return null;
}

function isCleanSentence(sentence) {
  if (!sentence || sentence.length < 18 || sentence.length > 190) return false;
  if (!/[.!?]$/u.test(sentence)) return false;
  if (mojibake.test(sentence)) return false;
  if (/https?:\/\//iu.test(sentence)) return false;
  if (/[<>{}\[\]|_=():;]/u.test(sentence)) return false;
  if (/[—–]{2,}|--/u.test(sentence)) return false;
  if (/["«»]/u.test(sentence)) return false;
  if (/\d/u.test(sentence)) return false;
  if (/\b(?:chapter|ebook|project gutenberg|copyright|contents|illustration)\b/iu.test(sentence)) return false;
  if (sentence.includes("->") || sentence.includes("***")) return false;
  const tokenCount = words(sentence).length;
  if (tokenCount < 4 || tokenCount > 20) return false;
  const letterCount = (sentence.match(/\p{L}/gu) || []).length;
  if (letterCount < 12) return false;
  if (!czechDiacritics.test(sentence)) return false;
  if ((sentence.match(/[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/gu) || []).length > Math.max(8, letterCount * 0.45)) return false;
  return true;
}

function sentenceKey(sentence) {
  return lowerCs(sentence).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function wordScore(word, position) {
  let score = 0;
  if (czechDiacritics.test(word)) score += 4;
  if (word.length >= 4 && word.length <= 9) score += 3;
  if (word.length >= 10) score += 1;
  if (position > 0) score += 1;
  return score;
}

function candidateWords(sentence) {
  const found = words(sentence);
  const seen = new Set();
  const candidates = [];
  for (let idx = 0; idx < found.length; idx += 1) {
    const surface = found[idx].replace(/^[-']+|[-']+$/g, "");
    const word = lowerCs(surface);
    if (seen.has(word)) continue;
    seen.add(word);
    if (word.length < 3 || word.length > 18) continue;
    if (stopWords.has(word)) continue;
    if (!/^\p{L}+(?:[-']\p{L}+)*$/u.test(word)) continue;
    candidates.push({ word, score: wordScore(word, idx) });
  }
  candidates.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word, "cs"));
  return candidates.slice(0, maxWordsPerSentence).map((item) => item.word);
}

function difficulty(sentence) {
  const count = words(sentence).length;
  if (count <= 8 && sentence.length <= 80) return "easy";
  if (count <= 14 && sentence.length <= 130) return "medium";
  return "hard";
}

function promptVariants(word) {
  if (cleanSft) return [cleanPrompt(word)];
  if (standardPromptOnly) return [`Slovo: ${word}\nVěta:`];
  return [
    word,
    `${word}\n`,
    `Slovo: ${word}\nVěta:`,
    `Napiš jednu českou větu se slovem "${word}".\nVěta:`,
    `Použij slovo "${word}" v krátké české větě.\nVěta:`,
    `Jedna krátká věta se slovem "${word}":`,
  ];
}

function cleanPrompt(word) {
  return `C\u00edl: ${word}\nNapi\u0161 jednu kr\u00e1tkou b\u011b\u017enou \u010deskou v\u011btu. Nevysv\u011btluj.\nV\u011bta:`;
}

function anchorTemplates(word) {
  return [
    `Slovo ${word} se objevilo v krátké české větě.`,
    `Na planetě slov dnes svítí slovo ${word}.`,
    `Ve slovní hře použijeme slovo ${word}.`,
    `Krátká věta obsahuje slovo ${word}.`,
    `Pro procvičení si zapamatuj slovo ${word}.`,
  ];
}

async function maybeReadJsonl(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function fetchCached(source) {
  const rawDir = path.join(planetCorpusDir, "raw");
  await fs.mkdir(rawDir, { recursive: true });
  const file = path.join(rawDir, `gutenberg_${source.id}.txt`);
  try {
    return await fs.readFile(file, "utf8");
  } catch {}
  const response = await fetch(source.url, { headers: { "user-agent": userAgent } });
  if (!response.ok) throw new Error(`${source.url} returned HTTP ${response.status}`);
  const text = await response.text();
  await fs.writeFile(file, text, "utf8");
  return text;
}

async function collectAppSentences(addSentence) {
  const dictionary = await readJson(path.join(appDataRoot, "dictionary.json"));
  const scripts = await readJson(path.join(appDataRoot, "scripts.json"));
  for (const item of dictionary) {
    if (item.use) {
      addSentence(item.use, {
        source_type: "caatuu_app_data",
        source_id: "dictionary_use",
        title: item.cs || item.en || "dictionary",
        license: "project-local",
      });
    }
  }
  for (const script of scripts) {
    for (const line of script.lines || []) {
      if (line.cs) {
        addSentence(line.cs, {
          source_type: "caatuu_app_data",
          source_id: "script_line",
          title: script.title || "script",
          license: "project-local",
        });
      }
    }
  }
}

async function collectExistingCorpus(addSentence) {
  const docs = await maybeReadJsonl(existingCorpusJsonl);
  for (const doc of docs) {
    if (doc.source_type === "caatuu_app_data" || doc.source_type === "book") continue;
    for (const sentence of sentenceSplit(doc.text || "")) {
      addSentence(sentence, {
        source_type: doc.source_type || "existing_corpus",
        source_id: doc.source_id || "existing_corpus",
        title: doc.title || "existing corpus",
        license: doc.license || null,
        url: doc.url || null,
      });
    }
  }
}

async function collectGutenberg(addSentence) {
  for (const source of projectGutenbergSources) {
    const raw = await fetchCached(source);
    const text = stripGutenberg(raw);
    for (const sentence of sentenceSplit(text)) {
      addSentence(sentence, {
        source_type: source.source_type,
        source_id: `gutenberg:${source.id}`,
        title: source.title,
        license: "Project Gutenberg License / public domain in the United States",
        url: source.url,
        difficulty_hint: source.difficulty_hint,
      });
    }
  }
}

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(path.join(planetCorpusDir, "processed"), { recursive: true });

const sentenceMap = new Map();
const filterCounts = new Map();
function addSentence(rawSentence, source) {
  const sentence = cleanSentence(rawSentence);
  if (!isCleanSentence(sentence)) return;
  if (cleanSft) {
    const reason = cleanSftRejectionReason(sentence);
    if (reason) {
      filterCounts.set(reason, (filterCounts.get(reason) || 0) + 1);
      return;
    }
  }
  const key = sentenceKey(sentence);
  if (!key || sentenceMap.has(key)) return;
  sentenceMap.set(key, {
    sentence,
    source_type: source.source_type,
    source_id: source.source_id,
    title: source.title,
    license: source.license || null,
    url: source.url || null,
    difficulty_hint: source.difficulty_hint || null,
    difficulty: difficulty(sentence),
  });
}

await collectAppSentences(addSentence);
await collectExistingCorpus(addSentence);
await collectGutenberg(addSentence);

const sentences = shuffle(Array.from(sentenceMap.values()), seed);
const rows = [];
const wordCounts = new Map();
const allSentenceSourceCounts = new Map();
for (const item of sentences) {
  allSentenceSourceCounts.set(item.source_type, (allSentenceSourceCounts.get(item.source_type) || 0) + 1);
}
const trainingSentenceSourceCounts = new Map();
const trainingRowSourceCounts = new Map();
const effectiveAnchorRepeats = cleanSft ? 0 : anchorRepeats;
for (const item of sentences) {
  const targets = candidateWords(item.sentence);
  for (const word of targets) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    for (let idx = 0; idx < effectiveAnchorRepeats; idx += 1) {
      const sentence = anchorTemplates(word)[idx % anchorTemplates(word).length];
      rows.push({
        task: "planet_wordnet_sentence",
        prompt: `Slovo: ${word}\nVěta:`,
        completion: ` ${sentence}`,
        word,
        target_input: word,
        target_mode: "surface",
        matched_surface: word,
        prompt_template: "synthetic_copy_anchor",
        sentence,
        source_type: "synthetic_copy_anchor",
        source_id: "planet_wordnet_anchor",
        title: "Planet Word Net exact-word anchor",
        license: "project-local",
        url: null,
        difficulty: "easy",
      });
      trainingRowSourceCounts.set("synthetic_copy_anchor", (trainingRowSourceCounts.get("synthetic_copy_anchor") || 0) + 1);
      if (rows.length >= maxRows) break;
    }
    if (rows.length >= maxRows) break;
    for (const prompt of promptVariants(word)) {
      rows.push({
        task: "planet_wordnet_sentence",
        prompt,
        completion: ` ${item.sentence}`,
        word,
        target_input: word,
        target_mode: "surface",
        matched_surface: word,
        prompt_template: cleanSft ? "clean_surface_v1" : standardPromptOnly ? "standard_slovo_veta" : "mixed_prompt_v1",
        sentence: item.sentence,
        source_type: item.source_type,
        source_id: item.source_id,
        title: item.title,
        license: item.license,
        url: item.url,
        difficulty: item.difficulty,
      });
      trainingRowSourceCounts.set(item.source_type, (trainingRowSourceCounts.get(item.source_type) || 0) + 1);
      if (rows.length >= maxRows) break;
    }
    if (rows.length >= maxRows) break;
  }
  if (targets.length) {
    trainingSentenceSourceCounts.set(item.source_type, (trainingSentenceSourceCounts.get(item.source_type) || 0) + 1);
  }
  if (rows.length >= maxRows) break;
}

shuffle(rows, seed + 1);

const benchmarkCandidates = Array.from(wordCounts.entries())
  .filter(([word, count]) => count >= 2 && word.length >= 3 && word.length <= 14)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "cs"))
  .slice(0, Math.max(benchmarkWords * 5, benchmarkWords));
shuffle(benchmarkCandidates, seed + 2);
const benchmark = benchmarkCandidates.slice(0, benchmarkWords).map(([word, training_hits], idx) => {
  const variants = promptVariants(word);
  return {
    id: `planet-wordnet-${String(idx + 1).padStart(4, "0")}`,
    word,
    target_input: word,
    target_mode: "surface",
    prompt: variants[idx % variants.length],
    training_hits,
    expected: cleanSft
      ? "one short natural Czech sentence containing the exact target form, with no meta-language"
      : "one Czech sentence containing the word case-insensitively",
  };
});

const sources = projectGutenbergSources.map((source) => ({
  source_id: `gutenberg:${source.id}`,
  title: source.title,
  url: source.url,
  license: "Project Gutenberg License / public domain in the United States",
}));

const summary = {
  task: "planet_wordnet_sentence",
  train_examples: rows.length,
  validation_split: false,
  benchmark_examples: benchmark.length,
  unique_sentences: sentences.length,
  unique_words: wordCounts.size,
  clean_sft: cleanSft,
  clean_max_tokens: cleanMaxTokens,
  max_words_per_sentence: maxWordsPerSentence,
  anchor_repeats: effectiveAnchorRepeats,
  requested_anchor_repeats: anchorRepeats,
  standard_prompt_only: standardPromptOnly,
  prompt_variants_per_word: promptVariants("slovo").length,
  prompt_template: cleanSft ? cleanPrompt("{target}") : null,
  filter_counts: Object.fromEntries(Array.from(filterCounts.entries()).sort()),
  all_candidate_sentence_source_counts: Object.fromEntries(Array.from(allSentenceSourceCounts.entries()).sort()),
  training_sentence_source_counts: Object.fromEntries(Array.from(trainingSentenceSourceCounts.entries()).sort()),
  training_row_source_counts: Object.fromEntries(Array.from(trainingRowSourceCounts.entries()).sort()),
  source_note: "Training uses all generated examples. benchmark.jsonl is for generated-output checks, not loss validation.",
};

await fs.writeFile(path.join(outDir, "train.jsonl"), toJsonl(rows), "utf8");
await fs.writeFile(path.join(outDir, "all.jsonl"), toJsonl(rows), "utf8");
await fs.writeFile(path.join(outDir, "benchmark.jsonl"), toJsonl(benchmark), "utf8");
await writeJson(path.join(outDir, "summary.json"), summary);
await writeJson(path.join(outDir, "sources.json"), sources);
await fs.writeFile(
  path.join(planetCorpusDir, "processed", "sentences.jsonl"),
  toJsonl(sentences),
  "utf8",
);
await fs.writeFile(
  path.join(planetCorpusDir, "processed", "words.jsonl"),
  toJsonl(Array.from(wordCounts.entries()).map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count)),
  "utf8",
);

console.log(JSON.stringify(summary, null, 2));
