import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createInterfaceContent,
  loadInterfaceContent,
  validateInterfaceCatalog,
  validateInterfaceCatalogParity
} from "../static/source/interface-content.mjs";

const readCatalog = async (name) => JSON.parse(await readFile(
  new URL(`../static/data/interface/${name}.v1.json`, import.meta.url), "utf8"
));
const [english, spanish] = await Promise.all([readCatalog("en"), readCatalog("es")]);

test("the complete Spanish interface preserves the live English message API", () => {
  assert.deepEqual(validateInterfaceCatalog(spanish, {
    locale: "es-ES", direction: "ltr", revision: spanish.revision
  }), { valid: true, errors: [] });
  assert.deepEqual(validateInterfaceCatalogParity(english, spanish), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(spanish.messages), Object.keys(spanish.messages).sort());
});

test("Spanish has no copied English prose outside explicit shared terms and templates", () => {
  // These strings are either identical Spanish words, product/technical terms,
  // parameter-only templates, or the required English image-search example.
  // Every additional identical message must receive an explicit review here.
  const identicalAllowed = new Set([
    "app.title", "common.android", "common.audio", "common.normal",
    "courseselector.option.arialabel", "courseselector.option.status",
    "developer.audio.voiceoption", "developer.images.example",
    "games.grammargravity.journey.recapannouncement",
    "games.grammargravity.nouns.result", "home.social.title", "nav.gameoption",
    "nav.social", "progress.effort.visible", "settings.ai.chat", "settings.ai.tokens",
    "soundquasar.answer", "speech.audio.label", "speech.pace.badgestatus",
    "speech.pace.manualstatus", "speech.pace.normal", "speech.speed.normal",
    "speech.voice.option", "wordworld.diagnostics.corpus",
    "wordworld.diagnostics.pool.corpus", "wordworld.mode.answer.visible",
    "wordworld.reconstruction.points"
  ]);
  const unexpectedCopies = Object.entries(spanish.messages)
    .filter(([id, value]) => JSON.stringify(value) === JSON.stringify(english.messages[id]))
    .map(([id]) => id)
    .filter((id) => !identicalAllowed.has(id));
  assert.deepEqual(unexpectedCopies, []);
});

test("Spanish learner UI loads independently from an English target and audit authority", async () => {
  const course = {
    sourceLanguage: { locale: "es-ES", direction: "ltr" },
    targetLanguage: { locale: "en-GB", direction: "ltr" },
    languageRoles: { auditLanguage: "en", retrievalLanguage: "en" },
    interfaceContent: {
      schemaVersion: 1, locale: "es-ES", direction: "ltr",
      revision: spanish.revision,
      catalog: "/language-runtime/static/data/interface/es.v1.json"
    }
  };
  const requests = [];
  const content = await loadInterfaceContent(course, {
    origin: "https://caatuu.test",
    async fetchImpl(url) {
      requests.push(url);
      return { ok: true, json: async () => spanish };
    }
  });
  assert.deepEqual(requests, [
    `https://caatuu.test/language-runtime/static/data/interface/es.v1.json?v=${spanish.revision}`
  ]);
  assert.equal(content.locale, "es-ES");
  assert.equal(content.t("nav.home"), "Inicio");
  assert.equal(content.t("nav.settings"), "Ajustes");
  assert.equal(content.t("nav.backpack"), "Mochila");
  assert.equal(content.languageName(course.targetLanguage), "Inglés");
  assert.equal(content.languageName(course.sourceLanguage), "Español");
  assert.deepEqual(course.languageRoles, { auditLanguage: "en", retrievalLanguage: "en" });
});

test("Spanish plurals and named parameters remain usable in progress and audio controls", () => {
  const content = createInterfaceContent(spanish);
  assert.equal(content.t("progress.reward.coin", { count: 1 }), "1 moneda");
  assert.equal(content.t("progress.reward.coin", { count: 2 }), "2 monedas");
  assert.equal(content.t("progress.streak.days", { count: 0 }), "0 días");
  assert.equal(content.t("progress.streak.days", { count: 1 }), "1 día");
  assert.equal(content.t("speech.word.play", { word: "hello", speed: "lenta" }),
    "Escuchar «hello» — lenta");
  assert.throws(() => content.t("speech.word.play", { word: "hello" }), /requires placeholder speed/u);
});
