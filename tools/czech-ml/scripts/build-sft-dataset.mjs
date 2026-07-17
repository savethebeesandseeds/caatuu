#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { appDataRoot, fromRoot } from "./paths.mjs";
import { readJson, shuffle, toJsonl, writeJson } from "./jsonl.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const outDir = path.resolve(argValue("--out-dir", fromRoot("data", "models", "czech-finetuned", "training-data")));
const corpusSentences = path.resolve(argValue("--sentences", fromRoot("data", "corpus", "processed", "czech_seed_sentences.txt")));

function argInt(name, fallback) {
  const value = argValue(name, null);
  return value === null ? fallback : Number.parseInt(value, 10);
}

const seed = argInt("--seed", 7);
const correctionLimit = argInt("--correction-limit", 1200);
const valSizeArg = argInt("--val-size", 80);

const systemCorrect = "Jsi český korektor pro začátečníky. Oprav pravopis a diakritiku. Neměň význam. Vrať pouze opravený český text.";
const systemTranslate = "Jsi pomocník Caatuu Czech. Přelož krátký význam do přirozené češtiny. Vrať pouze český výraz nebo větu.";
const systemExplain = "Jsi trpělivý učitel češtiny pro začátečníky. Odpovídej česky, krátce a prakticky.";
const systemDialogue = "Jsi pomocník Caatuu Czech. Piš přirozené krátké české dialogy pro začátečníky. Používej jen češtinu.";

function example(system, user, assistant, source) {
  return { messages: [{ role: "system", content: system }, { role: "user", content: user }, { role: "assistant", content: assistant }], source };
}

function stripDiacritics(text) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function cleanSentence(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function hasCzechDiacritic(text) {
  return /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/u.test(text);
}

function correctionExamples(sentences) {
  const rows = [];
  for (const sentence of sentences.map(cleanSentence).filter((item) => item.length >= 25 && item.length <= 170 && hasCzechDiacritic(item)).slice(0, correctionLimit)) {
    const plain = stripDiacritics(sentence);
    if (plain !== sentence) rows.push(example(systemCorrect, `Oprav: ${plain}`, sentence, "corpus_diacritic_restore"));
  }
  return rows;
}

async function appDataExamples() {
  const rows = [];
  const dictionary = await readJson(path.join(appDataRoot, "dictionary.json"));
  const scripts = await readJson(path.join(appDataRoot, "scripts.json"));
  const verbs = await readJson(path.join(appDataRoot, "verbs.json"));

  for (const item of dictionary) {
    if (item.cs && item.en) {
      rows.push(example(systemTranslate, `Přelož do češtiny: ${item.en}`, item.cs, "dictionary_translate"));
      rows.push(example(systemTranslate, `Jak se česky řekne: ${item.en}?`, item.cs, "dictionary_translate_variant"));
      rows.push(example(systemTranslate, `Vrať jen český překlad: ${item.en}`, item.cs, "dictionary_translate_variant"));
    }
    if (item.use && item.cs) {
      rows.push(example(systemExplain, `Ukaž krátký příklad s výrazem „${item.cs}“.`, item.use, "dictionary_usage"));
      rows.push(example(systemExplain, `Napiš jednu krátkou českou větu se slovem „${item.cs}“.`, item.use, "dictionary_usage_variant"));
    }
    if (item.cs && item.cue) {
      rows.push(example(systemExplain, `Jak se použije české slovo „${item.cs}“? Odpověz jednou krátkou větou.`, `${item.cs}: ${item.cue}.`, "dictionary_cue"));
    }
  }

  for (const script of scripts) {
    const lines = (script.lines || []).filter((line) => line.cs);
    if (!lines.length) continue;
    const dialogue = lines.map((line) => line.cs).join("\n");
    rows.push(example(systemDialogue, `Napiš krátký český skript pro situaci: ${script.title || "situace"}. Cíl: ${script.goal || ""}.`, dialogue, "script_dialogue"));
    rows.push(example(systemDialogue, `Napiš čtyři krátké repliky česky pro situaci „${script.title || "situace"}“.`, dialogue, "script_dialogue_variant"));
    for (const line of lines) {
      if (line.en && line.cs) rows.push(example(systemTranslate, `Přelož do češtiny: ${line.en}`, line.cs, "script_translate"));
    }
  }

  for (const verb of verbs) {
    if (verb.infinitive && verb.english) rows.push(example(systemTranslate, `Přelož sloveso do češtiny: ${verb.english}`, verb.infinitive, "verb_translate"));
    if (verb.infinitive && verb.pattern) rows.push(example(systemExplain, `Dej krátkou pomůcku pro české sloveso „${verb.infinitive}“.`, `${verb.infinitive}: ${verb.pattern}.`, "verb_pattern"));
    for (const form of Object.values(verb.forms || {})) {
      if (form.cs && form.en) {
        rows.push(example(systemTranslate, `Přelož do češtiny: ${form.en}`, form.cs, "verb_form"));
        rows.push(example(systemTranslate, `Vrať pouze český slovesný tvar: ${form.en}`, form.cs, "verb_form_variant"));
        rows.push(example(systemTranslate, `Jaký je český tvar pro „${form.en}“?`, form.cs, "verb_form_variant"));
      }
    }
  }
  return rows;
}

function fixedExamples() {
  const phrasePairs = [
    ["Where is the station?", "Kde je nádraží?"],
    ["Where is the shop?", "Kde je obchod?"],
    ["I do not understand.", "Nerozumím."],
    ["I do not speak Czech.", "Nemluvím česky."],
    ["Please speak slowly.", "Mluvte prosím pomalu."],
    ["Can I pay by card?", "Mohu platit kartou?"],
    ["I would like two coffees.", "Chtěl bych dvě kávy."],
    ["The bill, please.", "Účet, prosím."],
    ["I am going to the shop.", "Jdu do obchodu."],
    ["I am at the station.", "Jsem na nádraží."],
    ["I need help.", "Potřebuji pomoc."],
    ["How much does it cost?", "Kolik to stojí?"],
    ["Thank you very much.", "Moc děkuji."],
    ["Good morning.", "Dobré ráno."],
    ["Good evening.", "Dobrý večer."],
    ["Goodbye.", "Na shledanou."],
    ["Hi.", "Ahoj."]
  ];
  const rows = [
    example(systemCorrect, "Oprav: Dobry den, chtel bych dve kavy a jeden ucet prosim.", "Dobrý den, chtěl bych dvě kávy a jeden účet, prosím.", "fixed_eval_like_correction"),
    example(systemCorrect, "Oprav: Prosim vas, kde je nadrazi?", "Prosím vás, kde je nádraží?", "fixed_eval_like_correction"),
    example(systemCorrect, "Oprav: Mam rad ceskou kavu a cerstvy chleba.", "Mám rád českou kávu a čerstvý chléb.", "fixed_eval_like_correction"),
    example(systemDialogue, "Napiš česky krátký seznam přesně tří pozdravů. Bez vysvětlení.", "Ahoj.\nDobrý den.\nDobrý večer.", "controlled_generation"),
    example(systemExplain, "Vysvětli jednoduše rozdíl mezi „prosím“ a „děkuji“.", "„Prosím“ říkáme, když o něco žádáme. „Děkuji“ říkáme, když za něco děkujeme.", "fixed_explanation"),
    example(systemDialogue, "Napiš čtyři krátké repliky v obchodě se slovy: rohlíky, mléko, účet, prosím, děkuji.", "Zákazník: Dobrý den, dva rohlíky a jedno mléko, prosím.\nProdavač: Tady to máte.\nZákazník: Účet, prosím.\nProdavač: Samozřejmě. Děkuji.", "fixed_shop_dialogue")
  ];
  for (const [en, cs] of phrasePairs) {
    rows.push(example(systemTranslate, `Přelož do češtiny. Vrať pouze větu: ${en}`, cs, "practical_phrase_translate"));
    rows.push(example(systemTranslate, `Napiš česky pouze větu: ${en}`, cs, "practical_phrase_generate"));
  }
  return rows;
}

await fs.mkdir(outDir, { recursive: true });
let sentences = [];
try {
  sentences = (await fs.readFile(corpusSentences, "utf8")).split(/\r?\n/).filter(Boolean);
} catch {
  console.warn(`No corpus sentence file found at ${corpusSentences}; continuing with app data only.`);
}
shuffle(sentences, seed);

const rows = [...fixedExamples(), ...(await appDataExamples()), ...correctionExamples(sentences)];
const seen = new Set();
const deduped = [];
for (const row of rows) {
  const key = JSON.stringify(row.messages);
  if (!seen.has(key)) {
    seen.add(key);
    deduped.push(row);
  }
}
shuffle(deduped, seed + 1);

const valSize = Math.min(valSizeArg, Math.max(20, Math.floor(deduped.length / 10)));
const val = deduped.slice(0, valSize);
const train = deduped.slice(valSize);

await fs.writeFile(path.join(outDir, "train.jsonl"), toJsonl(train), "utf8");
await fs.writeFile(path.join(outDir, "val.jsonl"), toJsonl(val), "utf8");
await fs.writeFile(path.join(outDir, "all.jsonl"), toJsonl(deduped), "utf8");

const sources = [...new Set(deduped.map((row) => row.source))].sort();
const summary = {
  train_examples: train.length,
  val_examples: val.length,
  total_examples: deduped.length,
  sources,
  source_counts: Object.fromEntries(sources.map((source) => [source, deduped.filter((row) => row.source === source).length]))
};
await writeJson(path.join(outDir, "summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));
