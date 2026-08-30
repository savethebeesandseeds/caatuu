import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const languageRuntimeStatic = new URL("../../../../apps/language-runtime/static/", import.meta.url);
const pageNames = [
  "chat.html",
  "conjugation-comet.html",
  "case-cosmos.html",
  "agreement-aurora.html",
  "embedding-images.html",
  "verb-difficulty.html",
  "audio-lab.html"
];
const chrome = await readFile(new URL("source/caatuu-chrome.js", languageRuntimeStatic), "utf8");
const chromeCss = await readFile(new URL("styles/caatuu-chrome.css", languageRuntimeStatic), "utf8");
const appController = await readFile(new URL("source/caatuu-workspace.js", languageRuntimeStatic), "utf8");
const appCss = await readFile(new URL("styles/caatuu-workspace.css", languageRuntimeStatic), "utf8");
const wordWorldController = await readFile(new URL("source/product-word-world.mjs", languageRuntimeStatic), "utf8");
const wordWorldCss = await readFile(new URL("styles/caatuu-word-world.css", languageRuntimeStatic), "utf8");
const sharedAppBootstrap = await readFile(new URL("source/app-bootstrap.mjs", languageRuntimeStatic), "utf8");
const wordWorldHost = await readFile(new URL("source/word-world-host.mjs", languageRuntimeStatic), "utf8");
const setupCatalogSource = await readFile(new URL("setup-assets.json", staticRoot), "utf8");
const canonicalPage = await readFile(new URL("app/index.html", languageRuntimeStatic), "utf8");
const secondaryPages = await Promise.all(
  pageNames.map((file) => readFile(new URL(file, staticRoot), "utf8"))
);
const pages = [canonicalPage, ...secondaryPages];

test("Games opens a shared planet selector from every screen", () => {
  assert.match(chrome, /navigation\.active-game\.v1/);
  assert.match(chrome, /"verb-lab"[\s\S]*?href: "index\.html"/);
  assert.match(chrome, /"word-net"[\s\S]*?href: "index\.html"/);
  assert.match(chrome, /"conjugation-comet"[\s\S]*?href: "index\.html"/);
  assert.match(chrome, /"case-cosmos"[\s\S]*?href: "index\.html"/);
  assert.match(chrome, /"agreement-aurora"[\s\S]*?href: "index\.html"/);
  assert.match(chrome, /item\.key === "games"[\s\S]*?gameNavigationHref\(\)/);
  assert.match(chrome, /function renderGameMenu\(\)[\s\S]*?id = "gamesMenuPanel"[\s\S]*?className = "games-menu-backdrop"/);
  assert.doesNotMatch(chrome, /games-menu-head|gamesMenuTitle|data-games-menu-close/);
  assert.match(chrome, /class="games-menu-grid" role="tablist"/);
  assert.doesNotMatch(chrome, /cloneNode\(true\)[\s\S]*?games-menu-app-header/);
  assert.match(chrome, /panel\.querySelectorAll\("\.games-menu-app-header"\)\.forEach\(\(header\) => header\.remove\(\)\)/);
  assert.match(chrome, /function openGameMenu\(trigger\)[\s\S]*?document\.body\.classList\.add\("games-menu-open"\)/);
  assert.doesNotMatch(chrome, /function openGameMenu\(trigger\)[\s\S]*?closeSharedSettings\(\{ restoreFocus: false \}\)[\s\S]*?sharedGameMenuTrigger/);
  assert.match(chrome, /if \(gameNav\) \{[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?openGameMenu\(gameNav\)/);
  assert.match(chrome, /if \(backpackButton\) \{[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?setBottomDockMenu\(dock\?\.dataset\.openMenu === "settings" \? "" : "settings"\)/);
  assert.match(chrome, /function selectGameFromMenu\(gameId\)[\s\S]*?localTarget\.click\(\)[\s\S]*?rememberNavigationRequest\(`game:\$\{normalizedGameId\}`\)/);
  assert.match(chrome, /function openSharedSettings\(\{ view = readRememberedBackpackView\(\) \} = \{\}\)[\s\S]*?setSettingsView\(panel, view\)[\s\S]*?setBottomDockMenu\(\)/);
  assert.match(chrome, /if \(panel\.hidden\) openSharedSettings\(\{ view: settingsView\.dataset\.settingsView \}\)/);
  assert.match(appController, /navigationRequest\.startsWith\("game:"\)[\s\S]*?\["campaign", "verb-lab", "word-net", "conjugation-comet", "case-cosmos", "agreement-aurora", "memory-moon"\]\.includes\(requestedGame\)[\s\S]*?data-train-tab/);
  assert.match(chrome, /function ensureBottomDock\(nav = document\.querySelector\("\[data-caatuu-bottom-nav\]"\)\)/);
  assert.match(chrome, /dock\.append\(menuHost, nav\)/);
  assert.match(chrome, /function setBottomDockMenu\(menu = ""\)/);
  assert.match(chrome, /setBottomDockMenu\("games"\)/);
  assert.match(chrome, /dock\?\.dataset\.openMenu === "settings" \? "" : "settings"/);
  assert.match(chrome, /button\.setAttribute\("aria-expanded", normalizedMenu === "settings" \? "true" : "false"\)/);
  assert.match(chromeCss, /\.app-bottom-dock \{[\s\S]*?--games-menu-surface:[\s\S]*?position: fixed;[\s\S]*?grid-template-rows: auto auto;/);
  assert.match(chromeCss, /\.app-bottom-dock\[data-open-menu="games"\] > \.app-bottom-dock-menu,[\s\S]*?\.app-bottom-dock\[data-open-menu="settings"\] > \.app-bottom-dock-menu \{[\s\S]*?position: absolute;[\s\S]*?bottom: 100%;[\s\S]*?background: transparent;/);
  assert.match(chromeCss, /\.games-menu-backdrop \{[\s\S]*?position: fixed;[\s\S]*?grid-template-rows: minmax\(0, 1fr\)/);
  assert.doesNotMatch(chromeCss, /> \.games-menu-app-header/);
  assert.match(chromeCss, /\.games-menu-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(chromeCss, /@media \(min-width: 560px\)[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(chromeCss, /@media \(min-width: 960px\)[\s\S]*?grid-template-columns: repeat\(var\(--game-menu-count, 1\), minmax\(86px, 1fr\)\)/);
  assert.match(chromeCss, /body\.games-menu-open \{[\s\S]*?overflow: hidden/);
  assert.match(chromeCss, /\.games-menu-sheet::after\s*\{/);
  assert.match(chromeCss, /\.games-menu-sheet \{[\s\S]*?border-radius: 12px;[\s\S]*?background: var\(--games-menu-surface\)/);
  assert.match(chromeCss, /\.games-menu-sheet \{[\s\S]*?margin: 0 calc\(var\(--games-menu-edge\) - 1px\);/);
  assert.match(chromeCss, /\.settings-section-switcher \{[\s\S]*?margin: 0 calc\(var\(--settings-section-edge\) - 1px\);[\s\S]*?border-radius: 12px;[\s\S]*?background: var\(--games-menu-surface\)/);
  assert.match(chromeCss, /\.settings-section-switcher \{[\s\S]*?padding: 4px 0 5px;/);
  assert.match(chromeCss, /\.settings-section-switcher::after \{[\s\S]*?right: 10px;[\s\S]*?width: calc\(\(100% - 12px\) \/ 3 - 20px\);[\s\S]*?background: var\(--games-menu-surface\)/);
  assert.match(chromeCss, /\.settings-section-switcher button \{[\s\S]*?width: calc\(100% - 20px\);[\s\S]*?margin-inline: auto;/);
  assert.match(chromeCss, /\.app-bottom-dock\[data-open-menu="settings"\] #openSettings\[aria-expanded="true"\] \{[\s\S]*?width: calc\(100% - 20px\);[\s\S]*?margin-inline: auto;/);
  assert.match(chromeCss, /\.app-bottom-dock\[data-open-menu="settings"\] #openSettings\[aria-expanded="true"\]::before/);
  assert.match(chromeCss, /\.settings-section-switcher button\.is-active \{[\s\S]*?background: var\(--games-menu-surface\)/);
  assert.match(chromeCss, /body\.games-menu-open \[data-caatuu-bottom-nav\] \[data-nav-key="games"\]::before/);
  assert.match(chromeCss, /\.games-menu-backdrop \{[\s\S]*?background: transparent;/);
  assert.match(chromeCss, /\.games-menu-body::\-webkit-scrollbar \{[\s\S]*?display: none;/);
  assert.doesNotMatch(chrome, /gameNavigationQueryKey|restoreRequestedGame|requestedGameId/);
  assert.match(chrome, /function clearVisibleUrlState\(\)[\s\S]*?window\.history\.replaceState\(window\.history\.state, "", window\.location\.pathname\)/);
});

test("Home is an in-page view of the canonical index shell", () => {
  const gamesPage = pages.find((page) => page.includes("trainPanelGalaxy"));

  assert.match(gamesPage, /id="view-home"[^>]*class="view home-view is-active"|class="view home-view is-active"[^>]*id="view-home"/);
  assert.match(gamesPage, /id="nativeSetup"/);
  assert.match(chrome, /data-navigation-request="home"/);
  assert.match(chrome, /if \(homeNavigation && document\.querySelector\("#view-home"\)\)[\s\S]*?setBottomDockMenu\(\);[\s\S]*?caatuu:home-request/);
  assert.match(chrome, /caatuu:home-request/);
  assert.match(appController, /function normalizeView\(view\)[\s\S]*?view === "home"/);
  assert.match(appController, /document\.addEventListener\("caatuu:home-request", \(\) => \{[\s\S]*?stopCampaign\(\);[\s\S]*?setView\("home"\);[\s\S]*?\}\)/);
  assert.doesNotMatch(setupCatalogSource, /\.\/home\.html/);
});

test("Word World lazy-mounts inside the shared Games URL and retains its challenge", () => {
  const gamesPage = pages.find((page) => page.includes("trainPanelGalaxy"));

  assert.match(gamesPage, /id="wordWorldRoot"[^>]*data-word-world-root/);
  assert.match(gamesPage, /id="wordWorldRoot"[\s\S]*?class="word-net-game"/);
  assert.doesNotMatch(gamesPage, /id="wordNetEmbeddedGame"|data-src="word-net\.html"/);
  assert.match(gamesPage, /id="wordNetEmbeddedStage"[^>]*aria-busy="true"/);
  assert.match(gamesPage, /id="wordNetEmbeddedStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(gamesPage, /id="wordNetEmbeddedStatus"[\s\S]*?class="word-net-embedded-loader"[^>]*\/assets\/robots\/robot%20\(1\)\.png/);
  assert.doesNotMatch(gamesPage, /Opening (?:Word World|Conjugation Comet|Case Cosmos|Agreement Aurora)/);

  assert.match(sharedAppBootstrap, /import\("\.\/word-world-host\.mjs\?v=word-world-host-/);
  assert.match(sharedAppBootstrap, /caatuu-workspace\.js\?v=workspace-/);
  assert.doesNotMatch(sharedAppBootstrap, /product-shell|wordNetEmbeddedGame/);

  assert.match(appController, /function ensureWordNetLoaded\(\)/);
  assert.match(appController, /host\.ensureLoaded\(\)/);
  assert.match(appController, /if \(activeTab === "word-net"\) ensureWordNetLoaded\(\)/);
  assert.match(appController, /syncEmbeddedWordNetVisibility\(activeTab === "word-net"\)/);
  assert.match(appController, /CaatuuWordWorldHost\?\.setActive\?\./);
  assert.doesNotMatch(appController, /CaatuuProductShell|wordNetEmbeddedGame/);
  assert.doesNotMatch(appController, /playWorldLandingAnimation|worldLandingAnimation|animation-landing|animation-leaving/);
  assert.doesNotMatch(appController, /window\.location\.href\s*=\s*["']word-net\.html/);

  assert.match(wordWorldHost, /mountWordWorld\(root, course, manifest\)/);
  assert.match(wordWorldHost, /setStatus\(\s*"loading",\s*"",\s*""\s*\)/);
  assert.match(wordWorldHost, /root\.classList\.add\("is-ready"\)/);
  assert.match(wordWorldHost, /status\.hidden = true/);
  assert.match(wordWorldController, /export async function mountProductWordWorld\(root, preparedContext/);
  assert.doesNotMatch(wordWorldController, /void init\(\)|notifyEmbeddedShell|bindEmbeddedShellBridge/);

  assert.match(appCss, /\.word-net-embedded-stage \{[\s\S]*?height: clamp\(/);
  assert.match(appCss, /\.word-net-embedded-game,[\s\S]*?\.word-net-shared-game \{[\s\S]*?opacity: 0;/);
  assert.match(appCss, /\.word-net-shared-game\.is-ready \{[\s\S]*?opacity: 1;/);
  assert.match(wordWorldCss, /^#wordWorldRoot \{[\s\S]*?\.word-net-game \{/);
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
  assert.match(chrome, /title: "Verb Nebula"[\s\S]*?iconSrc: "\/assets\/planets\/verb-nebula\.png"/);
  assert.match(chrome, /title: "Word World"[\s\S]*?iconSrc: "\/assets\/planets\/word-world\.png"/);
  assert.match(chrome, /title: "Conjugation Comet"[\s\S]*?iconSrc: "\/assets\/planets\/conjugation-comet\.png"/);
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

test("every Czech screen uses the shared icon, kicker, title, and course selector header", () => {
  for (const page of pages) {
    assert.match(page, /data-caatuu-page-kicker="[^"]+"/);
    assert.match(page, /data-caatuu-page-title="[^"]+"/);
    assert.match(page, /data-caatuu-page-icon="[^"]+"/);
  }
  assert.match(chrome, /pageCopy\.className = "app-header-page-copy"/);
  assert.match(chrome, /language\.className = "language-pill app-header-language-pill language-switch"/);
  assert.match(chromeCss, /\.app-header-page-copy \{[\s\S]*?display: grid;/);
  assert.match(chromeCss, /\.language-pill\.app-header-language-pill,[\s\S]*?\.language-pill\.settings-language-pill \{[\s\S]*?width: 30px;[\s\S]*?min-width: 30px;[\s\S]*?cursor: pointer;/);
  assert.doesNotMatch(chrome, /language-base-code|language-route-arrow|language-selector-disclosure/);
});

test("the Games landing screen relies on the shared header and fits above the fixed navigation", () => {
  const gamesPage = pages.find((page) => page.includes("trainPanelGalaxy"));
  assert.match(gamesPage, /<body class="games-page setup-blocked">/);
  assert.match(sharedAppBootstrap, /course\.capabilities\?\.offlineModels === true[\s\S]*?document\.body\.classList\.add\("setup-blocked"\)/);
  assert.doesNotMatch(gamesPage, /class="train-galaxy-copy"/);
  assert.match(chromeCss, /\.games-page \.app-shell \{[\s\S]*?padding-bottom: 0;/);
  assert.match(chromeCss, /\.games-page \.brand-icon \{[\s\S]*?width: auto;[\s\S]*?max-width: none;[\s\S]*?height: 36px;[\s\S]*?max-height: 36px;/);
});

test("newer games lazy-mount inside the shared Games URL while standalone routes remain compatible", () => {
  const gamesPage = pages.find((page) => page.includes("trainPanelGalaxy"));
  const cometPage = pages.find((page) => page.includes("conjugation-comet-page"));
  assert.match(gamesPage, /id="conjugationCometWorld"[\s\S]*?data-train-tab="conjugation-comet"[\s\S]*?hidden/);
  assert.match(gamesPage, /\/assets\/planets\/conjugation-comet\.png/);
  assert.match(cometPage, /data-caatuu-header-title="Conjugation Comet"/);
  assert.match(cometPage, /data-caatuu-header-back-href="index\.html"/);
  assert.match(cometPage, /id="conjugationCometPanel"/);
  assert.match(chrome, /document\.querySelector\("\.conjugation-comet-page"\)[\s\S]*?return "conjugation-comet"/);
  assert.match(chrome, /function gamePresentationAvailable\(gameId, presentation\)[\s\S]*?shellPolicy\.gameAvailable\(course, gameId\)[\s\S]*?gameId === "conjugation-comet"[\s\S]*?course\.capabilities\?\.conjugationComet === true/);
  assert.doesNotMatch(chrome, /localDeveloperGamePreview|conjugationCometConfiguration/);
  assert.match(gamesPage, /data-course-game="conjugation-comet"/);
  assert.match(gamesPage, /id="conjugationCometEmbeddedGame"[\s\S]*?data-src="conjugation-comet\.html"[\s\S]*?data-embedded-game="conjugation-comet"/);
  assert.match(gamesPage, /id="caseCosmosEmbeddedGame"[\s\S]*?data-src="case-cosmos\.html"[\s\S]*?data-embedded-game="case-cosmos"/);
  assert.match(gamesPage, /id="agreementAuroraEmbeddedGame"[\s\S]*?data-src="agreement-aurora\.html"[\s\S]*?data-embedded-game="agreement-aurora"/);
  assert.match(appController, /const embeddedGameTabs = \{[\s\S]*?"conjugation-comet"[\s\S]*?"case-cosmos"[\s\S]*?"agreement-aurora"/);
  assert.match(appController, /function ensureEmbeddedGameLoaded\(gameId\)[\s\S]*?frame\.src = source/);
  assert.doesNotMatch(appController, /syncEmbeddedGameHeight|observeEmbeddedGameHeight/);
  assert.match(appCss, /body\.word-net-active,[\s\S]*?body\.embedded-game-active[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/);
  assert.match(appCss, /body\.word-net-active > \.app-shell,[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);[\s\S]*?overflow:\s*hidden;/);
  assert.match(appCss, /body\.word-net-active \.workspace,[\s\S]*?body\.embedded-game-active \.workspace \{[\s\S]*?padding:\s*0;[\s\S]*?overflow:\s*hidden;/);
  assert.match(appCss, /body\.word-net-active \.word-net-embedded-stage,[\s\S]*?body\.embedded-game-active \.embedded-game-stage[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;/);
  assert.match(appCss, /\.word-net-embedded-panel \{[\s\S]*?border-radius:\s*0;/);
  assert.match(appCss, /\.word-net-embedded-stage \{[\s\S]*?border-radius:\s*0;/);
  assert.match(appController, /body\.caatuu-embedded-shell > \.app-shell > \.app-footer \{[\s\S]*?margin: 0 !important;[\s\S]*?display: flex !important;/);
  assert.match(wordWorldCss, /^#wordWorldRoot \{/);
  assert.match(appController, /"conjugation-comet": "trainPanelConjugationComet"[\s\S]*?"case-cosmos": "trainPanelCaseCosmos"[\s\S]*?"agreement-aurora": "trainPanelAgreementAurora"/);
  assert.doesNotMatch(chrome, /requestedGame === "conjugation-comet"[\s\S]*?window\.location\.href/);
  assert.match(chrome, /document\.querySelectorAll\("\[data-course-game\]"\)[\s\S]*?trigger\.hidden = !available/);
  assert.match(chrome, /function gameLandingHref\(gameId\) \{[\s\S]*?return course\.routes\.games;/);
  assert.match(chrome, /function gamePresentationHref\(gameId\)[\s\S]*?return presentation\.href;/);
  assert.match(chrome, /back\.href = gameLandingHref\("conjugation-comet"\)/);
});

test("developer tools keep path-only pages and never expose view state in the URL", () => {
  for (const route of ["chat", "audioLab", "embeddingImages", "verbDifficulty"]) {
    assert.match(chrome, new RegExp(`href: routes\\.${route}`));
  }
  assert.match(chrome, /href: routes\.dictionary,[\s\S]*?navigationRequest: "dictionary"/);
  assert.match(chrome, /href="\$\{tool\.href\}"\$\{navigationRequest\}/);
  assert.match(chrome, /sessionStorage\.setItem\(navigationRequestStorageKey/);
  assert.doesNotMatch(chrome, /href="[^"]*[?#][^"]*"/);
  assert.doesNotMatch(appController, /searchParams\.get|URLSearchParams/);
});

test("the themed scrollbar reserves its gutter without shifting fixed navigation", () => {
  assert.match(chromeCss, /html \{[\s\S]*?scrollbar-gutter: stable;[\s\S]*?scrollbar-color:/);
  assert.match(chromeCss, /\.settings-sheet-body,[\s\S]*?\.chat-log,[\s\S]*?\.command-box \{[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(chromeCss, /\*::\-webkit-scrollbar-track \{[\s\S]*?var\(--caatuu-scroll-track-edge\)[\s\S]*?linear-gradient/);
  assert.match(chromeCss, /\*::\-webkit-scrollbar-thumb \{[\s\S]*?border-radius: 999px;[\s\S]*?linear-gradient/);
  assert.match(chromeCss, /\.app-bottom-dock \{[\s\S]*?left: 0;[\s\S]*?right: 0;[\s\S]*?width: auto;/);
});

test("phone navigation yields a frame before semantic work and avoids expensive Android compositing", () => {
  assert.match(chrome, /function scheduleSemanticSkillCompassLoad\(panel/);
  assert.match(chrome, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(chrome, /if \(view === "stats"\) scheduleSemanticSkillCompassLoad\(panel\)/);
  assert.match(chrome, /function scheduleSettingsViewTransition\(panel/);
  assert.match(chrome, /setSettingsViewTransitionState\(panel, view, true\)/);
  assert.match(chrome, /button\.classList\.toggle\("is-active", isRequested\)/);
  assert.match(chrome, /button\.setAttribute\("aria-selected", String\(isRequested\)\)/);
  assert.match(chromeCss, /\.settings-section-switcher button\.is-pending::after/);
  assert.match(chromeCss, /animation: maintenance-spin 0\.75s linear infinite/);
  assert.match(
    chrome,
    /querySelectorAll\("#settingsPanel, \[data-caatuu-settings-panel\]"\)\.forEach\(renderSettingsPanel\)/
  );
  assert.match(chrome, /document\.documentElement\.dataset\.caatuuRuntime = window\.CaatuuRuntime\?\.env \|\| "browser"/);
  assert.match(chrome, /coin_icon_ui\.png" alt="" loading="lazy" decoding="async"/);
  assert.match(chrome, /difficulty_medal_\$\{option\.level\}_ui\.png\?v=ui-1/);
  assert.match(chromeCss, /touch-action: manipulation;/);
  assert.match(chromeCss, /html\[data-caatuu-runtime="android"\] \.app-bottom-dock \{[\s\S]*?backdrop-filter: none;/);
  assert.match(chromeCss, /html\[data-caatuu-runtime="android"\] \.settings-sheet \{[\s\S]*?box-shadow: none;/);
  assert.match(chromeCss, /\.settings-view-panel \{[\s\S]*?contain: layout style;/);
  assert.match(setupCatalogSource, /\/assets\/icons\/coin_icon_ui\.png/);
  assert.match(setupCatalogSource, /\/assets\/icons\/dark_mode_ui\.png/);
  assert.match(setupCatalogSource, /\/assets\/icons\/light_mode_ui\.png/);
  assert.match(setupCatalogSource, /\/assets\/icons\/czech_flag_ui\.png/);
  assert.doesNotMatch(setupCatalogSource, /\/assets\/icons\/(?:coin_icon|dark_mode|czech_flag)\.png/);
});

test("Backpack remembers its submenu and mirrors it on the bottom-nav badge", () => {
  assert.match(chrome, /navigation\.backpack-view\.v1/);
  assert.match(chrome, /function normalizeBackpackView\(view\)/);
  assert.match(chrome, /localStorage\.getItem\(backpackViewStorageKey\)/);
  assert.match(chrome, /localStorage\.setItem\(backpackViewStorageKey, normalizedView\)/);
  assert.match(chrome, /className = "app-nav-submenu-icon"/);
  assert.match(chrome, /items_icon\.png\?v=items-2/);
  assert.match(chrome, /stats_icon\.png/);
  assert.match(chrome, /gear_icon\.png/);
  assert.match(chrome, /function setSettingsView\(panel, requestedView = "items", \{ persist = true \} = \{\}\)[\s\S]*?rememberBackpackView\(view\)[\s\S]*?syncBackpackViewIndicators\(view\)/);
  assert.match(chrome, /setSettingsView\(panel, readRememberedBackpackView\(\), \{ persist: false \}\)/);
  assert.match(chrome, /function openSharedSettings\(\{ view = readRememberedBackpackView\(\) \} = \{\}\)[\s\S]*?setSettingsView\(panel, view\)/);
  assert.match(chromeCss, /\.app-bottom-dock\[data-open-menu="settings"\] #openSettings\[aria-expanded="true"\]/);
});

test("Games shows the current child badge and clears it on the planet selector", () => {
  assert.match(chrome, /function syncGameNavigationIndicators\(gameId = readRememberedGame\(\)\)/);
  assert.match(chrome, /badge\.className = "app-nav-submenu-icon"/);
  assert.match(chrome, /badge\.src = presentation\.iconSrc/);
  assert.match(chrome, /button\.dataset\.activeGame = normalizedGameId/);
  assert.match(chrome, /button\.setAttribute\("aria-label", `Games, \$\{presentation\.title\}`\)/);
  assert.match(chrome, /rememberActiveGame\(gameId\)[\s\S]*?syncGameNavigationIndicators\(normalizedGameId\)/);
  assert.match(chrome, /syncGameNavigationIndicators\(currentGameId\(\)\)/);
  assert.match(chrome, /if \(!presentation\) \{[\s\S]*?badge\?\.remove\(\)[\s\S]*?delete button\.dataset\.activeGame[\s\S]*?button\.setAttribute\("aria-label", "Games"\)/);
  assert.match(setupCatalogSource, /\/assets\/planets\/verb-nebula\.png/);
  assert.match(setupCatalogSource, /\/assets\/planets\/conjugation-comet\.png/);
  assert.match(setupCatalogSource, /\/assets\/planets\/word-world\.png/);
  assert.match(setupCatalogSource, /\/assets\/planets\/case-cosmos\.png/);
  assert.match(setupCatalogSource, /\/assets\/planets\/memory-moon\.png/);
  assert.match(setupCatalogSource, /\/assets\/planets\/agreement-aurora\.png/);
});

test("every shared page and the setup catalog use the new Chrome cache keys", () => {
  for (const page of pages) {
    assert.match(page, /caatuu-chrome\.css\?v=chrome-style-125/);
    assert.match(page, /caatuu-chrome\.js\?v=chrome-122/);
  }
  assert.match(setupCatalogSource, /caatuu-czech-pwa-v\d+/);
  assert.match(setupCatalogSource, /caatuu-chrome\.css\?v=chrome-style-125/);
  assert.match(setupCatalogSource, /caatuu-chrome\.js\?v=chrome-122/);
});

test("retired Guided Journey is absent while the live dictionary request remains", () => {
  assert.doesNotMatch(chrome, /guided-journey/);
  assert.match(chrome, /navigationRequest: "dictionary"/);
  assert.match(chrome, /data-navigation-request="\$\{tool\.navigationRequest\}"/);
});

test("shared settings own their About and legal presentation on every page", () => {
  assert.match(chromeCss, /\.about-brand-note\s*\{/);
  assert.match(chromeCss, /\.about-card\s*>\s*\.version-note\s*\{/);
  assert.match(chromeCss, /\.legal-notice\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\)/);
  assert.match(chromeCss, /\.legal-notice-icon\s*\{[\s\S]*?display:\s*inline-grid/);
  assert.match(chromeCss, /html\[data-theme="dark"\]\s+\.legal-notice\s*\{/);
});

test("shared headers stay focused while each game owns its theme control", () => {
  assert.doesNotMatch(chrome, /actions\.append\(theme, language\)/);
  assert.match(pages.find((page) => page.includes("trainPanelGalaxy")), /data-theme-toggle/);
  assert.match(canonicalPage, /id="wordNetDisplayToggle"/);
});
