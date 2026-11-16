import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateRecords, toRuntimeRecord, buildCoverageReport } from "../../czech-ml/scripts/word-world-standard-lib.mjs";
import { normalizeContentProgression } from "../../../apps/language-runtime/static/source/games/content-progression.mjs";

function corpusVersion(document) {
  const value = document.metadata?.corpusVersion;
  assert.ok(typeof value === "string" && value.length > 0 && value.length <= 80
    && value === value.trim() && value === value.normalize("NFC") && !/[<>\p{Cc}\p{Cf}]/u.test(value),
  "Standard records require a bounded, nonempty, normalized corpusVersion.");
  return value;
}

// Provider-specific compatibility with the original standard corpus. The
// publication contract selects this implementation by provider, never course ID.
function playableRecords(document) {
  return document.records.filter(item => item.reviewStatus !== "untranslated");
}

export function standardCorpusAuthoringRecords(document) {
  return playableRecords(document).map(item => {
    assert.equal(item.embeddingText, item.englishText, `${item.id}: standard corpus ranks the included English sentence`);
    assert.equal(item.pronunciation, null, `${item.id}: standard speech uses the sentence text`);
    assert.deepEqual(Object.keys(item.annotations).sort(), ["cefr", "learning", "grammar", "provenance", "review"].sort());
    return {
      schemaVersion: "caatuu-word-world-record-v1", id: item.id,
      languages: { en: { text: item.englishText, alternates: [...item.englishAlternates] }, cs: { text: item.targetText } },
      difficulty: item.difficulty, cefr: item.annotations.cefr, topic: item.topic,
      targets: item.tokens.map(token => {
        assert.deepEqual(Object.keys(token).sort(), ["surface", "normalized", "tokenIndex", "playable", "gloss"].sort());
        if (token.gloss !== null) assert.ok(typeof token.gloss === "string" && token.gloss.trim()
          && token.gloss === token.gloss.trim() && token.gloss === token.gloss.normalize("NFC")
          && !/[<>\p{Cc}\p{Cf}]/u.test(token.gloss), `${item.id}: expected normalized plain-text gloss`);
        const { gloss, ...target } = token;
        return target;
      }),
      learning: structuredClone(item.annotations.learning), grammar: structuredClone(item.annotations.grammar),
      scene: { query: item.sceneQuery, assetIds: [...item.sceneAssetIds] },
      provenance: structuredClone(item.annotations.provenance), review: structuredClone(item.annotations.review),
      ...(item.semanticBankId ? { semanticBankId: item.semanticBankId } : {})
    };
  });
}

export function standardCorpusRuntimeRecords(document, rubric) {
  const playable = playableRecords(document);
  const authoring = standardCorpusAuthoringRecords({ ...document, records: playable });
  if (!authoring.length) return { authoring, runtime: [], validation: { valid: true, errors: [] } };
  const validation = validateRecords(authoring, rubric);
  assert.ok(validation.valid, validation.errors.join("\n"));
  const runtime = authoring.map((record, index) => {
    const output = toRuntimeRecord(record);
    Object.assign(output, normalizeContentProgression(playable[index], record.id));
    output.targets.forEach((target, tokenIndex) => {
      const gloss = playable[index].tokens[tokenIndex].gloss;
      if (gloss !== null) target.gloss = gloss;
    });
    return output;
  });
  return { authoring, runtime, validation };
}

export const czechStandardRecordsProvider = Object.freeze({
  id: "czech-standard-records-v1",
  rubricPath: "tools/czech-ml/data/word-world/standard-v0.1/rubric.json",
  validate(document, course) {
    corpusVersion(document);
    assert.equal(course.sourceLanguage.locale, "en", "This standard-record provider supports an English learner base.");
    assert.equal(course.targetLanguage.locale, "cs-CZ", "This standard-record provider supports Czech target text.");
    assert.equal(document.sourceLanguage, course.sourceLanguage.locale);
    assert.equal(document.targetLanguage, course.targetLanguage.locale);
    assert.equal(document.courseId, course.id);
    standardCorpusAuthoringRecords(document);
  },
  project({ document, rubric, manifest, sourcePath, runtimeFile }) {
    const version = corpusVersion(document);
    assert.equal(manifest.schemaVersion, "caatuu-word-world-runtime-manifest-v1");
    assert.equal(manifest.mode, "standard");
    assert.equal(manifest.sessionProvider?.kind, "standard-corpus");
    const { authoring, runtime, validation } = standardCorpusRuntimeRecords(document, rubric);
    const coverage = buildCoverageReport(authoring, rubric, validation, [sourcePath]);
    const bytes = JSON.stringify({ schemaVersion: "caatuu-word-world-runtime-v1", corpusVersion: version, records: runtime }) + "\n";
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    return { bytes, manifest: {
      ...manifest, corpusVersion: version,
      runtimeFile: `${runtimeFile}?v=${contentSha256.slice(0, 16)}`, recordCount: runtime.length, contentSha256,
      difficultyDistribution: coverage.records.byDifficulty, difficultyShare: coverage.records.difficultyShare,
      playableTargets: coverage.targets.uniquePlayable,
      branchability: { ...manifest.branchability, branchableTargets: coverage.targets.branchable.targetCount,
        strongTargets: coverage.targets.strong.targetCount },
      authoringFile: sourcePath, authoringSchema: document.schemaVersion
    }, coverage, validation };
  }
});
