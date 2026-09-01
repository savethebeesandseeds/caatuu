import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";

import { loadAndValidateLanguageContent } from "../../language-content/lib/content-contract.mjs";

export const COURSE_SCHEMA_VERSION = 1;
export const DEFAULT_CATALOG_PATH = "apps/languages/catalog.json";
export const CANONICAL_BROWSER_APP_ENTRY_PATH = "apps/language-runtime/static/app/index.html";

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COURSE_SCHEMA_PATH = "tools/language-packs/schemas/course-pack.v1.schema.json";
const CATALOG_SCHEMA_PATH = "tools/language-packs/schemas/catalog.v1.schema.json";
const COURSE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROUTE_PREFIX_PATTERN = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
const GAME_IDS = [
  "campaign",
  "verb-lab",
  "word-net",
  "conjugation-comet",
  "case-cosmos",
  "agreement-aurora",
  "naturalization-nucleus",
  "memory-moon"
];
const UPCOMING_GAME_IDS = GAME_IDS.filter((gameId) => gameId !== "campaign");
const GAME_REQUIREMENTS = Object.freeze({
  "verb-lab": Object.freeze({ route: "verbNebula", capabilities: [], linguisticFeatures: [] }),
  "word-net": Object.freeze({ route: "wordWorld", capabilities: ["wordWorld"], linguisticFeatures: [] }),
  "conjugation-comet": Object.freeze({ route: "conjugationComet", capabilities: ["conjugationComet"], linguisticFeatures: ["verb-conjugation"] }),
  "case-cosmos": Object.freeze({ route: "caseCosmos", capabilities: [], linguisticFeatures: ["grammatical-case"] }),
  "agreement-aurora": Object.freeze({ route: "agreementAurora", capabilities: [], linguisticFeatures: ["grammatical-agreement"] }),
  "naturalization-nucleus": Object.freeze({
    route: "naturalizationNucleus",
    capabilities: [],
    linguisticFeatures: ["hanzi-pinyin"],
    resources: Object.freeze([
      Object.freeze({
        name: "naturalizationNucleusCatalog",
        kind: "file",
        scope: "course",
        state: "present"
      })
    ])
  }),
  "memory-moon": Object.freeze({ route: "memoryMoon", capabilities: ["memory"], linguisticFeatures: [] })
});
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

function isBcp47ish(value) {
  if (typeof value !== "string" || !LANGUAGE_TAG_PATTERN.test(value)) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
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
      if (typeof route !== "string" || route.includes("\\") || route.split("/").includes("..")) {
        issues.push({ code: "route.invalid", message: `${courseId}.routes.${key} is not a safe course-relative route.` });
      }
    }
    if (course.routes.languageSelection !== "/") {
      issues.push({ code: "route.invalid", message: `${courseId}.routes.languageSelection must be /.` });
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
    ["contract", "concepts", "realizations"],
    ["contract", "concepts", "realizations"],
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
      if (publication.concepts !== null || publication.realizations !== null) {
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
    if (addUnknownAndMissingKeys(issues, browser, ["enabled", "entryPath", "backend"], ["enabled", "entryPath", "backend"], `${courseId}.platforms.browser`, "manifest.shape")) {
      if (typeof browser.enabled !== "boolean") issues.push({ code: "manifest.shape", message: `${courseId}.platforms.browser.enabled must be boolean.` });
      if (!['static', 'czech-dictionary'].includes(browser.backend)) issues.push({ code: "manifest.shape", message: `${courseId}.platforms.browser.backend is unsupported.` });
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
      if (!addUnknownAndMissingKeys(issues, resource, ["kind", "path", "scope", "state"], ["kind", "path", "scope", "state"], label, "manifest.shape")) continue;
      if (!["file", "directory"].includes(resource.kind)) issues.push({ code: "manifest.shape", message: `${label}.kind must be file or directory.` });
      if (!isSafeRepositoryPath(resource.path)) issues.push({ code: "path.invalid", message: `${label}.path is not a confined repository-relative path.` });
      if (!["course", "shared"].includes(resource.scope)) issues.push({ code: "manifest.shape", message: `${label}.scope must be course or shared.` });
      if (!["present", "planned"].includes(resource.state)) issues.push({ code: "manifest.shape", message: `${label}.state must be present or planned.` });
    }
  }
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

function validateSourceLanguagePresentation(courses, issues) {
  const firstByLanguageId = new Map();
  for (const { course } of courses) {
    const language = course?.sourceLanguage;
    const languageId = typeof language?.id === "string" ? language.id : "";
    if (!languageId) continue;
    const presentation = Object.fromEntries(
      LANGUAGE_PRESENTATION_KEYS.map((key) => [key, language[key]])
    );
    const first = firstByLanguageId.get(languageId);
    if (!first) {
      firstByLanguageId.set(languageId, { courseId: course.id, presentation });
      continue;
    }
    if (!isDeepStrictEqual(first.presentation, presentation)) {
      issues.push({
        code: "language.presentation",
        message: `Source language ${languageId} must use identical presentation metadata in ${first.courseId} and ${course.id}.`
      });
    }
  }
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
  if (capabilities.conjugationComet && !capabilities.verbs) issues.push({ code: "capability.contradiction", message: `${course.id} conjugationComet requires verbs.` });

  if (capabilities.embeddings) requireResource("embeddingCatalog", "embeddings are enabled");
  if (capabilities.dictionary) requireResource("dictionaryCatalog", "dictionary is enabled");
  if (capabilities.llm || capabilities.generation || capabilities.offlineModels) requireResource("modelCatalog", "LLM/model capabilities are enabled");
  if (capabilities.wordWorld) requireResource("wordWorldManifest", "wordWorld is enabled");
  if (course.platforms?.android?.enabled) {
    requireResource("androidAssetCatalog", "Android is enabled");
    if (resources.androidAssetCatalog?.state !== "present") {
      issues.push({ code: "platform.contradiction", message: `${course.id} enabled Android platform requires a present androidAssetCatalog.` });
    }
  }

  if (!capabilities.embeddings && resources.embeddingCatalog) issues.push({ code: "capability.contradiction", message: `${course.id} declares an embedding catalog while embeddings are disabled.` });
  if (!capabilities.dictionary && resources.dictionaryCatalog) issues.push({ code: "capability.contradiction", message: `${course.id} declares a dictionary catalog while dictionary is disabled.` });
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
    }
    if (typeof course.routes?.[requirement.route] !== "string" || !course.routes[requirement.route].trim()) {
      issues.push({
        code: "game.route",
        message: `${course.id}.games enables ${gameId} but routes.${requirement.route} is missing.`
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
  if (declaredGames.has("campaign")) {
    const playableGames = [...declaredGames].filter((gameId) => gameId !== "campaign");
    if (playableGames.length < 2) {
      issues.push({ code: "game.campaign", message: `${course.id}.games campaign requires at least two other enabled games.` });
    }
    if (typeof course.routes?.campaign !== "string" || !course.routes.campaign.trim()) {
      issues.push({ code: "game.route", message: `${course.id}.games enables campaign but routes.campaign is missing.` });
    }
  }

  const backend = course.platforms?.browser?.backend;
  if (backend === "czech-dictionary" && !capabilities.dictionary) {
    issues.push({ code: "backend.contradiction", message: `${course.id} czech-dictionary backend requires dictionary capability.` });
  }
}

function validateBrowserDelivery(record, issues) {
  const { course } = record;
  const browser = course.platforms?.browser;
  if (!isObject(browser) || typeof browser.enabled !== "boolean") return;

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

async function validateResourcePaths(record, repoRoot, issues, checkExistence) {
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
      if (resource.scope === "course") {
        const realCourseRoot = await realpath(courseRoot);
        if (!isInside(realCourseRoot, realResource)) issues.push({ code: "path.scope", message: `${course.id}.resources.${name} resolves outside its course root.` });
      } else if (resource.scope === "shared") {
        let insideRealSharedRoot = false;
        for (const sharedRoot of SHARED_RESOURCE_ROOTS) {
          try {
            const realSharedRoot = await realpath(path.resolve(repoRoot, sharedRoot));
            if (isInside(realSharedRoot, realResource)) insideRealSharedRoot = true;
          } catch {
            // A configured shared root may not exist in this repository revision.
          }
        }
        if (!insideRealSharedRoot) issues.push({ code: "path.scope", message: `${course.id}.resources.${name} resolves outside approved shared roots.` });
      }
    } catch (error) {
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
        || publication.concepts !== null || publication.realizations !== null) {
      issues.push({ code: "publication.legacy", message: `${course.id} cannot use the Czech-only legacy publication exception.` });
    }
    return;
  }
  if (publication.contract !== "language-content-v1") {
    issues.push({ code: "publication.contract", message: `${course.id}.publication.contract is unsupported.` });
    return;
  }
  const expectedRealizationRoot = `apps/languages/${course.directoryName}/content/`;
  if (!isSafeRepositoryPath(publication.concepts)
      || !/^apps\/languages\/shared\/english-concepts\/[a-z0-9][a-z0-9.-]*\.json$/u.test(publication.concepts)
      || !isSafeRepositoryPath(publication.realizations)
      || !publication.realizations.startsWith(expectedRealizationRoot)
      || !publication.realizations.endsWith(".json")) {
    issues.push({ code: "publication.path", message: `${course.id} publication evidence paths are invalid.` });
    return;
  }

  try {
    const content = await loadAndValidateLanguageContent({
      repoRoot,
      conceptsPath: publication.concepts,
      realizationsPath: publication.realizations,
      release,
      requireNativeReview
    });
    if (content.concepts.language !== course.sourceLanguage?.id) {
      issues.push({
        code: "publication.language",
        message: `${course.id} publication source language ${content.concepts.language} does not match ${course.sourceLanguage?.id}.`
      });
    }
    if (content.realizations.courseId !== course.id) {
      issues.push({
        code: "publication.course",
        message: `${course.id} publication realization catalog belongs to ${content.realizations.courseId}.`
      });
    }
    if (content.realizations.targetLanguage?.languageTag !== course.targetLanguage?.locale) {
      issues.push({
        code: "publication.language",
        message: `${course.id} publication target language ${content.realizations.targetLanguage?.languageTag} does not match ${course.targetLanguage?.locale}.`
      });
    }
    if (content.realizations.targetLanguage?.speechLocale !== course.targetLanguage?.speechLocale) {
      issues.push({
        code: "publication.language",
        message: `${course.id} publication speech locale ${content.realizations.targetLanguage?.speechLocale} does not match ${course.targetLanguage?.speechLocale}.`
      });
    }
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
  const catalog = JSON.parse(await readFile(catalogAbsolutePath, "utf8"));
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
      course = JSON.parse(await readFile(manifestAbsolutePath, "utf8"));
    } catch (error) {
      throw new CourseContractError([{ code: "manifest.read", message: `Cannot read ${entry.manifest}: ${error.message}` }]);
    }
    courses.push({ course, catalogEntry: entry, manifestPath: entry.manifest });
  }
  return { catalog, catalogPath, courses, repoRoot: resolvedRepoRoot };
}

export async function validateCourseCatalog(loaded, { checkExistence = true } = {}) {
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
    validateBrowserDelivery(record, issues);
  }

  addDuplicateIssues(issues, courses, ({ id }) => id, "collision.id", "Course ID");
  addDuplicateIssues(issues, courses, ({ directoryName }) => directoryName, "collision.directory", "Course directory");
  addDuplicateIssues(issues, courses, ({ storage }) => storage?.namespace, "collision.namespace", "Storage namespace");
  addDuplicateIssues(issues, courses, ({ cache }) => cache?.prefix, "collision.namespace", "Cache prefix");
  addDuplicateIssues(issues, courses, ({ cache }) => cache?.setupFallback, "collision.namespace", "Setup cache");
  validateSourceLanguagePresentation(courses, issues);
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
    await validateResourcePaths(record, repoRoot, issues, checkExistence);
    await validatePublicationEvidence(record, repoRoot, issues);
  }

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
    await validatePublicationEvidence(record, loaded.repoRoot, publicationIssues, {
      release: true,
      requireNativeReview: true
    });
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
  return {
    schemaVersion: COURSE_SCHEMA_VERSION,
    defaultLanguage: loaded.catalog.defaultCourseId,
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

export function generateCourseProfileObject(course, catalogCourses = [course]) {
  const staticRoot = String(course.resources?.staticRoot?.path || "").replace(/\/+$/u, "");
  const adapterPath = String(course.resources?.languageAdapter?.path || "");
  const adapterModule = staticRoot && adapterPath.startsWith(`${staticRoot}/`)
    ? adapterPath.slice(staticRoot.length + 1)
    : "";
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
    courseSelector: generateCourseSelectorCatalog(catalogCourses),
    routes: { ...course.routes },
    storage: { ...course.storage },
    cache: { ...course.cache },
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, course.capabilities[key]])),
    skillCompass: course.skillCompass ? JSON.parse(JSON.stringify(course.skillCompass)) : null,
    platforms: JSON.parse(JSON.stringify(course.platforms))
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

export function generateCourseProfileSource(course, catalogCourses = [course]) {
  const objectSource = serializeJavaScriptValue(generateCourseProfileObject(course, catalogCourses), 2).replace(/^  /, "");
  return `(() => {\n  const deepFreeze = (value) => {\n    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;\n    Object.values(value).forEach(deepFreeze);\n    return Object.freeze(value);\n  };\n\n  window.CaatuuCourse = deepFreeze(${objectSource});\n})();\n`;
}

function evaluateCourseProfile(source, filename) {
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
