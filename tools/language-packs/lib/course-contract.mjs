import { Buffer } from "node:buffer";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";

import {
  ENGLISH_AUDIT_LANGUAGE
} from "../../language-content/lib/content-contract.mjs";
import { auditDictionaryContentDocuments } from "../../language-content/lib/dictionary-content-audit.mjs";
import { loadAndPrepareLanguageRoleContent } from "../../language-content/lib/language-role-contract.mjs";
import { auditPlanetEnglishResource } from "../../language-content/lib/planet-english-audit.mjs";
import { projectWordWorldRuntime } from "../../language-content/project-word-world-runtime.mjs";
import { resolveWordWorldProjectionPolicy } from "../../language-content/word-world-projection/registry.mjs";
import {
  browserCourseGameContentClosureIssues,
  browserSetupCacheNamespaceIssues,
  browserSharedRuntimeClosureIssues
} from "./browser-shared-runtime-closure.mjs";
import { assertLanguageAdapterMatchesTarget } from "../../../apps/language-runtime/contract.mjs";
import { normalizeAgreementAuroraPack } from "../../../apps/language-runtime/static/source/games/agreement-aurora/agreement-aurora-core.mjs";
import { validateConjugationCometCatalog } from "../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs";
import { resolveWordWorldGenerationStrategy } from "../../../apps/language-runtime/static/source/word-world-provider.mjs";
import {
  GAME_IDS,
  LEARNER_BASE_PRESENTATION_CONTRACT,
  NON_CAMPAIGN_GAME_IDS,
  NON_CAMPAIGN_GAME_REGISTRY,
  PLANET_GAME_CONTRACT
} from "../../../apps/language-runtime/static/source/shell-policy.mjs";

export {
  browserCourseGameContentClosureIssues,
  browserSetupCacheNamespaceIssues,
  browserSharedRuntimeClosureIssues
};

export const COURSE_SCHEMA_VERSION = 1;
export const DEFAULT_CATALOG_PATH = "apps/languages/catalog.json";
export const CANONICAL_BROWSER_APP_ENTRY_PATH = "apps/language-runtime/static/app/index.html";

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COURSE_SCHEMA_PATH = "tools/language-packs/schemas/course-pack.v1.schema.json";
const CATALOG_SCHEMA_PATH = "tools/language-packs/schemas/catalog.v1.schema.json";
const LEARNER_BASE_REALIZATION_ROOT = "apps/languages/shared/learner-base-realizations/";
const LANGUAGE_ADAPTER_CONTRACT_URL = new URL(
  "../../../apps/language-runtime/contract.mjs",
  import.meta.url
).href;
const COURSE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROJECTION_POLICY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u;
const ROUTE_PREFIX_PATTERN = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COURSE_RELATIVE_ROUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?:\?[A-Za-z0-9._~!$&'()*+,;=:@/?%-]+)?$/u;
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const REPOSITORY_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ ()/-]*$/;
const LANGUAGE_PRESENTATION_KEYS = [
  "label",
  "nativeLabel",
  "shortCode",
  "locale",
  "direction",
  "flagClass",
  "flagSrc"
];
const SHARED_RESOURCE_ROOTS = [
  "apps/launcher/static/assets",
  "apps/language-runtime",
  "shared"
];
const LEGACY_VIEW_CAPABILITIES = [
  "chat",
  "dictionary",
  "memory",
  "verbs",
  "wordWorld",
  "conjugationComet",
  "offlineModels",
  "semanticSearch"
];
const CAPABILITY_KEYS = [
  "llm",
  "generation",
  "chat",
  "embeddings",
  "semanticSearch",
  "skillCompass",
  "dictionary",
  "memory",
  "verbs",
  "wordWorld",
  "conjugationComet",
  "offlineModels",
  "speech",
  "pronunciationGuides"
];
const LINGUISTIC_FEATURE_IDS = [
  "verb-conjugation",
  "grammatical-case",
  "grammatical-agreement",
  "hanzi-pinyin"
];
const UPCOMING_GAME_IDS = NON_CAMPAIGN_GAME_IDS;
const GAME_REQUIREMENTS = NON_CAMPAIGN_GAME_REGISTRY;
const SHARED_GAME_HOST_BY_ROUTE = Object.freeze(Object.fromEntries(
  Object.values(GAME_REQUIREMENTS)
    .filter(({ route, sharedHost }) => typeof route === "string" && typeof sharedHost === "string")
    .map(({ route, sharedHost }) => [route, sharedHost])
));
const COURSE_KEYS = [
  "$schema",
  "schemaVersion",
  "id",
  "directoryName",
  "status",
  "brandLabel",
  "workspaceLabel",
  "routePrefix",
  "entryPath",
  "sourceLanguage",
  "targetLanguage",
  "launcher",
  "routes",
  "storage",
  "cache",
  "capabilities",
  "skillCompass",
  "linguisticFeatures",
  "games",
  "upcomingGames",
  "publication",
  "platforms",
  "resources"
];
const REQUIRED_COURSE_KEYS = COURSE_KEYS.filter((key) => !["linguisticFeatures", "games", "upcomingGames"].includes(key));
const SKILL_COMPASS_COPY_KEYS = [
  "eyebrow",
  "title",
  "summary",
  "chartTitle",
  "chartDescription",
  "legendLabel",
  "practiceLabel",
  "strengthLabel",
  "confidenceLabel",
  "progressLabel",
  "notMapped",
  "building",
  "notAssessed",
  "idleMessage",
  "emptyChartDescription",
  "emptyMessage",
  "emptySummary",
  "projectionDescription",
  "unmappedMessage",
  "practiceOnlyMessage",
  "partialStrengthMessage",
  "completeMessage",
  "loadingMessage",
  "loadingSummary",
  "errorMessage",
  "errorSummary",
  "changedMessage",
  "closedMessage",
  "updateReadySummary",
  "closedSummary"
];
const BASE_RESOURCE_KEYS = [
  "staticRoot",
  "courseProfile",
  "languageAdapter",
  "webManifest",
  "setupCatalog",
  "sourceLanguageFlag",
  "launcherFlag"
];
const DICTIONARY_RESOURCE_KEYS = [
  "dictionaryCatalog",
  "dictionaryCoreEntries",
  "dictionaryScriptLines",
  "dictionaryReferenceDocument",
  "dictionaryProvider"
];
const BROWSER_PROVIDER_RESOURCE_KEYS = [
  "courseRuntime",
  "semanticLearningProvider",
  "setupProgressProvider",
  "setupProvider"
];

export class CourseContractError extends Error {
  constructor(issues) {
    const detail = issues.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n");
    super(`Course-pack contract validation failed:\n${detail}`);
    this.name = "CourseContractError";
    this.issues = issues;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function isInside(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

function expectedPhysicalPath(lexicalRoot, realRoot, lexicalPath) {
  return path.resolve(realRoot, path.relative(path.resolve(lexicalRoot), path.resolve(lexicalPath)));
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function isSafeRepositoryPath(value) {
  if (typeof value !== "string" || !REPOSITORY_PATH_PATTERN.test(value) || value.includes("\\")) return false;
  if (path.posix.isAbsolute(value)) return false;
  const segments = value.split("/");
  return !segments.includes("") && !segments.includes(".") && !segments.includes("..");
}

function routesCollide(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function isValidEntryPath(entryPath, routePrefix) {
  if (typeof entryPath !== "string" || typeof routePrefix !== "string") return false;
  const expectedPrefix = `${routePrefix}/`;
  if (!entryPath.startsWith(expectedPrefix)) return false;
  const suffix = entryPath.slice(expectedPrefix.length);
  return suffix.length > 0
    && !suffix.includes("\\")
    && !suffix.includes("?")
    && !suffix.includes("#")
    && suffix.split("/").every((component) => component.length > 0 && component !== "." && component !== "..");
}

function isSafeCourseRelativeRoute(value) {
  if (typeof value !== "string" || !COURSE_RELATIVE_ROUTE_PATTERN.test(value)) return false;
  const pathPart = value.split("?", 1)[0];
  if (pathPart.split("/").some((component) => (
    component.length === 0 || component === "." || component === ".."
  ))) return false;

  const base = new URL("https://caatuu.invalid/course/");
  const resolved = new URL(value, base);
  return resolved.origin === base.origin
    && resolved.pathname.startsWith(base.pathname)
    && resolved.hash === "";
}

function isSafeCourseRoute(routeKey, value) {
  return isSafeCourseRelativeRoute(value)
    || SHARED_GAME_HOST_BY_ROUTE[routeKey] === value;
}

function isBcp47ish(value) {
  if (typeof value !== "string" || !LANGUAGE_TAG_PATTERN.test(value)) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function canonicalLanguageIdentity(language) {
  if (!isObject(language) || !isBcp47ish(language.locale)) return undefined;
  return Intl.getCanonicalLocales(language.locale)[0].toLowerCase();
}

function isEnglishLanguage(language) {
  return canonicalLanguageIdentity(language)?.split("-", 1)[0] === ENGLISH_AUDIT_LANGUAGE;
}

export function courseLanguagePairIdentity({ sourceLanguage, targetLanguage } = {}) {
  const source = canonicalLanguageIdentity(sourceLanguage);
  const target = canonicalLanguageIdentity(targetLanguage);
  return source && target ? `${source}->${target}` : undefined;
}

function addUnknownAndMissingKeys(issues, value, allowed, required, label, code) {
  if (!isObject(value)) {
    issues.push({ code, message: `${label} must be an object.` });
    return false;
  }
  for (const key of required) {
    if (!(key in value)) issues.push({ code, message: `${label} is missing required key ${key}.` });
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ code, message: `${label} contains unsupported key ${key}.` });
  }
  return true;
}

function addStringIssue(issues, value, label, code) {
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ code, message: `${label} must be a non-empty string.` });
    return false;
  }
  return true;
}

function validateKnownUniqueStringArray(value, allowedValues, label, code, issues) {
  if (!Array.isArray(value)) {
    issues.push({ code, message: `${label} must be an array.` });
    return;
  }
  const allowed = new Set(allowedValues);
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !allowed.has(item)) {
      issues.push({ code, message: `${label}[${index}] names unsupported value ${JSON.stringify(item)}.` });
      continue;
    }
    if (seen.has(item)) {
      issues.push({ code, message: `${label} contains duplicate value ${item}.` });
    }
    seen.add(item);
  }
}

function validateCatalogShape(catalog, issues) {
  const keys = ["$schema", "schemaVersion", "defaultCourseId", "reservedRoutePrefixes", "courses"];
  if (!addUnknownAndMissingKeys(issues, catalog, keys, keys, "catalog", "catalog.shape")) return;
  addStringIssue(issues, catalog.$schema, "catalog.$schema", "catalog.shape");
  if (catalog.schemaVersion !== COURSE_SCHEMA_VERSION) {
    issues.push({ code: "catalog.version", message: `catalog.schemaVersion must be ${COURSE_SCHEMA_VERSION}.` });
  }
  if (typeof catalog.defaultCourseId !== "string" || !COURSE_ID_PATTERN.test(catalog.defaultCourseId)) {
    issues.push({ code: "catalog.shape", message: "catalog.defaultCourseId must be a lowercase course ID." });
  }
  if (!Array.isArray(catalog.reservedRoutePrefixes)) {
    issues.push({ code: "catalog.shape", message: "catalog.reservedRoutePrefixes must be an array." });
  } else {
    for (const route of catalog.reservedRoutePrefixes) {
      if (typeof route !== "string" || !ROUTE_PREFIX_PATTERN.test(route)) {
        issues.push({ code: "catalog.shape", message: `Invalid reserved route prefix ${JSON.stringify(route)}.` });
      }
    }
  }
  if (!Array.isArray(catalog.courses) || catalog.courses.length === 0) {
    issues.push({ code: "catalog.shape", message: "catalog.courses must contain at least one course." });
    return;
  }
  for (const [index, entry] of catalog.courses.entries()) {
    const label = `catalog.courses[${index}]`;
    if (!addUnknownAndMissingKeys(issues, entry, ["id", "manifest"], ["id", "manifest"], label, "catalog.shape")) continue;
    if (typeof entry.id !== "string" || !COURSE_ID_PATTERN.test(entry.id)) {
      issues.push({ code: "catalog.shape", message: `${label}.id must be a lowercase course ID.` });
    }
    if (!isSafeRepositoryPath(entry.manifest) || !/^apps\/languages\/[a-z0-9]+(?:-[a-z0-9]+)*\/course\.json$/.test(entry.manifest)) {
      issues.push({ code: "catalog.path", message: `${label}.manifest must be a confined apps/languages/<pack>/course.json path.` });
    }
  }
}

function validateLanguageShape(language, kind, issues, courseId) {
  const sourceKeys = [
    "id",
    "label",
    "nativeLabel",
    "shortCode",
    "locale",
    "direction",
    "flagClass",
    "flagSrc"
  ];
  const targetKeys = [
    "id",
    "label",
    "nativeLabel",
    "shortCode",
    "locale",
    "script",
    "speechLocale",
    "direction",
    "flagClass",
    "flagSrc"
  ];
  const keys = kind === "source" ? sourceKeys : targetKeys;
  const label = `${courseId}.${kind}Language`;
  if (!addUnknownAndMissingKeys(issues, language, keys, keys, label, "manifest.shape")) return;
  if (typeof language.id !== "string" || !/^[a-z]{2,3}$/.test(language.id)) {
    issues.push({ code: "locale.invalid", message: `${label}.id must be a lowercase ISO-like language ID.` });
  }
  if (!isBcp47ish(language.locale)) {
    issues.push({ code: "locale.invalid", message: `${label}.locale is not a BCP47-like language tag: ${JSON.stringify(language.locale)}.` });
  }
  if (typeof language.locale === "string" && typeof language.id === "string" && language.locale.split("-")[0].toLowerCase() !== language.id) {
    issues.push({ code: "locale.mismatch", message: `${label}.locale must begin with language ID ${language.id}.` });
  }
  addStringIssue(issues, language.label, `${label}.label`, "manifest.shape");
  addStringIssue(issues, language.nativeLabel, `${label}.nativeLabel`, "manifest.shape");
  if (typeof language.shortCode !== "string" || !/^[A-Z0-9]{2,8}$/.test(language.shortCode)) {
    issues.push({ code: "manifest.shape", message: `${label}.shortCode must contain 2-8 uppercase letters or digits.` });
  }
  if (!['ltr', 'rtl'].includes(language.direction)) {
    issues.push({ code: "manifest.shape", message: `${label}.direction must be ltr or rtl.` });
  }
  addStringIssue(issues, language.flagClass, `${label}.flagClass`, "manifest.shape");
  if (typeof language.flagSrc !== "string" || !language.flagSrc.startsWith("/assets/")) {
    issues.push({ code: "manifest.shape", message: `${label}.flagSrc must be an /assets/ URL.` });
  }
  if (kind === "target") {
    if (typeof language.script !== "string" || !/^[A-Z][a-z]{3}$/.test(language.script)) {
      issues.push({ code: "locale.invalid", message: `${label}.script must be an ISO 15924-style script code.` });
    }
    if (!isBcp47ish(language.speechLocale)) {
      issues.push({ code: "locale.invalid", message: `${label}.speechLocale is not a BCP47-like language tag: ${JSON.stringify(language.speechLocale)}.` });
    }
    if (typeof language.speechLocale === "string" && typeof language.id === "string" && language.speechLocale.split("-")[0].toLowerCase() !== language.id) {
      issues.push({ code: "locale.mismatch", message: `${label}.speechLocale must begin with language ID ${language.id}.` });
    }
  }
}

function validateCourseShape(course, issues) {
  const courseId = typeof course?.id === "string" ? course.id : "<unknown-course>";
  if (!addUnknownAndMissingKeys(issues, course, COURSE_KEYS, REQUIRED_COURSE_KEYS, courseId, "manifest.shape")) return;
  if (course.schemaVersion !== COURSE_SCHEMA_VERSION) {
    issues.push({ code: "manifest.version", message: `${courseId}.schemaVersion must be ${COURSE_SCHEMA_VERSION}.` });
  }
  if (typeof course.id !== "string" || !COURSE_ID_PATTERN.test(course.id)) {
    issues.push({ code: "manifest.shape", message: `${courseId}.id must be a lowercase course ID.` });
  }
  if (typeof course.directoryName !== "string" || !COURSE_ID_PATTERN.test(course.directoryName)) {
    issues.push({ code: "manifest.shape", message: `${courseId}.directoryName must be a lowercase directory name.` });
  }
  if (!["development", "active", "retired"].includes(course.status)) {
    issues.push({ code: "manifest.shape", message: `${courseId}.status must be development, active, or retired.` });
  }
  addStringIssue(issues, course.brandLabel, `${courseId}.brandLabel`, "manifest.shape");
  addStringIssue(issues, course.workspaceLabel, `${courseId}.workspaceLabel`, "manifest.shape");
  if (typeof course.routePrefix !== "string" || !ROUTE_PREFIX_PATTERN.test(course.routePrefix)) {
    issues.push({ code: "route.invalid", message: `${courseId}.routePrefix must be one lowercase top-level route segment.` });
  }
  if (!isValidEntryPath(course.entryPath, course.routePrefix)) {
    issues.push({ code: "route.invalid", message: `${courseId}.entryPath must be a confined file path beneath ${course.routePrefix}/.` });
  }
  validateLanguageShape(course.sourceLanguage, "source", issues, courseId);
  validateLanguageShape(course.targetLanguage, "target", issues, courseId);

  if (addUnknownAndMissingKeys(issues, course.launcher, ["flagClass"], ["flagClass"], `${courseId}.launcher`, "manifest.shape")) {
    addStringIssue(issues, course.launcher.flagClass, `${courseId}.launcher.flagClass`, "manifest.shape");
  }
  if (!isObject(course.routes)) {
    issues.push({ code: "manifest.shape", message: `${courseId}.routes must be an object.` });
  } else {
    for (const key of ["languageSelection", "home", "games", "settings"]) {
      if (!addStringIssue(issues, course.routes[key], `${courseId}.routes.${key}`, "manifest.shape")) continue;
    }
    for (const [key, route] of Object.entries(course.routes)) {
      if (key === "languageSelection") {
        if (route !== "/") {
          issues.push({ code: "route.invalid", message: `${courseId}.routes.languageSelection must be /.` });
        }
        continue;
      }
      if (!isSafeCourseRoute(key, route)) {
        issues.push({
          code: "route.invalid",
          message: `${courseId}.routes.${key} must be a confined course-relative route or its registry-declared shared host.`
        });
      }
    }
  }
  if (!isObject(course.storage)) {
    issues.push({ code: "manifest.shape", message: `${courseId}.storage must be an object.` });
  } else {
    const namespace = course.storage.namespace;
    if (typeof namespace !== "string" || !/^caatuu-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace)) {
      issues.push({ code: "namespace.invalid", message: `${courseId}.storage.namespace must be a caatuu- prefixed namespace.` });
    }
    for (const key of ["theme", "fontSize", "learningPreferences", "learningPerformance"]) {
      addStringIssue(issues, course.storage[key], `${courseId}.storage.${key}`, "manifest.shape");
    }
    for (const [key, value] of Object.entries(course.storage)) {
      if (key === "namespace") continue;
      if (typeof value !== "string" || !value.startsWith(`${namespace}.`)) {
        issues.push({ code: "namespace.invalid", message: `${courseId}.storage.${key} must stay inside ${namespace}.` });
      }
    }
  }
  if (addUnknownAndMissingKeys(issues, course.cache, ["prefix", "setupFallback"], ["prefix", "setupFallback"], `${courseId}.cache`, "manifest.shape")) {
    for (const [key, value] of Object.entries(course.cache)) {
      if (typeof value !== "string" || !value.startsWith(course.storage?.namespace ?? "<missing>.")) {
        issues.push({ code: "namespace.invalid", message: `${courseId}.cache.${key} must begin with the course storage namespace.` });
      }
    }
  }
  if (addUnknownAndMissingKeys(
    issues,
    course.publication,
    ["contract", "concepts", "realizations", "learnerBaseRealizations", "runtimeProjection"],
    ["contract", "concepts", "realizations", "learnerBaseRealizations", "runtimeProjection"],
    `${courseId}.publication`,
    "manifest.shape"
  )) {
    const publication = course.publication;
    if (!["legacy-active-v1", "language-content-v1"].includes(publication.contract)) {
      issues.push({ code: "publication.contract", message: `${courseId}.publication.contract is unsupported.` });
    } else if (publication.contract === "legacy-active-v1") {
      if (courseId !== "cz" || course.directoryName !== "czech") {
        issues.push({ code: "publication.legacy", message: "legacy-active-v1 is confined to the existing Czech compatibility course." });
      }
      if (
        publication.concepts !== null
        || publication.realizations !== null
        || publication.learnerBaseRealizations !== null
        || publication.runtimeProjection !== null
      ) {
        issues.push({ code: "publication.contract", message: `${courseId} legacy publication evidence paths must be null.` });
      }
    } else {
      if (!isSafeRepositoryPath(publication.concepts)
          || !/^apps\/languages\/shared\/english-concepts\/[a-z0-9][a-z0-9.-]*\.json$/u.test(publication.concepts)) {
        issues.push({ code: "publication.path", message: `${courseId}.publication.concepts must be a confined shared English concept catalog.` });
      }
      const expectedRealizationRoot = `apps/languages/${course.directoryName}/content/`;
      if (!isSafeRepositoryPath(publication.realizations)
          || !publication.realizations.startsWith(expectedRealizationRoot)
          || !publication.realizations.endsWith(".json")) {
        issues.push({ code: "publication.path", message: `${courseId}.publication.realizations must be a confined course authoring catalog beneath ${expectedRealizationRoot}.` });
      }
      const sourceIsEnglish = isEnglishLanguage(course.sourceLanguage);
      if (sourceIsEnglish && publication.learnerBaseRealizations !== null) {
        issues.push({
          code: "publication.base-realizations",
          message: `${courseId} uses English as its learner base and must not duplicate English concepts in learnerBaseRealizations.`
        });
      }
      if (
        !sourceIsEnglish
        && (
          !isSafeRepositoryPath(publication.learnerBaseRealizations)
          || !publication.learnerBaseRealizations.startsWith(LEARNER_BASE_REALIZATION_ROOT)
          || !publication.learnerBaseRealizations.endsWith(".json")
        )
      ) {
        issues.push({
          code: "publication.base-realizations",
          message: `${courseId} requires a confined shared learner-base realization catalog beneath ${LEARNER_BASE_REALIZATION_ROOT}.`
        });
      }
      const hasWordWorld = Array.isArray(course.games) && course.games.includes("word-net");
      if (hasWordWorld) {
        validateWordWorldRuntimeProjectionShape(course, publication, issues);
      } else if (publication.runtimeProjection !== null) {
        issues.push({
          code: "publication.runtime-authority",
          message: `${courseId}.publication.runtimeProjection must be null without Word World.`
        });
      }
    }
  }
  if (addUnknownAndMissingKeys(issues, course.capabilities, CAPABILITY_KEYS, CAPABILITY_KEYS, `${courseId}.capabilities`, "manifest.shape")) {
    for (const key of CAPABILITY_KEYS) {
      if (typeof course.capabilities[key] !== "boolean") {
        issues.push({ code: "manifest.shape", message: `${courseId}.capabilities.${key} must be boolean.` });
      }
    }
  }
  if (isObject(course.skillCompass)) {
    const pack = course.skillCompass;
    const packKeys = ["schemaVersion", "id", "version", "modelId", "minimumConfidence", "copy", "axes"];
    if (addUnknownAndMissingKeys(issues, pack, packKeys, packKeys, `${courseId}.skillCompass`, "manifest.shape")) {
      if (pack.schemaVersion !== 1) issues.push({ code: "manifest.shape", message: `${courseId}.skillCompass.schemaVersion must be 1.` });
      for (const key of ["id", "version", "modelId"]) addStringIssue(issues, pack[key], `${courseId}.skillCompass.${key}`, "manifest.shape");
      if (typeof pack.minimumConfidence !== "number" || pack.minimumConfidence < 0 || pack.minimumConfidence > 1) {
        issues.push({ code: "manifest.shape", message: `${courseId}.skillCompass.minimumConfidence must be a number from 0 to 1.` });
      }
      if (addUnknownAndMissingKeys(issues, pack.copy, SKILL_COMPASS_COPY_KEYS, SKILL_COMPASS_COPY_KEYS, `${courseId}.skillCompass.copy`, "manifest.shape")) {
        for (const key of SKILL_COMPASS_COPY_KEYS) addStringIssue(issues, pack.copy[key], `${courseId}.skillCompass.copy.${key}`, "manifest.shape");
      }
      if (!Array.isArray(pack.axes) || pack.axes.length < 3) {
        issues.push({ code: "manifest.shape", message: `${courseId}.skillCompass.axes must contain at least three axes.` });
      } else {
        const axisIds = new Set();
        for (const [index, axis] of pack.axes.entries()) {
          const label = `${courseId}.skillCompass.axes[${index}]`;
          const allowedKeys = ["id", "label", "chartLabel", "chartLabelBelow", "emblem", "probe"];
          if (!addUnknownAndMissingKeys(issues, axis, allowedKeys, ["id", "label", "chartLabel", "emblem", "probe"], label, "manifest.shape")) continue;
          for (const key of ["id", "label", "chartLabel", "emblem"]) addStringIssue(issues, axis[key], `${label}.${key}`, "manifest.shape");
          if (axisIds.has(axis.id)) issues.push({ code: "manifest.shape", message: `${courseId}.skillCompass.axes contains duplicate id ${axis.id}.` });
          axisIds.add(axis.id);
          if (axis.chartLabelBelow !== undefined && typeof axis.chartLabelBelow !== "boolean") issues.push({ code: "manifest.shape", message: `${label}.chartLabelBelow must be boolean when present.` });
          if (addUnknownAndMissingKeys(issues, axis.probe, ["locale", "revision", "text"], ["locale", "revision", "text"], `${label}.probe`, "manifest.shape")) {
            for (const key of ["locale", "revision", "text"]) addStringIssue(issues, axis.probe[key], `${label}.probe.${key}`, "manifest.shape");
            if (!isBcp47ish(axis.probe.locale)) issues.push({ code: "locale.invalid", message: `${label}.probe.locale is not a BCP47-like language tag.` });
          }
        }
      }
    }
  } else if (course.skillCompass !== null) {
    issues.push({ code: "manifest.shape", message: `${courseId}.skillCompass must be an object or null.` });
  }
  if (course.linguisticFeatures !== undefined) {
    validateKnownUniqueStringArray(
      course.linguisticFeatures,
      LINGUISTIC_FEATURE_IDS,
      `${courseId}.linguisticFeatures`,
      "linguistic-feature.invalid",
      issues
    );
  }
  if (course.games !== undefined) {
    validateKnownUniqueStringArray(course.games, GAME_IDS, `${courseId}.games`, "game.invalid", issues);
  }
  if (course.upcomingGames !== undefined) {
    validateKnownUniqueStringArray(
      course.upcomingGames,
      UPCOMING_GAME_IDS,
      `${courseId}.upcomingGames`,
      "game.upcoming.invalid",
      issues
    );
  }
  if (addUnknownAndMissingKeys(issues, course.platforms, ["browser", "android"], ["browser", "android"], `${courseId}.platforms`, "manifest.shape")) {
    const browser = course.platforms.browser;
    if (addUnknownAndMissingKeys(issues, browser, ["enabled", "pagesEnabled", "entryPath", "backend"], ["enabled", "pagesEnabled", "entryPath", "backend"], `${courseId}.platforms.browser`, "manifest.shape")) {
      if (typeof browser.enabled !== "boolean") issues.push({ code: "manifest.shape", message: `${courseId}.platforms.browser.enabled must be boolean.` });
      if (typeof browser.pagesEnabled !== "boolean") issues.push({ code: "manifest.shape", message: `${courseId}.platforms.browser.pagesEnabled must be boolean.` });
      if (!["static", "dictionary-api-v1"].includes(browser.backend)) issues.push({ code: "manifest.shape", message: `${courseId}.platforms.browser.backend is unsupported.` });
      if (browser.entryPath !== course.entryPath) issues.push({ code: "platform.contradiction", message: `${courseId} browser entryPath must equal the course entryPath.` });
    }
    const android = course.platforms.android;
    if (addUnknownAndMissingKeys(issues, android, ["enabled", "channels"], ["enabled", "channels"], `${courseId}.platforms.android`, "manifest.shape")) {
      if (typeof android.enabled !== "boolean") issues.push({ code: "manifest.shape", message: `${courseId}.platforms.android.enabled must be boolean.` });
      if (!Array.isArray(android.channels)) {
        issues.push({ code: "manifest.shape", message: `${courseId}.platforms.android.channels must be an array.` });
      } else {
        if (!android.enabled && android.channels.length > 0) issues.push({ code: "platform.contradiction", message: `${courseId} disabled Android platform cannot publish channels.` });
        if (android.enabled && android.channels.length === 0) issues.push({ code: "platform.contradiction", message: `${courseId} enabled Android platform must publish at least one channel.` });
        for (const [index, channel] of android.channels.entries()) {
          const label = `${courseId}.platforms.android.channels[${index}]`;
          if (!addUnknownAndMissingKeys(
            issues,
            channel,
            ["kind", "manifest", "artifact", "minimumVersionCode"],
            ["kind", "manifest", "artifact", "minimumVersionCode"],
            label,
            "manifest.shape"
          )) continue;
          if (!["release", "preview", "debug"].includes(channel.kind)) issues.push({ code: "manifest.shape", message: `${label}.kind is unsupported.` });
          if (typeof channel.manifest !== "string" || !channel.manifest.startsWith("/android/")) issues.push({ code: "manifest.shape", message: `${label}.manifest must be an /android/ path.` });
          if (typeof channel.artifact !== "string" || !channel.artifact.startsWith("/android/")) issues.push({ code: "manifest.shape", message: `${label}.artifact must be an /android/ path.` });
          if (!Number.isSafeInteger(channel.minimumVersionCode) || channel.minimumVersionCode < 1) {
            issues.push({ code: "manifest.shape", message: `${label}.minimumVersionCode must be a positive safe integer.` });
          }
        }
      }
    }
  }
  if (!isObject(course.resources)) {
    issues.push({ code: "manifest.shape", message: `${courseId}.resources must be an object.` });
  } else {
    for (const [name, resource] of Object.entries(course.resources)) {
      const label = `${courseId}.resources.${name}`;
      const allowedResourceKeys = [
        "kind", "path", "scope", "state", "revision",
        ...(name === "dictionaryProvider" ? ["providerId", "gapReporting"] : [])
      ];
      if (!addUnknownAndMissingKeys(issues, resource, allowedResourceKeys, ["kind", "path", "scope", "state"], label, "manifest.shape")) continue;
      if (!["file", "directory"].includes(resource.kind)) issues.push({ code: "manifest.shape", message: `${label}.kind must be file or directory.` });
      if (!isSafeRepositoryPath(resource.path)) issues.push({ code: "path.invalid", message: `${label}.path is not a confined repository-relative path.` });
      if (!["course", "shared"].includes(resource.scope)) issues.push({ code: "manifest.shape", message: `${label}.scope must be course or shared.` });
      if (!["present", "planned"].includes(resource.state)) issues.push({ code: "manifest.shape", message: `${label}.state must be present or planned.` });
      if (resource.revision !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(String(resource.revision))) {
        issues.push({ code: "manifest.shape", message: `${label}.revision must be a lowercase cache revision when present.` });
      }
      if (name === "dictionaryProvider" && resource.providerId !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u.test(String(resource.providerId))) {
        issues.push({ code: "manifest.shape", message: `${label}.providerId must be a versioned lowercase provider ID when present.` });
      }
      if (name === "dictionaryProvider" && resource.gapReporting !== undefined) {
        const reporting = resource.gapReporting;
        if (addUnknownAndMissingKeys(
          issues,
          reporting,
          ["dictionaryKey", "dictionaryDirection"],
          ["dictionaryKey", "dictionaryDirection"],
          `${label}.gapReporting`,
          "manifest.shape"
        )) {
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(String(reporting.dictionaryKey || ""))) {
            issues.push({ code: "manifest.shape", message: `${label}.gapReporting.dictionaryKey must be a confined lowercase dictionary key.` });
          }
          if (!/^[a-z]{2,3}(?:-[a-z0-9]+)*-[a-z]{2,3}(?:-[a-z0-9]+)*$/u.test(String(reporting.dictionaryDirection || ""))) {
            issues.push({ code: "manifest.shape", message: `${label}.gapReporting.dictionaryDirection must be a lowercase source-to-meaning language direction.` });
          }
        }
      }
    }
    const browserProviderRoot = `apps/languages/${course.directoryName}/static/source/`;
    for (const name of BROWSER_PROVIDER_RESOURCE_KEYS) {
      const resource = course.resources[name];
      if (resource === undefined) continue;
      if (
        resource.kind !== "file"
        || resource.scope !== "course"
        || resource.state !== "present"
        || !String(resource.path || "").startsWith(browserProviderRoot)
        || !String(resource.path || "").endsWith(".js")
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(String(resource.revision || ""))
      ) {
        issues.push({
          code: "browser.provider",
          message: `${courseId}.resources.${name} must declare a present, revisioned course JavaScript provider beneath its static source root.`
        });
      }
    }
  }
}

function validateWordWorldRuntimeProjectionShape(course, publication, issues) {
  const courseId = course.id;
  const projection = publication.runtimeProjection;
  const label = `${courseId}.publication.runtimeProjection`;
  const keys = [
    "policyId",
    "conceptsRuntime",
    "targetRealizationsRuntime",
    "learnerBaseRuntime",
    "supplementalOutputs",
    "manifest"
  ];
  if (!addUnknownAndMissingKeys(issues, projection, keys, keys, label, "publication.runtime-authority")) {
    return;
  }
  if (typeof projection.policyId !== "string" || !PROJECTION_POLICY_ID_PATTERN.test(projection.policyId)) {
    issues.push({
      code: "publication.runtime-policy",
      message: `${label}.policyId must be a stable versioned projection policy ID.`
    });
  }
  const sharedConceptRoot = "apps/language-runtime/static/data/english-concepts/";
  if (!isSafeRepositoryPath(projection.conceptsRuntime)
      || !projection.conceptsRuntime.startsWith(sharedConceptRoot)
      || !projection.conceptsRuntime.endsWith(".json")) {
    issues.push({
      code: "publication.runtime-authority",
      message: `${label}.conceptsRuntime must remain beneath ${sharedConceptRoot}.`
    });
  }

  const courseStaticRoot = `apps/languages/${course.directoryName}/static/`;
  const requireCourseRuntimePath = (value, field) => {
    if (!isSafeRepositoryPath(value)
        || !value.startsWith(courseStaticRoot)
        || !value.endsWith(".json")) {
      issues.push({
        code: "publication.runtime-authority",
        message: `${label}.${field} must be a JSON file beneath ${courseStaticRoot}.`
      });
      return false;
    }
    return true;
  };
  requireCourseRuntimePath(projection.targetRealizationsRuntime, "targetRealizationsRuntime");
  requireCourseRuntimePath(projection.manifest, "manifest");
  if (projection.manifest !== course.resources?.wordWorldManifest?.path) {
    issues.push({
      code: "publication.runtime-authority",
      message: `${label}.manifest must equal resources.wordWorldManifest.path.`
    });
  }

  if (publication.learnerBaseRealizations === null) {
    if (projection.learnerBaseRuntime !== null) {
      issues.push({
        code: "publication.runtime-authority",
        message: `${label}.learnerBaseRuntime must be null for an English learner base.`
      });
    }
  } else {
    requireCourseRuntimePath(projection.learnerBaseRuntime, "learnerBaseRuntime");
  }

  if (!isObject(projection.supplementalOutputs)) {
    issues.push({
      code: "publication.runtime-authority",
      message: `${label}.supplementalOutputs must be an object.`
    });
  } else {
    for (const [projectionKey, outputPath] of Object.entries(projection.supplementalOutputs)) {
      if (!/^[a-z][A-Za-z0-9]*Projection$/u.test(projectionKey)) {
        issues.push({
          code: "publication.runtime-authority",
          message: `${label}.supplementalOutputs key ${projectionKey} is invalid.`
        });
      }
      requireCourseRuntimePath(outputPath, `supplementalOutputs.${projectionKey}`);
    }
  }

  const outputPaths = wordWorldRuntimeProjectionPaths(publication);
  if (new Set(outputPaths).size !== outputPaths.length) {
    issues.push({
      code: "publication.runtime-authority",
      message: `${label} output paths must be unique.`
    });
  }
}

function wordWorldRuntimeProjectionPaths(publication) {
  const projection = publication?.runtimeProjection;
  if (!isObject(projection)) return [];
  return [
    projection.conceptsRuntime,
    projection.targetRealizationsRuntime,
    projection.learnerBaseRuntime,
    projection.manifest,
    ...Object.values(isObject(projection.supplementalOutputs) ? projection.supplementalOutputs : {})
  ].filter((value) => typeof value === "string" && value.length > 0);
}

function addDuplicateIssues(issues, records, key, code, label) {
  const firstByValue = new Map();
  for (const record of records) {
    const value = key(record.course);
    if (typeof value !== "string") continue;
    const first = firstByValue.get(value);
    if (first) {
      issues.push({ code, message: `${label} ${value} is shared by ${first.course.id} and ${record.course.id}.` });
    } else {
      firstByValue.set(value, record);
    }
  }
}

export function sourceLanguagePresentationIssues(courses) {
  const issues = [];
  const firstByLanguageLocale = new Map();
  for (const { course } of courses) {
    const language = course?.sourceLanguage;
    const languageLocale = canonicalLanguageIdentity(language);
    if (!languageLocale) continue;
    const presentation = Object.fromEntries(
      LANGUAGE_PRESENTATION_KEYS.map((key) => [key, language[key]])
    );
    const first = firstByLanguageLocale.get(languageLocale);
    if (!first) {
      firstByLanguageLocale.set(languageLocale, { courseId: course.id, presentation });
      continue;
    }
    if (!isDeepStrictEqual(first.presentation, presentation)) {
      issues.push({
        code: "language.presentation",
        message: `Source language ${languageLocale} must use identical presentation metadata in ${first.courseId} and ${course.id}.`
      });
    }
  }
  return issues;
}

function validateCapabilityResources(course, issues) {
  const capabilities = course.capabilities ?? {};
  const resources = course.resources ?? {};
  const requireResource = (name, reason) => {
    if (!resources[name]) issues.push({ code: "resource.required", message: `${course.id} requires resources.${name} because ${reason}.` });
  };
  for (const name of BASE_RESOURCE_KEYS) requireResource(name, "it is part of every course-pack delivery contract");
  if (capabilities.generation && !capabilities.llm) issues.push({ code: "capability.contradiction", message: `${course.id} generation requires llm.` });
  if (capabilities.chat && (!capabilities.llm || !capabilities.generation)) issues.push({ code: "capability.contradiction", message: `${course.id} chat requires llm and generation.` });
  if (capabilities.offlineModels && !capabilities.llm) issues.push({ code: "capability.contradiction", message: `${course.id} offlineModels requires llm.` });
  if (capabilities.semanticSearch && !capabilities.embeddings) issues.push({ code: "capability.contradiction", message: `${course.id} semanticSearch requires embeddings.` });
  if (capabilities.skillCompass && (!capabilities.semanticSearch || !capabilities.embeddings)) issues.push({ code: "capability.contradiction", message: `${course.id} skillCompass requires semanticSearch and embeddings.` });
  if (capabilities.skillCompass && !isObject(course.skillCompass)) issues.push({ code: "capability.contradiction", message: `${course.id} skillCompass capability requires an authored skillCompass pack.` });
  if (!capabilities.skillCompass && course.skillCompass !== null) issues.push({ code: "capability.contradiction", message: `${course.id} declares a skillCompass pack while the capability is disabled.` });
  if (capabilities.embeddings) requireResource("embeddingCatalog", "embeddings are enabled");
  if (capabilities.dictionary) {
    for (const name of DICTIONARY_RESOURCE_KEYS) {
      const resource = resources[name];
      if (!isObject(resource)) {
        issues.push({
          code: "resource.required",
          message: `${course.id} requires resources.${name} because dictionary is enabled.`
        });
        continue;
      }
      if (resource.kind !== "file") {
        issues.push({
          code: "capability.resource",
          message: `${course.id} dictionary requires resources.${name}.kind to be file.`
        });
      }
      if (resource.scope !== "course") {
        issues.push({
          code: "path.scope",
          message: `${course.id} dictionary requires resources.${name} to use course scope.`
        });
      }
      if (resource.state !== "present") {
        issues.push({
          code: "capability.resource",
          message: `${course.id} dictionary requires resources.${name}.state to be present.`
        });
      }
    }
    if (!/\.html$/u.test(String(resources.dictionaryReferenceDocument?.path || ""))) {
      issues.push({
        code: "capability.resource",
        message: `${course.id} dictionary requires resources.dictionaryReferenceDocument.path to name an HTML fragment.`
      });
    }
    if (!/\.js$/u.test(String(resources.dictionaryProvider?.path || ""))) {
      issues.push({
        code: "capability.resource",
        message: `${course.id} dictionary requires resources.dictionaryProvider.path to name a script provider.`
      });
    }
    if (!resources.dictionaryProvider?.revision) {
      issues.push({
        code: "capability.resource",
        message: `${course.id} dictionary requires resources.dictionaryProvider.revision for cache-safe loading.`
      });
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u.test(String(resources.dictionaryProvider?.providerId || ""))) {
      issues.push({
        code: "capability.resource",
        message: `${course.id} dictionary requires resources.dictionaryProvider.providerId to declare the exact versioned provider contract.`
      });
    }
  }
  if (capabilities.llm || capabilities.generation || capabilities.offlineModels) requireResource("modelCatalog", "LLM/model capabilities are enabled");
  if (capabilities.wordWorld) requireResource("wordWorldManifest", "wordWorld is enabled");
  if (course.platforms?.android?.enabled) {
    requireResource("androidAssetCatalog", "Android is enabled");
    if (resources.androidAssetCatalog?.state !== "present") {
      issues.push({ code: "platform.contradiction", message: `${course.id} enabled Android platform requires a present androidAssetCatalog.` });
    }
  }

  if (!capabilities.embeddings && resources.embeddingCatalog) issues.push({ code: "capability.contradiction", message: `${course.id} declares an embedding catalog while embeddings are disabled.` });
  if (!capabilities.dictionary) {
    for (const name of DICTIONARY_RESOURCE_KEYS) {
      if (resources[name]) {
        issues.push({
          code: "capability.contradiction",
          message: `${course.id} declares resources.${name} while dictionary is disabled.`
        });
      }
    }
  }
  if (!capabilities.llm && resources.modelCatalog) issues.push({ code: "capability.contradiction", message: `${course.id} declares a model catalog while llm is disabled.` });
  if (!capabilities.wordWorld && resources.wordWorldManifest) issues.push({ code: "capability.contradiction", message: `${course.id} declares a Word World manifest while wordWorld is disabled.` });

  const declaredGames = new Set(Array.isArray(course.games) ? course.games : []);
  const upcomingGames = new Set(Array.isArray(course.upcomingGames) ? course.upcomingGames : []);
  for (const gameId of upcomingGames) {
    if (declaredGames.has(gameId)) {
      issues.push({
        code: "game.lifecycle",
        message: `${course.id}.${gameId} cannot be both playable and upcoming.`
      });
    }
  }
  const declaredFeatures = new Set(Array.isArray(course.linguisticFeatures) ? course.linguisticFeatures : []);
  if (declaredFeatures.has("hanzi-pinyin") && course.targetLanguage?.id !== "zh") {
    issues.push({
      code: "linguistic-feature.language",
      message: `${course.id}.linguisticFeatures declares hanzi-pinyin but targetLanguage.id is not zh.`
    });
  }
  for (const gameId of declaredGames) {
    if (gameId === "campaign" || !GAME_REQUIREMENTS[gameId]) continue;
    const requirement = GAME_REQUIREMENTS[gameId];
    if (requirement.implementationState === "unimplemented") {
      issues.push({
        code: "game.implementation",
        message: `${course.id}.games cannot enable ${gameId} while its shared implementation is marked unimplemented; keep it in upcomingGames until the registry gate is deliberately promoted.`
      });
      continue;
    }
    for (const capability of requirement.capabilities) {
      if (capabilities[capability] !== true) {
        issues.push({
          code: "game.capability",
          message: `${course.id}.games enables ${gameId} but capability ${capability} is disabled.`
        });
      }
    }
    for (const feature of requirement.linguisticFeatures) {
      if (!declaredFeatures.has(feature)) {
        issues.push({
          code: "game.linguistic-feature",
          message: `${course.id}.games enables ${gameId} but linguisticFeatures does not declare ${feature}.`
        });
      }
    }
    for (const resourceRequirement of requirement.resources ?? []) {
      const resource = resources[resourceRequirement.name];
      if (!isObject(resource)) {
        issues.push({
          code: "resource.required",
          message: `${course.id}.games enables ${gameId} but resources.${resourceRequirement.name} is missing.`
        });
        continue;
      }
      if (resource.kind !== resourceRequirement.kind) {
        issues.push({
          code: "game.resource",
          message: `${course.id}.games enables ${gameId} but resources.${resourceRequirement.name}.kind must be ${resourceRequirement.kind}.`
        });
      }
      if (resource.scope !== resourceRequirement.scope) {
        issues.push({
          code: "path.scope",
          message: `${course.id}.games enables ${gameId} but resources.${resourceRequirement.name} must use ${resourceRequirement.scope} scope.`
        });
      }
      if (resource.state !== resourceRequirement.state) {
        issues.push({
          code: "game.resource",
          message: `${course.id}.games enables ${gameId} but resources.${resourceRequirement.name}.state must be ${resourceRequirement.state}.`
        });
      }
      if (requirement.sharedHost && (
        typeof resource.revision !== "string" || !resource.revision.trim()
      )) {
        issues.push({
          code: "game.resource",
          message: `${course.id}.games enables ${gameId} through the shared host, so resources.${resourceRequirement.name}.revision is required for cache-safe delivery.`
        });
      }
      const expectedPath = `apps/languages/${course.directoryName}/${resourceRequirement.coursePath}`;
      if (resource.path !== expectedPath) {
        issues.push({
          code: "game.resource",
          message: `${course.id}.games enables ${gameId} but resources.${resourceRequirement.name}.path must be ${expectedPath}.`
        });
      }
    }
    const gameRoute = course.routes?.[requirement.route];
    if (typeof gameRoute !== "string" || !gameRoute.trim()) {
      issues.push({
        code: "game.route",
        message: `${course.id}.games enables ${gameId} but routes.${requirement.route} is missing.`
      });
    } else if (requirement.sharedHost && gameRoute !== requirement.sharedHost) {
      issues.push({
        code: "game.route",
        message: `${course.id}.games enables ${gameId} through the shared host, so routes.${requirement.route} must be ${requirement.sharedHost}.`
      });
    }
  }
  for (const [gameId, requirement] of Object.entries(GAME_REQUIREMENTS)) {
    if (declaredGames.has(gameId) || upcomingGames.has(gameId)) continue;
    for (const resourceRequirement of requirement.resources ?? []) {
      if (resources[resourceRequirement.name]) {
        issues.push({
          code: "game.resource",
          message: `${course.id} declares resources.${resourceRequirement.name} but ${gameId} is neither enabled nor upcoming.`
        });
      }
    }
  }
  const campaign = PLANET_GAME_CONTRACT.campaign;
  if (declaredGames.has(campaign.id)) {
    const eligibleGames = [...declaredGames].filter(
      (gameId) => GAME_REQUIREMENTS[gameId]?.campaignEligible === true
    );
    if (eligibleGames.length < campaign.minimumEligibleGames) {
      const gameLabel = campaign.minimumEligibleGames === 1 ? "game" : "games";
      issues.push({
        code: "game.campaign",
        message: `${course.id}.games ${campaign.id} requires at least ${campaign.minimumEligibleGames} campaign-eligible enabled ${gameLabel}.`
      });
    }
    if (typeof course.routes?.[campaign.route] !== "string" || !course.routes[campaign.route].trim()) {
      issues.push({ code: "game.route", message: `${course.id}.games enables ${campaign.id} but routes.${campaign.route} is missing.` });
    }
  }

  issues.push(...browserBackendContractIssues(course));
}

export function wordWorldGenerationReadinessIssues(course, manifest = {}) {
  if (!course?.games?.includes?.("word-net")) return [];
  try {
    resolveWordWorldGenerationStrategy(course, manifest);
    return [];
  } catch (error) {
    return [{
      code: "word-world.generation-strategy",
      message: `${course.id} ${error.message ?? String(error)}`
    }];
  }
}

export function browserBackendContractIssues(course) {
  const issues = [];
  const capabilities = course?.capabilities ?? {};
  const backend = course?.platforms?.browser?.backend;
  if (backend === "dictionary-api-v1" && !capabilities.dictionary) {
    issues.push({ code: "backend.contradiction", message: `${course.id} dictionary-api-v1 backend requires dictionary capability.` });
  }
  if (course?.platforms?.browser?.enabled === true && capabilities.dictionary && backend !== "dictionary-api-v1") {
    issues.push({ code: "backend.contradiction", message: `${course.id} browser dictionary capability requires the dictionary-api-v1 backend.` });
  }
  return issues;
}

function validateLearnerSourceReadiness(course, issues, { launcher = false } = {}) {
  issues.push(...learnerSourceReadinessIssues(course, { launcher }));
}

function coursePathValue(course, dottedPath) {
  return dottedPath.split(".").reduce(
    (value, segment) => value && typeof value === "object" ? value[segment] : undefined,
    course
  );
}

function learnerBasePresentationReady(course, contractId, playableGames, seen = new Set()) {
  const contract = LEARNER_BASE_PRESENTATION_CONTRACT.implementations[contractId];
  if (!contract || seen.has(contractId)) return false;
  if (contract.kind === "publication-contract") {
    return course.publication?.contract === contract.publicationContract;
  }
  if (contract.kind === "course-paths") {
    return course.publication?.contract === contract.publicationContract
      && contract.requiredCoursePaths.every((path) => {
        const value = coursePathValue(course, path);
        return typeof value === "string" && Boolean(value.trim());
      });
  }
  if (contract.kind === "all-contained-planets") {
    const containedGames = playableGames.filter((gameId) => gameId !== PLANET_GAME_CONTRACT.campaign.id);
    const nextSeen = new Set(seen).add(contractId);
    return containedGames.length >= PLANET_GAME_CONTRACT.campaign.minimumEligibleGames
      && containedGames.every((gameId) => learnerBasePresentationReady(
        course,
        GAME_REQUIREMENTS[gameId]?.learnerBasePresentationContract,
        playableGames,
        nextSeen
      ));
  }
  return false;
}

export function learnerSourceReadinessIssues(course, { launcher = false } = {}) {
  const issues = [];
  const hasDelivery = launcher
    || course.platforms?.browser?.enabled === true
    || course.platforms?.android?.enabled === true;
  if (!hasDelivery || isEnglishLanguage(course.sourceLanguage)) return issues;

  const publication = course.publication;
  const projection = publication?.runtimeProjection;
  if (
    publication?.contract !== "language-content-v1"
    || typeof publication?.learnerBaseRealizations !== "string"
    || !publication.learnerBaseRealizations
    || typeof projection?.learnerBaseRuntime !== "string"
    || !projection.learnerBaseRuntime
  ) {
    issues.push({
      code: "source-language.readiness",
      message: launcher
        ? `Active course ${course.id} cannot enter the launcher with non-English learner base ${course.sourceLanguage?.locale || course.sourceLanguage?.id} until it has reviewed learnerBaseRealizations plus an exact runtimeProjection.learnerBaseRuntime; English remains the audit and retrieval authority.`
        : `Course ${course.id} uses non-English learner base ${course.sourceLanguage?.locale || course.sourceLanguage?.id} and requires reviewed learnerBaseRealizations plus an exact runtimeProjection.learnerBaseRuntime; English remains the audit and retrieval authority.`
    });
  }

  const playableGames = Array.isArray(course.games) ? course.games : [];
  const unsupportedGames = playableGames.filter((gameId) => {
    const game = gameId === PLANET_GAME_CONTRACT.campaign.id
      ? PLANET_GAME_CONTRACT.campaign
      : GAME_REQUIREMENTS[gameId];
    return !learnerBasePresentationReady(
      course,
      game?.learnerBasePresentationContract,
      playableGames
    );
  });
  const unsupportedCapabilities = Object.entries(LEARNER_BASE_PRESENTATION_CONTRACT.capabilities)
    .filter(([capability, contractId]) => (
      course.capabilities?.[capability] === true
      && !learnerBasePresentationReady(course, contractId, playableGames)
    ))
    .map(([capability]) => capability);
  if (unsupportedGames.length > 0 || unsupportedCapabilities.length > 0) {
    const unsupported = [
      ...unsupportedGames,
      ...unsupportedCapabilities
    ];
    issues.push({
      code: "source-language.presentation",
      message: `${course.id} non-English learner-base presentation is not yet declared for: ${[...new Set(unsupported)].join(", ")}. Only Word World (and a campaign containing no other playable planet) currently consumes the reviewed learner-base role.`
    });
  }
  return issues;
}

function validateBrowserDelivery(record, issues) {
  const { course } = record;
  const browser = course.platforms?.browser;
  if (!isObject(browser) || typeof browser.enabled !== "boolean") return;
  if (browser.pagesEnabled === true && !browser.enabled) {
    issues.push({
      code: "platform.contradiction",
      message: `Course ${course.id} cannot enable Pages while its browser platform is disabled.`
    });
  }
  if (course.status === "active" && !browser.enabled) {
    issues.push({
      code: "platform.contradiction",
      message: `Active course ${course.id} must enable its browser platform because active courses are launcher-visible.`
    });
  }
  if (course.status === "retired" && browser.enabled) {
    issues.push({
      code: "platform.contradiction",
      message: `Retired course ${course.id} cannot enable its browser platform.`
    });
  }
  if (!browser.enabled) return;

  for (const field of ["linguisticFeatures", "games"]) {
    if (!Array.isArray(course[field])) {
      issues.push({
        code: "platform.contradiction",
        message: `Browser-enabled course ${course.id} requires ${field}.`
      });
    }
  }

  const resources = isObject(course.resources) ? course.resources : {};
  const requirePresentResource = (name, expectedKind, expectedScope) => {
    const resource = resources[name];
    if (!isObject(resource)) {
      issues.push({
        code: "resource.required",
        message: `Browser-enabled course ${course.id} requires resources.${name}.`
      });
      return null;
    }
    if (resource.state !== "present") {
      issues.push({
        code: "platform.contradiction",
        message: `Browser-enabled course ${course.id} requires a present resources.${name}.`
      });
    }
    if (resource.kind !== expectedKind) {
      issues.push({
        code: "platform.contradiction",
        message: `Browser-enabled course ${course.id} requires resources.${name}.kind to be ${expectedKind}.`
      });
    }
    if (resource.scope !== expectedScope) {
      issues.push({
        code: "path.scope",
        message: `Browser-enabled course ${course.id} requires resources.${name} to use ${expectedScope} scope.`
      });
    }
    return resource;
  };

  const staticRoot = requirePresentResource("staticRoot", "directory", "course");
  const appEntry = requirePresentResource("appEntry", "file", "shared");
  if (typeof course.directoryName !== "string" || !COURSE_ID_PATTERN.test(course.directoryName)) return;

  const expectedStaticPath = `apps/languages/${course.directoryName}/static`;
  if (staticRoot && staticRoot.path !== expectedStaticPath) {
    issues.push({
      code: "path.scope",
      message: `${course.id}.resources.staticRoot must be the course-scoped path ${expectedStaticPath}.`
    });
  }
  if (appEntry && appEntry.path !== CANONICAL_BROWSER_APP_ENTRY_PATH) {
    issues.push({
      code: "resource.app-entry",
      message: `${course.id}.resources.appEntry must be the canonical shared application ${CANONICAL_BROWSER_APP_ENTRY_PATH}.`
    });
  }
}

function validateSharedBrowserAppEntry(courses, issues) {
  const browserCourses = courses.filter(({ course }) => course.platforms?.browser?.enabled === true);
  if (browserCourses.length < 2) return;
  const first = browserCourses[0].course;
  const expected = first.resources?.appEntry?.path;
  for (const { course } of browserCourses.slice(1)) {
    const actual = course.resources?.appEntry?.path;
    if (typeof expected === "string" && typeof actual === "string" && actual !== expected) {
      issues.push({
        code: "resource.app-entry",
        message: `Browser courses ${first.id} and ${course.id} must share one appEntry; found ${expected} and ${actual}.`
      });
    }
  }
}

async function validateResourcePaths(
  record,
  repoRoot,
  issues,
  checkExistence,
  { allowMissingGeneratedViews = false } = {}
) {
  const { course, manifestPath } = record;
  if (!isObject(course.resources)) return;
  const courseRoot = path.resolve(repoRoot, path.dirname(manifestPath));
  const staticRootResource = course.resources.staticRoot;
  const staticRoot = staticRootResource && isSafeRepositoryPath(staticRootResource.path)
    ? path.resolve(repoRoot, staticRootResource.path)
    : null;
  const expectedStaticRoot = path.resolve(courseRoot, "static");
  if (staticRoot && staticRoot !== expectedStaticRoot) {
    issues.push({ code: "path.scope", message: `${course.id}.resources.staticRoot must be ${toPosixPath(path.relative(repoRoot, expectedStaticRoot))}.` });
  }

  let realRepoRoot = null;
  let realCourseRoot = null;
  let realStaticRoot = null;
  if (checkExistence) {
    try {
      realRepoRoot = await realpath(repoRoot);
      realCourseRoot = await realpath(courseRoot);
      const expectedRealCourseRoot = expectedPhysicalPath(repoRoot, realRepoRoot, courseRoot);
      if (!isInside(realRepoRoot, realCourseRoot) || !samePath(realCourseRoot, expectedRealCourseRoot)) {
        issues.push({ code: "path.scope", message: `${course.id} course root resolves outside the repository.` });
      }
      if (staticRoot) {
        realStaticRoot = await realpath(staticRoot);
        const expectedRealStaticRoot = expectedPhysicalPath(repoRoot, realRepoRoot, staticRoot);
        if (!isInside(realRepoRoot, realStaticRoot)
            || !isInside(realCourseRoot, realStaticRoot)
            || !samePath(realStaticRoot, expectedRealStaticRoot)) {
          issues.push({ code: "path.scope", message: `${course.id}.resources.staticRoot resolves outside its course root.` });
        }
      }
    } catch (error) {
      issues.push({
        code: "path.missing",
        message: `${course.id} course/static authority roots cannot be resolved: ${error.code ?? error.message}.`
      });
    }
  }

  for (const [name, resource] of Object.entries(course.resources)) {
    if (!isObject(resource) || !isSafeRepositoryPath(resource.path)) continue;
    const absolutePath = path.resolve(repoRoot, resource.path);
    if (!isInside(repoRoot, absolutePath)) {
      issues.push({ code: "path.scope", message: `${course.id}.resources.${name} escapes the repository root.` });
      continue;
    }
    if (resource.scope === "course" && !isInside(courseRoot, absolutePath)) {
      issues.push({ code: "path.scope", message: `${course.id}.resources.${name} must stay inside ${toPosixPath(path.relative(repoRoot, courseRoot))}.` });
    }
    if (resource.scope === "shared") {
      const allowed = SHARED_RESOURCE_ROOTS.some((root) => isInside(path.resolve(repoRoot, root), absolutePath));
      if (!allowed) issues.push({ code: "path.scope", message: `${course.id}.resources.${name} is outside an approved shared resource root.` });
    }
    if (!["staticRoot", "androidAssetCatalog"].includes(name) && resource.scope === "course" && staticRoot && !isInside(staticRoot, absolutePath)) {
      issues.push({ code: "path.scope", message: `${course.id}.resources.${name} must stay inside its staticRoot.` });
    }
    if (course.status === "active" && resource.state !== "present") {
      issues.push({ code: "status.planned-resource", message: `Active course ${course.id} cannot declare planned resource ${name}.` });
    }
    if (!checkExistence || resource.state !== "present") continue;
    try {
      const info = await stat(absolutePath);
      if ((resource.kind === "file" && !info.isFile()) || (resource.kind === "directory" && !info.isDirectory())) {
        issues.push({ code: "path.kind", message: `${course.id}.resources.${name} is not a ${resource.kind}: ${resource.path}.` });
      }
      const realResource = await realpath(absolutePath);
      const expectedRealResource = realRepoRoot
        ? expectedPhysicalPath(repoRoot, realRepoRoot, absolutePath)
        : null;
      if (!realRepoRoot
          || !isInside(realRepoRoot, realResource)
          || !expectedRealResource
          || !samePath(realResource, expectedRealResource)) {
        issues.push({ code: "path.scope", message: `${course.id}.resources.${name} resolves outside the repository root.` });
      }
      if (resource.scope === "course") {
        if (!realCourseRoot || !isInside(realCourseRoot, realResource)) issues.push({ code: "path.scope", message: `${course.id}.resources.${name} resolves outside its course root.` });
        if (!["staticRoot", "androidAssetCatalog"].includes(name)
            && (!realStaticRoot || !isInside(realStaticRoot, realResource))) {
          issues.push({ code: "path.scope", message: `${course.id}.resources.${name} resolves outside its staticRoot.` });
        }
      } else if (resource.scope === "shared") {
        let insideRealSharedRoot = false;
        for (const sharedRoot of SHARED_RESOURCE_ROOTS) {
          try {
            const realSharedRoot = await realpath(path.resolve(repoRoot, sharedRoot));
            if (realRepoRoot && isInside(realRepoRoot, realSharedRoot) && isInside(realSharedRoot, realResource)) {
              insideRealSharedRoot = true;
            }
          } catch {
            // A configured shared root may not exist in this repository revision.
          }
        }
        if (!insideRealSharedRoot) issues.push({ code: "path.scope", message: `${course.id}.resources.${name} resolves outside approved shared roots.` });
      }
    } catch (error) {
      if (allowMissingGeneratedViews && isAllowedMissingGeneratedViewResource({
        course,
        resourceName: name,
        errorCode: error?.code
      })) continue;
      issues.push({ code: "path.missing", message: `${course.id}.resources.${name} is marked present but cannot be read at ${resource.path}: ${error.code ?? error.message}.` });
    }
  }

  const validateFlagResourceUrl = (resourceName, languageName) => {
    const resource = course.resources[resourceName];
    if (!resource || !isSafeRepositoryPath(resource.path)) return;
    const launcherRoot = path.resolve(repoRoot, "apps/launcher/static");
    const flagPath = path.resolve(repoRoot, resource.path);
    if (isInside(launcherRoot, flagPath)) {
      const expectedFlagSrc = `/${toPosixPath(path.relative(launcherRoot, flagPath))}`;
      if (course[languageName]?.flagSrc !== expectedFlagSrc) {
        issues.push({
          code: "resource.url-mismatch",
          message: `${course.id}.${languageName}.flagSrc must be ${expectedFlagSrc} for ${resourceName}.`
        });
      }
    }
  };
  validateFlagResourceUrl("sourceLanguageFlag", "sourceLanguage");
  validateFlagResourceUrl("launcherFlag", "targetLanguage");
}

export function isAllowedMissingGeneratedViewResource({ course, resourceName, errorCode }) {
  return errorCode === "ENOENT"
    && resourceName === "courseProfile"
    && course?.platforms?.browser?.enabled === true;
}

async function resolveConfinedCourseFile(record, repoRoot, resourceName) {
  const { course, manifestPath } = record;
  const resource = course.resources?.[resourceName];
  const staticRootResource = course.resources?.staticRoot;
  if (
    !isObject(resource)
    || resource.kind !== "file"
    || resource.state !== "present"
    || resource.scope !== "course"
    || !isSafeRepositoryPath(resource.path)
    || !isObject(staticRootResource)
    || !isSafeRepositoryPath(staticRootResource.path)
  ) return null;
  try {
    const lexicalCourseRoot = path.resolve(repoRoot, path.dirname(manifestPath));
    const lexicalStaticRoot = path.resolve(repoRoot, staticRootResource.path);
    const lexicalFile = path.resolve(repoRoot, resource.path);
    const [realRepoRoot, realCourseRoot, realStaticRoot, realFile] = await Promise.all([
      realpath(repoRoot),
      realpath(lexicalCourseRoot),
      realpath(lexicalStaticRoot),
      realpath(lexicalFile)
    ]);
    const info = await stat(realFile);
    const expectedRealCourseRoot = expectedPhysicalPath(repoRoot, realRepoRoot, lexicalCourseRoot);
    const expectedRealStaticRoot = expectedPhysicalPath(repoRoot, realRepoRoot, lexicalStaticRoot);
    const expectedRealFile = expectedPhysicalPath(repoRoot, realRepoRoot, lexicalFile);
    if (
      !info.isFile()
      || !isInside(realRepoRoot, realCourseRoot)
      || !isInside(realCourseRoot, realStaticRoot)
      || !isInside(realStaticRoot, realFile)
      || !samePath(realCourseRoot, expectedRealCourseRoot)
      || !samePath(realStaticRoot, expectedRealStaticRoot)
      || !samePath(realFile, expectedRealFile)
    ) return null;
    return { file: realFile, staticRoot: realStaticRoot };
  } catch {
    return null;
  }
}

async function resolveConfinedCourseRootFile(record, repoRoot, resourceName) {
  const { course, manifestPath } = record;
  const resource = course.resources?.[resourceName];
  if (
    !isObject(resource)
    || resource.kind !== "file"
    || resource.state !== "present"
    || resource.scope !== "course"
    || !isSafeRepositoryPath(resource.path)
  ) return null;
  try {
    const lexicalCourseRoot = path.resolve(repoRoot, path.dirname(manifestPath));
    const lexicalFile = path.resolve(repoRoot, resource.path);
    const [realRepoRoot, realCourseRoot, realFile] = await Promise.all([
      realpath(repoRoot),
      realpath(lexicalCourseRoot),
      realpath(lexicalFile)
    ]);
    const info = await stat(realFile);
    const expectedRealCourseRoot = expectedPhysicalPath(repoRoot, realRepoRoot, lexicalCourseRoot);
    const expectedRealFile = expectedPhysicalPath(repoRoot, realRepoRoot, lexicalFile);
    if (
      !info.isFile()
      || !isInside(realRepoRoot, realCourseRoot)
      || !isInside(realCourseRoot, realFile)
      || !samePath(realCourseRoot, expectedRealCourseRoot)
      || !samePath(realFile, expectedRealFile)
    ) return null;
    return realFile;
  } catch {
    return null;
  }
}

async function resolvePinnedRepositoryFile(repoRoot, repositoryPath) {
  if (!isSafeRepositoryPath(repositoryPath)) return null;
  try {
    const lexicalFile = path.resolve(repoRoot, repositoryPath);
    const [realRepoRoot, realFile] = await Promise.all([
      realpath(repoRoot),
      realpath(lexicalFile)
    ]);
    const info = await stat(realFile);
    const expectedRealFile = expectedPhysicalPath(repoRoot, realRepoRoot, lexicalFile);
    if (
      !info.isFile()
      || !isInside(realRepoRoot, realFile)
      || !samePath(realFile, expectedRealFile)
    ) return null;
    return realFile;
  } catch {
    return null;
  }
}

function setupAssetPathForRuntime(course, runtimePath) {
  const courseStaticRoot = `apps/languages/${course.directoryName}/static/`;
  if (runtimePath.startsWith(courseStaticRoot)) return runtimePath.slice(courseStaticRoot.length);
  if (runtimePath.startsWith("apps/language-runtime/")) {
    return `/${runtimePath.slice("apps/".length)}`;
  }
  return null;
}

async function validateWordWorldProjectionDeliveryClosure(record, repoRoot, issues, checkExistence) {
  const { course } = record;
  const hasDelivery = course.platforms?.browser?.enabled === true
    || course.platforms?.android?.enabled === true;
  if (!checkExistence || !hasDelivery || !course.games?.includes?.("word-net")) return;
  const projectionPaths = wordWorldRuntimeProjectionPaths(course.publication);
  if (
    course.publication?.contract !== "language-content-v1"
    || projectionPaths.length === 0
  ) return;
  if (
    !isEnglishLanguage(course.sourceLanguage)
    && (
      typeof course.publication?.learnerBaseRealizations !== "string"
      || typeof course.publication?.runtimeProjection?.learnerBaseRuntime !== "string"
    )
  ) return;

  let setupCatalog = null;
  let androidCatalog = null;
  let appAssetCatalog = null;
  if (course.platforms.browser?.enabled === true) {
    const setup = await resolveConfinedCourseFile(record, repoRoot, "setupCatalog");
    if (setup) {
      try {
        setupCatalog = await readJsonDocument(setup.file);
      } catch {
        // The pure closure audit below reports an unreadable/missing catalog.
      }
    }
  }
  if (course.platforms.android?.enabled === true) {
    const androidCatalogFile = await resolveConfinedCourseRootFile(
      record,
      repoRoot,
      "androidAssetCatalog"
    );
    if (androidCatalogFile) {
      try {
        androidCatalog = await readJsonDocument(androidCatalogFile);
      } catch {
        // The pure closure audit below reports an unreadable/missing catalog.
      }
    }
    const appAssetCatalogFile = await resolvePinnedRepositoryFile(
      repoRoot,
      "apps/language-runtime/app-assets.json"
    );
    if (appAssetCatalogFile) {
      try {
        appAssetCatalog = await readJsonDocument(appAssetCatalogFile);
      } catch {
        // The pure closure audit below reports an unreadable/missing catalog.
      }
    }
  }
  issues.push(...wordWorldProjectionDeliveryClosureIssues(course, {
    setupCatalog,
    androidCatalog,
    appAssetCatalog
  }));
}

async function validateBrowserSharedRuntimeDeliveryClosure(records, repoRoot, issues, checkExistence) {
  if (!checkExistence) return;
  const browserRecords = records.filter(
    ({ course }) => course.platforms?.browser?.enabled === true
  );
  if (browserRecords.length === 0) return;

  let appAssetCatalog = null;
  const appAssetCatalogFile = await resolvePinnedRepositoryFile(
    repoRoot,
    "apps/language-runtime/app-assets.json"
  );
  if (appAssetCatalogFile) {
    try {
      appAssetCatalog = await readJsonDocument(appAssetCatalogFile);
    } catch {
      // The shared closure audit below reports the unreadable catalog for every browser course.
    }
  }

  for (const record of browserRecords) {
    let setupCatalog = null;
    const setup = await resolveConfinedCourseFile(record, repoRoot, "setupCatalog");
    if (setup) {
      try {
        setupCatalog = await readJsonDocument(setup.file);
      } catch {
        // The shared closure audit below reports the unreadable setup catalog.
      }
    }
    issues.push(...browserSharedRuntimeClosureIssues({
      appAssetCatalog,
      setupCatalog,
      courseId: record.course.id,
      routePrefix: record.course.routePrefix
    }));
    issues.push(...browserSetupCacheNamespaceIssues({
      course: record.course,
      setupCatalog
    }));
    issues.push(...browserCourseGameContentClosureIssues({
      course: record.course,
      setupCatalog
    }));
  }
}

export function wordWorldProjectionDeliveryClosureIssues(
  course,
  { setupCatalog = null, androidCatalog = null, appAssetCatalog = null } = {}
) {
  const issues = [];
  const projectionPaths = wordWorldRuntimeProjectionPaths(course?.publication);
  if (course?.platforms?.browser?.enabled === true) {
    if (!isObject(setupCatalog) || !Array.isArray(setupCatalog?.offline?.assets)) {
      issues.push({
        code: "source-language.browser-package",
        message: `${course.id} Word World delivery cannot resolve its setup catalog.`
      });
    } else {
      const cached = new Set(setupCatalog.offline.assets.map(
        (asset) => String(asset).split(/[?#]/u, 1)[0]
      ));
      const expected = projectionPaths.map((runtimePath) => setupAssetPathForRuntime(course, runtimePath));
      const missing = expected.filter((asset) => !asset || !cached.has(asset));
      if (missing.length > 0) {
        issues.push({
          code: "source-language.browser-package",
          message: `${course.id} setup offline assets omit Word World runtime projections: ${missing.join(", ")}.`
        });
      }

    }
  }

  if (course?.platforms?.android?.enabled === true) {
    if (!isObject(androidCatalog) || !Array.isArray(androidCatalog.files)) {
      issues.push({
        code: "source-language.android-package",
        message: `${course.id} Word World delivery cannot resolve its Android asset catalog.`
      });
    } else {
      const packaged = new Set(androidCatalog.files);
      const courseStaticRoot = `apps/languages/${course.directoryName}/static/`;
      const expected = projectionPaths
        .filter((runtimePath) => runtimePath.startsWith(courseStaticRoot))
        .map((runtimePath) => runtimePath.slice(courseStaticRoot.length));
      const missing = expected.filter((asset) => !packaged.has(asset));
      if (missing.length > 0) {
        issues.push({
          code: "source-language.android-package",
          message: `${course.id} Android assets omit course-scoped Word World runtime projections: ${missing.join(", ")}.`
        });
      }

      const sharedRuntimeOutputs = projectionPaths.filter(
        (runtimePath) => runtimePath.startsWith("apps/language-runtime/")
      );
      if (sharedRuntimeOutputs.length > 0) {
        const sharedAssets = Array.isArray(appAssetCatalog?.assets)
          ? appAssetCatalog.assets
          : [];
        const missingShared = sharedRuntimeOutputs.filter((runtimePath) => {
          const matches = sharedAssets.filter((asset) => asset?.source === runtimePath);
          return matches.length !== 1
            || matches[0].output !== runtimePath.slice("apps/".length);
        });
        if (missingShared.length > 0) {
          issues.push({
            code: "source-language.android-package",
            message: `${course.id} app-wide Android assets omit, duplicate, or remap shared Word World runtime projections: ${missingShared.join(", ")}.`
          });
        }
      }
    }
  }
  return issues;
}

export const learnerSourceDeliveryClosureIssues = wordWorldProjectionDeliveryClosureIssues;

async function validateDictionaryReferenceDocument(record, repoRoot, issues, checkExistence) {
  if (!checkExistence || record.course.capabilities?.dictionary !== true) return;
  const resolved = await resolveConfinedCourseFile(
    record,
    repoRoot,
    "dictionaryReferenceDocument"
  );
  if (!resolved) {
    issues.push({
      code: "content.dictionary-reference",
      message: `${record.course.id}.resources.dictionaryReferenceDocument cannot be resolved inside its course static root.`
    });
    return;
  }
  const markup = await readFile(resolved.file, "utf8");
  const allowedTags = new Set([
    "article", "b", "button", "code", "div", "em", "h2", "h3", "li", "ol", "p",
    "section", "small", "span", "table", "tbody", "td", "th", "thead", "tr"
  ]);
  const tags = [...markup.matchAll(/<\s*\/?\s*([A-Za-z0-9-]+)/gu)]
    .map((match) => match[1].toLowerCase());
  const unsafeTag = tags.find((tag) => !allowedTags.has(tag));
  if (unsafeTag) {
    issues.push({
      code: "content.dictionary-reference",
      message: `${record.course.id}.resources.dictionaryReferenceDocument contains unsupported <${unsafeTag}> markup.`
    });
  }
  if (/\s(?:on[a-z]+|href|src|srcdoc)\s*=/iu.test(markup)) {
    issues.push({
      code: "content.dictionary-reference",
      message: `${record.course.id}.resources.dictionaryReferenceDocument contains executable or external-link attributes.`
    });
  }
  const attributes = [...markup.matchAll(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*["']/gu)]
    .map((match) => match[1].toLowerCase());
  const unsupportedAttribute = attributes.find((attribute) => !["class", "id", "type"].includes(attribute));
  if (unsupportedAttribute) {
    issues.push({
      code: "content.dictionary-reference",
      message: `${record.course.id}.resources.dictionaryReferenceDocument contains unsupported ${unsupportedAttribute} attributes.`
    });
  }
  const ids = [...markup.matchAll(/\sid\s*=\s*(["'])([^"']+)\1/giu)]
    .map((match) => match[2]);
  const seen = new Set();
  const duplicate = ids.find((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  if (duplicate) {
    issues.push({
      code: "content.dictionary-reference",
      message: `${record.course.id}.resources.dictionaryReferenceDocument contains duplicate id ${duplicate}.`
    });
  }
  try {
    const sharedApp = await readFile(path.resolve(repoRoot, CANONICAL_BROWSER_APP_ENTRY_PATH), "utf8");
    const sharedIds = new Set(
      [...sharedApp.matchAll(/\sid\s*=\s*(["'])([^"']+)\1/giu)].map((match) => match[2])
    );
    const collision = ids.find((id) => sharedIds.has(id));
    if (collision) {
      issues.push({
        code: "content.dictionary-reference",
        message: `${record.course.id}.resources.dictionaryReferenceDocument id ${collision} collides with the shared app document.`
      });
    }
  } catch (error) {
    issues.push({
      code: "content.dictionary-reference",
      message: `Cannot audit the shared dictionary document IDs: ${error.code ?? error.message}.`
    });
  }
}

async function validateDictionaryContent(record, repoRoot, issues, checkExistence) {
  if (!checkExistence || record.course.capabilities?.dictionary !== true) return;
  const resourceNames = [
    "languageAdapter",
    "dictionaryCatalog",
    "dictionaryCoreEntries",
    "dictionaryScriptLines",
    "dictionaryProvider"
  ];
  const resolved = Object.fromEntries(await Promise.all(resourceNames.map(async (resourceName) => [
    resourceName,
    await resolveConfinedCourseFile(record, repoRoot, resourceName)
  ])));
  const unconfined = resourceNames.filter((resourceName) => !resolved[resourceName]);
  if (unconfined.length > 0) {
    issues.push({
      code: "content.dictionary",
      message: `${record.course.id} dictionary content cannot be audited because these resources are not confined files: ${unconfined.join(", ")}.`
    });
    return;
  }
  try {
    const [adapter, catalog, coreEntries, scripts, provider] = await Promise.all([
      importBrowserLanguageAdapter(resolved.languageAdapter.file),
      readJsonDocument(resolved.dictionaryCatalog.file),
      readJsonDocument(resolved.dictionaryCoreEntries.file),
      readJsonDocument(resolved.dictionaryScriptLines.file),
      loadDictionaryProviderRegistration(resolved.dictionaryProvider.file)
    ]);
    const expectedProviderId = record.course.resources.dictionaryProvider.providerId;
    if (
      provider?.schemaVersion !== 1
      || provider?.id !== expectedProviderId
      || typeof provider?.mountDictionaryProvider !== "function"
    ) {
      issues.push({
        code: "content.dictionary-provider",
        message: `${record.course.id} dictionary provider artifact must register the declared ${expectedProviderId} v1 mount contract.`
      });
    }
    const gapReporting = record.course.resources.dictionaryProvider.gapReporting;
    if (gapReporting) {
      const reportedDictionary = Array.isArray(catalog?.dictionaries)
        ? catalog.dictionaries.find(({ key }) => key === gapReporting.dictionaryKey)
        : null;
      if (
        catalog?.default_dictionary !== gapReporting.dictionaryKey
        || reportedDictionary?.status !== "active"
        || reportedDictionary?.direction !== gapReporting.dictionaryDirection
      ) {
        issues.push({
          code: "content.dictionary-gap-reporting",
          message: `${record.course.id} dictionary gap reporting must bind the declared active default dictionary key and direction.`
        });
      }
    }
    for (const issue of auditDictionaryContentDocuments({
      adapter,
      catalog,
      coreEntries,
      scripts,
      sourceLanguageId: record.course.sourceLanguage?.id,
      targetLanguageId: record.course.targetLanguage?.id,
      targetLanguageLocale: record.course.targetLanguage?.locale,
      targetLanguageScript: record.course.targetLanguage?.script
    })) {
      issues.push({
        code: `content.${issue.code}`,
        message: `${record.course.id} ${issue.message}`
      });
    }
  } catch (error) {
    issues.push({
      code: "content.dictionary",
      message: `${record.course.id} dictionary content audit failed: ${error.message ?? String(error)}`
    });
  }
}

async function importBrowserLanguageAdapter(file) {
  const source = await readFile(file, "utf8");
  const matches = [...source.matchAll(/(["'])\/language-runtime\/contract\.mjs\1/gu)];
  if (matches.length !== 1) {
    throw new Error("Language adapter must import the canonical browser contract exactly once.");
  }
  const nodeSource = source.replace(matches[0][0], JSON.stringify(LANGUAGE_ADAPTER_CONTRACT_URL));
  const dataUrl = `data:text/javascript;base64,${Buffer.from(nodeSource).toString("base64")}`;
  return (await import(dataUrl)).default;
}

async function validateBrowserLanguageAdapterIdentity(
  record,
  repoRoot,
  issues,
  checkExistence
) {
  if (!checkExistence || record.course.platforms?.browser?.enabled !== true) return;
  const resolved = await resolveConfinedCourseFile(record, repoRoot, "languageAdapter");
  if (!resolved) {
    issues.push({
      code: "content.language-adapter",
      message: `${record.course.id}.resources.languageAdapter cannot be resolved inside its canonical course static root.`
    });
    return;
  }
  try {
    const adapter = await importBrowserLanguageAdapter(resolved.file);
    assertLanguageAdapterMatchesTarget(adapter, record.course.targetLanguage);
  } catch (error) {
    issues.push({
      code: "content.language-adapter",
      message: `${record.course.id} language adapter does not match its target language: ${error.message ?? String(error)}`
    });
  }
}

export async function browserLanguageAdapterIdentityIssues(
  record,
  repoRoot = DEFAULT_REPO_ROOT,
  { checkExistence = true } = {}
) {
  const issues = [];
  await validateBrowserLanguageAdapterIdentity(
    record,
    path.resolve(repoRoot instanceof URL ? fileURLToPath(repoRoot) : repoRoot),
    issues,
    checkExistence
  );
  return issues;
}

async function loadDictionaryProviderRegistration(file) {
  const source = await readFile(file, "utf8");
  const sandbox = {};
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false }
  });
  new vm.Script(source, { filename: file }).runInContext(context, { timeout: 1000 });
  return sandbox.CaatuuDictionaryProvider;
}

async function readJsonDocument(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function usesExactCzechLegacyPublicationException(course) {
  return course?.id === "cz"
    && course?.directoryName === "czech"
    && course?.publication?.contract === "legacy-active-v1";
}

function normalizeCourseAuthoredGrammarCatalog(course, gameId, document) {
  if (gameId === "conjugation-comet") {
    return validateConjugationCometCatalog(document, {
      expectedCourseId: course.id,
      expectedTargetLanguageId: course.targetLanguage?.id,
      expectedLearnerBaseLanguageId: course.sourceLanguage?.id,
      expectedTargetLocale: course.targetLanguage?.locale
    });
  }
  if (gameId === "agreement-aurora") {
    return normalizeAgreementAuroraPack(document, {
      courseId: course.id,
      targetLanguage: course.targetLanguage?.locale || course.targetLanguage?.id,
      learnerBaseLanguage: course.sourceLanguage?.locale || course.sourceLanguage?.id,
      targetLabel: course.targetLanguage?.label || course.targetLanguage?.id
    });
  }
  throw new Error(`Unsupported authored grammar game ${gameId}.`);
}

export function authoredGrammarPromotionIssues(course, gameId, catalog) {
  if (usesExactCzechLegacyPublicationException(course)) return [];
  const release = course?.status === "active"
    || course?.platforms?.browser?.pagesEnabled === true
    || course?.platforms?.android?.enabled === true;
  const requireNativeReview = course?.status === "active";
  const issues = [];
  if (release && catalog?.license?.status !== "release-cleared") {
    issues.push({
      code: "release.game-license",
      message: `${course?.id}.${gameId} license.status must be release-cleared before browser or Android release.`
    });
  }
  const approvedReviewState = gameId === "conjugation-comet"
    ? "release-approved"
    : gameId === "agreement-aurora"
      ? "approved"
      : "";
  if (requireNativeReview && catalog?.review?.status !== approvedReviewState) {
    issues.push({
      code: "activation.game-native-review",
      message: `${course?.id}.${gameId} review.status must be ${approvedReviewState} before active promotion.`
    });
  }
  return issues;
}

async function validateAuthoredGrammarPromotionEvidence(record, repoRoot, issues) {
  const { course } = record;
  if (usesExactCzechLegacyPublicationException(course)) return;
  const release = course.status === "active"
    || course.platforms?.browser?.pagesEnabled === true
    || course.platforms?.android?.enabled === true;
  if (!release) return;
  const declaredGames = new Set(Array.isArray(course.games) ? course.games : []);
  const grammarResources = [
    ["conjugation-comet", "conjugationCometCatalog"],
    ["agreement-aurora", "agreementAuroraCatalog"]
  ];
  for (const [gameId, resourceName] of grammarResources) {
    if (!declaredGames.has(gameId)) continue;
    try {
      const confined = await resolveConfinedCourseFile(record, repoRoot, resourceName);
      if (!confined) {
        throw new Error(`${resourceName} cannot be resolved inside its course static root.`);
      }
      const document = await readJsonDocument(confined.file);
      const catalog = normalizeCourseAuthoredGrammarCatalog(course, gameId, document);
      issues.push(...authoredGrammarPromotionIssues(course, gameId, catalog));
    } catch (error) {
      issues.push({
        code: "content.game-contract",
        message: `${course.id}.${gameId} ${error.message ?? String(error)}`
      });
    }
  }
}

async function validatePlanetEnglishAudit(record, repoRoot, issues, checkExistence) {
  if (!checkExistence) return;
  const { course } = record;
  const declaredGames = new Set(Array.isArray(course.games) ? course.games : []);
  for (const gameId of declaredGames) {
    const game = PLANET_GAME_CONTRACT.planets[gameId];
    if (!game) continue;
    for (const requirement of game.resources ?? []) {
      if (typeof requirement.englishAuditContract !== "string") continue;
      const resource = course.resources?.[requirement.name];
      if (
        !isObject(resource)
        || resource.kind !== "file"
        || resource.state !== "present"
        || !isSafeRepositoryPath(resource.path)
      ) continue;
      const absolutePath = path.resolve(repoRoot, resource.path);
      if (!isInside(repoRoot, absolutePath)) continue;
      const confined = await resolveConfinedCourseFile(record, repoRoot, requirement.name);
      if (!confined) {
        issues.push({
          code: "content.path-scope",
          message: `${course.id}.${gameId} resource ${requirement.name} cannot be resolved inside its course static root.`
        });
        continue;
      }
      const auditIssues = await auditPlanetEnglishResource({
        contractId: requirement.englishAuditContract,
        absolutePath: confined.file,
        allowedRoot: confined.staticRoot,
        repositoryPath: resource.path,
        sourceLanguageId: course.sourceLanguage?.id,
        publicationContract: course.publication?.contract
      });
      for (const issue of auditIssues) {
        issues.push({
          code: issue.code,
          message: `${course.id}.${gameId} ${issue.message}`
        });
      }
      if (
        (gameId === "conjugation-comet" && requirement.name === "conjugationCometCatalog")
        || (gameId === "agreement-aurora" && requirement.name === "agreementAuroraCatalog")
      ) {
        try {
          const document = await readJsonDocument(confined.file);
          normalizeCourseAuthoredGrammarCatalog(course, gameId, document);
        } catch (error) {
          issues.push({
            code: "content.game-contract",
            message: `${course.id}.${gameId} ${error.message ?? String(error)}`
          });
        }
      }
      if (gameId === "word-net" && requirement.name === "wordWorldManifest") {
        try {
          const manifest = await readJsonDocument(confined.file);
          issues.push(...wordWorldGenerationReadinessIssues(course, manifest));
        } catch (error) {
          issues.push({
            code: "word-world.generation-strategy",
            message: `${course.id} could not validate its Word World generation strategy: ${error.message ?? String(error)}`
          });
        }
      }
    }
  }
}

async function validateWordWorldPublicationProjection(record, repoRoot, content, issues) {
  const { course } = record;
  if (!course.games?.includes?.("word-net")) return;
  const policy = resolveWordWorldProjectionPolicy(content.targetRealizations?.contentPolicy);
  if (!policy) {
    issues.push({
      code: "publication.runtime-policy",
      message: `${course.id} has no Word World runtime projection policy for ${content.targetRealizations?.contentPolicy || "<missing>"}.`
    });
    return;
  }
  const runtimeProjection = course.publication.runtimeProjection;
  if (!isObject(runtimeProjection) || runtimeProjection.policyId !== policy.id) {
    issues.push({
      code: "publication.runtime-policy",
      message: `${course.id} Word World runtimeProjection must name policy ${policy.id}.`
    });
    return;
  }
  const expectedSupplementalKeys = Object.keys(policy.supplementalOutputs).sort();
  const actualSupplementalKeys = Object.keys(runtimeProjection.supplementalOutputs ?? {}).sort();
  if (!isDeepStrictEqual(actualSupplementalKeys, expectedSupplementalKeys)) {
    issues.push({
      code: "publication.runtime-authority",
      message: `${course.id} Word World supplemental outputs must be exactly ${expectedSupplementalKeys.join(", ") || "none"}.`
    });
    return;
  }
  const projectionPaths = {
    conceptsSource: course.publication.concepts,
    realizationsSource: course.publication.realizations,
    conceptsRuntime: runtimeProjection.conceptsRuntime,
    realizationsRuntime: runtimeProjection.targetRealizationsRuntime,
    manifest: runtimeProjection.manifest
  };
  if (course.publication.learnerBaseRealizations) {
    projectionPaths.learnerBaseSource = course.publication.learnerBaseRealizations;
    projectionPaths.learnerBaseRuntime = runtimeProjection.learnerBaseRuntime;
  }
  for (const [projectionKey, pathKey] of Object.entries(policy.supplementalOutputs)) {
    projectionPaths[pathKey] = runtimeProjection.supplementalOutputs[projectionKey];
  }
  try {
    const lexicalCourseStaticRoot = path.resolve(repoRoot, course.resources.staticRoot.path);
    const lexicalSharedConceptRoot = path.resolve(
      repoRoot,
      "apps/language-runtime/static/data/english-concepts"
    );
    const [realRepoRoot, realCourseStaticRoot, realSharedConceptRoot] = await Promise.all([
      realpath(repoRoot),
      realpath(lexicalCourseStaticRoot),
      realpath(lexicalSharedConceptRoot)
    ]);
    const expectedRealCourseStaticRoot = expectedPhysicalPath(
      repoRoot,
      realRepoRoot,
      lexicalCourseStaticRoot
    );
    const expectedRealSharedConceptRoot = expectedPhysicalPath(
      repoRoot,
      realRepoRoot,
      lexicalSharedConceptRoot
    );
    if (!isInside(realRepoRoot, realCourseStaticRoot)
        || !isInside(realRepoRoot, realSharedConceptRoot)
        || !samePath(realCourseStaticRoot, expectedRealCourseStaticRoot)
        || !samePath(realSharedConceptRoot, expectedRealSharedConceptRoot)) {
      throw new Error("Word World runtime authority roots resolve outside the repository.");
    }
    const courseOutputPaths = [
      runtimeProjection.targetRealizationsRuntime,
      runtimeProjection.learnerBaseRuntime,
      runtimeProjection.manifest,
      ...Object.values(runtimeProjection.supplementalOutputs)
    ].filter((value) => typeof value === "string");
    for (const outputPath of courseOutputPaths) {
      const lexicalOutput = path.resolve(repoRoot, outputPath);
      const realOutput = await realpath(lexicalOutput);
      const expectedRealOutput = expectedPhysicalPath(repoRoot, realRepoRoot, lexicalOutput);
      if (!isInside(realCourseStaticRoot, realOutput) || !samePath(realOutput, expectedRealOutput)) {
        throw new Error(`Word World runtime output resolves outside course static authority: ${outputPath}.`);
      }
    }
    const lexicalConceptsRuntime = path.resolve(repoRoot, runtimeProjection.conceptsRuntime);
    const realConceptsRuntime = await realpath(lexicalConceptsRuntime);
    const expectedRealConceptsRuntime = expectedPhysicalPath(
      repoRoot,
      realRepoRoot,
      lexicalConceptsRuntime
    );
    if (!isInside(realSharedConceptRoot, realConceptsRuntime)
        || !samePath(realConceptsRuntime, expectedRealConceptsRuntime)) {
      throw new Error("Word World English concepts runtime resolves outside shared English authority.");
    }
    const report = await projectWordWorldRuntime({
      repositoryRoot: repoRoot,
      check: true,
      projectionPolicy: policy,
      paths: projectionPaths,
      sourceLanguage: course.sourceLanguage?.locale ?? course.sourceLanguage?.id,
      learnerBaseRealizationsPath: course.publication.learnerBaseRealizations
    });
    if (report.changes.length > 0) {
      issues.push({
        code: "publication.runtime-drift",
        message: `${course.id} Word World runtime projection differs from its authoring authority: ${report.changes.join(", ")}.`
      });
    }
  } catch (error) {
    issues.push({
      code: "publication.runtime-drift",
      message: `${course.id} Word World runtime projection cannot be verified: ${error.message ?? String(error)}`
    });
  }
}

async function validatePublicationEvidence(
  record,
  repoRoot,
  issues,
  {
    release = record.course.status === "active",
    requireNativeReview = record.course.status === "active"
  } = {}
) {
  const { course } = record;
  const publication = course.publication;
  if (!isObject(publication)) {
    issues.push({ code: "publication.contract", message: `${course.id} has no valid publication contract.` });
    return;
  }
  if (publication.contract === "legacy-active-v1") {
    if (course.id !== "cz" || course.directoryName !== "czech"
        || publication.concepts !== null
        || publication.realizations !== null
        || publication.learnerBaseRealizations !== null
        || publication.runtimeProjection !== null) {
      issues.push({ code: "publication.legacy", message: `${course.id} cannot use the Czech-only legacy publication exception.` });
    }
    return;
  }
  if (publication.contract !== "language-content-v1") {
    issues.push({ code: "publication.contract", message: `${course.id}.publication.contract is unsupported.` });
    return;
  }
  const expectedRealizationRoot = `apps/languages/${course.directoryName}/content/`;
  const sourceIsEnglish = isEnglishLanguage(course.sourceLanguage);
  const learnerBasePathIsValid = sourceIsEnglish
    ? publication.learnerBaseRealizations === null
    : isSafeRepositoryPath(publication.learnerBaseRealizations)
      && publication.learnerBaseRealizations.startsWith(LEARNER_BASE_REALIZATION_ROOT)
      && publication.learnerBaseRealizations.endsWith(".json");
  if (!isSafeRepositoryPath(publication.concepts)
      || !/^apps\/languages\/shared\/english-concepts\/[a-z0-9][a-z0-9.-]*\.json$/u.test(publication.concepts)
      || !isSafeRepositoryPath(publication.realizations)
      || !publication.realizations.startsWith(expectedRealizationRoot)
      || !publication.realizations.endsWith(".json")
      || !learnerBasePathIsValid) {
    issues.push({ code: "publication.path", message: `${course.id} publication evidence paths are invalid.` });
    return;
  }

  try {
    const content = await loadAndPrepareLanguageRoleContent({
      repoRoot,
      conceptsPath: publication.concepts,
      targetRealizationsPath: publication.realizations,
      learnerBaseRealizationsPath: publication.learnerBaseRealizations,
      sourceLanguage: course.sourceLanguage,
      release,
      requireNativeReview
    });
    if (content.concepts.language !== ENGLISH_AUDIT_LANGUAGE) {
      issues.push({
        code: "publication.language",
        message: `${course.id} publication audit language ${content.concepts.language} must remain ${ENGLISH_AUDIT_LANGUAGE}, independently of learner source language ${course.sourceLanguage?.id}.`
      });
    }
    if (
      content.roles.auditLanguage !== ENGLISH_AUDIT_LANGUAGE
      || content.roles.retrievalLanguage !== ENGLISH_AUDIT_LANGUAGE
    ) {
      issues.push({
        code: "publication.language",
        message: `${course.id} publication must retain English as both audit and retrieval language.`
      });
    }
    if (content.targetRealizations.courseId !== course.id) {
      issues.push({
        code: "publication.course",
        message: `${course.id} publication realization catalog belongs to ${content.targetRealizations.courseId}.`
      });
    }
    if (content.targetRealizations.targetLanguage?.languageTag !== course.targetLanguage?.locale) {
      issues.push({
        code: "publication.language",
        message: `${course.id} publication target language ${content.targetRealizations.targetLanguage?.languageTag} does not match ${course.targetLanguage?.locale}.`
      });
    }
    if (content.targetRealizations.targetLanguage?.script !== course.targetLanguage?.script) {
      issues.push({
        code: "publication.language",
        message: `${course.id} publication target script ${content.targetRealizations.targetLanguage?.script} does not match ${course.targetLanguage?.script}.`
      });
    }
    if (content.targetRealizations.targetLanguage?.speechLocale !== course.targetLanguage?.speechLocale) {
      issues.push({
        code: "publication.language",
        message: `${course.id} publication speech locale ${content.targetRealizations.targetLanguage?.speechLocale} does not match ${course.targetLanguage?.speechLocale}.`
      });
    }
    await validateWordWorldPublicationProjection(record, repoRoot, content, issues);
  } catch (error) {
    const evidenceIssues = Array.isArray(error?.issues)
      ? error.issues
      : [{ code: "publication.evidence", message: error?.message ?? String(error) }];
    for (const issue of evidenceIssues) {
      issues.push({
        code: typeof issue === "object" && typeof issue.code === "string" ? issue.code : "publication.evidence",
        message: `${course.id} publication evidence: ${typeof issue === "object" && issue !== null ? issue.message : issue}`
      });
    }
  }
}

export async function loadCourseCatalog({ repoRoot = DEFAULT_REPO_ROOT, catalogPath = DEFAULT_CATALOG_PATH } = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot instanceof URL ? fileURLToPath(repoRoot) : repoRoot);
  const catalogAbsolutePath = path.resolve(resolvedRepoRoot, catalogPath);
  if (!isInside(resolvedRepoRoot, catalogAbsolutePath)) {
    throw new CourseContractError([{ code: "catalog.path", message: `Catalog path escapes repository root: ${catalogPath}.` }]);
  }
  let realRepoRoot;
  let realCatalogPath;
  try {
    [realRepoRoot, realCatalogPath] = await Promise.all([
      realpath(resolvedRepoRoot),
      realpath(catalogAbsolutePath)
    ]);
  } catch (error) {
    throw new CourseContractError([{
      code: "catalog.read",
      message: `Cannot resolve ${catalogPath}: ${error.code ?? error.message}.`
    }]);
  }
  const expectedRealCatalogPath = expectedPhysicalPath(
    resolvedRepoRoot,
    realRepoRoot,
    catalogAbsolutePath
  );
  if (!isInside(realRepoRoot, realCatalogPath) || !samePath(realCatalogPath, expectedRealCatalogPath)) {
    throw new CourseContractError([{
      code: "catalog.path",
      message: `Catalog resolves outside repository root: ${catalogPath}.`
    }]);
  }
  const catalog = JSON.parse(await readFile(realCatalogPath, "utf8"));
  const preliminaryIssues = [];
  validateCatalogShape(catalog, preliminaryIssues);
  if (preliminaryIssues.length > 0) throw new CourseContractError(preliminaryIssues);

  const courses = [];
  for (const entry of catalog.courses) {
    const manifestAbsolutePath = path.resolve(resolvedRepoRoot, entry.manifest);
    if (!isInside(resolvedRepoRoot, manifestAbsolutePath)) {
      throw new CourseContractError([{ code: "catalog.path", message: `Manifest path escapes repository root: ${entry.manifest}.` }]);
    }
    let course;
    try {
      const lexicalCourseRoot = path.dirname(manifestAbsolutePath);
      const [realCourseRoot, realManifestPath] = await Promise.all([
        realpath(lexicalCourseRoot),
        realpath(manifestAbsolutePath)
      ]);
      const expectedRealCourseRoot = expectedPhysicalPath(
        resolvedRepoRoot,
        realRepoRoot,
        lexicalCourseRoot
      );
      const expectedRealManifestPath = expectedPhysicalPath(
        resolvedRepoRoot,
        realRepoRoot,
        manifestAbsolutePath
      );
      if (!isInside(realRepoRoot, realCourseRoot)
          || !isInside(realRepoRoot, realManifestPath)
          || !isInside(realCourseRoot, realManifestPath)
          || !samePath(realCourseRoot, expectedRealCourseRoot)
          || !samePath(realManifestPath, expectedRealManifestPath)) {
        throw new CourseContractError([{
          code: "catalog.path",
          message: `Manifest resolves outside its repository course root: ${entry.manifest}.`
        }]);
      }
      course = JSON.parse(await readFile(realManifestPath, "utf8"));
    } catch (error) {
      if (error instanceof CourseContractError) throw error;
      throw new CourseContractError([{ code: "manifest.read", message: `Cannot read ${entry.manifest}: ${error.message}` }]);
    }
    courses.push({ course, catalogEntry: entry, manifestPath: entry.manifest });
  }
  return { catalog, catalogPath, courses, repoRoot: resolvedRepoRoot };
}

export async function validateCourseCatalog(
  loaded,
  { checkExistence = true, allowMissingGeneratedViews = false } = {}
) {
  const issues = [];
  const { catalog, courses, repoRoot, catalogPath = DEFAULT_CATALOG_PATH } = loaded;
  validateCatalogShape(catalog, issues);
  for (const record of courses) validateCourseShape(record.course, issues);

  const expectedCatalogSchema = path.resolve(repoRoot, CATALOG_SCHEMA_PATH);
  if (typeof catalog?.$schema === "string" && path.resolve(repoRoot, path.dirname(catalogPath), catalog.$schema) !== expectedCatalogSchema) {
    issues.push({ code: "catalog.schema", message: `Catalog must reference ${CATALOG_SCHEMA_PATH}.` });
  }
  for (const record of courses) {
    const { course, catalogEntry, manifestPath } = record;
    const expectedCourseSchema = path.resolve(repoRoot, COURSE_SCHEMA_PATH);
    if (typeof course?.$schema === "string" && path.resolve(repoRoot, path.dirname(manifestPath), course.$schema) !== expectedCourseSchema) {
      issues.push({ code: "manifest.schema", message: `${course.id} must reference ${COURSE_SCHEMA_PATH}.` });
    }
    if (catalogEntry?.id !== course.id) issues.push({ code: "catalog.manifest-mismatch", message: `Catalog ID ${catalogEntry?.id} does not match manifest ID ${course.id}.` });
    const manifestDirectoryName = path.posix.basename(path.posix.dirname(manifestPath));
    if (course.directoryName !== manifestDirectoryName) {
      issues.push({ code: "catalog.manifest-mismatch", message: `${course.id}.directoryName must match manifest directory ${manifestDirectoryName}.` });
    }
    validateCapabilityResources(course, issues);
    validateLearnerSourceReadiness(course, issues);
    validateBrowserDelivery(record, issues);
  }

  addDuplicateIssues(issues, courses, ({ id }) => id, "collision.id", "Course ID");
  addDuplicateIssues(issues, courses, ({ directoryName }) => directoryName, "collision.directory", "Course directory");
  addDuplicateIssues(issues, courses, ({ storage }) => storage?.namespace, "collision.namespace", "Storage namespace");
  addDuplicateIssues(issues, courses, ({ cache }) => cache?.prefix, "collision.namespace", "Cache prefix");
  addDuplicateIssues(issues, courses, ({ cache }) => cache?.setupFallback, "collision.namespace", "Setup cache");
  addDuplicateIssues(
    issues,
    courses,
    courseLanguagePairIdentity,
    "collision.language-pair",
    "Learner-base/target language pair"
  );
  issues.push(...sourceLanguagePresentationIssues(courses));
  validateSharedBrowserAppEntry(courses, issues);

  for (let leftIndex = 0; leftIndex < courses.length; leftIndex += 1) {
    const left = courses[leftIndex].course;
    for (let rightIndex = leftIndex + 1; rightIndex < courses.length; rightIndex += 1) {
      const right = courses[rightIndex].course;
      if (typeof left.routePrefix === "string" && typeof right.routePrefix === "string" && routesCollide(left.routePrefix, right.routePrefix)) {
        issues.push({ code: "collision.route", message: `Course routes ${left.routePrefix} (${left.id}) and ${right.routePrefix} (${right.id}) overlap.` });
      }
      const leftStorage = isObject(left.storage) ? Object.entries(left.storage).filter(([key]) => key !== "namespace") : [];
      const rightStorageValues = new Set(isObject(right.storage) ? Object.entries(right.storage).filter(([key]) => key !== "namespace").map(([, value]) => value) : []);
      for (const [key, value] of leftStorage) {
        if (rightStorageValues.has(value)) issues.push({ code: "collision.namespace", message: `Storage key ${value} is shared by ${left.id}.${key} and ${right.id}.` });
      }
    }
  }

  for (const record of courses) {
    const { course } = record;
    for (const reserved of catalog.reservedRoutePrefixes ?? []) {
      if (typeof course.routePrefix === "string" && routesCollide(course.routePrefix, reserved)) {
        issues.push({ code: "route.reserved", message: `${course.id} route ${course.routePrefix} overlaps reserved route ${reserved}.` });
      }
    }
    await validateResourcePaths(record, repoRoot, issues, checkExistence, {
      allowMissingGeneratedViews
    });
    await validateBrowserLanguageAdapterIdentity(record, repoRoot, issues, checkExistence);
    await validateWordWorldProjectionDeliveryClosure(record, repoRoot, issues, checkExistence);
    await validateDictionaryReferenceDocument(record, repoRoot, issues, checkExistence);
    await validateDictionaryContent(record, repoRoot, issues, checkExistence);
    await validatePlanetEnglishAudit(record, repoRoot, issues, checkExistence);
    await validateAuthoredGrammarPromotionEvidence(record, repoRoot, issues);
    await validatePublicationEvidence(record, repoRoot, issues, {
      release: course.status === "active" || course.platforms?.browser?.pagesEnabled === true,
      requireNativeReview: course.status === "active"
    });
  }
  await validateBrowserSharedRuntimeDeliveryClosure(courses, repoRoot, issues, checkExistence);

  const defaultRecords = courses.filter(({ course }) => course.id === catalog.defaultCourseId);
  if (defaultRecords.length !== 1) {
    issues.push({ code: "catalog.default", message: `Default course ${catalog.defaultCourseId} must resolve exactly once.` });
  } else if (defaultRecords[0].course.status !== "active") {
    issues.push({ code: "catalog.default", message: `Default course ${catalog.defaultCourseId} must be active.` });
  }
  if (issues.length > 0) throw new CourseContractError(issues);
  return loaded;
}

export async function loadAndValidateCourseCatalog(options = {}) {
  const loaded = await loadCourseCatalog(options);
  return validateCourseCatalog(loaded, options);
}

export async function generateLauncherRegistry(loaded) {
  const activeRecords = loaded.courses.filter(({ course }) => course.status === "active");
  const activeCourses = activeRecords.map(({ course }) => course);
  const browserDisabled = activeCourses.filter((course) => course.platforms?.browser?.enabled !== true);
  if (browserDisabled.length > 0) {
    throw new CourseContractError(browserDisabled.map((course) => ({
      code: "platform.contradiction",
      message: `Active course ${course.id} cannot be emitted into the launcher while its browser platform is disabled.`
    })));
  }
  const publicationIssues = [];
  for (const record of activeRecords) {
    validateLearnerSourceReadiness(record.course, publicationIssues, { launcher: true });
    await validatePublicationEvidence(record, loaded.repoRoot, publicationIssues, {
      release: true,
      requireNativeReview: true
    });
    await validateAuthoredGrammarPromotionEvidence(record, loaded.repoRoot, publicationIssues);
  }
  if (publicationIssues.length > 0) throw new CourseContractError(publicationIssues);
  const languages = activeCourses
    .map((course) => ({
      id: course.id,
      status: course.status,
      label: course.targetLanguage.label,
      nativeLabel: course.targetLanguage.nativeLabel,
      shortCode: course.targetLanguage.shortCode,
      locale: course.targetLanguage.locale,
      direction: course.targetLanguage.direction,
      flagClass: course.launcher.flagClass,
      flagSrc: course.targetLanguage.flagSrc,
      routePrefix: course.routePrefix,
      entryPath: course.entryPath,
      sourceLanguage: {
        id: course.sourceLanguage.id,
        label: course.sourceLanguage.label,
        locale: course.sourceLanguage.locale
      },
      capabilities: LEGACY_VIEW_CAPABILITIES.filter((key) => course.capabilities[key]),
      platforms: {
        browser: {
          enabled: course.platforms.browser.enabled,
          entryPath: course.platforms.browser.entryPath
        },
        android: {
          enabled: course.platforms.android.enabled,
          channels: course.platforms.android.channels.map((channel) => ({ ...channel }))
        }
      }
    }));
  const defaultCourse = activeCourses.find((course) => course.id === loaded.catalog.defaultCourseId);
  const browserSetup = generateCourseSelectorCatalog(loaded.courses);
  return {
    schemaVersion: COURSE_SCHEMA_VERSION,
    defaultLanguage: loaded.catalog.defaultCourseId,
    browserSetup: {
      schemaVersion: browserSetup.schemaVersion,
      entryPath: defaultCourse.platforms.browser.entryPath,
      courses: browserSetup.courses
    },
    languages
  };
}

function courseSelectorCandidates(catalogCourses) {
  return catalogCourses
    .map((record) => record?.course ?? record)
    .filter((candidate) => isObject(candidate))
    .filter((candidate) => ["active", "development"].includes(candidate.status))
    .filter((candidate) => candidate.platforms?.browser?.enabled === true);
}

export function generateCourseSelectorAssetMappings(catalogCourses) {
  const issues = [];
  const mappings = [];
  const byOutput = new Map();
  for (const candidate of courseSelectorCandidates(catalogCourses)) {
    const flags = [
      {
        role: "source",
        language: candidate.sourceLanguage,
        resource: candidate.resources?.sourceLanguageFlag
      },
      {
        role: "target",
        language: candidate.targetLanguage,
        resource: candidate.resources?.launcherFlag
      }
    ];
    for (const { role, language, resource } of flags) {
      const url = String(language?.flagSrc || "");
      const source = String(resource?.path || "");
      const output = url.startsWith("/") ? url.slice(1) : "";
      if (!url.startsWith("/assets/") || /[?#]/u.test(url) || !output) {
        issues.push({ code: "view.selector-assets", message: `${candidate.id} ${role} selector flag URL must be an exact /assets/ path.` });
        continue;
      }
      if (!REPOSITORY_PATH_PATTERN.test(source)
          || path.posix.normalize(source) !== source
          || source.startsWith("/")
          || source.split("/").includes("..")) {
        issues.push({ code: "view.selector-assets", message: `${candidate.id} ${role} selector flag source must be a normalized repository path.` });
        continue;
      }
      const existing = byOutput.get(output);
      if (existing && existing.source !== source) {
        issues.push({ code: "view.selector-assets", message: `Selector flag output ${output} maps both ${existing.source} and ${source}.` });
        continue;
      }
      if (existing) continue;
      const mapping = { courseId: candidate.id, url, source, output };
      byOutput.set(output, mapping);
      mappings.push(mapping);
    }
  }
  if (issues.length > 0) throw new CourseContractError(issues);
  return mappings;
}

export function generateCourseSelectorCatalog(catalogCourses) {
  const courses = courseSelectorCandidates(catalogCourses)
    .map((candidate) => ({
      id: candidate.id,
      status: candidate.status,
      routePrefix: candidate.routePrefix,
      entryPath: candidate.platforms.browser.entryPath,
      storage: {
        learningPerformance: candidate.storage.learningPerformance
      },
      sourceLanguage: { ...candidate.sourceLanguage },
      targetLanguage: {
        id: candidate.targetLanguage.id,
        label: candidate.targetLanguage.label,
        nativeLabel: candidate.targetLanguage.nativeLabel,
        shortCode: candidate.targetLanguage.shortCode,
        locale: candidate.targetLanguage.locale,
        direction: candidate.targetLanguage.direction,
        flagClass: candidate.targetLanguage.flagClass,
        flagSrc: candidate.targetLanguage.flagSrc
      }
    }));
  return {
    schemaVersion: 1,
    courses
  };
}

function courseStaticBrowserPath(course, resourceName) {
  const staticRoot = String(course.resources?.staticRoot?.path || "").replace(/\/+$/u, "");
  const resourcePath = String(course.resources?.[resourceName]?.path || "");
  return staticRoot && resourcePath.startsWith(`${staticRoot}/`)
    ? resourcePath.slice(staticRoot.length + 1)
    : "";
}

function courseStaticBrowserResourceUrl(course, resourceName) {
  const browserPath = courseStaticBrowserPath(course, resourceName);
  const revision = String(course.resources?.[resourceName]?.revision || "").trim();
  return browserPath && revision ? `${browserPath}?v=${revision}` : browserPath;
}

function courseGameContent(course) {
  return Object.fromEntries((course.games ?? []).flatMap((gameId) => {
    const requirements = NON_CAMPAIGN_GAME_REGISTRY[gameId]?.resources ?? [];
    const resources = Object.fromEntries(requirements.flatMap(({ name }) => {
      const browserPath = courseStaticBrowserResourceUrl(course, name);
      return browserPath ? [[name, browserPath]] : [];
    }));
    return Object.keys(resources).length > 0 ? [[gameId, resources]] : [];
  }));
}

export function generateCourseProfileObject(course, catalogCourses = [course]) {
  const adapterModule = courseStaticBrowserPath(course, "languageAdapter");
  const browserProviders = Object.fromEntries(BROWSER_PROVIDER_RESOURCE_KEYS.flatMap((name) => {
    const resource = course.resources?.[name];
    const module = courseStaticBrowserPath(course, name);
    return resource?.state === "present" && module && resource.revision
      ? [[name, `${module}?v=${resource.revision}`]]
      : [];
  }));
  return {
    schemaVersion: COURSE_SCHEMA_VERSION,
    id: course.id,
    status: course.status,
    brandLabel: course.brandLabel,
    workspaceLabel: course.workspaceLabel,
    routePrefix: course.routePrefix,
    entryPath: course.entryPath,
    sourceLanguage: { ...course.sourceLanguage },
    targetLanguage: {
      id: course.targetLanguage.id,
      label: course.targetLanguage.label,
      nativeLabel: course.targetLanguage.nativeLabel,
      shortCode: course.targetLanguage.shortCode,
      locale: course.targetLanguage.locale,
      script: course.targetLanguage.script,
      speechLocale: course.targetLanguage.speechLocale,
      direction: course.targetLanguage.direction,
      flagClass: course.targetLanguage.flagClass,
      flagSrc: course.targetLanguage.flagSrc
    },
    linguisticFeatures: [...(course.linguisticFeatures ?? [])],
    games: [...(course.games ?? [])],
    upcomingGames: [...(course.upcomingGames ?? [])],
    languageAdapter: {
      schemaVersion: 1,
      module: adapterModule
    },
    browserProviders,
    gameContent: courseGameContent(course),
    dictionaryContent: course.capabilities.dictionary
      ? {
          catalog: courseStaticBrowserPath(course, "dictionaryCatalog"),
          coreEntries: courseStaticBrowserPath(course, "dictionaryCoreEntries"),
          scriptLines: courseStaticBrowserPath(course, "dictionaryScriptLines"),
          referenceDocument: courseStaticBrowserPath(course, "dictionaryReferenceDocument"),
          providerId: course.resources.dictionaryProvider.providerId,
          providerModule: `${courseStaticBrowserPath(course, "dictionaryProvider")}?v=${course.resources.dictionaryProvider.revision}`,
          ...(course.resources.dictionaryProvider.gapReporting ? {
            gapReporting: {
              providerId: course.resources.dictionaryProvider.providerId,
              ...course.resources.dictionaryProvider.gapReporting
            }
          } : {})
        }
      : null,
    embeddingContent: course.capabilities.embeddings
      ? {
          catalog: courseStaticBrowserPath(course, "embeddingCatalog")
        }
      : null,
    courseSelector: generateCourseSelectorCatalog(catalogCourses),
    routes: { ...course.routes },
    storage: { ...course.storage },
    cache: { ...course.cache },
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, course.capabilities[key]])),
    skillCompass: course.skillCompass ? JSON.parse(JSON.stringify(course.skillCompass)) : null,
    platforms: {
      browser: {
        enabled: course.platforms.browser.enabled,
        entryPath: course.platforms.browser.entryPath,
        backend: course.platforms.browser.backend
      },
      android: {
        enabled: course.platforms.android.enabled,
        channels: course.platforms.android.channels.map((channel) => ({ ...channel }))
      }
    }
  };
}

function serializeJavaScriptValue(value, indent = 0) {
  const indentation = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${" ".repeat(indent + 2)}${serializeJavaScriptValue(item, indent + 2)}`);
    return `[\n${items.join(",\n")}\n${indentation}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const properties = entries.map(([key, item]) => {
      const renderedKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
      return `${" ".repeat(indent + 2)}${renderedKey}: ${serializeJavaScriptValue(item, indent + 2)}`;
    });
    return `{\n${properties.join(",\n")}\n${indentation}}`;
  }
  return JSON.stringify(value);
}

export function serializeCourseProfileSource(profile) {
  const objectSource = serializeJavaScriptValue(profile, 2).replace(/^  /, "");
  return `(() => {\n  const deepFreeze = (value) => {\n    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;\n    Object.values(value).forEach(deepFreeze);\n    return Object.freeze(value);\n  };\n\n  window.CaatuuCourse = deepFreeze(${objectSource});\n})();\n`;
}

export function generateCourseProfileSource(course, catalogCourses = [course]) {
  return serializeCourseProfileSource(generateCourseProfileObject(course, catalogCourses));
}

export function evaluateCourseProfile(source, filename = "course-profile.js") {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename });
  if (!isObject(context.window.CaatuuCourse)) {
    throw new CourseContractError([{ code: "view.profile", message: `${filename} did not define window.CaatuuCourse.` }]);
  }
  return context.window.CaatuuCourse;
}

export async function checkLauncherView(loaded, launcherPath = "apps/launcher/static/languages.json") {
  const expected = await generateLauncherRegistry(loaded);
  const actual = JSON.parse(await readFile(path.resolve(loaded.repoRoot, launcherPath), "utf8"));
  if (!isDeepStrictEqual(actual, expected)) {
    throw new CourseContractError([{ code: "view.launcher", message: `${launcherPath} does not match the active course manifests.` }]);
  }
}

export async function checkCourseSelectorAssetView(
  loaded,
  assetCatalogPath = "apps/language-runtime/app-assets.json"
) {
  const catalog = JSON.parse(await readFile(path.resolve(loaded.repoRoot, assetCatalogPath), "utf8"));
  const assets = Array.isArray(catalog?.assets) ? catalog.assets : [];
  const byOutput = new Map(assets.map((asset) => [asset?.output, asset]));
  const issues = [];
  for (const mapping of generateCourseSelectorAssetMappings(loaded.courses)) {
    const actual = byOutput.get(mapping.output);
    if (!actual) {
      issues.push({ code: "view.selector-assets", message: `${assetCatalogPath} is missing ${mapping.output} for ${mapping.courseId}.` });
    } else if (actual.source !== mapping.source) {
      issues.push({ code: "view.selector-assets", message: `${assetCatalogPath} maps ${mapping.output} from ${actual.source} instead of ${mapping.source}.` });
    }
  }
  if (issues.length > 0) throw new CourseContractError(issues);
}

export async function checkCourseProfileView(loaded, courseId) {
  const record = loaded.courses.find(({ course }) => course.id === courseId);
  if (!record) throw new CourseContractError([{ code: "view.profile", message: `Unknown course ID ${courseId}.` }]);
  const resource = record.course.resources.courseProfile;
  if (!resource || resource.state !== "present") {
    throw new CourseContractError([{ code: "view.profile", message: `${courseId} has no present courseProfile resource to check.` }]);
  }
  const source = await readFile(path.resolve(loaded.repoRoot, resource.path), "utf8");
  const actual = evaluateCourseProfile(source, resource.path);
  const expected = generateCourseProfileObject(record.course, loaded.courses);
  const plainActual = JSON.parse(JSON.stringify(actual));
  if (!isDeepStrictEqual(plainActual, expected)) {
    throw new CourseContractError([{ code: "view.profile", message: `${resource.path} does not match ${courseId}'s course manifest.` }]);
  }
}

export async function checkGeneratedViews(loaded) {
  await checkLauncherView(loaded);
  await checkCourseSelectorAssetView(loaded);
  for (const { course } of loaded.courses) {
    if (course.resources?.courseProfile?.state === "present") {
      await checkCourseProfileView(loaded, course.id);
    }
  }
}
