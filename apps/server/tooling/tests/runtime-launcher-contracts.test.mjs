import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { launcherCourseFallbackIssues, launcherEntryIssues } from "../runtime-launcher-contracts.mjs";

const registry = {
  browserSetup: {
    entryPath: "/first/index.html",
    courses: [
      { id: "first", status: "active", entryPath: "/first/index.html", targetLanguage: { flagSrc: "/assets/flags/first.png" } },
      { id: "second", status: "development", entryPath: "/second/index.html", targetLanguage: { flagSrc: "/assets/flags/second.png" } }
    ]
  }
};

function fixture(courses = registry.browserSetup.courses) {
  return `<!doctype html><html><head>
    <title>Caatuu — language journeys</title><meta name="description" content="Choose a course.">
    <script src="/launcher.js?v=release-anything" defer></script>
    </head><body><h1>A different welcome</h1>
    <a data-browser-entry href="/first/index.html">Learn online</a>
    <a data-android-download aria-disabled="true">Check app availability</a>
    <ul data-language-list>${courses.map((course) => `<li data-language-id="${course.id}" aria-label="${course.id}"${course.status === "development" ? ' data-course-status="development"' : ""}>
      <a class="language-choice" href="${course.entryPath}"><img class="flag-icon" src="${course.targetLanguage.flagSrc}?caatuu_asset=unrelated-revision" alt=""><strong>${course.id}</strong>
      ${course.status === "development" ? '<span class="language-choice-status">Development preview</span>' : ""}</a></li>`).join("")}</ul>
    <dialog data-course-dialog aria-labelledby="course-title">
      <h2 data-course-dialog-title id="course-title"></h2><img data-course-dialog-flag alt="">
      <a data-course-dialog-browser href="#courses">Browser</a>
      <a data-course-dialog-android aria-disabled="true">Android</a>
      <p data-course-dialog-status role="status"></p>
      <button data-course-dialog-close type="button" aria-label="Dismiss">×</button>
    </dialog></body></html>`;
}

test("the canonical launcher satisfies structural and generated-course contracts", async () => {
  const [html, generatedRegistry] = await Promise.all([
    readFile(new URL("../../../launcher/static/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../../launcher/static/languages.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  assert.deepEqual(launcherEntryIssues(html), []);
  assert.deepEqual(launcherCourseFallbackIssues(html, generatedRegistry), []);
});

test("copy, decorative art, cache revisions and attribute order do not define launcher behavior", () => {
  const html = fixture()
    .replace("language journeys", "Explore anything")
    .replace("A different welcome", "<span>Aprende idiomas</span>")
    .replace("Choose a course.", "Otra descripción.")
    .replace('<script src="/launcher.js?v=release-anything" defer>', "<script defer src='/launcher.js?v=next-build'>")
    .replace("<h1>", '<img src="/assets/a-new-illustration.png" alt=""><h1>');
  assert.deepEqual(launcherEntryIssues(html), []);
  assert.deepEqual(launcherCourseFallbackIssues(html, registry), []);
});

for (const [label, before, after, issue] of [
  ["missing brand", "Caatuu — language journeys", "Unrelated product", "title must identify"],
  ["empty heading", "A different welcome", " ", "heading must have text"],
  ["empty description", 'content="Choose a course."', 'content=" "', "description must have text"],
  ["script origin", "/launcher.js?v=release-anything", "https://another.invalid/launcher.js?v=release-anything", "same-origin"],
  ["unversioned script", "/launcher.js?v=release-anything", "/launcher.js", "cache revision"],
  ["async race", 'defer></script>', 'defer async></script>', "must defer"],
  ["early script", ' defer></script>', '></script>', "must defer"],
  ["foreign browser entry", 'data-browser-entry href="/first/index.html"', 'data-browser-entry href="https://another.invalid/first/index.html"', "same-origin link"],
  ["unvalidated download", 'data-android-download aria-disabled="true"', 'data-android-download href="/android/unvalidated.apk"', "until its channel is validated"],
  ["missing list", "data-language-list", "data-other-list", "data-language-list"],
  ["missing dialog", "data-course-dialog aria-labelledby", "data-other-dialog aria-labelledby", "data-course-dialog"],
  ["missing close control", "data-course-dialog-close", "data-other-close", "data-course-dialog-close"],
  ["submit close control", 'type="button" aria-label="Dismiss"', 'type="submit" aria-label="Dismiss"', "non-submit button"],
  ["unlabelled dialog", 'aria-labelledby="course-title"', 'aria-labelledby="absent-title"', "labelled by its title"],
  ["early dialog download", 'data-course-dialog-android aria-disabled="true"', 'data-course-dialog-android href="/android/unvalidated.apk"', "wait for a validated channel"]
]) {
  test(`launcher entry detects ${label}`, () => {
    const html = fixture();
    assert.notEqual(html.replace(before, after), html, "fixture mutation must take effect");
    assert.ok(launcherEntryIssues(html.replace(before, after)).some((message) => message.includes(issue)));
  });
}

test("comments cannot supply missing executable or dialog hooks", () => {
  const html = fixture().replace('<script src="/launcher.js?v=release-anything" defer></script>', '<!-- <script src="/launcher.js?v=release-anything" defer></script> -->');
  assert.ok(launcherEntryIssues(html).some((issue) => issue.includes("launcher script must appear exactly once")));
});

test("the generated registry, rather than course IDs or a fixed count, owns fallback coverage", () => {
  const expanded = structuredClone(registry);
  expanded.browserSetup.courses.push({ id: "future", status: "development", entryPath: "/future/index.html", targetLanguage: { flagSrc: "/assets/flags/future.png" } });
  assert.deepEqual(launcherCourseFallbackIssues(fixture(expanded.browserSetup.courses), expanded), []);
  assert.ok(launcherCourseFallbackIssues(fixture(), expanded).some((issue) => issue.includes("course order")));
  assert.ok(launcherCourseFallbackIssues(fixture([...registry.browserSetup.courses].reverse()), registry).some((issue) => issue.includes("course order")));
  assert.ok(launcherCourseFallbackIssues(fixture([...registry.browserSetup.courses, registry.browserSetup.courses[0]]), registry).some((issue) => issue.includes("course order")));
});

for (const [label, before, after, issue] of [
  ["wrong default route", 'data-browser-entry href="/first/index.html"', 'data-browser-entry href="/second/index.html"', "default setup entry"],
  ["wrong course route", 'class="language-choice" href="/second/index.html"', 'class="language-choice" href="/first/index.html"', "declared course entry"],
  ["foreign flag", "/assets/flags/second.png?", "https://another.invalid/assets/flags/second.png?", "generated target-language flag"],
  ["wrong course flag", "/assets/flags/second.png?", "/assets/flags/first.png?", "generated target-language flag"],
  ["preview promotion", 'data-course-status="development"', 'data-course-status="active"', "retain registry status"],
  ["missing preview badge", 'class="language-choice-status"', 'class="removed-status"', "visibly disclose"],
  ["hidden preview badge", 'class="language-choice-status"', 'class="language-choice-status" hidden', "visibly disclose"],
  ["empty preview badge", "Development preview", " ", "visibly disclose"]
]) {
  test(`launcher fallback detects ${label}`, () => {
    const html = fixture();
    assert.notEqual(html.replace(before, after), html, "fixture mutation must take effect");
    assert.ok(launcherCourseFallbackIssues(html.replace(before, after), registry).some((message) => message.includes(issue)));
  });
}

test("a declared active course cannot inherit a preview badge", () => {
  const promoted = structuredClone(registry);
  promoted.browserSetup.courses[1].status = "active";
  const html = fixture().replace('data-course-status="development"', 'data-course-status="active"');
  assert.ok(launcherCourseFallbackIssues(html, promoted).some((issue) => issue.includes("must not be labelled")));
});
