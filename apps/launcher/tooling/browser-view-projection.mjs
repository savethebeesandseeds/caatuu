import assert from "node:assert/strict";
import { evaluateCourseProfile, serializeCourseProfileSource } from "../../../tools/language-packs/lib/course-contract.mjs";
import { setHtmlAttribute, transformHtmlElement } from "../../android/tooling/build-product-assets.mjs";

function projectRecordsById(records, expectedIds, label) {
  assert.ok(Array.isArray(records), `${label} must be an array`);
  const byId = new Map();
  for (const record of records) {
    const id = String(record?.id || "");
    assert.ok(id, `${label} contains a record without an ID`);
    assert.ok(!byId.has(id), `${label} repeats course ${id}`);
    byId.set(id, record);
  }
  return expectedIds.map((id) => {
    const record = byId.get(id);
    assert.ok(record, `${label} is missing Pages-enabled course ${id}`);
    return record;
  });
}

function pagesCourseIds(languagePlan) {
  assert.ok(Array.isArray(languagePlan?.browserCourses), "Pages language plan has no browser courses");
  const ids = languagePlan.browserCourses.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "Pages language plan repeats a browser course");
  return ids;
}

export function projectPagesLanguageRegistry({ registry, languagePlan }) {
  assert.ok(registry && typeof registry === "object" && !Array.isArray(registry), "Pages language registry must be an object");
  assert.equal(registry.browserSetup?.schemaVersion, 1, "Pages browser setup must use schema version 1");
  const projected = structuredClone(registry);
  if (languagePlan.defaultCourseId) projected.defaultLanguage = languagePlan.defaultCourseId;
  const courseIds = pagesCourseIds(languagePlan);
  projected.browserSetup.entryPath = languagePlan.defaultCourse.entryPath;
  projected.browserSetup.courses = projectRecordsById(
    projected.browserSetup.courses,
    courseIds,
    "Pages browser setup",
  );
  projected.languages = projectRecordsById(
    projected.languages,
    courseIds,
    "Pages language registry",
  );
  return projected;
}

export function launcherFallbackCourseIds(source, label = "launcher fallback") {
  const lists = [...source.matchAll(/<ul\b(?=[^>]*\bclass="language-list")(?=[^>]*\bdata-language-list(?:\s|=|>))[^>]*>/gu)];
  assert.equal(lists.length, 1, `${label} list anchor changed`);
  const open = lists[0][0];
  const start = lists[0].index + open.length;
  const end = source.indexOf("</ul>", start);
  assert.ok(end > start, `${label} list has no closing tag`);
  const body = source.slice(start, end);
  const rowPattern = /<li\b(?=[^>]*\bdata-language-id="([^"]+)")[\s\S]*?<\/li>/gu;
  const rows = [...body.matchAll(rowPattern)];
  const ids = rows.map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${label} repeats a course row`);
  return { body, end, ids, open, rowPattern, rows, start };
}

export function projectPagesLauncherFallback({ source, languagePlan }) {
  assert.equal(typeof source, "string", "Pages launcher fallback source must be text");
  const expectedIds = pagesCourseIds(languagePlan);
  const expected = new Set(expectedIds);
  const parsed = launcherFallbackCourseIds(source);
  for (const id of expectedIds) {
    assert.ok(parsed.ids.includes(id), `Launcher fallback is missing Pages-enabled course ${id}`);
  }
  const body = parsed.body.replace(parsed.rowPattern, (row, id) => expected.has(id) ? row : "");
  let projected = `${source.slice(0, parsed.start)}${body}${source.slice(parsed.end)}`;
  if (languagePlan.defaultCourse?.entryPath) {
    projected = projected.replace(/<a\b(?=[^>]*\bdata-browser-entry(?:\s|=|>))[^>]*>/gu,
      (opening) => setHtmlAttribute(opening, "href", languagePlan.defaultCourse.entryPath));
  }
  assert.deepEqual(
    launcherFallbackCourseIds(projected, "projected launcher fallback").ids,
    expectedIds,
    "Projected launcher fallback must exactly match Pages course order",
  );
  return projected;
}

export function projectPagesCourseProfileSource({ source, languagePlan, courseId, label }) {
  const profile = JSON.parse(JSON.stringify(evaluateCourseProfile(source, label)));
  assert.equal(profile.id, courseId, `${label} belongs to the wrong course`);
  assert.equal(profile.courseSelector?.schemaVersion, 1, `${label} has an unsupported course selector`);
  profile.courseSelector.courses = projectRecordsById(
    profile.courseSelector.courses,
    pagesCourseIds(languagePlan),
    `${label} course selector`,
  );
  return serializeCourseProfileSource(profile);
}

export function projectBrowserGameFrames({ source, course }) {
  for (const [gameId, routeKey] of [
    ["memory-moon", "memoryMoon"], ["sound-quasar", "soundQuasar"],
    ["conjugation-comet", "conjugationComet"], ["case-cosmos", "caseCosmos"],
    ["grammar-gravity", "grammarGravity"],
  ]) {
    const enabled = course.games?.includes(gameId) === true;
    const route = course.routes?.[routeKey];
    if (enabled) assert.ok(typeof route === "string" && route, "Enabled game has no browser route: " + gameId);
    source = transformHtmlElement(source, "iframe", "data-embedded-game", gameId,
      (opening, content, closing) => {
        // Disabled course games retain their shared DOM controls but cannot
        // request another course's fallback document during static loading.
        const inactive = opening.replace(/\s(?:src|data-src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "");
        return (enabled ? setHtmlAttribute(inactive, "data-src", route) : inactive) + content + closing;
      });
  }
  return source;
}
