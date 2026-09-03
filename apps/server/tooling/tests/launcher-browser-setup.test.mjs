import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);

const [index, launcher, staticLauncher, staticBuilder, styles, registry] = await Promise.all([
  readFile(new URL("apps/launcher/static/index.html", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/static/launcher.js", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/tooling/templates/launcher-static.js", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/tooling/build-static-site.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/static/app.css", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/static/languages.json", repoRoot), "utf8").then(JSON.parse)
]);

test("launcher keeps release-active languages separate from browser setup choices", () => {
  assert.deepEqual(registry.languages.map(({ id, status }) => ({ id, status })), [
    { id: "cz", status: "active" }
  ]);
  assert.equal(registry.browserSetup.schemaVersion, 1);
  assert.equal(registry.browserSetup.entryPath, "/cz/index.html");
  assert.deepEqual(
    registry.browserSetup.courses.map(({ id, status, targetLanguage }) => ({
      id,
      status,
      label: targetLanguage.label,
      nativeLabel: targetLanguage.nativeLabel,
      shortCode: targetLanguage.shortCode
    })),
    [
      { id: "cz", status: "active", label: "Czech", nativeLabel: "Čeština", shortCode: "CZ" },
      { id: "zh", status: "development", label: "Mandarin", nativeLabel: "中文", shortCode: "ZH" }
    ]
  );
});

test("launcher fallback advertises both browser courses and one online action", () => {
  assert.match(index, /aria-label="Czech \(Čeština\)"[\s\S]*?language-choice-code">CZ<\/span>/u);
  assert.match(index, /aria-label="Mandarin \(中文\), Preview"[\s\S]*?language-choice-code">ZH<\/span>[\s\S]*?language-choice-status">Preview<\/span>/u);
  assert.match(index, /china_flag\.png\?caatuu_asset=11/u);
  assert.match(index, /aria-label="Continue online in the browser"[\s\S]*?<b>Continue online<\/b>/u);
  assert.match(styles, /\.language-choice-status\s*\{/u);
  assert.doesNotMatch(index, /Continue with Czech/u);
});

test("server and static launchers preserve the generic form entry after registry load", () => {
  for (const [label, source] of [
    ["server launcher", launcher],
    ["static launcher", staticLauncher]
  ]) {
    assert.match(source, /registry\?\.browserSetup\?\.entryPath/u, `${label} should use the catalog-derived setup entry`);
    assert.match(source, /label\.textContent = "Continue online"/u, `${label} should keep the online browser CTA`);
    assert.match(source, /setAttribute\("aria-label", "Continue online in the browser"\)/u, `${label} should retain the descriptive accessible name`);
    assert.match(source, /\["active", "development"\]\.includes\(courseRecord\?\.status\)/u, `${label} should disclose active and development browser courses`);
    assert.match(source, /status\.textContent = "Preview"/u, `${label} should visibly label development courses`);
    assert.match(source, /versionedLauncherAsset\(language\.flagSrc\)/u, `${label} should bypass stale launcher image caches`);
    assert.match(source, /createElement\("span"\)/u, `${label} should render informational course rows`);
    assert.doesNotMatch(source, /Continue with \$\{language\.label\}|createElement\("button"\)|data\.languageChoice/u, `${label} must not duplicate target selection on the launcher`);
  }
});

test("static publication derives browser-course flag files from the launcher catalog", () => {
  assert.match(staticBuilder, /function launcherIconPaths\(launcherStaticDir\)/u);
  assert.match(staticBuilder, /courseRecord\?\.targetLanguage\?\.flagSrc/u);
  assert.match(staticBuilder, /for \(const path of launcherIconPaths\(launcherDir\)\)/u);
  assert.match(staticBuilder, /expected\.add\(path\)/u);
});
