import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  findJsonlFiles,
  normalizeText,
  normalizeSentence,
  readJson,
  readJsonl,
  sha256,
  tokenize,
  validateRecords,
} from "../scripts/word-world-standard-lib.mjs";

const mlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(mlRoot, "..", "..");
const datasetDir = path.join(mlRoot, "data", "word-world", "standard-v0.1");
const sourceDir = path.join(datasetDir, "source");
const commonSourceFile = path.join(sourceDir, "common-phrases-pilot.jsonl");
const reviewedExpansionFile = path.join(sourceDir, "codex-expansion-0001-reviewed.jsonl");
const reviewedLevel3File = path.join(sourceDir, "codex-level3-0001-reviewed.jsonl");
const candidateDir = path.join(datasetDir, "candidates");
const rubricFile = path.join(datasetDir, "rubric.json");
const runtimeRoot = path.join(repoRoot, "apps", "languages", "czech", "static", "data", "word-world");

const sourceFiles = await findJsonlFiles(sourceDir);
const records = (await Promise.all(sourceFiles.map(readJsonl))).flat().sort((left, right) => left.id.localeCompare(right.id));
const rubric = await readJson(rubricFile);

test("normalizes Czech tokens without losing diacritics", () => {
  assert.equal(normalizeText("  PŘÍŠTÍ týden! "), "příští týden");
  assert.notEqual(normalizeSentence("Můžeme vyrazit?"), normalizeSentence("Můžeme vyrazit."));
  assert.deepEqual(tokenize("Mám žízeň."), [
    { surface: "Mám", normalized: "mám", tokenIndex: 0 },
    { surface: "žízeň", normalized: "žízeň", tokenIndex: 1 },
  ]);
});

test("the checked-in corpus satisfies schema, difficulty, review, and duplicate gates", () => {
  const validation = validateRecords(records, rubric);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(records.length, 760);
  assert.equal(validation.level2Share, 0.701316);
  assert.deepEqual(Object.fromEntries([1, 2, 3].map((level) => [level, records.filter((record) => record.difficulty === level).length])), {
    "1": 175,
    "2": 533,
    "3": 52,
  });
  assert.ok(records.every((record) => record.review.status === "codex_reviewed"));
  assert.ok(records.every((record) => record.review.humanApproved === false));
});

test("only the 219 independently passing expansion rows enter canonical source", async () => {
  const candidateFile = path.join(candidateDir, "codex-expansion-0001.candidates.jsonl");
  const auditFile = path.join(candidateDir, "codex-expansion-0001.blind-review.json");
  const receiptFile = path.join(candidateDir, "codex-expansion-0001.promotion-receipt.json");
  const [candidateBytes, auditBytes, commonBytes, reviewedBytes, candidates, audit, receipt, reviewed] = await Promise.all([
    fs.readFile(candidateFile),
    fs.readFile(auditFile),
    fs.readFile(commonSourceFile),
    fs.readFile(reviewedExpansionFile),
    readJsonl(candidateFile),
    readJson(auditFile),
    readJson(receiptFile),
    readJsonl(reviewedExpansionFile),
  ]);

  assert.equal(sha256(candidateBytes), "a719737b2658fe4a269eeba629122760760f4244bb3fd90fcc903df51adc32c6");
  assert.equal(sha256(auditBytes), "561dab14cb5dc88df563730c2b8ffbd3bd6c73fd596a278c8b4504c97213c5b2");
  assert.equal(sha256(commonBytes), "909a50a024664d7741c54c3e61d265921addce430b74fc5c0556f58f77e7d604");
  assert.equal(sha256(reviewedBytes), "581c12eb10a10baac99fa05a634432d050e742496054176a59927fd117d2a044");
  assert.equal(audit.inputs.candidateSha256, sha256(candidateBytes));
  assert.equal(audit.inputs.canonicalSha256, sha256(commonBytes));
  assert.equal(receipt.inputs.blindReviewSha256, sha256(auditBytes));
  assert.equal(receipt.output.sourceSha256, sha256(reviewedBytes));
  assert.equal(receipt.humanApproved, false);
  assert.equal(receipt.selection.promotedRecords, 219);
  assert.equal(receipt.selection.heldRecords, 31);
  assert.deepEqual(receipt.selection.promotedByDifficulty, { "1": 49, "2": 170 });
  assert.deepEqual(receipt.selection.heldByDifficulty, { "1": 13, "2": 18 });

  const passIds = audit.rows.filter((row) => row.verdict === "pass").map((row) => row.id);
  const failedIds = audit.rows.filter((row) => row.verdict === "fail").map((row) => row.id);
  assert.deepEqual(reviewed.map((record) => record.id), passIds);
  assert.deepEqual(receipt.selection.promotedIds, passIds);
  assert.deepEqual(receipt.selection.heldIds, failedIds);
  assert.equal(reviewed.length, 219);
  assert.equal(failedIds.length, 31);

  const candidateById = new Map(candidates.map((record) => [record.id, record]));
  for (const promoted of reviewed) {
    const candidate = candidateById.get(promoted.id);
    assert.deepEqual(promoted.languages, candidate.languages, `${promoted.id} text`);
    assert.equal(promoted.difficulty, candidate.difficulty, `${promoted.id} difficulty`);
    assert.deepEqual(promoted.targets, candidate.targets, `${promoted.id} targets`);
    assert.equal(promoted.provenance.sourceLicense, "MIT", `${promoted.id} license`);
    assert.equal(promoted.review.status, "codex_reviewed", `${promoted.id} review status`);
    assert.equal(promoted.review.reviewedOn, "2026-07-22", `${promoted.id} review date`);
    assert.equal(promoted.review.humanApproved, false, `${promoted.id} human approval`);
  }

  const canonicalIds = new Set(records.map((record) => record.id));
  for (const failedId of failedIds) assert.equal(canonicalIds.has(failedId), false, failedId);
  assert.equal(canonicalIds.has("ww-codex-exp-0001-0002"), false, "known failed bilingual row entered source");
});

test("only the 52 independently safe Level 3 rows enter canonical source", async () => {
  const candidateFile = path.join(candidateDir, "codex-level3-0001.candidates.jsonl");
  const auditFile = path.join(candidateDir, "codex-level3-0001.blind-review.json");
  const receiptFile = path.join(candidateDir, "codex-level3-0001.promotion-receipt.json");
  const comparisonBatchFile = path.join(candidateDir, "codex-expansion-0001.candidates.jsonl");
  const [candidateBytes, auditBytes, commonBytes, comparisonBytes, reviewedBytes, candidates, audit, receipt, reviewed] = await Promise.all([
    fs.readFile(candidateFile),
    fs.readFile(auditFile),
    fs.readFile(commonSourceFile),
    fs.readFile(comparisonBatchFile),
    fs.readFile(reviewedLevel3File),
    readJsonl(candidateFile),
    readJson(auditFile),
    readJson(receiptFile),
    readJsonl(reviewedLevel3File),
  ]);

  assert.equal(sha256(candidateBytes), "f69b73cf2e3f70cbc93a67db2896d7c6875c5ec198b53c6b8b0cd2d39f48c454");
  assert.equal(sha256(auditBytes), "8fa444bb6da7510b47667f6d2e1bd3d4be5d08238f084ff2c1f7c22f5da97b21");
  assert.equal(sha256(reviewedBytes), "ab08b03f4acbd9aa2347d230a12bbe818815b6e715edf4af35106ee9aa69c8cc");
  assert.equal(audit.inputs.candidateSha256, sha256(candidateBytes));
  assert.equal(audit.inputs.canonicalSha256, sha256(commonBytes));
  assert.equal(audit.inputs.comparisonBatchSha256, sha256(comparisonBytes));
  assert.equal(receipt.inputs.blindReviewSha256, sha256(auditBytes));
  assert.equal(receipt.output.sourceSha256, sha256(reviewedBytes));
  assert.equal(receipt.humanApproved, false);
  assert.equal(receipt.selection.promotedRecords, 52);
  assert.equal(receipt.selection.heldRecords, 28);
  assert.deepEqual(receipt.selection.promotedByDifficulty, { "3": 52 });
  assert.deepEqual(receipt.selection.heldByDifficulty, { "3": 28 });

  const passRows = audit.rows.filter((row) => row.verdict === "pass" && row.safeToPromote === true);
  const failedRows = audit.rows.filter((row) => row.verdict === "fail" && row.safeToPromote === false);
  const passIds = passRows.map((row) => row.id);
  const failedIds = failedRows.map((row) => row.id);
  assert.equal(audit.rows.length, passRows.length + failedRows.length, "every review decision must be internally consistent");
  assert.deepEqual(reviewed.map((record) => record.id), passIds);
  assert.deepEqual(receipt.selection.promotedIds, passIds);
  assert.deepEqual(receipt.selection.heldIds, failedIds);
  assert.equal(reviewed.length, 52);
  assert.equal(failedIds.length, 28);

  const candidateById = new Map(candidates.map((record) => [record.id, record]));
  for (const promoted of reviewed) {
    const candidate = candidateById.get(promoted.id);
    assert.deepEqual(promoted.languages, candidate.languages, `${promoted.id} text`);
    assert.equal(promoted.difficulty, 3, `${promoted.id} difficulty`);
    assert.deepEqual(promoted.targets, candidate.targets, `${promoted.id} targets`);
    assert.equal(promoted.provenance.sourceLicense, "MIT", `${promoted.id} license`);
    assert.equal(promoted.review.status, "codex_reviewed", `${promoted.id} review status`);
    assert.equal(promoted.review.reviewedOn, "2026-07-22", `${promoted.id} review date`);
    assert.equal(promoted.review.humanApproved, false, `${promoted.id} human approval`);
  }

  const canonicalIds = new Set(records.map((record) => record.id));
  for (const failedId of failedIds) assert.equal(canonicalIds.has(failedId), false, failedId);
  assert.equal(canonicalIds.has("ww-codex-l3-0001-0002"), false, "known failed Level 3 row entered source");
});

test("independent audit bilingual and naturalness corrections are locked", () => {
  const expected = {
    "cc-000025": ["Let's say hello.", "Řekněme si ahoj."],
    "cc-000047": ["That's kind of you.", "To je od tebe milé."],
    "cc-000069": ["Work in pairs.", "Pracuj ve dvojici."],
    "cc-000150": ["Let's help each other.", "Pomozme si navzájem."],
    "cc-000151": ["I get up early.", "Vstávám brzy."],
    "cc-000159": ["I do my homework.", "Dělám si domácí úkol."],
    "cc-000083": ["Can you show it to me?", "Můžeš mi to ukázat?"],
    "cc-000096": ["Which word is it?", "Které slovo to je?"],
    "cc-000222": ["I can’t find the right way.", "Nemůžu najít správnou cestu."],
    "cc-000260": ["This costs less.", "Tohle stojí méně."],
    "cc-000261": ["I like this.", "Tohle se mi líbí."],
    "cc-000268": ["Are we waiting in line here?", "Čekáme tady ve frontě?"],
    "cc-000285": ["Put on your hat.", "Nasaď si čepici."],
    "cc-000337": ["Get help, please.", "Prosím, dojdi pro pomoc."],
    "cc-000339": ["My knee hurts.", "Bolí mě koleno."],
    "cc-000353": ["The room is tidy.", "Pokoj je uklizený."],
    "cc-000405": ["I want this.", "Chci tohle."],
    "cc-000406": ["I want that.", "Chci tamto."],
    "cc-000407": ["Which option do you want?", "Kterou možnost chceš?"],
    "cc-000408": ["This is better.", "Tohle je lepší."],
    "cc-000409": ["That is nice.", "Tamto je hezké."],
    "cc-000469": ["What are we going to do?", "Co budeme dělat?"],
    "cc-000471": ["Let's finish later.", "Dokončeme to později."],
    "cc-000489": ["Take a photo of it.", "Vyfoť to."],
  };
  for (const [sourceId, [en, cs]] of Object.entries(expected)) {
    const record = records.find((entry) => entry.provenance.sourceIds.includes(sourceId));
    assert.ok(record, `missing corrected ${sourceId}`);
    assert.equal(record.languages.en.text, en, `${sourceId} English`);
    assert.equal(record.languages.cs.text, cs, `${sourceId} Czech`);
  }
});

test("blind-audit relevels complex first-contact rows to level 2", () => {
  const relevelled = [
    "cc-000021", "cc-000036", "cc-000044", "cc-000058", "cc-000066", "cc-000069", "cc-000070", "cc-000073",
    "cc-000083", "cc-000088", "cc-000094", "cc-000096", "cc-000098", "cc-000099", "cc-000111", "cc-000117",
    "cc-000103", "cc-000109", "cc-000123", "cc-000125", "cc-000147", "cc-000148", "cc-000149", "cc-000159",
  ];
  for (const sourceId of relevelled) {
    const record = records.find((entry) => entry.provenance.sourceIds.includes(sourceId));
    assert.equal(record?.difficulty, 2, sourceId);
    assert.equal(record?.cefr, "A1", sourceId);
  }
});

test("re-audit grammar guidance matches the corrected Czech constructions", () => {
  const expected = {
    "cc-000021": { tags: ["common_phrase", "question", "past", "possessive", "function_greet_and_introduce", "category_greetings_intro"], sentenceType: "question" },
    "cc-000134": { tags: ["common_phrase", "question", "be_present", "function_talk_about_people", "category_family_people"], sentenceType: "question" },
    "cc-000222": { tags: ["common_phrase", "modal", "negative", "function_ask_and_give_directions", "category_location_directions"], sentenceType: "statement" },
    "cc-000244": { tags: ["common_phrase", "past", "event", "function_talk_about_food", "category_food_drink"], sentenceType: "statement" },
    "cc-000472": { tags: ["common_phrase", "question", "modal", "function_make_plans", "category_plans_invitations"], sentenceType: "question" },
    "cc-000473": { tags: ["common_phrase", "modal", "function_make_plans", "category_plans_invitations"], sentenceType: "statement" },
  };
  for (const [sourceId, guidance] of Object.entries(expected)) {
    const record = records.find((entry) => entry.provenance.sourceIds.includes(sourceId));
    assert.ok(record, `missing corrected ${sourceId}`);
    assert.deepEqual(record.grammar.tags, guidance.tags, `${sourceId} tags`);
    assert.deepEqual(record.learning.skillFocus, guidance.tags
      .filter((tag) => !tag.startsWith("function_") && !tag.startsWith("category_") && tag !== "common_phrase")
      .map((tag) => tag.replaceAll("_", " ")), `${sourceId} skill focus`);
    assert.equal(record.grammar.sentenceType, guidance.sentenceType, `${sourceId} sentence type`);
  }
});

test("unsupported speaker-gender defaults cannot return", () => {
  const forbidden = [
    "Rád tě vidím.", "Jsi tu nový?", "To jsem nechtěl.", "Prosím, buď opatrný.", "Udělal jsem chybu.",
    "Nejsem si jistý.", "Našel jsem to.", "Jsem šťastný.", "Jsem smutný.", "Jsem unavený.",
    "Jsem nadšený.", "Jsem připravený.", "Nejsem připravený.", "Jsem zaneprázdněný.", "Jsem pyšný.",
    "Mám rád svou rodinu.", "Ztratil jsem cestu.", "Mám rád jablka.", "Mám rád banány.",
    "Nemám rád cibuli.", "Rozlil jsem pití.", "Už jsem plný.", "Vyhrál jsem.", "Vyhrál jsi.",
    "Buď opatrný.", "Našel jsem klíče.", "Zapomněl jsem.", "Jsi připravený jít?", "Jsem připravený jít.",
  ];
  const czech = new Set(records.map((record) => record.languages.cs.text));
  for (const phrase of forbidden) assert.equal(czech.has(phrase), false, phrase);
  assert.equal(records.find((record) => record.id === "ww-cp-000013")?.languages.en.text, "This is my friend Tom.");
  assert.equal(records.find((record) => record.id === "ww-cp-000136")?.languages.en.text, "That man is my teacher.");
});

test("exact Czech duplicates are merged and English alternates are preserved", () => {
  const hello = records.find((record) => record.id === "ww-cp-000001");
  assert.deepEqual(hello.provenance.sourceIds, ["cc-000001", "cc-000002"]);
  assert.deepEqual(hello.languages.en.alternates, ["Hi."]);
  const howAreYou = records.find((record) => record.id === "ww-cp-000006");
  assert.deepEqual(howAreYou.languages.en.alternates, ["How's it going?"]);
});

test("function-only formulas do not invent a playable branch target", () => {
  const no = records.find((record) => record.languages.cs.text === "Ne.");
  assert.ok(no);
  assert.ok(no.targets.every((target) => target.playable === false));
  assert.equal(no.learning.support.dictionarySuitable, false);
});

test("review rejections cannot silently re-enter the pilot", async () => {
  const rejected = await readJsonl(path.join(datasetDir, "reports", "common-phrases-rejections.jsonl"));
  const rejectedIds = new Set(rejected.map((record) => record.sourceId));
  assert.equal(rejectedIds.size, 8);
  for (const record of records) {
    assert.ok(record.provenance.sourceIds.every((sourceId) => !rejectedIds.has(sourceId)));
  }
});

test("level 1 rejects a sentence beyond the tiny-sentence limit", () => {
  const changed = structuredClone(records);
  const first = changed.find((record) => record.difficulty === 1);
  first.languages.cs.text = "Tohle je příliš dlouhá věta pro začátek.";
  first.targets = tokenize(first.languages.cs.text).map((token) => ({ ...token, playable: true }));
  const validation = validateRecords(changed, rubric);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("level 1 allows 5")));
});

test("level 2 must remain the majority", () => {
  const changed = structuredClone(records);
  for (const record of changed) {
    record.difficulty = 1;
    record.learning.progression.level = 1;
  }
  const validation = validateRecords(changed, rubric);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("level 2 share")));
});

test("a real Level 3 layer cannot fall below the 50-record minimum", () => {
  const changed = structuredClone(records);
  const removedIds = new Set(changed.filter((record) => record.difficulty === 3).slice(0, 3).map((record) => record.id));
  const withoutThree = changed.filter((record) => !removedIds.has(record.id));
  const validation = validateRecords(withoutThree, rubric);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("level 3 has 49 records; minimum is 50")));
});

test("the same English meaning may intentionally describe a different Czech record", () => {
  const baseline = validateRecords(records, rubric);
  const changed = structuredClone(records);
  const englishCounts = new Map();
  for (const record of changed) {
    for (const meaning of [record.languages.en.text, ...record.languages.en.alternates]) {
      const key = normalizeText(meaning);
      englishCounts.set(key, (englishCounts.get(key) || 0) + 1);
    }
  }
  const uniqueMeaningRecord = changed.find((record) => (
    record.languages.en.alternates.length === 0
    && englishCounts.get(normalizeText(record.languages.en.text)) === 1
  ));
  const variant = structuredClone(uniqueMeaningRecord);
  variant.id = "ww-test-formal-hello";
  variant.languages.cs.text = "Zdravím vás.";
  variant.targets = tokenize(variant.languages.cs.text).map((token) => ({ ...token, playable: true }));
  variant.provenance.sourceIds = ["test-formal-hello"];
  changed.push(variant);
  const validation = validateRecords(changed, rubric);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.duplicateEnglishGroups, baseline.duplicateEnglishGroups + 1);
  assert.ok(validation.warnings.some((warning) => warning.includes("English meaning")));
});

test("runtime manifest points to a deterministic compact pack", async () => {
  const manifest = await readJson(path.join(runtimeRoot, "manifest.json"));
  const runtimePath = manifest.runtimeFile.split("?", 1)[0];
  const runtimeFile = path.join(runtimeRoot, ...runtimePath.split("/"));
  const fileText = await fs.readFile(runtimeFile, "utf8");
  const pack = JSON.parse(fileText);
  assert.equal(manifest.contentSha256, sha256(fileText));
  assert.equal(manifest.recordCount, pack.records.length);
  assert.equal(manifest.minimumLevel3Records, 50);
  assert.equal(pack.records.length, records.length);
  assert.deepEqual(pack.records.map((record) => record.id), [...pack.records.map((record) => record.id)].sort());
  assert.deepEqual(Object.keys(pack.records[0]), [
    "id", "cs", "en", "enAlternates", "difficulty", "cefr", "topic", "targets", "learning", "grammar", "sceneQuery", "sceneAssetIds", "provenance", "review",
  ]);
});

test("validation and coverage reports have distinct machine-readable contracts", async () => {
  const validation = await readJson(path.join(datasetDir, "reports", "validation.json"));
  const coverage = await readJson(path.join(datasetDir, "reports", "coverage.json"));
  assert.equal(validation.schemaVersion, "caatuu-word-world-validation-v1");
  assert.equal(validation.valid, true);
  assert.equal(validation.recordCount, records.length);
  assert.equal(coverage.schemaVersion, "caatuu-word-world-coverage-v1");
  assert.equal(coverage.records.total, records.length);
  assert.ok(Array.isArray(coverage.targets.perTarget));
});

test("independent blind-review receipt records every correction without human approval", async () => {
  const receipt = await readJson(path.join(datasetDir, "reports", "blind-review-2026-07-21.json"));
  assert.equal(receipt.schemaVersion, "caatuu-word-world-blind-review-v1");
  assert.equal(receipt.reviewDate, "2026-07-22");
  assert.equal(receipt.humanApproved, false);
  assert.equal(receipt.findings, receipt.resolutions.length);
  assert.equal(receipt.findings, 69);
  assert.equal(receipt.correctedSourceRows, 69);
  assert.equal(receipt.reviewEvents, 76);
  assert.equal(receipt.overlappingReviewRows, 7);
  assert.equal(receipt.difficultyChanges, 24);
  assert.equal(receipt.textChanges, 58);
  assert.equal(receipt.guidanceChanges, 8);
  assert.equal(receipt.explicitGuidanceCorrections, 6);
  assert.deepEqual(receipt.findingsByReviewPass, {
    "blind_review_2026-07-21": 59,
    "independent_reaudit_2026-07-22": 17,
  });
  assert.equal(receipt.reviewPasses.length, 2);
  assert.ok(receipt.resolutions.every((finding) => finding.resolution.action === "corrected"));
  assert.ok(receipt.resolutions.every((finding) => finding.reviewOrigins.length >= 1));
});
