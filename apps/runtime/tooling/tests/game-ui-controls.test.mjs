import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [app, appCss, chrome, wordNetCss, wordNetHtml, wordNetJs] = await Promise.all([
  readFile(new URL("app.js", staticRoot), "utf8"),
  readFile(new URL("app.css", staticRoot), "utf8"),
  readFile(new URL("chrome.js", staticRoot), "utf8"),
  readFile(new URL("word-net.css", staticRoot), "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("word-net.js", staticRoot), "utf8")
]);

test("shared app headers use the bird mark without a repeated wordmark", () => {
  assert.match(chrome, /brand\.append\(mark\)/);
  assert.doesNotMatch(chrome, /labelWrap|label\.textContent = course\.brandLabel/);
});

test("game-local theme controls preserve centered artwork and Word World chrome", () => {
  assert.match(appCss, /\.verb-match-control-cluster > \.theme-toggle \{[\s\S]*?padding: 0;[\s\S]*?place-items: center;/);
  assert.match(appCss, /html\[data-theme\] \.verb-match-control-cluster > \.theme-toggle \{[\s\S]*?border:[\s\S]*?background:/);
  assert.match(appCss, /html\[data-theme\] \.verb-match-control-cluster > \.theme-toggle\.is-selected \{[\s\S]*?border-color:[\s\S]*?background:/);
  assert.match(wordNetCss, /\.word-net-panel-actions > \.theme-toggle \{[\s\S]*?border: 1px solid[\s\S]*?place-items: center;/);
  assert.match(wordNetCss, /html\[data-theme\] \.word-net-panel-actions > \.theme-toggle \{[\s\S]*?border-color:[\s\S]*?background:/);
});

test("Verb Nebula reveal toggles a visible animated arrow overlay", () => {
  assert.match(app, /function toggleVerbSolution\(\)/);
  assert.match(app, /state\.verbSolutionRevealed = !state\.verbSolutionRevealed/);
  assert.match(app, /svg\.classList\.toggle\("is-visible", Boolean\(visible\)\)/);
  assert.match(appCss, /\.verb-solution-arrows\.is-visible \{[\s\S]*?display: block;/);
  assert.match(app, /svg\.toggleAttribute\("hidden", !visible\);/);
  assert.match(app, /svg\.toggleAttribute\("hidden", true\);/);
  assert.match(app, /revealButton\.setAttribute\("aria-pressed", String\(state\.verbSolutionRevealed\)\)/);
});

test("Generative mode requires an explicit local-model download confirmation", () => {
  assert.match(wordNetHtml, /id="wordNetGenerativeDialog"[\s\S]*?about 1\.9 GB[\s\S]*?value="cancel"[\s\S]*?value="confirm"/);
  assert.match(wordNetHtml, /word-net-generative-dialog-art[\s\S]*?\/assets\/robots\/word-world-waiting\.svg/);
  assert.match(wordNetCss, /\.word-net-generative-dialog-card \{[\s\S]*?box-shadow:[\s\S]*?grid-template-columns:/);
  assert.match(wordNetJs, /function confirmGenerativeMode\(\)[\s\S]*?dialog\.showModal\(\)/);
  assert.match(wordNetJs, /mode === "generative" && !\(await confirmGenerativeMode\(\)\)/);
});

test("Word World translations reuse the quiet dictionary accent", () => {
  assert.match(wordNetCss, /\.word-net-translation \{[\s\S]*?color: var\(--theme-entry-accent, #8f4b40\)/);
});
