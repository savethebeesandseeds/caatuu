import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { ENGLISH_AUDIT_LANGUAGE } from "./content-contract.mjs";

export const PLANET_ENGLISH_AUDIT_CONTRACT_IDS = Object.freeze([
  "verb-nebula-items-v1",
  "word-world-manifest-v1",
  "conjugation-comet-items-v1",
  "case-cosmos-items-v1",
  "agreement-aurora-items-v1",
  "naturalization-nucleus-items-v1"
]);

const CONTRACT_IDS = new Set(PLANET_ENGLISH_AUDIT_CONTRACT_IDS);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function addIssue(issues, location, message) {
  issues.push({
    code: "content.english-audit",
    message: `${location}: ${message}`
  });
}

function requireArray(issues, value, location) {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, location, "must contain at least one authored item.");
    return [];
  }
  return value;
}

function requireEnglishText(
  issues,
  record,
  location,
  { sourceLanguageId, sourceRoleFields = [] } = {}
) {
  if (!isRecord(record)) {
    addIssue(issues, location, "must be an object with an English audit translation.");
    return;
  }
  const explicitEnglishFields = ["englishAuditText", "english", "en"];
  if (explicitEnglishFields.some((field) => nonEmptyString(record[field]))) return;
  if (
    sourceLanguageId === ENGLISH_AUDIT_LANGUAGE
    && sourceRoleFields.some((field) => nonEmptyString(record[field]))
  ) return;
  addIssue(
    issues,
    location,
    sourceLanguageId === ENGLISH_AUDIT_LANGUAGE
      ? `requires a non-empty English value (${[...explicitEnglishFields, ...sourceRoleFields].join(", ")}).`
      : "requires a non-empty englishAuditText (or an explicitly named english/en field); learner-base text is not English audit evidence."
  );
}

function validateVerbNebula(document, context, issues) {
  for (const [index, item] of requireArray(issues, document, context.location).entries()) {
    requireEnglishText(issues, item, `${context.location}[${index}]`, {
      sourceLanguageId: context.sourceLanguageId,
      sourceRoleFields: ["source"]
    });
  }
}

function validateConjugationComet(document, context, issues) {
  const verbs = requireArray(issues, document?.verbs, `${context.location}.verbs`);
  for (const [verbIndex, verb] of verbs.entries()) {
    const verbLocation = `${context.location}.verbs[${verbIndex}]`;
    requireEnglishText(issues, verb, verbLocation, {
      sourceLanguageId: context.sourceLanguageId,
      sourceRoleFields: ["meaning"]
    });
    for (const [formIndex, form] of requireArray(
      issues,
      verb?.forms,
      `${verbLocation}.forms`
    ).entries()) {
      requireEnglishText(issues, form, `${verbLocation}.forms[${formIndex}]`, {
        sourceLanguageId: context.sourceLanguageId,
        sourceRoleFields: ["cue"]
      });
    }
  }
}

function validateCaseCosmos(document, context, issues) {
  for (const [challengeIndex, challenge] of requireArray(
    issues,
    document,
    context.location
  ).entries()) {
    const cases = isRecord(challenge?.cases) ? Object.entries(challenge.cases) : [];
    if (!cases.length) {
      addIssue(issues, `${context.location}[${challengeIndex}].cases`, "must contain authored cases.");
      continue;
    }
    for (const [caseName, caseItem] of cases) {
      requireEnglishText(
        issues,
        caseItem,
        `${context.location}[${challengeIndex}].cases.${caseName}`,
        { sourceLanguageId: context.sourceLanguageId }
      );
    }
  }
}

function validateAgreementAurora(document, context, issues) {
  const challenges = Array.isArray(document) ? document : document?.challenges;
  for (const [challengeIndex, challenge] of requireArray(
    issues,
    challenges,
    Array.isArray(document) ? context.location : `${context.location}.challenges`
  ).entries()) {
    const challengeLocation = Array.isArray(document)
      ? `${context.location}[${challengeIndex}]`
      : `${context.location}.challenges[${challengeIndex}]`;
    const forms = isRecord(challenge?.forms) ? Object.entries(challenge.forms) : [];
    if (!forms.length) {
      addIssue(issues, `${challengeLocation}.forms`, "must contain authored forms.");
      continue;
    }
    for (const [formName, form] of forms) {
      const examples = requireArray(
        issues,
        form?.examples,
        `${challengeLocation}.forms.${formName}.examples`
      );
      for (const [exampleIndex, example] of examples.entries()) {
        requireEnglishText(
          issues,
          example,
          `${challengeLocation}.forms.${formName}.examples[${exampleIndex}]`,
          { sourceLanguageId: context.sourceLanguageId }
        );
      }
    }
  }
}

function validateNaturalizationNucleus(document, context, issues) {
  for (const [index, challenge] of requireArray(
    issues,
    document?.challenges,
    `${context.location}.challenges`
  ).entries()) {
    requireEnglishText(issues, challenge, `${context.location}.challenges[${index}]`, {
      sourceLanguageId: context.sourceLanguageId,
      sourceRoleFields: ["translation"]
    });
  }
}

function validateWordWorldManifest(document, context, issues) {
  if (!isRecord(document)) {
    addIssue(issues, context.location, "must be an object.");
    return;
  }
  const policy = document.embeddingPolicy;
  if (
    policy?.inputLanguage !== ENGLISH_AUDIT_LANGUAGE
    || policy?.inputField !== "embeddingText"
    || policy?.targetTextAllowed !== false
  ) {
    addIssue(
      issues,
      `${context.location}.embeddingPolicy`,
      "must keep retrieval input on English embeddingText and exclude target text."
    );
  }
  if (document.schemaVersion === "caatuu-word-world-runtime-manifest-v1") {
    if (document.translationIncluded !== true) {
      addIssue(issues, context.location, "must declare translationIncluded=true.");
    }
    if (!nonEmptyString(document.runtimeFile)) {
      addIssue(issues, context.location, "must declare a runtimeFile for item-level English audit.");
    }
    return;
  }
  if (document.schemaVersion === "caatuu-word-world-runtime-manifest-v2") {
    if (document.mediationLanguage !== ENGLISH_AUDIT_LANGUAGE) {
      addIssue(issues, context.location, "must keep mediationLanguage=en.");
    }
    if (context.publicationContract !== "language-content-v1") {
      addIssue(
        issues,
        context.location,
        "authored Word World content requires publication.contract=language-content-v1 so English concepts are audited independently."
      );
    }
    return;
  }
  addIssue(issues, context.location, "uses an unsupported Word World manifest schemaVersion.");
}

function validateWordWorldRuntime(document, context, issues) {
  const records = requireArray(issues, document?.records, `${context.location}.records`);
  for (const [index, record] of records.entries()) {
    requireEnglishText(issues, record, `${context.location}.records[${index}]`, {
      sourceLanguageId: context.sourceLanguageId
    });
  }
}

const VALIDATORS = Object.freeze({
  "verb-nebula-items-v1": validateVerbNebula,
  "word-world-manifest-v1": validateWordWorldManifest,
  "conjugation-comet-items-v1": validateConjugationComet,
  "case-cosmos-items-v1": validateCaseCosmos,
  "agreement-aurora-items-v1": validateAgreementAurora,
  "naturalization-nucleus-items-v1": validateNaturalizationNucleus
});

export function validatePlanetEnglishAuditDocument(contractId, document, context = {}) {
  const normalizedContractId = String(contractId || "").trim();
  const issues = [];
  if (!CONTRACT_IDS.has(normalizedContractId)) {
    addIssue(issues, context.location || "content", `uses unknown contract ${normalizedContractId || "<missing>"}.`);
    return issues;
  }
  VALIDATORS[normalizedContractId](document, {
    location: context.location || "content",
    sourceLanguageId: String(context.sourceLanguageId || "").trim(),
    publicationContract: String(context.publicationContract || "").trim()
  }, issues);
  return issues;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function expectedPhysicalPath(lexicalRoot, realRoot, lexicalPath) {
  return path.resolve(realRoot, path.relative(path.resolve(lexicalRoot), path.resolve(lexicalPath)));
}

async function readJson(file, location, issues) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    addIssue(issues, location, `cannot be read as JSON: ${error.message}`);
    return null;
  }
}

export async function auditPlanetEnglishResource({
  contractId,
  absolutePath,
  repositoryPath,
  sourceLanguageId,
  publicationContract,
  allowedRoot = null
}) {
  const location = repositoryPath || absolutePath;
  const issues = [];
  let realAbsolutePath;
  let realAllowedRoot = null;
  try {
    [realAbsolutePath, realAllowedRoot] = await Promise.all([
      realpath(absolutePath),
      allowedRoot ? realpath(allowedRoot) : Promise.resolve(null)
    ]);
  } catch (error) {
    addIssue(issues, location, `cannot resolve its real path: ${error.code ?? error.message}`);
    return issues;
  }
  if (realAllowedRoot) {
    const expectedRealAbsolutePath = expectedPhysicalPath(
      allowedRoot,
      realAllowedRoot,
      absolutePath
    );
    if (
      !isInside(realAllowedRoot, realAbsolutePath)
      || !samePath(realAbsolutePath, expectedRealAbsolutePath)
    ) {
      addIssue(issues, location, "does not resolve to its exact declared content path.");
      return issues;
    }
  }
  const document = await readJson(realAbsolutePath, location, issues);
  if (document === null) return issues;
  issues.push(...validatePlanetEnglishAuditDocument(contractId, document, {
    location,
    sourceLanguageId,
    publicationContract
  }));

  if (
    contractId !== "word-world-manifest-v1"
    || document?.schemaVersion !== "caatuu-word-world-runtime-manifest-v1"
    || !nonEmptyString(document.runtimeFile)
  ) return issues;

  const runtimeReference = document.runtimeFile;
  let relativeRuntimePath;
  try {
    relativeRuntimePath = decodeURIComponent(runtimeReference.split(/[?#]/u, 1)[0]);
  } catch (error) {
    addIssue(issues, `${location} -> ${runtimeReference}`, `contains invalid URL encoding: ${error.message}`);
    return issues;
  }
  const manifestDirectory = path.dirname(realAbsolutePath);
  const runtimePath = path.resolve(manifestDirectory, ...relativeRuntimePath.split("/"));
  const runtimeLocation = `${location} -> ${runtimeReference}`;
  if (
    !relativeRuntimePath
    || path.isAbsolute(relativeRuntimePath)
    || relativeRuntimePath.includes("\\")
    || relativeRuntimePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || !isInside(manifestDirectory, runtimePath)
  ) {
    addIssue(issues, runtimeLocation, "must stay inside the Word World manifest directory.");
    return issues;
  }
  let realRuntimePath;
  try {
    realRuntimePath = await realpath(runtimePath);
  } catch (error) {
    addIssue(issues, runtimeLocation, `cannot resolve its real path: ${error.code ?? error.message}`);
    return issues;
  }
  if (
    !isInside(manifestDirectory, realRuntimePath)
    || (realAllowedRoot && !isInside(realAllowedRoot, realRuntimePath))
    || !samePath(realRuntimePath, runtimePath)
  ) {
    addIssue(issues, runtimeLocation, "does not resolve to its exact declared Word World content path.");
    return issues;
  }
  const runtimeDocument = await readJson(realRuntimePath, runtimeLocation, issues);
  if (runtimeDocument !== null) {
    validateWordWorldRuntime(runtimeDocument, {
      location: runtimeLocation,
      sourceLanguageId
    }, issues);
  }
  return issues;
}
