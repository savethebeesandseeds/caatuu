#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson, toJsonl } from "./jsonl.mjs";
import { appDataRoot, fromRoot } from "./paths.mjs";

const corpusRoot = fromRoot("data", "corpus");
const rawDir = path.join(corpusRoot, "raw");
const processedDir = path.join(corpusRoot, "processed");
const sourcesPath = path.join(corpusRoot, "sources.json");
const userAgent = "CaatuuCzechCorpusBuilder/0.2 node";

const refresh = process.argv.includes("--refresh");
const skipRemote = process.argv.includes("--skip-remote");

function normalizeText(text) {
  return String(text || "")
    .replace(/\ufeff/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\[[0-9]+\]/g, "")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripGutenberg(text) {
  return normalizeText(text)
    .replace(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*/is, "")
    .replace(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*/is, "")
    .trim();
}

function sentenceSplit(text) {
  return normalizeText(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9])/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20 && item.length <= 320 && (item.match(/\p{L}/gu) || []).length >= 12 && !/^https?:\/\//i.test(item));
}

function slugify(value) {
  return String(value || "source")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^0-9a-z]+/g, "-")
    .replace(/^-|-$/g, "") || "source";
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function cachedJson(file, url) {
  if (!refresh) {
    try {
      return await readJson(file);
    } catch {}
  }
  const text = await fetchText(url);
  const json = JSON.parse(text);
  await writeJson(file, json);
  return json;
}

async function cachedText(file, url) {
  if (!refresh) {
    try {
      return await fs.readFile(file, "utf8");
    } catch {}
  }
  const text = await fetchText(url);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
  return text;
}

function addDoc(docs, row) {
  const text = normalizeText(row.text);
  if (!text) return;
  docs.push({
    source_id: row.source_id,
    source_type: row.source_type,
    title: row.title,
    license: row.license,
    url: row.url || null,
    text,
    sentence_count: sentenceSplit(text).length
  });
}

async function addLocalDocs(docs) {
  const dictionary = await readJson(path.join(appDataRoot, "dictionary.json"));
  const scripts = await readJson(path.join(appDataRoot, "scripts.json"));
  const verbs = await readJson(path.join(appDataRoot, "verbs.json"));

  addDoc(docs, {
    source_id: "caatuu_dictionary",
    source_type: "caatuu_app_data",
    title: "Caatuu Czech dictionary",
    license: "project-local",
    text: dictionary.map((item) => [item.cs, item.en, item.cue, item.use].filter(Boolean).join(". ")).join("\n")
  });
  addDoc(docs, {
    source_id: "caatuu_scripts",
    source_type: "caatuu_app_data",
    title: "Caatuu Czech scripts",
    license: "project-local",
    text: scripts.map((script) => (script.lines || []).map((line) => [line.cs, line.en].filter(Boolean).join(" - ")).join("\n")).join("\n\n")
  });
  addDoc(docs, {
    source_id: "caatuu_verbs",
    source_type: "caatuu_app_data",
    title: "Caatuu Czech verbs",
    license: "project-local",
    text: verbs.map((verb) => {
      const forms = Object.values(verb.forms || {}).map((form) => [form.cs, form.en].filter(Boolean).join(" - "));
      return [verb.infinitive, verb.english, verb.pattern, ...forms].filter(Boolean).join(". ");
    }).join("\n")
  });
}

async function addWikipediaDocs(docs, sources) {
  if (skipRemote) return;
  const wiki = sources.wikipedia_extracts;
  for (const title of wiki.titles || []) {
    const file = path.join(rawDir, `wikipedia_summary_${slugify(title)}.json`);
    const encoded = encodeURIComponent(String(title).replace(/ /g, "_"));
    const url = `https://cs.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
    try {
      const raw = await cachedJson(file, url);
      addDoc(docs, {
        source_id: `wikipedia_${slugify(title)}`,
        source_type: "wikipedia_summary",
        title: raw.title || title,
        license: wiki.license,
        url: raw.content_urls?.desktop?.page || `https://cs.wikipedia.org/wiki/${encoded}`,
        text: raw.extract || ""
      });
    } catch (error) {
      console.warn(`Skipped ${title}: ${error.message}`);
    }
  }
}

async function addBookDocs(docs, sources) {
  if (skipRemote) return;
  for (const book of sources.books || []) {
    const file = path.join(rawDir, `${book.id}.txt`);
    try {
      const raw = await cachedText(file, book.text_url);
      addDoc(docs, {
        source_id: book.id,
        source_type: "book",
        title: book.title,
        license: book.license,
        url: book.source,
        text: stripGutenberg(raw)
      });
    } catch (error) {
      console.warn(`Skipped ${book.id}: ${error.message}`);
    }
  }
}

await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(processedDir, { recursive: true });

const sources = await readJson(sourcesPath);
const docs = [];
await addLocalDocs(docs);
await addWikipediaDocs(docs, sources);
await addBookDocs(docs, sources);

const sentences = [...new Set(docs.flatMap((doc) => sentenceSplit(doc.text)))].sort((a, b) => a.localeCompare(b, "cs"));
const attribution = docs.map(({ text, ...doc }) => doc);
const summary = {
  documents: docs.length,
  sentences: sentences.length,
  corpus_jsonl: "processed/czech_seed_corpus.jsonl",
  sentences_txt: "processed/czech_seed_sentences.txt",
  attribution_json: "processed/attribution.json"
};

await fs.writeFile(path.join(processedDir, "czech_seed_corpus.jsonl"), toJsonl(docs), "utf8");
await fs.writeFile(path.join(processedDir, "czech_seed_sentences.txt"), `${sentences.join("\n")}\n`, "utf8");
await writeJson(path.join(processedDir, "attribution.json"), attribution);
await writeJson(path.join(processedDir, "summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));
