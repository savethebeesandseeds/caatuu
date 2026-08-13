import path from "node:path";
import {
  findJsonlFiles,
  normalizeSentence,
  normalizeText,
  readJsonl,
  sha256,
  tokenize,
  writeJson,
  writeJsonl,
} from "../../../../scripts/word-world-standard-lib.mjs";

const batchId = "codex-reflexive-0001";
const createdOn = "2026-08-10";
const datasetDir = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(datasetDir, "source");
const candidateFile = path.join(import.meta.dirname, `${batchId}.candidates.jsonl`);
const manifestFile = path.join(import.meta.dirname, `${batchId}.manifest.json`);
const reportFile = path.join(import.meta.dirname, `${batchId}.authoring-report.json`);

const rows = [
  ["ucit-se", "school", "Učím se česky.", "I am learning Czech.", "Učím"],
  ["ucit-se", "school", "Dnes se učím česky.", "Today I am learning Czech.", "učím"],
  ["ucit-se", "school", "Ve škole se učím česky.", "I learn Czech at school.", "učím"],
  ["ucit-se", "school", "Moje sestra se učí česky.", "My sister is learning Czech.", "učí"],
  ["divat-se", "daily-life", "Dívám se na mapu.", "I am looking at the map.", "Dívám"],
  ["divat-se", "daily-life", "Teď se dívám na mapu.", "I am looking at the map now.", "dívám"],
  ["divat-se", "transport", "V autobuse se dívám z okna.", "I look out the window on the bus.", "dívám"],
  ["divat-se", "play", "Děti se dívají na film.", "The children are watching a film.", "dívají"],
  ["ptat-se", "school", "Ptám se učitele.", "I am asking the teacher.", "Ptám"],
  ["ptat-se", "location", "Dnes se ptám na cestu.", "Today I am asking for directions.", "ptám"],
  ["ptat-se", "school", "Ve třídě se ptáme učitelky.", "We ask the teacher in class.", "ptáme"],
  ["ptat-se", "school", "Dítě se ptá na nové slovo.", "The child asks about a new word.", "ptá"],
  ["smat-se", "play", "Směju se tomu vtipu.", "I am laughing at that joke.", "Směju"],
  ["smat-se", "play", "Teď se smějeme spolu.", "We are laughing together now.", "smějeme"],
  ["smat-se", "school", "Ve škole se děti smějí.", "The children are laughing at school.", "smějí"],
  ["smat-se", "people", "Moje kamarádka se často směje.", "My friend often laughs.", "směje"],
  ["vracet-se", "daily-life", "Vracím se domů.", "I am returning home.", "Vracím"],
  ["vracet-se", "daily-life", "Dnes se vracím brzy.", "I am coming back early today.", "vracím"],
  ["vracet-se", "school", "Po škole se vracíme domů.", "We return home after school.", "vracíme"],
  ["vracet-se", "travel", "Rodina se vrací z výletu.", "The family is returning from a trip.", "vrací"],
  ["tesit-se", "plans", "Těším se na výlet.", "I am looking forward to the trip.", "Těším"],
  ["tesit-se", "plans", "Dnes se těšíme na film.", "Today we are looking forward to the film.", "těšíme"],
  ["tesit-se", "school", "Ve škole se těším na přestávku.", "At school, I look forward to the break.", "těším"],
  ["tesit-se", "plans", "Děti se těší na prázdniny.", "The children are looking forward to the holidays.", "těší"],
  ["bat-se", "weather", "Bojím se bouřky.", "I am afraid of the storm.", "Bojím"],
  ["bat-se", "people", "V noci se bojím tmy.", "At night, I am afraid of the dark.", "bojím"],
  ["bat-se", "people", "Dítě se bojí velkého psa.", "The child is afraid of the big dog.", "bojí"],
  ["bat-se", "home", "Náš pes se bojí vysavače.", "Our dog is afraid of the vacuum cleaner.", "bojí"],
  ["setkat-se", "people", "Setkám se s Janou.", "I will meet Jana.", "Setkám"],
  ["setkat-se", "plans", "Zítra se setkám s Petrem.", "I will meet Petr tomorrow.", "setkám"],
  ["setkat-se", "school", "Ve škole se setkáme s učitelkou.", "We will meet the teacher at school.", "setkáme"],
  ["setkat-se", "transport", "Na nádraží se setkají přátelé.", "Friends will meet at the station.", "setkají"],
];

const records = rows.map((row, index) => makeRecord(row, index));
const sourceFiles = await findJsonlFiles(sourceDir);
const canonical = (await Promise.all(sourceFiles.map(readJsonl))).flat();
const canonicalCzech = new Set(canonical.map((record) => normalizeSentence(record.languages.cs.text)));
const candidateCzech = new Set();
const errors = [];

for (const record of records) {
  const key = normalizeSentence(record.languages.cs.text);
  if (candidateCzech.has(key)) errors.push(`${record.id}: duplicate Czech inside the batch`);
  if (canonicalCzech.has(key)) errors.push(`${record.id}: duplicates an existing Czech sentence`);
  candidateCzech.add(key);
  const tokens = tokenize(record.languages.cs.text);
  for (const target of record.targets) {
    const token = tokens[target.tokenIndex];
    if (!token || token.surface !== target.surface || token.normalized !== target.normalized) {
      errors.push(`${record.id}: target ${target.surface} does not match its token`);
    }
  }
}

if (errors.length) throw new Error(errors.join("\n"));
await writeJsonl(candidateFile, records);
const candidateBytes = await import("node:fs/promises").then(({ readFile }) => readFile(candidateFile));
const candidateSha256 = sha256(candidateBytes);

await writeJson(manifestFile, {
  schemaVersion: "caatuu-word-world-candidate-manifest-v1",
  batchId,
  createdOn,
  recordsFile: path.basename(candidateFile),
  recordsSha256: candidateSha256,
  recordCount: records.length,
  status: "candidate",
  acceptedIntoCanonicalSource: false,
  compiledIntoRuntimePack: false,
  externalCorpusTextUsed: false,
  intendedUse: "Create explorable families of common Czech verbs with se inside Word World.",
});
await writeJson(reportFile, {
  schemaVersion: "caatuu-word-world-candidate-authoring-report-v1",
  batchId,
  createdOn,
  disposition: "candidate_only_pending_review",
  selfReviewIsAcceptance: false,
  counts: {
    records: records.length,
    families: Object.fromEntries([...new Set(rows.map(([family]) => family))].map((family) => [family, rows.filter(([value]) => value === family).length])),
    byDifficulty: { "2": records.length },
  },
  checks: {
    exactCzechDuplicatesInBatch: 0,
    exactCzechDuplicatesAgainstCanonical: 0,
    exactTargetPositions: true,
    everyRecordMakesSePlayable: records.every((record) => record.targets.some((target) => target.normalized === "se" && target.playable)),
  },
  reviewRequired: [
    "Czech naturalness",
    "English naturalness and bilingual equivalence",
    "intentional minimal-contrast family review",
    "target and metadata review",
    "child-safety review",
  ],
});

console.log(JSON.stringify({ batchId, records: records.length, candidateFile, candidateSha256 }, null, 2));

function makeRecord([family, topic, cs, en, verbSurface], index) {
  const tokens = tokenize(cs);
  const verbIndex = tokens.findIndex((token) => token.surface === verbSurface);
  const seIndex = tokens.findIndex((token) => token.normalized === "se");
  if (verbIndex < 0 || seIndex < 0) throw new Error(`Missing verb or se in ${cs}`);
  const serial = String(index + 1).padStart(4, "0");
  const sourceId = `${batchId}-${serial}`;
  const targets = [tokens[verbIndex], tokens[seIndex]]
    .sort((left, right) => left.tokenIndex - right.tokenIndex)
    .map((token) => ({ ...token, playable: true }));
  return {
    schemaVersion: "caatuu-word-world-record-v1",
    id: `ww-${sourceId}`,
    languages: { en: { text: en, alternates: [] }, cs: { text: cs } },
    difficulty: 2,
    cefr: "A1",
    topic,
    targets,
    learning: {
      objective: "explore common verbs with se in natural sentences",
      skillFocus: ["verb with se", "word order in context"],
      ageBand: "6-10",
      progression: {
        level: 2,
        rationale: "Short everyday sentences repeat one useful verb while changing the natural opening around se.",
        prerequisites: ["recognize-level-1-words-and-formulas"],
      },
      support: { translationAvailable: true, imageSuitable: true, audioSuitable: true, dictionarySuitable: true },
    },
    grammar: {
      tags: ["codex_authored", "lexical_se", "clitic_placement", `family_${family}`],
      sentenceType: "statement",
      clauseCount: 1,
    },
    scene: { query: en.replace(/[.!?]$/u, ""), assetIds: [] },
    provenance: {
      sourceName: "Caatuu Word World se-family expansion",
      sourceIds: [sourceId],
      sourceLicense: "Caatuu-authored candidate; licensing confirmation required before promotion",
      sourceType: "codex_authored",
      transformation: "Original bilingual authoring for Caatuu; no external corpus text was used. Metadata and exact target positions were generated from the authored pair.",
    },
    review: {
      status: "candidate",
      reviewer: "candidate author self-check only",
      reviewedOn: createdOn,
      humanApproved: false,
      checks: ["author structural self-check", "author bilingual self-check", "author placement-family self-check"],
      notes: ["Author self-check is not acceptance. This record awaits focused bilingual review."],
    },
  };
}
