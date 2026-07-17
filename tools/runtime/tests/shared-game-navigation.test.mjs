import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../apps/caatuu-czech/static/", import.meta.url);
const [chrome, chromeCss, serviceWorker, ...pages] = await Promise.all([
  readFile(new URL("chrome.js", staticRoot), "utf8"),
  readFile(new URL("chrome.css", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  ...["chat.html", "embedding-images.html", "home.html", "index.html", "word-net.html"]
    .map((file) => readFile(new URL(file, staticRoot), "utf8"))
]);

test("Games remembers and restores the active game without resetting an open game", () => {
  assert.match(chrome, /navigation\.active-game\.v1/);
  assert.match(chrome, /"verb-lab"[\s\S]*?href: `index\.html\?\$\{gameNavigationQueryKey\}=verb-lab#verbs`/);
  assert.match(chrome, /"word-net"[\s\S]*?href: "word-net\.html"/);
  assert.match(chrome, /item\.key === "games"[\s\S]*?gameNavigationHref\(\)/);
  assert.match(chrome, /activeGameId && activeGameId !== "galaxy"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopImmediatePropagation\(\)/);
  assert.match(chrome, /settingsPanel && !settingsPanel\.hidden[\s\S]*?closeSharedSettings\(\{ restoreFocus: false \}\)/);
  assert.match(chrome, /restoreRequestedGame\(\)/);
  assert.match(chrome, /if \(panel\.hidden\) trigger\.click\(\)/);
});

test("the game back arrow alone returns navigation memory to the planets", () => {
  assert.match(chrome, /const back = event\.target\.closest\?\.\("\.app-header-back"\)/);
  assert.match(chrome, /if \(back && currentGameId\(\) && currentGameId\(\) !== "galaxy"\)[\s\S]*?rememberActiveGame\("galaxy"\)/);
  assert.match(chrome, /const trainTarget = event\.target\.closest\?\.\("\[data-train-tab\]"\)/);
});

test("shared game titles use the matching small planet artwork", () => {
  assert.match(chrome, /title: "Verb Nebula"[\s\S]*?iconSrc: "\/assets\/planets\/nebula\.png"/);
  assert.match(chrome, /title: "Word World"[\s\S]*?iconSrc: "\/assets\/planets\/planet_A\.png"/);
  assert.match(chrome, /titleIcon\.className = "app-header-title-icon"/);
  assert.match(chromeCss, /\.app-header-title \{[\s\S]*?display: inline-flex;[\s\S]*?border-radius: 999px;/);
  assert.match(chromeCss, /\.app-header-title-icon \{[\s\S]*?width: 26px;[\s\S]*?object-fit: contain;/);
});

test("every shared page and the service worker use the new Chrome cache keys", () => {
  for (const page of pages) {
    assert.match(page, /chrome\.css\?v=chrome-style-42/);
    assert.match(page, /chrome\.js\?v=chrome-48/);
  }
  assert.match(serviceWorker, /caatuu-czech-pwa-v\d+/);
  assert.match(serviceWorker, /chrome\.css\?v=chrome-style-42/);
  assert.match(serviceWorker, /chrome\.js\?v=chrome-48/);
});
