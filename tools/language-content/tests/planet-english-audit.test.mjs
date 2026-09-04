import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditPlanetEnglishResource,
  PLANET_ENGLISH_AUDIT_CONTRACT_IDS,
  validatePlanetEnglishAuditDocument
} from "../lib/planet-english-audit.mjs";

test("every planet English-audit contract accepts its current English-base shape", () => {
  const fixtures = new Map([
    ["verb-nebula-items-v1", [{ target: "gehen", source: "go" }]],
    ["conjugation-comet-items-v1", {
      verbs: [{ verb: "gehen", meaning: "go", forms: [{ form: "gehe", cue: "I go" }] }]
    }],
    ["case-cosmos-items-v1", [{
      cases: { Nominative: { form: "Hund", english: "The dog runs." } }
    }]],
    ["agreement-aurora-items-v1", [{
      forms: { masculine: { examples: [{ target: "guter Hund", english: "good dog" }] } }
    }]],
    ["naturalization-nucleus-items-v1", {
      challenges: [{ target: "字", translation: "written character" }]
    }],
    ["word-world-manifest-v1", {
      schemaVersion: "caatuu-word-world-runtime-manifest-v2",
      mediationLanguage: "en",
      embeddingPolicy: {
        inputLanguage: "en",
        inputField: "embeddingText",
        targetTextAllowed: false
      }
    }]
  ]);

  assert.deepEqual(
    [...fixtures.keys()].sort(),
    [...PLANET_ENGLISH_AUDIT_CONTRACT_IDS].sort()
  );
  for (const [contractId, fixture] of fixtures) {
    assert.deepEqual(validatePlanetEnglishAuditDocument(contractId, fixture, {
      sourceLanguageId: "en",
      publicationContract: "language-content-v1"
    }), [], contractId);
  }
});

test("Agreement Aurora accepts metadata-bearing content packs without dropping English audit", () => {
  assert.deepEqual(validatePlanetEnglishAuditDocument("agreement-aurora-items-v1", {
    schemaVersion: "caatuu-agreement-aurora-content-v2",
    challenges: [{
      forms: {
        femininePlural: {
          examples: [{ target: "las casas blancas", englishAuditText: "the white houses" }]
        }
      }
    }]
  }, { sourceLanguageId: "en" }), []);
});

test("a non-English learner base cannot masquerade as the English audit translation", () => {
  for (const [contractId, fixture] of [
    ["verb-nebula-items-v1", [{ target: "gehen", source: "aller" }]],
    ["conjugation-comet-items-v1", {
      verbs: [{ verb: "gehen", meaning: "aller", forms: [{ form: "gehe", cue: "je vais" }] }]
    }],
    ["naturalization-nucleus-items-v1", {
      challenges: [{ target: "字", translation: "caractère écrit" }]
    }]
  ]) {
    const issues = validatePlanetEnglishAuditDocument(contractId, fixture, {
      sourceLanguageId: "fr"
    });
    assert.ok(issues.length > 0, contractId);
    assert.ok(issues.every(({ code }) => code === "content.english-audit"));
    assert.match(issues[0].message, /englishAuditText/u);
  }
});

test("explicit English audit text keeps non-English-base content valid", () => {
  assert.deepEqual(validatePlanetEnglishAuditDocument("verb-nebula-items-v1", [{
    target: "gehen",
    source: "aller",
    englishAuditText: "go"
  }], { sourceLanguageId: "fr" }), []);
});

test("legacy Word World follows its confined runtime file and audits every record", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "caatuu-english-audit-"));
  try {
    const gameDirectory = path.join(root, "word-world");
    await mkdir(path.join(gameDirectory, "runtime"), { recursive: true });
    const manifestPath = path.join(gameDirectory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: "caatuu-word-world-runtime-manifest-v1",
      translationIncluded: true,
      runtimeFile: "runtime/records.json?v=hash",
      embeddingPolicy: {
        inputLanguage: "en",
        inputField: "embeddingText",
        targetTextAllowed: false
      }
    }), "utf8");
    await writeFile(path.join(gameDirectory, "runtime", "records.json"), JSON.stringify({
      records: [{ target: "Ahoj", en: "Hello" }, { target: "Díky" }]
    }), "utf8");

    const issues = await auditPlanetEnglishResource({
      contractId: "word-world-manifest-v1",
      absolutePath: manifestPath,
      repositoryPath: "fixture/manifest.json",
      sourceLanguageId: "en"
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /records\[1\]/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy Word World rejects a runtime symlink outside its declared content root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "caatuu-english-audit-link-"));
  try {
    const staticRoot = path.join(root, "course", "static");
    const gameDirectory = path.join(staticRoot, "word-world");
    const outsideRuntime = path.join(root, "outside", "records.json");
    await mkdir(path.join(gameDirectory, "runtime"), { recursive: true });
    await mkdir(path.dirname(outsideRuntime), { recursive: true });
    const manifestPath = path.join(gameDirectory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: "caatuu-word-world-runtime-manifest-v1",
      translationIncluded: true,
      runtimeFile: "runtime/records.json",
      embeddingPolicy: {
        inputLanguage: "en",
        inputField: "embeddingText",
        targetTextAllowed: false
      }
    }), "utf8");
    await writeFile(outsideRuntime, JSON.stringify({
      records: [{ target: "Ahoj", en: "Hello" }]
    }), "utf8");
    await symlink(outsideRuntime, path.join(gameDirectory, "runtime", "records.json"), "file");

    const issues = await auditPlanetEnglishResource({
      contractId: "word-world-manifest-v1",
      absolutePath: manifestPath,
      allowedRoot: staticRoot,
      repositoryPath: "fixture/manifest.json",
      sourceLanguageId: "en"
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /exact declared Word World content path/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy Word World rejects an in-root runtime symlink to different bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "caatuu-english-audit-alias-"));
  try {
    const staticRoot = path.join(root, "static");
    const gameDirectory = path.join(staticRoot, "word-world");
    await mkdir(path.join(gameDirectory, "runtime"), { recursive: true });
    await mkdir(path.join(gameDirectory, "alternate"), { recursive: true });
    const manifestPath = path.join(gameDirectory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: "caatuu-word-world-runtime-manifest-v1",
      translationIncluded: true,
      runtimeFile: "runtime/records.json",
      embeddingPolicy: {
        inputLanguage: "en",
        inputField: "embeddingText",
        targetTextAllowed: false
      }
    }), "utf8");
    const alternateRuntime = path.join(gameDirectory, "alternate", "records.json");
    await writeFile(alternateRuntime, JSON.stringify({
      records: [{ target: "Ahoj", en: "Different reviewed bytes" }]
    }), "utf8");
    await symlink(alternateRuntime, path.join(gameDirectory, "runtime", "records.json"), "file");

    const issues = await auditPlanetEnglishResource({
      contractId: "word-world-manifest-v1",
      absolutePath: manifestPath,
      allowedRoot: staticRoot,
      repositoryPath: "fixture/manifest.json",
      sourceLanguageId: "en"
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /exact declared Word World content path/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy Word World accepts a whole declared-root alias without changing authority", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "caatuu-english-audit-root-alias-"));
  try {
    const realStaticRoot = path.join(root, "real-static");
    const aliasStaticRoot = path.join(root, "alias-static");
    const gameDirectory = path.join(realStaticRoot, "word-world");
    await mkdir(path.join(gameDirectory, "runtime"), { recursive: true });
    await writeFile(path.join(gameDirectory, "manifest.json"), JSON.stringify({
      schemaVersion: "caatuu-word-world-runtime-manifest-v1",
      translationIncluded: true,
      runtimeFile: "runtime/records.json",
      embeddingPolicy: {
        inputLanguage: "en",
        inputField: "embeddingText",
        targetTextAllowed: false
      }
    }), "utf8");
    await writeFile(path.join(gameDirectory, "runtime", "records.json"), JSON.stringify({
      records: [{ target: "Ahoj", en: "Hello" }]
    }), "utf8");
    await symlink(realStaticRoot, aliasStaticRoot, "junction");

    assert.deepEqual(await auditPlanetEnglishResource({
      contractId: "word-world-manifest-v1",
      absolutePath: path.join(aliasStaticRoot, "word-world", "manifest.json"),
      allowedRoot: aliasStaticRoot,
      repositoryPath: "fixture/manifest.json",
      sourceLanguageId: "en"
    }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
