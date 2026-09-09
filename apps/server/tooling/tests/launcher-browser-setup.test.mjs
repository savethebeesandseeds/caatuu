import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("apps/languages/catalog.json", repoRoot), "utf8"));
const declaredCourses = await Promise.all(catalog.courses.map(({ manifest }) =>
  readFile(new URL(manifest, repoRoot), "utf8").then(JSON.parse)));
const browserCourses = declaredCourses.filter(course =>
  ["active", "development"].includes(course.status) && course.platforms.browser.enabled);

const [index, launcher, staticLauncher, staticBuilder, styles, registry] = await Promise.all([
  readFile(new URL("apps/launcher/static/index.html", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/static/launcher.js", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/tooling/templates/launcher-static.js", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/tooling/build-static-site.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/static/app.css", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/static/languages.json", repoRoot), "utf8").then(JSON.parse)
]);

test("launcher exposes supported browser courses while preserving preview status", () => {
  assert.deepEqual(registry.languages.map(({ id, status }) => ({ id, status })),
    registry.browserSetup.courses.map(({ id, status }) => ({ id, status })));
  assert.equal(registry.browserSetup.schemaVersion, 1);
  assert.equal(registry.browserSetup.entryPath,
    browserCourses.find(course => course.id === catalog.defaultCourseId).platforms.browser.entryPath);
  assert.deepEqual(
    registry.browserSetup.courses.map(({ id, status, targetLanguage }) => ({
      id,
      status,
      label: targetLanguage.label,
      nativeLabel: targetLanguage.nativeLabel,
      shortCode: targetLanguage.shortCode
    })),
    browserCourses.map(({ id, status, targetLanguage }) => ({
      id,
      status,
      label: targetLanguage.label,
      nativeLabel: targetLanguage.nativeLabel,
      shortCode: targetLanguage.shortCode
    }))
  );
});

test("launcher keeps all fallback courses and labels its independent page language", () => {
  assert.match(index, /aria-label="Czech \(Čeština\)"[\s\S]*?language-choice-code">CZ<\/span>/u);
  assert.match(index, /aria-label="Mandarin \(中文\), Preview"[\s\S]*?language-choice-code">ZH<\/span>[\s\S]*?language-choice-status">Preview<\/span>/u);
  assert.match(index, /aria-label="Spanish \(Español\), Preview"[\s\S]*?language-choice-code">ES<\/span>[\s\S]*?language-choice-status">Preview<\/span>/u);
  assert.match(index, /china_flag\.png\?caatuu_asset=11/u);
  assert.match(index, /spain_flag\.png\?caatuu_asset=11/u);
  assert.match(index, /aria-label="Continue online in the browser"[\s\S]*?<b data-i18n="launcher\.continue">Continue online<\/b>/u);
  assert.match(index, /data-language-control hidden/u);
  assert.match(index, /<select data-page-language[^>]*data-i18n-aria-label="launcher\.language"/u);
  for (const course of registry.browserSetup.courses) assert.ok(index.includes(`data-language-id="${course.id}"`));
  assert.match(styles, /\.language-choice-status\s*\{/u);
  assert.doesNotMatch(index, /Continue with Czech/u);
});

test("server and static launchers preserve the generic form entry after registry load", () => {
  for (const [label, source] of [
    ["server launcher", launcher],
    ["static launcher", staticLauncher]
  ]) {
    assert.match(source, /registry\?\.browserSetup\?\.entryPath/u, `${label} should use the catalog-derived setup entry`);
    assert.match(source, /\["active", "development"\]\.includes\(courseRecord\?\.status\)/u, `${label} should disclose active and development browser courses`);
    assert.match(source, /versionedLauncherAsset\(language\.flagSrc\)/u, `${label} should bypass stale launcher image caches`);
    assert.match(source, /createElement\("span"\)/u, `${label} should render informational course rows`);
    assert.doesNotMatch(source, /Continue with \$\{language\.label\}|createElement\("button"\)|data\.languageChoice/u, `${label} must not duplicate target selection on the launcher`);
  }
  assert.match(launcher, /label\.textContent = t\("launcher\.continue"\)/u);
  assert.match(launcher, /setAttribute\("aria-label", t\("launcher\.continuearia"\)\)/u);
  assert.match(launcher, /status\.textContent = t\("common\.preview"\)/u);
  assert.match(launcher, /loadLauncherInterface\(registry, localePreferences\(\)/u);
  assert.doesNotMatch(launcher, /selectedSourceLocale/u);
  assert.match(launcher, /document\.documentElement\.lang = content\.locale/u);
  assert.match(launcher, /content\.apply\(document\)/u);
  assert.match(staticLauncher, /label\.textContent = "Continue online"/u);
  assert.match(staticLauncher, /setAttribute\("aria-label", "Continue online in the browser"\)/u);
  assert.match(staticLauncher, /status\.textContent = "Preview"/u);
});

test("static publication derives browser-course flag files from the launcher catalog", () => {
  assert.match(staticBuilder, /function launcherIconPaths\(launcherStaticDir\)/u);
  assert.match(staticBuilder, /courseRecord\?\.targetLanguage\?\.flagSrc/u);
  assert.match(staticBuilder, /for \(const path of launcherIconPaths\(launcherDir\)\)/u);
  assert.match(staticBuilder, /expected\.add\(path\)/u);
});
