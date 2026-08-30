import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const czechStatic = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const czechAndroidAssets = new URL("../../../../apps/languages/czech/android-assets.json", import.meta.url);
const launcherStatic = new URL("../../../../apps/launcher/static/", import.meta.url);
const androidBuild = new URL("../../../../apps/android/app/build.gradle.kts", import.meta.url);

const [chromeCss, appCss, chatCss, chromeJs, courseProfile, serviceWorker, launcherCss, launcherHtml, launcherJs, languageRegistry, androidGradle, androidAssets] = await Promise.all([
  readFile(new URL("../../../language-runtime/static/styles/caatuu-chrome.css", czechStatic), "utf8"),
  readFile(new URL("../../../language-runtime/static/styles/caatuu-workspace.css", czechStatic), "utf8"),
  readFile(new URL("source/features/chat/chat.css", czechStatic), "utf8"),
  readFile(new URL("../../../language-runtime/static/source/caatuu-chrome.js", czechStatic), "utf8"),
  readFile(new URL("source/shared/course-profile.js", czechStatic), "utf8"),
  readFile(new URL("setup-assets.json", czechStatic), "utf8"),
  readFile(new URL("app.css", launcherStatic), "utf8"),
  readFile(new URL("index.html", launcherStatic), "utf8"),
  readFile(new URL("launcher.js", launcherStatic), "utf8"),
  readFile(new URL("languages.json", launcherStatic), "utf8"),
  readFile(androidBuild, "utf8"),
  readFile(czechAndroidAssets, "utf8").then(JSON.parse)
]);

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

function assertBorderlessImage(source, selector) {
  const body = ruleBody(source, selector);
  assert.match(body, /\bborder\s*:\s*0\s*;/, `${selector} must not draw a border`);
  assert.match(body, /\bborder-radius\s*:\s*0\s*;/, `${selector} must retain square flag corners`);
  assert.match(body, /\bbox-shadow\s*:\s*none\s*;/, `${selector} must not simulate a frame`);
  assert.match(body, /\bobject-fit\s*:\s*cover\s*;/, `${selector} should render the configured image at the flag ratio`);
  assert.match(body, /\bbackground\s*:\s*transparent\s*;/, `${selector} must not paint a replacement flag`);
  assert.doesNotMatch(source, new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}::before`), `${selector} must not generate the Czech flag with CSS`);
}

test("the shared Czech header uses the configured PNG without a CSS frame", () => {
  for (const [name, source] of [
    ["chrome.css", chromeCss],
    ["app.css", appCss],
    ["chat.css", chatCss]
  ]) {
    assertBorderlessImage(source, ".cz-flag");
    assert.doesNotMatch(source, /html\[data-theme="dark"\]\s+\.cz-flag\s*\{/, `${name} must not restore a dark-mode border`);
  }

  assert.match(
    chromeJs,
    /function renderLanguageSwitch[\s\S]*?createElement\("img"\)[\s\S]*?className = \["caatuu-language-flag", targetLanguage\.flagClass\]\.filter\(Boolean\)\.join\(" "\)[\s\S]*?src = targetLanguage\.flagSrc[\s\S]*?alt = ""/,
    "shared Chrome should render the image declared by the language profile"
  );
  assert.match(courseProfile, /flagClass: "cz-flag",\s*flagSrc: "\/assets\/icons\/czech_flag_ui\.png"/, "the Czech profile should select the shared UI PNG flag");
  assert.match(serviceWorker, /"\/assets\/icons\/czech_flag_ui\.png"/, "the Czech UI flag must remain available offline");
  assert.ok(androidAssets.launcherIconFiles.includes("czech_flag_ui.png"), "the Android allowlist must include the configured Czech UI flag");
  assert.match(androidGradle, /androidLauncherIconFiles/, "the Android package must consume the course-owned icon allowlist");
});

test("the language landing page uses the registered Czech PNG without a frame", () => {
  assertBorderlessImage(launcherCss, ".flag-icon");
  const holder = ruleBody(launcherCss, ".language-list li");
  assert.match(holder, /\bborder\s*:\s*0\s*;/, "the flag holder must not add a surrounding border");
  assert.match(holder, /\bbackground\s*:\s*transparent\s*;/, "the flag holder must not add a framed tile");
  assert.match(launcherHtml, /<img class="flag-icon" src="\/assets\/icons\/czech_flag_ui\.png" alt=""[^>]*>/);
  assert.match(launcherHtml, /<span class="language-choice-code">CZ<\/span>/, "the fallback language row should name Czech explicitly");
  assert.match(languageRegistry, /"flagSrc": "\/assets\/icons\/czech_flag_ui\.png"/);
  assert.match(
    launcherJs,
    /createElement\("img"\)[\s\S]*?className = language\.flagClass[\s\S]*?src = language\.flagSrc[\s\S]*?alt = ""/,
    "the launcher should render the registered flag image"
  );
  assert.match(launcherJs, /code\.textContent = language\.shortCode/, "dynamic language rows should include their short code");
});
