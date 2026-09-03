import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../../", import.meta.url);
const [czechProfileSource, mandarinProfileSource, launcherRegistry, czechSetup, mandarinSetup, appAssets] = await Promise.all([
  readFile(new URL("apps/languages/czech/static/source/shared/course-profile.js", repoRoot), "utf8"),
  readFile(new URL("apps/languages/mandarin-simplified/static/source/shared/course-profile.js", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/static/languages.json", repoRoot), "utf8").then(JSON.parse),
  readFile(new URL("apps/languages/czech/static/setup-assets.json", repoRoot), "utf8").then(JSON.parse),
  readFile(new URL("apps/languages/mandarin-simplified/static/setup-assets.json", repoRoot), "utf8").then(JSON.parse),
  readFile(new URL("apps/language-runtime/app-assets.json", repoRoot), "utf8").then(JSON.parse)
]);

function evaluateProfile(source, filename) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename });
  return JSON.parse(JSON.stringify(context.window.CaatuuCourse));
}

const czechProfile = evaluateProfile(czechProfileSource, "czech-course-profile.js");
const mandarinProfile = evaluateProfile(mandarinProfileSource, "mandarin-course-profile.js");

test("both courses receive one catalog-derived browser course projection", () => {
  assert.deepEqual(czechProfile.courseSelector, mandarinProfile.courseSelector);
  assert.deepEqual(
    czechProfile.courseSelector.courses.map(({ id, status, entryPath }) => ({ id, status, entryPath })),
    [
      { id: "cz", status: "active", entryPath: "/cz/index.html" },
      { id: "zh", status: "development", entryPath: "/zh/index.html" }
    ]
  );
  assert.deepEqual(
    czechProfile.courseSelector.courses.map(({ sourceLanguage }) => sourceLanguage),
    [
      {
        id: "en",
        label: "English",
        nativeLabel: "English",
        shortCode: "EN",
        locale: "en",
        direction: "ltr",
        flagClass: "en-flag",
        flagSrc: "/assets/icons/english_flag.png"
      },
      {
        id: "en",
        label: "English",
        nativeLabel: "English",
        shortCode: "EN",
        locale: "en",
        direction: "ltr",
        flagClass: "en-flag",
        flagSrc: "/assets/icons/english_flag.png"
      }
    ]
  );
  assert.deepEqual(
    czechProfile.courseSelector.courses.map(({ targetLanguage }) => targetLanguage.shortCode),
    ["CZ", "ZH"]
  );
  assert.deepEqual(launcherRegistry.languages.map(({ id }) => id), ["cz"], "the public launcher remains active-only");
});

test("every shared selector flag is cached by every course and packaged by the shared app", () => {
  const flagUrls = new Set(czechProfile.courseSelector.courses.flatMap(({ sourceLanguage, targetLanguage }) => [
    sourceLanguage.flagSrc,
    targetLanguage.flagSrc
  ]));
  const sharedOutputs = new Set(appAssets.assets.map(({ output }) => output));
  for (const flagUrl of flagUrls) {
    assert.ok(czechSetup.offline.assets.includes(flagUrl), `Czech offline cache must include ${flagUrl}`);
    assert.ok(mandarinSetup.offline.assets.includes(flagUrl), `Mandarin offline cache must include ${flagUrl}`);
    assert.ok(sharedOutputs.has(flagUrl.slice(1)), `shared Android assets must include ${flagUrl}`);
  }
});
