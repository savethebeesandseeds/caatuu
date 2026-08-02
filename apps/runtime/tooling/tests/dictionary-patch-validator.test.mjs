import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { compileDictionaryPatch } from "../../../../apps/languages/czech/static/dictionary-patch-core.mjs";
import {
  dictionaryPatchDigest,
  validatePatchAgainstDatabase
} from "../../../../tools/czech-ml/scripts/validate-dictionary-patch.mjs";

const review = {
  status: "codex_reviewed",
  reviewer: "Codex task dictionary-patch-validator-test",
  reviewedOn: "2026-08-01",
  humanApproved: false,
  evidence: [{
    label: "Test evidence",
    url: "https://example.test/evidence",
    note: "Fixture-only validation evidence."
  }],
  sourceLicense: {
    name: "Test fixture license",
    url: "https://example.test/license",
    attribution: "Test fixture"
  }
};

function patch(records) {
  return compileDictionaryPatch({
    schema: "caatuu.dictionary-patch.v1",
    revision: 1,
    digest: `sha256-${"0".repeat(64)}`,
    dictionaryKey: "kaikki-cs-en-2026-07-09",
    direction: "cs-en",
    records
  });
}

function fixtureDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      lemma TEXT NOT NULL,
      lemma_normalized TEXT NOT NULL,
      pos TEXT NOT NULL
    );
    CREATE TABLE search_terms (
      entry_id INTEGER NOT NULL,
      term TEXT NOT NULL,
      normalized TEXT NOT NULL,
      kind TEXT NOT NULL
    );
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      gloss TEXT NOT NULL
    );
    INSERT INTO entries(id, lemma, lemma_normalized, pos)
      VALUES (42, 'říci', 'rici', 'verb');
    INSERT INTO entries(id, lemma, lemma_normalized, pos)
      VALUES (43, 'řádí', 'radi', 'verb');
    INSERT INTO senses(id, entry_id, gloss) VALUES (1, 42, 'to say');
    INSERT INTO senses(id, entry_id, gloss) VALUES (2, 43, 'to rage');
  `);
  return database;
}

function alias(target = { entryId: 42, lemma: "říci", pos: "verb" }) {
  return {
    kind: "form-alias",
    form: "řekněme",
    tags: ["imperative"],
    target,
    review
  };
}

test("dictionary-aware validation accepts one exact, genuinely missing form alias", () => {
  const database = fixtureDatabase();
  try {
    assert.deepEqual(validatePatchAgainstDatabase(patch([alias()]), database), []);
  } finally {
    database.close();
  }
});

test("dictionary-aware validation rejects missing or mismatched alias targets", () => {
  const database = fixtureDatabase();
  try {
    assert.match(
      validatePatchAgainstDatabase(patch([alias({ entryId: 99, lemma: "říci", pos: "verb" })]), database).join("\n"),
      /targets missing base entry 99/
    );
    assert.match(
      validatePatchAgainstDatabase(patch([alias({ entryId: 42, lemma: "řici", pos: "verb" })]), database).join("\n"),
      /target metadata does not match base entry 42/
    );
  } finally {
    database.close();
  }
});

test("dictionary-aware validation rejects redundant aliases and existing entries", () => {
  const database = fixtureDatabase();
  database.prepare(
    "INSERT INTO search_terms(entry_id, term, normalized, kind) VALUES (?1, ?2, ?3, ?4)"
  ).run(42, "řekněme", "rekneme", "form");
  const existingEntry = {
    kind: "add-entry",
    lemma: "Říci",
    pos: "verb",
    sourceUrl: "https://example.test/rici",
    forms: [],
    senses: [{
      gloss: "to say",
      rawGloss: "to say",
      tags: [],
      topics: [],
      synonyms: [],
      antonyms: [],
      examples: []
    }],
    review
  };
  try {
    const errors = validatePatchAgainstDatabase(patch([alias(), existingEntry]), database).join("\n");
    assert.match(errors, /already indexes “řekněme” as form/);
    assert.match(errors, /is not a missing entry; base entry 42 already covers Říci\/verb/);
  } finally {
    database.close();
  }
});

test("dictionary-aware validation keeps accent-distinct Czech lemmas separate", () => {
  const database = fixtureDatabase();
  const accentDistinctEntry = {
    kind: "add-entry",
    lemma: "radí",
    pos: "verb",
    sourceUrl: "https://example.test/radi",
    forms: [],
    senses: [{
      gloss: "advises",
      rawGloss: "advises",
      tags: [],
      topics: [],
      synonyms: [],
      antonyms: [],
      examples: []
    }],
    review
  };
  try {
    assert.deepEqual(validatePatchAgainstDatabase(patch([accentDistinctEntry]), database), []);
  } finally {
    database.close();
  }
});

test("the published patch digest changes whenever reviewable content changes", () => {
  const raw = {
    schema: "caatuu.dictionary-patch.v1",
    revision: 1,
    digest: "ignored",
    dictionaryKey: "kaikki-cs-en-2026-07-09",
    direction: "cs-en",
    records: []
  };
  const emptyDigest = dictionaryPatchDigest(raw);
  raw.records.push(alias());
  assert.match(emptyDigest, /^sha256-[0-9a-f]{64}$/u);
  assert.notEqual(dictionaryPatchDigest(raw), emptyDigest);
});
