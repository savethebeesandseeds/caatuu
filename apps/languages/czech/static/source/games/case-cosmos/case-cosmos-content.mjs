import { createCaseCosmosContent } from "../../../../../../language-runtime/static/source/games/case-cosmos/case-cosmos-core.mjs?v=case-cosmos-core-1";
import { CZECH_CASE_SYSTEM } from "./case-cosmos-cs-policy.mjs?v=case-cosmos-policy-3";
export { CZECH_CASES, CASE_CONTRASTS } from "./case-cosmos-cs-policy.mjs?v=case-cosmos-policy-3";

const content = createCaseCosmosContent({ courseId: "cz", caseSystem: CZECH_CASE_SYSTEM });
// Compatibility for retained Czech v2 catalogs and noun-array callers. History IDs stay unchanged.
function normalizeLegacyPack(value) {
  return value?.schemaVersion === "caatuu-case-cosmos-content-v2"
    ? { ...value, schemaVersion: "caatuu-case-cosmos-content-v3", caseSystem: CZECH_CASE_SYSTEM }
    : value;
}
export const targetSpan = content.targetSpan;
export const buildQuestions = content.buildQuestions;
export const validatePack = value => content.validatePack(normalizeLegacyPack(value));
export const buildRounds = (value, difficulty) => content.buildRounds(normalizeLegacyPack(value), difficulty);
export const buildCasePracticeRounds = (value, difficulty, options) => content.buildCasePracticeRounds(normalizeLegacyPack(value), difficulty, options);
