import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const czechStatic = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const launcherStatic = new URL("../../../../apps/launcher/static/", import.meta.url);
const androidBuild = new URL("../../../../apps/android/app/build.gradle.kts", import.meta.url);

const [chromeCss, appCss, chatCss, chromeJs, courseProfile, serviceWorker, launcherCss, launcherHtml, launcherJs, languageRegistry, androidGradle] = await Promise.all([
  readFile(new URL("chrome.css", czechStatic), "utf8"),
  readFile(new URL("app.css", czechStatic), "utf8"),
  readFile(new URL("chat.css", czechStatic), "utf8"),
  readFile(new URL("chrome.js", czechStatic), "utf8"),
  readFile(new URL("course-profile.js", czechStatic), "utf8"),
  readFile(new URL("sw.js", czechStatic), "utf8"),
  readFile(new URL("app.css", launcherStatic), "utf8"),
  readFile(new URL("index.html", launcherStatic), "utf8"),
  readFile(new URL("launcher.js", launcherStatic), "utf8"),
  readFile(new URL("languages.json", launcherStatic), "utf8"),
  readFile(androidBuild, "utf8")
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
    /function renderLanguageSwitch[\s\S]*?createElement\("img"\)[\s\S]*?className = targetLanguage\.flagClass[\s\S]*?src = targetLanguage\.flagSrc[\s\S]*?alt = ""/,
    "shared Chrome should render the image declared by the language profile"
  );
  assert.match(courseProfile, /flagClass: "cz-flag",\s*flagSrc: "\/assets\/icons\/czech_flag\.png"/, "the Czech profile should select the shared PNG flag");
  assert.match(serviceWorker, /"\/assets\/icons\/czech_flag\.png"/, "the Czech flag must remain available offline");
  assert.match(androidGradle, /"czech_flag\.png"/, "the Android package must include the shared Czech flag");
});

test("the language landing page uses the registered Czech PNG without a frame", () => {
  assertBorderlessImage(launcherCss, ".flag-icon");
  const holder = ruleBody(launcherCss, ".language-list li");
  assert.match(holder, /\bborder\s*:\s*0\s*;/, "the flag holder must not add a surrounding border");
  assert.match(holder, /\bbackground\s*:\s*transparent\s*;/, "the flag holder must not add a framed tile");
  assert.match(launcherHtml, /<img class="flag-icon" src="\/assets\/icons\/czech_flag\.png" alt="">/);
  assert.match(launcherHtml, /<span class="language-choice-code">CZ<\/span>/, "the fallback language row should name Czech explicitly");
  assert.match(languageRegistry, /"flagSrc": "\/assets\/icons\/czech_flag\.png"/);
  assert.match(
    launcherJs,
    /createElement\("img"\)[\s\S]*?className = language\.flagClass[\s\S]*?src = language\.flagSrc[\s\S]*?alt = ""/,
    "the launcher should render the registered flag image"
  );
  assert.match(launcherJs, /code\.textContent = language\.shortCode/, "dynamic language rows should include their short code");
});
