import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyEditorialOverrides,
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
const reviewedReflexiveFile = path.join(sourceDir, "codex-reflexive-0001-reviewed.jsonl");
const candidateDir = path.join(datasetDir, "candidates");
const rubricFile = path.join(datasetDir, "rubric.json");
const editorialOverridesFile = path.join(datasetDir, "editorial-overrides.json");
const runtimeRoot = path.join(repoRoot, "apps", "languages", "czech", "static", "data", "games", "word-world");

const sourceFiles = await findJsonlFiles(sourceDir);
const historicalSourceRecords = (await Promise.all(sourceFiles.map(readJsonl))).flat().sort((left, right) => left.id.localeCompare(right.id));
const rubric = await readJson(rubricFile);
const editorialOverrides = await readJson(editorialOverridesFile);
const records = applyEditorialOverrides(historicalSourceRecords, editorialOverrides);

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
  assert.equal(records.length, 792);
  assert.equal(validation.level2Share, 0.713384);
  assert.deepEqual(Object.fromEntries([1, 2, 3].map((level) => [level, records.filter((record) => record.difficulty === level).length])), {
    "1": 175,
    "2": 565,
    "3": 52,
  });
  assert.ok(records.every((record) => record.review.status === "codex_reviewed"));
  assert.ok(records.every((record) => record.review.humanApproved === false));
});

test("the versioned child-safety ledger applies exact, honest editorial corrections", () => {
  const expected = {
    "ww-codex-exp-0001-0101": ["I have two soccer balls.", "Mám dva fotbalové míče."],
    "ww-codex-l3-0001-0025": ["Two soccer balls ended up behind the fence while the children practiced passing.", "Dva fotbalové míče skončily za plotem, když děti trénovaly přihrávky."],
    "ww-cp-000107": ["I feel hot.", "Je mi horko."],
    "ww-cp-000413": ["It is difficult.", "Je to těžké."],
    "ww-codex-exp-0001-0093": ["Try to spell this word.", "Zkus vyhláskovat toto slovo."],
    "ww-cp-000011": ["What is this character's name?", "Jak se jmenuje tato postava?"],
    "ww-cp-000056": ["Write the character's name.", "Napiš jméno postavy."],
    "ww-codex-exp-0001-0172": ["The boy stopped on his way home.", "Chlapec se cestou domů zastavil."],
    "ww-codex-exp-0001-0169": ["We can meet in the classroom.", "Můžeme se sejít ve třídě."],
    "ww-cp-000201": ["Where is the library?", "Kde je knihovna?"],
    "ww-cp-000203": ["Come here to the teacher.", "Pojď sem k učiteli."],
    "ww-cp-000224": ["Follow the teacher.", "Pojď za učitelem."],
    "ww-cp-000333": ["Stay with your parent.", "Zůstaň se svým rodičem."],
    "ww-cp-000334": ["Hold your parent's hand.", "Drž svého rodiče za ruku."],
    "ww-cp-000393": ["Cross the street at the crossing with an adult.", "Přejdi ulici po přechodu s dospělým."],
    "ww-cp-000465": ["We can meet later in the classroom.", "Můžeme se sejít později ve třídě."],
    "ww-cp-000474": ["Wait for your parent.", "Počkej na rodiče."],
    "ww-cp-000476": ["Call your parent.", "Zavolej rodiči."],
    "ww-cp-000477": ["Text your parent.", "Napiš rodiči."],
    "ww-cp-000478": ["Ask an adult before answering the phone.", "Než zvedneš telefon, zeptej se dospělého."],
    "ww-cp-000489": ["Take a photo of the flower.", "Vyfoť květinu."],
    "ww-cp-000490": ["Send the message to your parent.", "Pošli zprávu rodiči."],
    "ww-cp-000364": ["Open the window with an adult's help.", "Otevři okno s pomocí dospělého."],
    "ww-cp-000143": ["My father cooks dinner at home.", "Můj tatínek doma vaří večeři."],
    "ww-cp-000144": ["My mother reads a book.", "Moje maminka čte knihu."],
    "ww-cp-000145": ["Grandma repairs a bicycle.", "Babička opravuje kolo."],
    "ww-cp-000146": ["Grandpa washes the dishes.", "Dědeček myje nádobí."],
  };
  assert.equal(editorialOverrides.schemaVersion, "caatuu-word-world-editorial-overrides-v1");
  assert.equal(editorialOverrides.editorialPass.humanApproved, false);
  assert.deepEqual(editorialOverrides.overrides.map((override) => override.id), Object.keys(expected));
  for (const [id, [en, cs]] of Object.entries(expected)) {
    const record = records.find((entry) => entry.id === id);
    assert.ok(record, id);
    assert.equal(record.languages.en.text, en, `${id} English`);
    assert.equal(record.languages.cs.text, cs, `${id} Czech`);
    assert.equal(record.review.reviewer, "OpenAI Codex child-safety editorial curation", `${id} reviewer`);
    assert.equal(record.review.reviewedOn, "2026-08-13", `${id} review date`);
    assert.equal(record.review.humanApproved, false, `${id} human approval`);
    assert.ok(record.review.checks.includes("post-promotion child-safety editorial curation"), `${id} check`);
    assert.ok(record.provenance.transformation.includes("original candidate, review, and promoted-source evidence remains unchanged"), `${id} provenance`);
  }
  assert.equal(historicalSourceRecords.find((record) => record.id === "ww-codex-exp-0001-0101").languages.en.text, "I have two balls.");
  assert.deepEqual(records.find((record) => record.id === "ww-codex-exp-0001-0093").targets, [
    { surface: "vyhláskovat", normalized: "vyhláskovat", tokenIndex: 1, playable: true },
  ]);
  for (const override of editorialOverrides.overrides) {
    const before = historicalSourceRecords.find((record) => record.id === override.id);
    const after = records.find((record) => record.id === override.id);
    assert.equal(after.targets.length, before.targets.length, `${override.id} target count changed`);
    assert.equal(
      after.targets.filter((target) => target.playable).length,
      before.targets.filter((target) => target.playable).length,
      `${override.id} playable target count changed`,
    );
  }
});

test("Word World compilation rejects unsafe source text before overrides and has zero safety errors after them", () => {
  const historicalValidation = validateRecords(historicalSourceRecords, rubric);
  assert.equal(historicalValidation.valid, false);
  assert.ok(historicalValidation.errors.some((error) => (
    error.includes("ww-codex-exp-0001-0101")
    && error.includes("review.ambiguous-first-person-balls")
  )));
  const effectiveValidation = validateRecords(records, rubric);
  assert.equal(effectiveValidation.valid, true, effectiveValidation.errors.join("\n"));
  assert.deepEqual(effectiveValidation.errors.filter((error) => error.includes("learner-content safety")), []);
});

test("editorial overrides fail closed on duplicate IDs, drift, and missing source rows", () => {
  const duplicate = structuredClone(editorialOverrides);
  duplicate.overrides.push(structuredClone(duplicate.overrides[0]));
  assert.throws(() => applyEditorialOverrides(historicalSourceRecords, duplicate), /Duplicate editorial override id/);

  const drifted = structuredClone(editorialOverrides);
  drifted.overrides[0].changes[0].expected = "Unexpected old sentence.";
  assert.throws(() => applyEditorialOverrides(historicalSourceRecords, drifted), /expected value drifted/);

  const missing = structuredClone(editorialOverrides);
  missing.overrides[0].id = "ww-missing-editorial-source";
  assert.throws(() => applyEditorialOverrides(historicalSourceRecords, missing), /source record is missing/);

  const shortenedTargets = structuredClone(editorialOverrides);
  const targetOverride = shortenedTargets.overrides.find((override) => (
    override.changes.some((change) => change.path === "/targets" && change.expected.length > 1)
  ));
  assert.ok(targetOverride, "expected a multi-target editorial override");
  targetOverride.changes.find((change) => change.path === "/targets").replacement.length = 1;
  assert.throws(() => applyEditorialOverrides(historicalSourceRecords, shortenedTargets), /must preserve all .* target annotations/);

  const changedPlayableCount = structuredClone(editorialOverrides);
  const playableOverride = changedPlayableCount.overrides.find((override) => (
    override.changes.some((change) => change.path === "/targets")
  ));
  const playableTargets = playableOverride.changes.find((change) => change.path === "/targets").replacement;
  playableTargets[0].playable = !playableTargets[0].playable;
  assert.throws(() => applyEditorialOverrides(historicalSourceRecords, changedPlayableCount), /must preserve .* playable targets/);
});

test("the focused se families are explorable and retain their honest review boundary", async () => {
  const candidateFile = path.join(candidateDir, "codex-reflexive-0001.candidates.jsonl");
  const reviewFile = path.join(candidateDir, "codex-reflexive-0001.focused-review.json");
  const receiptFile = path.join(candidateDir, "codex-reflexive-0001.promotion-receipt.json");
  const [candidateBytes, reviewBytes, reviewedBytes, candidates, review, receipt, reviewed] = await Promise.all([
    fs.readFile(candidateFile),
    fs.readFile(reviewFile),
    fs.readFile(reviewedReflexiveFile),
    readJsonl(candidateFile),
    readJson(reviewFile),
    readJson(receiptFile),
    readJsonl(reviewedReflexiveFile),
  ]);

  assert.equal(sha256(candidateBytes), "a1dcbe3bb5644bd89a498f70677c035116251e26244906f288050fff3ced7f02");
  assert.equal(sha256(reviewBytes), "ed9a2c091a4df1fac538df6a7675c6ceae7a670d32151f5a1f85a661175495f4");
  assert.equal(sha256(reviewedBytes), "a9dc3bd1319bf3f4d4155a719d469a49d0f1f8e3d9935e4e6e18e04a31f312e6");
  assert.equal(review.independent, false);
  assert.equal(review.humanApproved, false);
  assert.equal(receipt.review.independent, false);
  assert.equal(receipt.output.sourceSha256, sha256(reviewedBytes));
  assert.equal(candidates.length, 32);
  assert.equal(reviewed.length, 32);
  assert.deepEqual(reviewed.map((record) => record.languages), candidates.map((record) => record.languages));
  assert.deepEqual(reviewed.map((record) => record.targets), candidates.map((record) => record.targets));
  assert.ok(reviewed.every((record) => record.difficulty === 2));
  assert.ok(reviewed.every((record) => record.targets.some((target) => target.normalized === "se" && target.playable)));
  assert.ok(reviewed.every((record) => record.review.status === "codex_reviewed"));
  assert.ok(reviewed.every((record) => record.review.humanApproved === false));
  const families = reviewed.flatMap((record) => record.grammar.tags.filter((tag) => tag.startsWith("family_")));
  assert.equal(new Set(families).size, 8);
  assert.ok([...new Set(families)].every((family) => families.filter((value) => value === family).length === 4));
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
    const record = historicalSourceRecords.find((entry) => entry.provenance.sourceIds.includes(sourceId));
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
  const editorialOverridesBytes = await fs.readFile(editorialOverridesFile);
  const runtimePath = manifest.runtimeFile.split("?", 1)[0];
  const runtimeFile = path.join(runtimeRoot, ...runtimePath.split("/"));
  const fileText = await fs.readFile(runtimeFile, "utf8");
  const pack = JSON.parse(fileText);
  assert.equal(manifest.contentSha256, sha256(fileText));
  assert.equal(manifest.recordCount, pack.records.length);
  assert.equal(manifest.minimumLevel3Records, 50);
  assert.deepEqual(manifest.editorialOverrides, {
    file: "tools/czech-ml/data/word-world/standard-v0.1/editorial-overrides.json",
    sha256: sha256(editorialOverridesBytes),
    overrideCount: 27,
    reviewedOn: "2026-08-13",
    humanApproved: false,
  });
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
  assert.ok(coverage.inputFiles.includes("tools/czech-ml/data/word-world/standard-v0.1/editorial-overrides.json"));
  assert.deepEqual(coverage.editorialOverrides, {
    file: "tools/czech-ml/data/word-world/standard-v0.1/editorial-overrides.json",
    sha256: sha256(await fs.readFile(editorialOverridesFile)),
    overrideCount: 27,
    reviewedOn: "2026-08-13",
    humanApproved: false,
  });
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
