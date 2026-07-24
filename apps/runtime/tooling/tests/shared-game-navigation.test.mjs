import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [chrome, chromeCss, serviceWorker, ...pages] = await Promise.all([
  readFile(new URL("chrome.js", staticRoot), "utf8"),
  readFile(new URL("chrome.css", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  ...["chat.html", "embedding-images.html", "home.html", "index.html", "verb-difficulty.html", "word-net.html"]
    .map((file) => readFile(new URL(file, staticRoot), "utf8"))
]);

test("Games remembers and restores the active game without resetting an open game", () => {
  assert.match(chrome, /navigation\.active-game\.v1/);
  assert.match(chrome, /"verb-lab"[\s\S]*?href: `index\.html\?\$\{gameNavigationQueryKey\}=verb-lab`/);
  assert.match(chrome, /"word-net"[\s\S]*?href: "word-net\.html"/);
  assert.match(chrome, /item\.key === "games"[\s\S]*?gameNavigationHref\(\)/);
  assert.match(chrome, /activeGameId && activeGameId !== "galaxy"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopImmediatePropagation\(\)/);
  assert.match(chrome, /settingsPanel && !settingsPanel\.hidden[\s\S]*?closeSharedSettings\(\{ restoreFocus: false \}\)/);
  assert.match(chrome, /restoreRequestedGame\(\)/);
  assert.match(chrome, /if \(panel\.hidden\) trigger\.click\(\)/);
});

test("the game back control alone returns navigation memory to the planets", () => {
  assert.match(chrome, /const back = event\.target\.closest\?\.\("\.app-header-back"\)/);
  assert.match(chrome, /if \(back && currentGameId\(\) && currentGameId\(\) !== "galaxy"\)[\s\S]*?rememberActiveGame\("galaxy"\)/);
  assert.match(chrome, /const trainTarget = event\.target\.closest\?\.\("\[data-train-tab\]"\)/);
});

test("Android back gestures activate the same visible game back control", () => {
  assert.match(chrome, /function handleAndroidBack\(\)/);
  assert.match(chrome, /\.app-header-back:not\(\[hidden\]\)/);
  assert.match(chrome, /back\.click\(\)/);
  assert.match(chrome, /handleAndroidBack/);
});

test("active game headers center the matching planet and use Games artwork as the back control", () => {
  assert.match(chrome, /title: "Verb Nebula"[\s\S]*?iconSrc: "\/assets\/planets\/nebula\.png"/);
  assert.match(chrome, /title: "Word World"[\s\S]*?iconSrc: "\/assets\/planets\/planet_A\.png"/);
  assert.match(chrome, /titleIcon\.className = "app-header-title-icon"/);
  assert.match(chrome, /titleKicker\.className = "app-header-title-kicker"/);
  assert.match(chrome, /backArtwork\.className = "app-header-back-image"/);
  assert.match(chrome, /backArtwork\.src = "\/assets\/icons\/games_icon\.png"/);
  assert.match(chromeCss, /\.app-header-title \{[\s\S]*?border-radius: 0;[\s\S]*?display: inline-flex;/);
  assert.match(chromeCss, /\.app-header-title-icon \{[\s\S]*?width: 42px;[\s\S]*?border-radius: 8px;[\s\S]*?object-fit: contain;/);
  assert.match(chromeCss, /\.app-header\.has-screen-title \.app-header-back \{[\s\S]*?order: 1;[\s\S]*?margin-right: auto;/);
  assert.match(chromeCss, /\.app-header\.has-screen-title \.app-header-center \{[\s\S]*?position: absolute;[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/);
  assert.match(chromeCss, /\.app-header\[data-caatuu-active-game\] \.app-header-back \{[\s\S]*?border-radius: 8px;[\s\S]*?background:/);
  assert.match(chromeCss, /\.app-header-back-image \{[\s\S]*?width: auto;[\s\S]*?height: 36px;[\s\S]*?object-fit: contain;/);
  assert.match(chromeCss, /\.app-header\[data-caatuu-active-game\] \.app-header-title-copy \{[\s\S]*?position: absolute;[\s\S]*?clip-path: inset\(50%\);/);
});

test("every Czech screen uses the shared icon, kicker, title, and bare-flag header", () => {
  for (const page of pages) {
    assert.match(page, /data-caatuu-page-kicker="[^"]+"/);
    assert.match(page, /data-caatuu-page-title="[^"]+"/);
    assert.match(page, /data-caatuu-page-icon="[^"]+"/);
  }
  assert.match(chrome, /pageCopy\.className = "app-header-page-copy"/);
  assert.match(chrome, /language\.className = "language-pill app-header-language-pill language-switch"/);
  assert.match(chromeCss, /\.app-header-page-copy \{[\s\S]*?display: grid;/);
  assert.match(chromeCss, /\.app-header-language-pill \{[\s\S]*?background: transparent;/);
  assert.match(chromeCss, /\.app-header-language-pill \.language-code \{[\s\S]*?display: none;/);
});

test("the Games landing screen relies on the shared header and fits above the fixed navigation", () => {
  const gamesPage = pages.find((page) => page.includes("trainPanelGalaxy"));
  assert.match(gamesPage, /<body class="games-page">/);
  assert.doesNotMatch(gamesPage, /class="train-galaxy-copy"/);
  assert.match(chromeCss, /\.games-page \.app-shell \{[\s\S]*?padding-bottom: 0;/);
  assert.match(chromeCss, /\.games-page \.brand-icon \{[\s\S]*?width: auto;[\s\S]*?max-width: none;[\s\S]*?height: 36px;[\s\S]*?max-height: 36px;/);
});

test("the themed scrollbar reserves its gutter without shifting fixed navigation", () => {
  assert.match(chromeCss, /html \{[\s\S]*?scrollbar-gutter: stable;[\s\S]*?scrollbar-color:/);
  assert.match(chromeCss, /\.settings-sheet-body,[\s\S]*?\.chat-log,[\s\S]*?\.command-box \{[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(chromeCss, /\*::\-webkit-scrollbar-track \{[\s\S]*?var\(--caatuu-scroll-track-edge\)[\s\S]*?linear-gradient/);
  assert.match(chromeCss, /\*::\-webkit-scrollbar-thumb \{[\s\S]*?border-radius: 999px;[\s\S]*?linear-gradient/);
  assert.match(chromeCss, /\.bottom-app-nav \{[\s\S]*?left: 0;[\s\S]*?right: 0;[\s\S]*?width: auto;/);
});

test("phone navigation yields a frame before semantic work and avoids expensive Android compositing", () => {
  assert.match(chrome, /function scheduleSemanticSkillCompassLoad\(panel/);
  assert.match(chrome, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(chrome, /if \(view === "stats"\) scheduleSemanticSkillCompassLoad\(panel\)/);
  assert.match(
    chrome,
    /querySelectorAll\("#settingsPanel, \[data-caatuu-settings-panel\]"\)\.forEach\(renderSettingsPanel\)/
  );
  assert.match(chrome, /document\.documentElement\.dataset\.caatuuRuntime = window\.CaatuuRuntime\?\.env \|\| "browser"/);
  assert.match(chrome, /coin_icon_ui\.png" alt="" loading="lazy" decoding="async"/);
  assert.match(chrome, /difficulty_medal_\$\{option\.level\}_ui\.png\?v=ui-1/);
  assert.match(chromeCss, /touch-action: manipulation;/);
  assert.match(chromeCss, /html\[data-caatuu-runtime="android"\] \.bottom-app-nav \{[\s\S]*?backdrop-filter: none;/);
  assert.match(chromeCss, /html\[data-caatuu-runtime="android"\] \.settings-sheet \{[\s\S]*?box-shadow: none;/);
  assert.match(chromeCss, /\.settings-view-panel \{[\s\S]*?contain: layout style;/);
  assert.match(serviceWorker, /\/assets\/icons\/coin_icon_ui\.png/);
  assert.match(serviceWorker, /\/assets\/icons\/dark_mode_ui\.png/);
  assert.match(serviceWorker, /\/assets\/icons\/czech_flag_ui\.png/);
  assert.doesNotMatch(serviceWorker, /\/assets\/icons\/(?:coin_icon|dark_mode|czech_flag)\.png/);
});

test("every shared page and the service worker use the new Chrome cache keys", () => {
  for (const page of pages) {
    assert.match(page, /chrome\.css\?v=chrome-style-72/);
    assert.match(page, /chrome\.js\?v=chrome-74/);
  }
  assert.match(serviceWorker, /caatuu-czech-pwa-v\d+/);
  assert.match(serviceWorker, /chrome\.css\?v=chrome-style-72/);
  assert.match(serviceWorker, /chrome\.js\?v=chrome-74/);
});

test("shared headers stay focused while each game owns its theme control", () => {
  assert.doesNotMatch(chrome, /actions\.append\(theme, language\)/);
  assert.match(pages.find((page) => page.includes("trainPanelGalaxy")), /data-theme-toggle/);
  assert.match(pages.find((page) => page.includes("word-net-page")), /data-theme-toggle/);
});
