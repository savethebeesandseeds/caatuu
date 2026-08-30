import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const runtimeStatic = new URL("apps/language-runtime/static/", repoRoot);
const canonicalEntry = new URL("app/index.html", runtimeStatic);
const czechCourseUrl = new URL("apps/languages/czech/course.json", repoRoot);
const mandarinCourseUrl = new URL("apps/languages/mandarin-simplified/course.json", repoRoot);

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function missing(url) {
  try {
    await access(url);
    return false;
  } catch {
    return true;
  }
}

test("all browser courses name one physical application entry", async () => {
  const [czech, mandarin, html] = await Promise.all([
    json(czechCourseUrl),
    json(mandarinCourseUrl),
    readFile(canonicalEntry, "utf8")
  ]);
  const expected = "apps/language-runtime/static/app/index.html";

  for (const course of [czech, mandarin]) {
    assert.deepEqual(course.resources.appEntry, {
      kind: "file",
      path: expected,
      scope: "shared",
      state: "present"
    });
    assert.equal(course.resources.entryFile, undefined);
  }
  assert.ok(html.length > 50_000, "the canonical entry must preserve the Czech-authoritative product surface");
  assert.equal(await missing(new URL("apps/languages/czech/static/index.html", repoRoot)), true);
  assert.equal(await missing(new URL("apps/languages/mandarin-simplified/static/index.html", repoRoot)), true);
});

test("promoted UI authorities exist only in the shared runtime", async () => {
  for (const retiredPath of [
    "apps/languages/czech/static/source/features/home/home.css",
    "apps/languages/czech/static/source/games/verb-nebula/app.css",
    "apps/languages/czech/static/source/games/verb-nebula/app.js",
    "apps/languages/czech/static/source/shared/chrome.css",
    "apps/languages/czech/static/source/shared/chrome.js",
    "apps/languages/czech/static/source/shared/learning-profile.js",
    "apps/languages/czech/static/source/shared/theme.css",
    "apps/language-runtime/static/styles/course-shell.css"
  ]) {
    assert.equal(await missing(new URL(retiredPath, repoRoot)), true, retiredPath);
  }
});

test("the canonical document owns one exact shell and one live Word World tree", async () => {
  const html = await readFile(canonicalEntry, "utf8");
  for (const marker of [
    "data-caatuu-app-root",
    'class="app-shell"',
    'class="app-header"',
    'class="workspace"',
    'id="sharedTrainWorlds"',
    "data-caatuu-bottom-nav",
    "data-caatuu-settings-panel",
    'id="wordWorldRoot"',
    'class="word-net-game"',
    'id="wordNetGenerativeDialog"'
  ]) {
    assert.ok(html.includes(marker), `canonical entry is missing ${marker}`);
  }
  assert.equal((html.match(/id="wordWorldRoot"/gu) || []).length, 1);
  assert.equal((html.match(/class="word-net-game"/gu) || []).length, 1);
  assert.equal((html.match(/app-bootstrap\.mjs/gu) || []).length, 1);
  assert.doesNotMatch(html, /id="wordNetEmbeddedGame"|<template|word-world-preview|Mandarin preview/iu);
  assert.doesNotMatch(html, /(?:\/cz\/|\/zh(?:-hans)?\/|course-shell\.mjs|site-header|preview-card-grid)/u);
});

test("one promoted controller, host, provider, and renderer serve every course", async () => {
  const [bootstrap, workspace, host, policy, provider, renderer] = await Promise.all([
    readFile(new URL("source/app-bootstrap.mjs", runtimeStatic), "utf8"),
    readFile(new URL("source/caatuu-workspace.js", runtimeStatic), "utf8"),
    readFile(new URL("source/word-world-host.mjs", runtimeStatic), "utf8"),
    readFile(new URL("source/shell-policy.js", runtimeStatic), "utf8"),
    readFile(new URL("source/word-world-provider.mjs", runtimeStatic), "utf8"),
    readFile(new URL("source/product-word-world.mjs", runtimeStatic), "utf8")
  ]);
  const sharedSource = [bootstrap, workspace, host, policy, provider, renderer].join("\n");

  assert.equal(await missing(new URL("source/product-shell.mjs", runtimeStatic)), true);
  assert.doesNotMatch(sharedSource, /(?:\/zh(?:-hans)?\/|\/cz\/|mandarin-simplified)/iu);
  assert.doesNotMatch(sharedSource, /course\.id\s*(?:===|!==|==|!=)\s*["']/u);
  assert.doesNotMatch(sharedSource, /targetLanguage\.(?:id|locale|script)\s*(?:===|!==|==|!=)\s*["']/u);

  assert.match(bootstrap, /import\("\.\/word-world-host\.mjs\?v=word-world-host-/u);
  assert.match(bootstrap, /loadSharedScript\("\/language-runtime\/static\/source\/caatuu-workspace\.js\?v=workspace-/u);
  assert.doesNotMatch(bootstrap, /product-shell|CaatuuProductShell/u);

  assert.match(workspace, /window\.CaatuuWorkspaceShell = Object\.freeze\(\{/u);
  assert.match(workspace, /CaatuuWordWorldHost\?\.setActive\?\./u);
  assert.match(workspace, /host\.ensureLoaded\(\)/u);
  assert.doesNotMatch(workspace, /CaatuuProductShell|wordNetEmbeddedGame/u);

  assert.match(host, /mountWordWorld\(root, course, manifest\)/u);
  assert.match(host, /globalThis\.CaatuuWordWorldHost = CaatuuWordWorldHost/u);
  assert.doesNotMatch(host, /createElement|replaceChildren|innerHTML|iframe/iu);

  assert.match(provider, /mountProductWordWorld/u);
  assert.match(provider, /return mountRenderer\(root, context,/u);
  assert.match(renderer, /export async function mountProductWordWorld\(root, preparedContext/u);
  assert.doesNotMatch(renderer, /document\.createElement\(["'](?:main|section|nav|header|footer)/u);
});

test("capabilities hide only precise controls and never select another UI", async () => {
  const [bootstrap, policy, renderer, czech, mandarin] = await Promise.all([
    readFile(new URL("source/app-bootstrap.mjs", runtimeStatic), "utf8"),
    readFile(new URL("source/shell-policy.js", runtimeStatic), "utf8"),
    readFile(new URL("source/product-word-world.mjs", runtimeStatic), "utf8"),
    json(czechCourseUrl),
    json(mandarinCourseUrl)
  ]);

  assert.match(bootstrap, /availableGames\?\.\(course\)/u);
  assert.match(bootstrap, /document\.querySelectorAll\("\[data-train-tab\]"\)/u);
  assert.match(bootstrap, /control\.hidden = unavailable/u);
  assert.doesNotMatch(bootstrap, /wordNetGenerationToggle|wordNetGenerationMenu/u);
  assert.match(renderer, /querySelectorAll\('\[data-content-mode="generative"\]'\)/u);
  assert.match(renderer, /const generationSupported = capabilities\.llm === true && capabilities\.generation === true;/u);
  assert.match(renderer, /node\.hidden = !generationSupported/u);
  assert.match(renderer, /localAiAvailability\(course, runtimeAdapter\(\), "generation"\)/u);
  assert.doesNotMatch(renderer, /wordNetGenerationToggle[^\n]*hidden/u);
  assert.match(policy, /linguisticFeatures/u);
  assert.match(policy, /gameDeclared/u);

  assert.equal(czech.capabilities.generation, true);
  assert.equal(czech.capabilities.dictionary, true);
  assert.equal(czech.capabilities.speech, true);
  assert.equal(mandarin.capabilities.generation, false);
  assert.equal(mandarin.capabilities.dictionary, false);
  assert.equal(mandarin.capabilities.speech, true);
  assert.deepEqual(mandarin.games, ["verb-lab", "word-net"]);
  assert.deepEqual(mandarin.linguisticFeatures, []);
});

test("Mandarin contributes content and policy, not a mini-app", async () => {
  const mandarin = await json(mandarinCourseUrl);
  assert.equal(mandarin.routes.wordWorld, "index.html?game=word-net");
  assert.equal(await missing(new URL("apps/languages/mandarin-simplified/static/word-world.html", repoRoot)), true);
  assert.equal(await missing(new URL("apps/languages/mandarin-simplified/static/source/app.mjs", repoRoot)), true);
  assert.equal(mandarin.resources.languageAdapter.scope, "course");
  assert.equal(mandarin.resources.wordWorldManifest.scope, "course");
  assert.equal(mandarin.resources.appEntry.scope, "shared");
});

test("shared styles retain Czech geometry instead of recentering reduced courses", async () => {
  const [workspaceCss, wordWorldCss] = await Promise.all([
    readFile(new URL("styles/caatuu-workspace.css", runtimeStatic), "utf8"),
    readFile(new URL("styles/caatuu-word-world.css", runtimeStatic), "utf8")
  ]);

  assert.doesNotMatch(workspaceCss, /\.train-worlds\[data-world-count=/u);
  assert.match(workspaceCss, /\.word-net-embedded-game,\s*\n\.word-net-shared-game \{/u);
  assert.match(wordWorldCss, /^#wordWorldRoot \{/u);
  assert.match(wordWorldCss, /\.word-net-game \{/u);
  assert.match(wordWorldCss, /\.word-net-game \[hidden\],[\s\S]*?display: none !important;/u);
});
