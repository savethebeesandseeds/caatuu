import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWord, sentenceFingerprint } from "../../../../apps/languages/czech/static/word-net-core.mjs";
import { WordNetBranchQueue } from "../../../../apps/languages/czech/static/word-net-queue.mjs";

function queue(options = {}) {
  return new WordNetBranchQueue({
    capacity: 8,
    normalizeKey: normalizeWord,
    sentenceKey: sentenceFingerprint,
    random: () => 0,
    ...options
  });
}

test("retains prepared branches after use and consumes only the requested word", () => {
  const prepared = queue();
  prepared.put("Kočka", { sentence: "Kočka spí doma." });
  prepared.put("pes", { sentence: "Pes běží venku." });
  assert.equal(prepared.take("kočka").sentence, "Kočka spí doma.");
  assert.equal(prepared.has("kočka"), true);
  assert.equal(prepared.has("pes"), true);
  assert.equal(prepared.size, 2);
  assert.equal(prepared.values().find((entry) => entry.word === "kočka").useCount, 1);
});

test("deduplicates sentences globally while merging reusable target words", () => {
  const prepared = queue();
  assert.equal(prepared.put("pes", { sentence: "Pes běží domů.", words: ["běží", "domů"] }), true);
  assert.equal(prepared.put("běží", { sentence: "Pes běží domů.", words: ["pes"] }), false);
  assert.equal(prepared.size, 1);
  assert.equal(prepared.take("běží").sentence, "Pes běží domů.");
});

test("prefers fresh entries and then cycles saved entries instead of deleting them", () => {
  let now = 1_000;
  const prepared = queue({ now: () => now });
  prepared.put("pes", { sentence: "Pes běží venku." });
  prepared.put("kočka", { sentence: "Kočka spí doma." });
  assert.equal(prepared.takeAny().word, "pes");
  now += 10;
  assert.equal(prepared.takeAny().word, "kočka");
  assert.equal(prepared.freshSize, 0);
  assert.equal(prepared.size, 2);
});

test("honors preferred words and recent-sentence exclusions", () => {
  const prepared = queue();
  prepared.put("vlak", { sentence: "Vlak čeká na nádraží." });
  prepared.put("jablko", { sentence: "Dítě jí červené jablko.", words: ["dítě", "jí", "červené"] });
  const selected = prepared.takeAny({
    preferredWords: ["dítě"],
    excludeFingerprints: [sentenceFingerprint("Vlak čeká na nádraží.")]
  });
  assert.equal(selected.word, "jablko");
});

test("restores metadata and evicts unused speculative work before displayed sentences", () => {
  let now = 1_000;
  const original = queue({ capacity: 3, freshReserve: 1, now: () => now });
  original.put("a", { sentence: "A je tady." });
  original.markUsed("A je tady.");
  now += 10;
  original.put("b", { sentence: "B je tady." });
  original.put("c", { sentence: "C je tady." });

  const restored = queue({ capacity: 3, freshReserve: 1, now: () => now, entries: original.snapshot() });
  assert.equal(restored.size, 3);
  assert.equal(restored.values().find((entry) => entry.word === "a").useCount, 1);
  now += 10_000_000;
  assert.equal(restored.size, 3);
  restored.put("d", { sentence: "D je tady." });
  assert.equal(restored.has("a"), true);
  assert.equal(restored.has("b"), false);
  assert.deepEqual(restored.words().sort(), ["a", "c", "d"]);
});

test("keeps a fresh reserve at capacity instead of discarding new speculative work", () => {
  let now = 1_000;
  const prepared = queue({ capacity: 3, freshReserve: 1, now: () => now });
  for (const [word, sentence] of [["a", "A čeká."], ["b", "B čeká."], ["c", "C čeká."]]) {
    prepared.put(word, { sentence, useCount: 1, lastUsedAt: now });
    now += 10;
  }
  assert.equal(prepared.put("d", { sentence: "D čeká." }), true);
  assert.equal(prepared.has("d"), true);
  assert.equal(prepared.freshSize, 1);
  assert.equal(prepared.size, 3);
});

test("merges newer persisted usage metadata instead of losing it", () => {
  const prepared = queue();
  prepared.put("pes", { sentence: "Pes čeká doma.", useCount: 1, lastUsedAt: 1_000 });
  prepared.restore([{ word: "pes", sentence: "Pes čeká doma.", useCount: 4, lastUsedAt: 5_000 }]);
  const [saved] = prepared.snapshot();
  assert.equal(saved.useCount, 4);
  assert.equal(saved.lastUsedAt, 5_000);
});

test("stores translations with prepared sentences and preserves them across snapshots", () => {
  const prepared = queue();
  prepared.put("pes", {
    sentence: "Pes čeká doma.",
    translation: "The dog is waiting at home."
  });
  const restored = queue({ entries: prepared.snapshot() });
  assert.equal(restored.take("pes").translation, "The dog is waiting at home.");
});

test("can enrich an existing Czech-only queue entry with English", () => {
  const prepared = queue();
  prepared.put("vlak", { sentence: "Vlak čeká na nádraží." });
  assert.equal(prepared.take("vlak").translation, "");
  assert.equal(prepared.setTranslation("Vlak čeká na nádraží.", "The train is waiting at the station."), true);
  assert.equal(prepared.take("vlak").translation, "The train is waiting at the station.");
});

test("supports an explicit TTL when a caller opts into expiration", () => {
  let now = 1_000;
  const prepared = queue({ ttlMs: 500, now: () => now });
  prepared.put("pes", { sentence: "Pes je tady." });
  now += 501;
  assert.equal(prepared.size, 0);
});
