#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { hostname } from "node:os";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { CORPUS_SCHEMA_VERSION, CORPUS_ADAPTER_VERSION, loadEvaluationCorpus } from "../../../tools/learning-evaluation/shared/corpus.mjs";
import { loadCourseCatalog, generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";
import "../../language-runtime/static/source/shell-policy.js?v=shell-policy-17";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "../../..");
export const PRACTICE_CORPUS_GENERATOR_VERSION = "practice-corpus-workload-2";
export const PRACTICE_PROFILE_PATH = "apps/language-runtime/static/source/learning-profile.js";
const BEGIN = "// BEGIN GENERATED PRACTICE CORPUS";
const END = "// END GENERATED PRACTICE CORPUS";
const simpleKinds = new Set(["verb-match", "sentence", "case-context", "agreement-example", "noun-category", "listening-word", "listening-sentence", "translation-choice"]);
const groupedKinds = new Set(["conjugation-form", "character-puzzle", "word-reading-puzzle"]);
const identity = value => JSON.stringify([value.courseId, value.gameId, value.bankId]);
const text = value => typeof value === "string" && Boolean(value.trim());
const sha256 = value => createHash("sha256").update(value).digest("hex");
const dictionary = value => value instanceof Map ? value : new Map(Object.entries(value || {}));

/** Evaluate only the controlled runtime policy literal, never the profile IIFE. */
export function extractPracticeEffortPolicy(source) {
  const matches = [...source.matchAll(/\bconst practicePolicies = Object\.freeze\((\{[\s\S]*?\})\);/gu)];
  assert.equal(matches.length, 1, "Exactly one authoritative practicePolicies literal is required");
  const literal = matches[0][1];
  const policy = new Script(`(${literal})`, { filename: "practicePolicies" }).runInNewContext(Object.create(null), {
    timeout: 100, contextCodeGeneration: { strings: false, wasm: false }
  });
  validateEffortPolicy(policy);
  return { policy: Object.freeze(Object.fromEntries(Object.entries(policy).map(([id, row]) => [id, Object.freeze({ ...row })]))),
    sourceHash: sha256(literal) };
}

function validateEffortPolicy(policy) {
  const positive = value => Number.isSafeInteger(value) && value > 0;
  for (const id of ["word-world", "word-net", "case-cosmos", "naturalization-nucleus"]) {
    assert.ok(positive(policy?.[id]?.units), `Missing fixed practice effort: ${id}`);
  }
  assert.equal(policy["word-world"].units, policy["word-net"].units, "Word World aliases must share effort");
  // Matching supports up to eight pairs. Listening and Moon caps also preserve
  // historical five/six-item batches; current challenges contain three items.
  assert.ok(positive(policy["verb-nebula"]?.cap) && policy["verb-nebula"].cap >= 8, "Matching cap cannot truncate supported clean boards");
  assert.ok(positive(policy["sound-quasar"]?.cap) && policy["sound-quasar"].cap >= 5, "Listening cap cannot truncate clean five-item batches");
  assert.ok(positive(policy["memory-moon"]?.cap) && policy["memory-moon"].cap >= 6, "Memory Moon cap cannot truncate clean six-question moons");
  assert.ok(positive(policy["conjugation-comet"]?.cap) && policy["conjugation-comet"].forms === true, "Missing form-based helix effort policy");
  assert.equal(policy["grammar-gravity"]?.terminalActivity, true, "Missing terminal grammar effort policy");
}

/** Unique parent/task experiences and clean effort equivalents, not vocabulary
 * size, mastery, elapsed time, or a claim that a learner covered the corpus.
 * The corpus has one primary assessment identity: targets, directions, answer
 * alternatives, shuffled boards, and optional modes are never multiplied here.
 */
export function aggregatePracticeCorpusWorkloads(corpus, { courseProfiles, catalogDocuments, effortPolicy } = {}) {
  validateEffortPolicy(effortPolicy);
  const weights = { "verb-match": 1, sentence: effortPolicy["word-world"].units, "case-context": effortPolicy["case-cosmos"].units,
    "agreement-example": 1, "noun-category": 1, "listening-word": 1, "listening-sentence": 1, "translation-choice": 1 };
  assert.equal(corpus?.schemaVersion, CORPUS_SCHEMA_VERSION, "Unsupported practice corpus schema");
  assert.equal(corpus?.adapterVersion, CORPUS_ADAPTER_VERSION, "Unsupported practice corpus adapter");
  for (const field of ["courses", "records", "playableUnits", "adapters"]) assert.ok(Array.isArray(corpus[field]), `Missing corpus ${field}`);
  const profiles = dictionary(courseProfiles), documents = dictionary(catalogDocuments);
  const courseIds = corpus.courses.map(course => course.id);
  assert.equal(new Set(courseIds).size, courseIds.length, "Duplicate corpus course");
  assert.ok(courseIds.length > 0, "Empty practice corpus");
  for (const courseId of courseIds) assert.equal(profiles.get(courseId)?.id, courseId, `Course authority unavailable: ${courseId}`);
  assert.equal(profiles.size, courseIds.length, "Corpus must contain every registered course");
  const adapters = new Map();
  for (const adapter of corpus.adapters) {
    assert.ok(courseIds.includes(adapter.courseId), "Adapter belongs to an unknown course");
    assert.ok(globalThis.CaatuuShellPolicy.GAME_IDS.includes(adapter.gameId) && text(adapter.normalizer), "Unsupported runtime adapter");
    assert.equal(adapter.status, "ok", `Incomplete runtime adapter: ${identity(adapter)}`);
    assert.equal(adapter.playableCountAvailable, true, `Unavailable playable count: ${identity(adapter)}`);
    assert.ok(Number.isSafeInteger(adapter.playableUnits) && adapter.playableUnits >= 0, "Invalid playable adapter count");
    assert.ok(!adapters.has(identity(adapter)), "Duplicate runtime adapter");
    adapters.set(identity(adapter), adapter);
  }
  const records = new Map();
  for (const row of corpus.records) {
    assert.ok(text(row.id) && !records.has(row.id), "Missing or duplicate authoring identity");
    records.set(row.id, row);
  }
  const table = Object.fromEntries([...courseIds].sort().map(id => [id, Object.fromEntries([0, 1, 2, 3].map(level => [level, { units: 0, effort: 0 }]))]));
  const seen = new Set(), helices = new Map(), dominoes = new Map();
  const adapterCounts = new Map();
  for (const unit of corpus.playableUnits) {
    assert.ok(text(unit.id) && !seen.has(unit.id), "Missing or duplicate playable identity");
    seen.add(unit.id);
    assert.ok(table[unit.courseId], "Playable unit belongs to an unknown course");
    assert.ok(adapters.has(identity(unit)), "Playable unit lacks a successful adapter");
    adapterCounts.set(identity(unit), (adapterCounts.get(identity(unit)) || 0) + 1);
    assert.ok([0, 1, 2, 3].includes(unit.metadata?.difficulty), "Playable unit has no exact normalized difficulty");
    assert.ok(Array.isArray(unit.recordIds) && unit.recordIds.length > 0 && unit.recordIds.every(id => records.has(id)), "Playable unit lacks authoring provenance");
    assert.ok(simpleKinds.has(unit.kind) || groupedKinds.has(unit.kind), `Unsupported playable kind: ${unit.kind}`);
    if (!globalThis.CaatuuShellPolicy.isGameAvailable(unit.gameId, profiles.get(unit.courseId))) continue;
    const difficulty = unit.metadata.difficulty, count = table[unit.courseId][difficulty];
    if (unit.kind === "conjugation-form") {
      assert.ok(text(unit.parentItemId) && unit.assessmentGroup === "helix-paradigm", "Helix form lacks its board parent");
      const key = JSON.stringify([unit.courseId, unit.gameId, unit.bankId, difficulty, unit.parentItemId]);
      if (!helices.has(key)) helices.set(key, { count, forms: new Set() });
      helices.get(key).forms.add(unit.itemId);
    } else if (unit.kind === "character-puzzle" || unit.kind === "word-reading-puzzle") {
      const key = JSON.stringify([unit.courseId, unit.gameId, unit.bankId, difficulty]);
      if (!dominoes.has(key)) dominoes.set(key, { count, units: [] });
      dominoes.get(key).units.push(unit);
    } else {
      count.units++;
      count.effort += weights[unit.kind];
    }
  }
  for (const [key, adapter] of adapters) assert.equal(adapterCounts.get(key) || 0, adapter.playableUnits, "Incomplete normalized adapter population");
  for (const { count, forms } of helices.values()) {
    assert.ok(forms.size >= 2, "A helix needs at least two forms");
    count.units++;
    count.effort += Math.min(effortPolicy["conjugation-comet"].cap, forms.size);
  }
  for (const { count, units } of dominoes.values()) {
    const readings = new Map(), targets = new Set();
    let defaultPieces;
    for (const unit of units) {
      assert.equal(unit.recordIds.length, 1, "Domino identity must resolve one exact authored challenge");
      const row = records.get(unit.recordIds[0]), document = documents.get(row.source?.path);
      assert.ok(document && document.gameId === "naturalization-nucleus" && document.courseId === unit.courseId, "Domino catalog authority unavailable");
      const pieces = unit.metadata.difficulty === 0 ? 3 : document.roundSettings?.defaultPieceCount;
      assert.ok(Number.isSafeInteger(pieces) && pieces >= 3
        && (unit.metadata.difficulty === 0 || document.roundSettings.pieceCounts?.includes(pieces)), "Invalid default domino board size");
      if (defaultPieces !== undefined) assert.equal(pieces, defaultPieces, "Mixed domino board settings");
      defaultPieces = pieces;
      const location = /^challenges\[(\d+)\]$/u.exec(row.source.location);
      assert.ok(location, "Unsupported domino challenge locator");
      const challenge = document.challenges?.[Number(location[1])];
      assert.equal(challenge?.id, unit.itemId, "Domino unit no longer matches its authoring identity");
      assert.equal(challenge?.difficulty, unit.metadata.difficulty, "Domino difficulty differs from authoring");
      const reading = challenge.reading ?? challenge.pinyin, target = challenge.target ?? challenge.hanzi;
      assert.ok(text(reading) && text(target) && !targets.has(target), "Missing or duplicate domino target");
      targets.add(target);
      const key = `${reading.normalize("NFC").toLowerCase()}:${challenge.tone ?? "word"}`;
      readings.set(key, (readings.get(key) || 0) + 1);
    }
    assert.ok(readings.size >= defaultPieces, "Exact difficulty cannot form a default domino board");
    // Each board admits only one target with a given reading. Filling a final
    // board may reuse familiar targets; that overhead is part of the estimate.
    const boards = Math.max(Math.ceil(units.length / defaultPieces), ...readings.values());
    count.units += units.length;
    count.effort += boards * effortPolicy["naturalization-nucleus"].units;
  }
  for (const bands of Object.values(table)) for (const row of Object.values(bands)) {
    assert.ok(Number.isSafeInteger(row.units) && Number.isSafeInteger(row.effort), "Unsafe corpus workload total");
  }
  return table;
}

export function practiceCorpusSourceHash(corpus, { effortPolicyHash } = {}) {
  assert.match(effortPolicyHash, /^[a-f0-9]{64}$/u, "Runtime effort policy hash is required");
  const sources = (corpus.sources || []).filter(source => source.path?.replaceAll("\\", "/") !== PRACTICE_PROFILE_PATH)
    .map(source => ({ path: source.path, sha256: source.sha256 })).sort((a, b) => a.path.localeCompare(b.path, "en"));
  return sha256(JSON.stringify({ generatorVersion: PRACTICE_CORPUS_GENERATOR_VERSION,
    adapterVersion: corpus.adapterVersion, effortPolicyHash, sources }));
}

export function generatedPracticeCorpusRegion(corpus, table, { effortPolicyHash, indent = "  ", newline = "\n" } = {}) {
  const json = JSON.stringify(table, null, 2).split("\n").join(`${newline}${indent}`);
  return `${indent}// Generated by apps/server/tooling/sync-practice-progression.mjs (${PRACTICE_CORPUS_GENERATOR_VERSION}).${newline}`
    + `${indent}// Adapter: ${corpus.adapterVersion}; source SHA-256: ${practiceCorpusSourceHash(corpus, { effortPolicyHash })}.${newline}`
    + `${indent}const practiceCorpusWorkloads = Object.freeze(${json});${newline}`;
}

function confined(root, candidate) {
  const target = resolve(root, candidate), fromRoot = relative(root, target);
  assert.ok(fromRoot && !fromRoot.startsWith("..") && !isAbsolute(fromRoot), `Unconfined corpus source: ${candidate}`);
  return target;
}

/** Production writes run only in the documented, already managed container. */
export async function verifyPracticeProgressionWorkspace(workspaceRoot) {
  assert.equal(process.platform, "linux", "Run this generator inside caatuu-dev");
  assert.equal(resolve(workspaceRoot), "/workspace", "Use canonical /workspace in caatuu-dev");
  assert.equal(await realpath(workspaceRoot), "/workspace", "Canonical workspace must not be a symlink");
  assert.equal(hostname(), "caatuu-dev", "Use the existing caatuu-dev container");
  assert.equal(process.env.CAATUU_WORKSPACE_ROOT, "/workspace", "Managed workspace environment is missing");
  const mounts = (await readFile("/proc/self/mountinfo", "utf8")).split("\n");
  const mount = mounts.find(line => line.split(" ")[4] === "/workspace");
  assert.ok(mount, "Canonical checkout must be bind-mounted at /workspace");
  const fields = mount.split(" "), separator = fields.indexOf("-");
  const decode = value => value.replace(/\\([0-7]{3})/gu, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  assert.equal(decode(fields[3]).replaceAll("\\", "/").toLowerCase(), "/work/caatuu", "Container must bind C:\\Work\\caatuu");
  assert.equal(decode(fields[separator + 2]).toLowerCase(), "c:\\", "Container must bind the canonical C: drive checkout");
  const git = (...args) => execFileSync("git", args, { cwd: workspaceRoot, encoding: "utf8" }).trim();
  assert.equal(git("rev-parse", "--show-toplevel"), "/workspace");
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(git("for-each-ref", "--format=%(refname)", "refs/heads"), "refs/heads/main");
  for (const ref of git("for-each-ref", "--format=%(refname) %(symref)", "refs/remotes").split("\n").filter(Boolean)) {
    const [name, symbolic] = ref.trim().split(/\s+/u);
    assert.ok(symbolic || /^refs\/remotes\/[^/]+\/main$/u.test(name), `Non-main remote branch: ${name}`);
  }
}

export async function syncPracticeProgression({ workspaceRoot = defaultWorkspaceRoot, check = false,
  loadCorpus = loadEvaluationCorpus, loadCourses = loadCourseCatalog,
  createProfiles = loaded => new Map(loaded.courses.map(({ course }) => [course.id,
    generateCourseProfileObject(course, loaded.courses.map(record => record.course))])),
  readSource = path => readFile(path), readDocument = async path => JSON.parse(String(await readSource(path))),
  verifyWorkspace = verifyPracticeProgressionWorkspace } = {}) {
  const root = resolve(workspaceRoot);
  // Read-only CI checks may run on a detached HEAD outside Docker. Only
  // mutations require the user's canonical main/container ownership boundary.
  if (!check) await verifyWorkspace(root);
  const target = confined(root, PRACTICE_PROFILE_PATH), before = await readFile(target, "utf8");
  assert.equal(await realpath(target), target, "Generated profile target must not be a symlink");
  const { policy: effortPolicy, sourceHash: effortPolicyHash } = extractPracticeEffortPolicy(before);
  const [corpus, loaded] = await Promise.all([loadCorpus({ root }), loadCourses({ repoRoot: root })]);
  const profiles = createProfiles(loaded);
  const records = new Map(corpus.records.map(row => [row.id, row]));
  const paths = new Set(corpus.playableUnits.filter(unit => unit.kind === "character-puzzle" || unit.kind === "word-reading-puzzle")
    .flatMap(unit => unit.recordIds.map(id => records.get(id)?.source?.path)));
  const documents = new Map(await Promise.all([...paths].map(async path => {
    assert.ok(text(path), "Domino authoring source unavailable");
    return [path, await readDocument(confined(root, path))];
  })));
  const table = aggregatePracticeCorpusWorkloads(corpus, { courseProfiles: profiles, catalogDocuments: documents, effortPolicy });
  assert.equal(before.split(BEGIN).length, 2, "Exactly one generated corpus begin marker is required");
  assert.equal(before.split(END).length, 2, "Exactly one generated corpus end marker is required");
  const expression = /(^[ \t]*\/\/ BEGIN GENERATED PRACTICE CORPUS\r?\n)([\s\S]*?)(^[ \t]*\/\/ END GENERATED PRACTICE CORPUS)/mu;
  const match = expression.exec(before);
  assert.ok(match, "Malformed generated corpus region");
  const indent = /^([ \t]*)/u.exec(match[1])[1], newline = match[1].endsWith("\r\n") ? "\r\n" : "\n";
  const body = generatedPracticeCorpusRegion(corpus, table, { effortPolicyHash, indent, newline });
  const after = before.slice(0, match.index) + match[1] + body + match[3] + before.slice(match.index + match[0].length);
  const changed = after !== before;
  async function verifyCapturedSources() {
    assert.ok(Array.isArray(corpus.sources) && corpus.sources.length, "Captured corpus source hashes are unavailable");
    const bytes = new Map();
    for (const source of corpus.sources) {
      assert.ok(text(source.path) && /^[a-f0-9]{64}$/u.test(source.sha256) && !bytes.has(source.path), "Invalid captured corpus source hash");
      const value = await readSource(confined(root, source.path));
      assert.equal(sha256(value), source.sha256, `Corpus source changed during generation: ${source.path}`);
      bytes.set(source.path, value);
    }
    for (const record of loaded.courses) {
      assert.ok(text(record.manifestPath) && bytes.has(record.manifestPath), "Course manifest has no captured corpus provenance");
      assert.deepEqual(JSON.parse(String(bytes.get(record.manifestPath))), record.course,
        `Course authority changed during generation: ${record.manifestPath}`);
    }
    for (const [path, document] of documents) {
      assert.ok(bytes.has(path), "Domino catalog has no captured corpus provenance");
      assert.deepEqual(JSON.parse(String(bytes.get(path))), document, `Domino catalog changed during generation: ${path}`);
    }
  }
  await verifyCapturedSources();
  if (check && changed) throw new Error("Shared practice corpus workloads are stale. Run sync-practice-progression.mjs in caatuu-dev.");
  if (!check && changed) {
    await verifyWorkspace(root);
    await verifyCapturedSources();
    assert.equal(await readFile(target, "utf8"), before, "Shared learning profile changed during corpus generation; retry after coordination");
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    try { await writeFile(temporary, after, { encoding: "utf8", flag: "wx" }); await rename(temporary, target); }
    finally { try { await unlink(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  }
  return { changed, table, sourceHash: practiceCorpusSourceHash(corpus, { effortPolicyHash }), target };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) console.log("Usage: docker exec -w /workspace caatuu-dev node apps/server/tooling/sync-practice-progression.mjs [--check]");
  else {
    if (args.some(value => value !== "--check") || args.length > 1) throw new Error("Only --check is supported");
    syncPracticeProgression({ check: args.includes("--check") }).then(result => console.log(JSON.stringify({
      changed: result.changed, courses: Object.keys(result.table).length, sourceHash: result.sourceHash
    }))).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
