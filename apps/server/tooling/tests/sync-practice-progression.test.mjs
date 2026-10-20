import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CORPUS_SCHEMA_VERSION, CORPUS_ADAPTER_VERSION } from "../../../../tools/learning-evaluation/shared/corpus.mjs";
import { aggregatePracticeCorpusWorkloads, extractPracticeEffortPolicy, practiceCorpusSourceHash,
  syncPracticeProgression, verifyPracticeProgressionWorkspace, PRACTICE_PROFILE_PATH } from "../sync-practice-progression.mjs";

const policySource = `const practicePolicies = Object.freeze({
  "word-world": { units: 3 }, "word-net": { units: 3 }, "case-cosmos": { units: 2 },
  "naturalization-nucleus": { units: 5 }, "verb-nebula": { cap: 12 }, "sound-quasar": { cap: 5 },
  "memory-moon": { cap: 6 },
  "conjugation-comet": { cap: 6, forms: true }, "grammar-gravity": { terminalActivity: true }
});`;
const extracted = extractPracticeEffortPolicy(policySource);
const profile = id => ({ id, capabilities: { wordWorld: true, conjugationComet: true, speech: true, memory: true },
  games: ["verb-lab", "word-net", "case-cosmos", "conjugation-comet", "grammar-gravity", "naturalization-nucleus", "sound-quasar", "memory-moon"],
  linguisticFeatures: ["grammatical-case", "verb-conjugation", "grammatical-agreement", "hanzi-pinyin"],
  routes: { verbNebula: "index.html?game=verb-lab", wordWorld: "index.html?game=word-net", caseCosmos: "cases.html",
    conjugationComet: "conjugation.html", grammarGravity: "grammar.html", naturalizationNucleus: "domino.html", soundQuasar: "sound.html",
    memoryMoon: "memory.html" } });
const kinds = { "verb-match": "verb-lab", sentence: "word-net", "case-context": "case-cosmos",
  "conjugation-form": "conjugation-comet", "agreement-example": "grammar-gravity", "noun-category": "grammar-gravity",
  "character-puzzle": "naturalization-nucleus", "listening-word": "sound-quasar", "listening-sentence": "sound-quasar", "translation-choice": "memory-moon" };

function corpusFixture(id = "future-course") {
  const corpus = { schemaVersion: CORPUS_SCHEMA_VERSION, adapterVersion: CORPUS_ADAPTER_VERSION,
    courses: [{ id }], records: [], playableUnits: [], adapters: [], sources: [{ path: "fixture.json", sha256: "a".repeat(64) }] };
  const documents = new Map(), profiles = new Map([[id, profile(id)]]);
  function add(kind, itemId, { difficulty = 1, parentItemId, source = "fixture.json", location = itemId, ...extra } = {}) {
    const gameId = kinds[kind], bankId = kind === "noun-category" ? "noun-catalog" : `${gameId}-catalog`;
    const recordId = JSON.stringify([id, gameId, bankId, location]);
    corpus.records.push({ id: recordId, source: { path: source, location } });
    const adapter = corpus.adapters.find(row => row.gameId === gameId && row.bankId === bankId);
    if (adapter) adapter.playableUnits++;
    else corpus.adapters.push({ courseId: id, gameId, bankId, status: "ok", normalizer: "fixture-normalizer", playableCountAvailable: true, playableUnits: 1 });
    corpus.playableUnits.push({ id: JSON.stringify([id, gameId, bankId, itemId]), courseId: id, gameId, bankId, kind, itemId,
      metadata: { difficulty }, recordIds: [recordId], ...(parentItemId ? { parentItemId, assessmentGroup: "helix-paradigm" } : {}), ...extra });
  }
  function domino(readings, pieces = 5, difficulty = 1) {
    const path = "domino.json";
    const document = { courseId: id, gameId: "naturalization-nucleus",
      roundSettings: { defaultPieceCount: pieces, pieceCounts: [5, 9] }, challenges: readings.map((reading, index) => ({
        id: `character-${index}`, hanzi: `target-${index}`, pinyin: reading, tone: 1, difficulty })) };
    documents.set(path, document);
    document.challenges.forEach((row, index) => add("character-puzzle", row.id, { difficulty, source: path, location: `challenges[${index}]` }));
  }
  const aggregate = (effortPolicy = extracted.policy) => aggregatePracticeCorpusWorkloads(corpus, { courseProfiles: profiles, catalogDocuments: documents, effortPolicy });
  return { corpus, profiles, documents, add, domino, aggregate };
}

test("normalized tasks count once, helix forms group by parent, and modes/targets do not inflate clean effort", () => {
  const f = corpusFixture();
  f.add("sentence", "sentence", { playableTargetCount: 20 });
  for (let index = 0; index < 8; index++) f.add("conjugation-form", `verb/form-${index}`, { parentItemId: "verb" });
  for (const kind of ["verb-match", "case-context", "agreement-example", "noun-category", "listening-word", "listening-sentence"]) f.add(kind, kind);
  f.domino(["a", "b", "c", "d", "e"]);
  f.corpus.records.push({ id: "structural-parent", recordRole: "parent" });
  assert.deepEqual(f.aggregate(), { "future-course": { 0: { units: 0, effort: 0 }, 1: { units: 13, effort: 21 }, 2: { units: 0, effort: 0 }, 3: { units: 0, effort: 0 } } });
  f.corpus.playableUnits.reverse(); f.corpus.records.reverse(); f.corpus.adapters.reverse();
  assert.equal(f.aggregate()["future-course"][1].effort, 21);
});

test("reading collisions require additional domino boards, whose repeated fillers add effort without new identities", () => {
  const f = corpusFixture();
  f.domino([...Array(8).fill("same"), "b", "c", "d", "e"]);
  assert.deepEqual(f.aggregate()["future-course"][1], { units: 12, effort: 40 });
  const nine = corpusFixture();
  nine.domino(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], 9);
  assert.deepEqual(nine.aggregate()["future-course"][1], { units: 10, effort: 10 });
});

test("Memory Moon counts each authored translation question once rather than multiplying choices or session phases", () => {
  const f = corpusFixture();
  for (const difficulty of [0, 1, 2, 3]) for (let index = 0; index < 6; index++) {
    f.add('translation-choice', `question-${difficulty}-${index}`, { difficulty, choiceCount: 3, assessmentDirection: 'recognize-translation' });
  }
  for (const difficulty of [0, 1, 2, 3]) assert.deepEqual(f.aggregate()['future-course'][difficulty], { units: 6, effort: 6 });
  f.profiles.get('future-course').capabilities.memory = false;
  for (const difficulty of [0, 1, 2, 3]) assert.deepEqual(f.aggregate()['future-course'][difficulty], { units: 0, effort: 0 });
  assert.throws(() => extractPracticeEffortPolicy(policySource.replace('"memory-moon": { cap: 6 }', '"memory-moon": { cap: 5 }')), /Memory Moon cap/u);
});

test("exact difficulty and canonical game availability apply to dynamically registered courses", () => {
  const f = corpusFixture("new-language");
  f.add("sentence", "one", { difficulty: 1 });
  f.add("sentence", "two", { difficulty: 2 });
  f.add("sentence", "three", { difficulty: 3 });
  f.add("listening-word", "listening", { difficulty: 2 });
  f.profiles.get("new-language").capabilities.speech = false;
  assert.deepEqual(f.aggregate(), { "new-language": { 0: { units: 0, effort: 0 }, 1: { units: 1, effort: 3 }, 2: { units: 1, effort: 3 }, 3: { units: 1, effort: 3 } } });
});

test("zero workloads retain complete helices and the catalog's normal reading board size", () => {
  const f = corpusFixture();
  for (const person of ["I", "you", "he", "we", "you-plural", "they"]) {
    f.add("conjugation-form", `starter/${person}`, { difficulty: 0, parentItemId: "starter" });
  }
  f.domino(["a", "b", "c", "d", "e", "f", "g", "h", "i"], 9, 0);
  assert.deepEqual(f.aggregate()["future-course"][0], { units: 10, effort: 11 });
  assert.deepEqual(f.aggregate()["future-course"][1], { units: 0, effort: 0 });
});

test("incomplete, unsupported, duplicated, or unproven normalized populations fail instead of falling back to authoring counts", () => {
  for (const mutate of [
    f => { f.corpus.adapters[0].status = "failed"; },
    f => { f.corpus.adapters[0].playableCountAvailable = false; },
    f => { f.corpus.adapters[0].playableUnits = 2; },
    f => { f.corpus.playableUnits[0].kind = "unimplemented-kind"; },
    f => { f.corpus.playableUnits[0].metadata.difficulty = null; },
    f => { f.corpus.playableUnits[0].recordIds = ["unavailable"]; },
    f => { f.corpus.playableUnits.push(f.corpus.playableUnits[0]); },
    f => { f.corpus.adapterVersion = "future-adapter"; }
  ]) {
    const f = corpusFixture(); f.add("sentence", "one"); mutate(f);
    assert.throws(() => f.aggregate());
  }
});

test("authoritative runtime policy changes update workload and its provenance without hashing the generated profile", () => {
  const f = corpusFixture(); f.add("sentence", "one");
  for (let index = 0; index < 8; index++) f.add("conjugation-form", `form-${index}`, { parentItemId: "verb" });
  const changed = extractPracticeEffortPolicy(policySource.replaceAll("units: 3", "units: 4").replace("cap: 6, forms", "cap: 7, forms"));
  assert.equal(f.aggregate()["future-course"][1].effort, 9);
  assert.equal(f.aggregate(changed.policy)["future-course"][1].effort, 11);
  const before = practiceCorpusSourceHash(f.corpus, { effortPolicyHash: extracted.sourceHash });
  assert.notEqual(practiceCorpusSourceHash(f.corpus, { effortPolicyHash: changed.sourceHash }), before);
  f.corpus.sources.push({ path: PRACTICE_PROFILE_PATH, sha256: "b".repeat(64) });
  assert.equal(practiceCorpusSourceHash(f.corpus, { effortPolicyHash: extracted.sourceHash }), before);
  f.corpus.sources.at(-1).sha256 = "c".repeat(64);
  assert.equal(practiceCorpusSourceHash(f.corpus, { effortPolicyHash: extracted.sourceHash }), before);
  assert.throws(() => extractPracticeEffortPolicy(policySource.replace("cap: 5", "cap: 4")), /Listening cap/u);
});

async function syncFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "caatuu-practice-corpus-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, PRACTICE_PROFILE_PATH);
  await mkdir(dirname(target), { recursive: true });
  const before = `// shared work before\n${policySource}\n  // BEGIN GENERATED PRACTICE CORPUS\n  const practiceCorpusWorkloads = Object.freeze({});\n  // END GENERATED PRACTICE CORPUS\n// shared work after\n`;
  await writeFile(target, before);
  const f = corpusFixture(); f.add("sentence", "one");
  let verifications = 0;
  const course = profile("future-course");
  const loaded = { courses: [{ course, manifestPath: "fixture-course.json" }] };
  const sources = { "fixture.json": "{}", "fixture-course.json": JSON.stringify(course) };
  for (const [path, bytes] of Object.entries(sources)) await writeFile(join(root, path), bytes);
  f.corpus.sources = Object.entries(sources).map(([path, bytes]) => ({ path, sha256: createHash("sha256").update(bytes).digest("hex") }));
  const options = { workspaceRoot: root, loadCorpus: async () => f.corpus, loadCourses: async () => loaded,
    createProfiles: value => new Map(value.courses.map(record => [record.course.id, record.course])),
    verifyWorkspace: async () => { verifications++; } };
  return { root, target, before, options, corpus: f.corpus, loaded, addDomino: f.domino,
    documents: f.documents, verifications: () => verifications };
}

test("check is read-only, atomic regeneration preserves shared surroundings, and a clean check is stable", async t => {
  const f = await syncFixture(t);
  await assert.rejects(syncPracticeProgression({ ...f.options, check: true }), /stale/u);
  assert.equal(await readFile(f.target, "utf8"), f.before);
  const result = await syncPracticeProgression(f.options);
  assert.equal(result.changed, true);
  const after = await readFile(f.target, "utf8");
  assert.ok(after.startsWith("// shared work before\n"));
  assert.ok(after.endsWith("// shared work after\n"));
  assert.match(after, /source SHA-256: [a-f0-9]{64}/u);
  assert.match(after, /"effort": 3/u);
  assert.equal((await syncPracticeProgression({ ...f.options, check: true })).changed, false);
  assert.equal(f.verifications(), 2);
});

test("guard failures and missing markers preserve the existing profile", async t => {
  const f = await syncFixture(t);
  await assert.rejects(syncPracticeProgression({ ...f.options, verifyWorkspace: async () => { throw new Error("not canonical main"); } }), /not canonical main/u);
  assert.equal(await readFile(f.target, "utf8"), f.before);
  const malformed = f.before.replace("// END GENERATED PRACTICE CORPUS", "// missing end");
  await writeFile(f.target, malformed);
  await assert.rejects(syncPracticeProgression(f.options), /end marker/u);
  assert.equal(await readFile(f.target, "utf8"), malformed);
});

test("read-only checks never require container, branch, or mutation authority", async t => {
  const f = await syncFixture(t);
  await syncPracticeProgression(f.options);
  const result = await syncPracticeProgression({ ...f.options, check: true,
    verifyWorkspace: () => assert.fail("read-only CI must not require a canonical mutation environment") });
  assert.equal(result.changed, false);
});

test("changed source bytes and hybrid course snapshots fail before any profile write", async t => {
  const bytes = await syncFixture(t);
  await writeFile(join(bytes.root, "fixture.json"), '{"changed":true}');
  await assert.rejects(syncPracticeProgression(bytes.options), /Corpus source changed/u);
  assert.equal(await readFile(bytes.target, "utf8"), bytes.before);
  const course = await syncFixture(t);
  course.loaded.courses[0].course.capabilities.wordWorld = false;
  await assert.rejects(syncPracticeProgression(course.options), /Course authority changed/u);
  assert.equal(await readFile(course.target, "utf8"), course.before);
});

test("a shared profile edit made during inventory loading is preserved instead of overwritten", async t => {
  const f = await syncFixture(t);
  const edited = `${f.before}// concurrent shared change\n`;
  await assert.rejects(syncPracticeProgression({ ...f.options, loadCorpus: async () => {
    await writeFile(f.target, edited); return f.corpus;
  } }), /Shared learning profile changed/u);
  assert.equal(await readFile(f.target, "utf8"), edited);
});

test("an extra authoring-document reread must match its captured bytes, preventing hybrid domino counts", async t => {
  const f = await syncFixture(t);
  f.addDomino(["a", "b", "c", "d", "e"]);
  const original = f.documents.get("domino.json"), bytes = JSON.stringify(original);
  await writeFile(join(f.root, "domino.json"), bytes);
  f.corpus.sources.push({ path: "domino.json", sha256: createHash("sha256").update(bytes).digest("hex") });
  const hybrid = structuredClone(original);
  hybrid.challenges[0].pinyin = "different";
  await assert.rejects(syncPracticeProgression({ ...f.options, readDocument: async () => hybrid }), /Domino catalog changed/u);
  assert.equal(await readFile(f.target, "utf8"), f.before);
});

test("the real mutation guard rejects an alternate path without creating a repository", async () => {
  await assert.rejects(verifyPracticeProgressionWorkspace("/tmp/alternate-caatuu"), /caatuu-dev|canonical/u);
});
