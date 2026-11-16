import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(modulePath), "../../..");
const keyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
function key(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, keyPattern, `${label} is invalid`);
  return value;
}
function locale(value, label) {
  assert.equal(typeof value, "string", `${label} must be a locale`);
  const canonical = Intl.getCanonicalLocales(value)[0];
  assert.equal(canonical, value, `${label} must be canonical BCP47`);
  return canonical;
}

export function buildReportingCourseCatalog({ workspaceRoot = defaultWorkspaceRoot, courses } = {}) {
  const root = realpathSync(workspaceRoot);
  const read = path => {
    assert.equal(typeof path, "string");
    assert.ok(!isAbsolute(path) && !path.includes("\\") && path.split("/").every(part => part && part !== "." && part !== ".."), "Reporting source path must be confined");
    const file = realpathSync(resolve(root, path));
    assert.ok(file.startsWith(`${root}${sep}`), "Reporting source must stay inside the workspace");
    return JSON.parse(readFileSync(file, "utf8"));
  };
  const selected = courses ?? read("apps/languages/catalog.json").courses.map(entry => {
    const course = read(entry.manifest);
    assert.equal(course.id, entry.id, "Reporting catalog ID must match its manifest");
    return course;
  });
  assert.ok(Array.isArray(selected), "Reporting courses must be an array");
  const seen = new Set();
  const records = selected.map(record => record.course ?? record)
    .filter(course => course.platforms?.browser?.enabled === true && course.platforms.browser.pagesEnabled === true)
    .map(course => {
      const courseId = key(course.id, "Reporting course ID");
      assert.ok(!seen.has(courseId), `Duplicate reporting course ${courseId}`);
      seen.add(courseId);
      const sourceLanguage = locale(course.sourceLanguage?.locale, `${courseId} source language`);
      const targetLanguage = locale(course.targetLanguage?.locale, `${courseId} target language`);
      const provider = course.resources?.dictionaryProvider;
      let dictionary = null;
      if (provider?.state === "present" && course.capabilities?.dictionary === true) {
        assert.equal(provider.kind, "file", "Dictionary reporting requires a declared provider module");
        const providerId = key(provider.providerId, `${courseId} dictionary provider`);
        const dictionaryKey = key(provider.gapReporting?.dictionaryKey, `${courseId} dictionary key`);
        const dictionaryDirection = key(provider.gapReporting?.dictionaryDirection, `${courseId} dictionary direction`);
        const catalogResource = course.resources?.dictionaryCatalog;
        assert.equal(catalogResource?.state, "present", `${courseId} dictionary catalog must be present`);
        const catalog = read(catalogResource.path);
        const active = catalog.dictionaries?.find(entry => entry.key === dictionaryKey && entry.status === "active");
        assert.ok(active, `${courseId} reporting dictionary must select an active catalog entry`);
        assert.equal(active.direction, dictionaryDirection, `${courseId} dictionary reporting direction must match its catalog`);
        assert.equal(active.lookupLanguage, course.targetLanguage.id, `${courseId} dictionary lookup must match the target`);
        assert.equal(locale(active.lookupLanguageTag, "Dictionary lookup locale"), targetLanguage);
        dictionary = { providerId, dictionaryKey, dictionaryDirection };
      }
      return { courseId, sourceLanguage, targetLanguage, sentenceReports: true, dictionary };
    });
  return { schemaVersion: 2, courses: records };
}

export function reportingCourseCatalogSource(catalog) {
  return `// Generated from course manifests by tooling/course-catalog.mjs.\nexport const REPORTING_COURSE_CATALOG = Object.freeze(${JSON.stringify(catalog, null, 2)});\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const path = resolve(defaultWorkspaceRoot, "apps/reporting-worker/src/course-catalog.mjs");
  const source = reportingCourseCatalogSource(buildReportingCourseCatalog());
  if (process.argv.includes("--check")) assert.equal(readFileSync(path, "utf8"), source, "Reporting course catalog is stale; regenerate it before release");
  else writeFileSync(path, source);
}
