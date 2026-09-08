import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapLegacyPage } from "../static/source/legacy-page-bootstrap.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

function fixture() {
  const { document, window } = createBrowserHarness({
    location: { href: "https://caatuu.test/cz/case-cosmos.html", pathname: "/cz/case-cosmos.html" }
  });
  const ready = [];
  document.addEventListener("caatuu:legacy-page-ready", () => ready.push(document.documentElement.dataset.caatuuLegacyPageReady));
  const options = {
    course: { routePrefix: "/cz", sourceLanguage: { locale: "en", direction: "ltr" } },
    documentRef: document,
    locationHref: window.location.href,
    featureModule: "source/games/case-cosmos/case-cosmos.js?v=case-cosmos-test",
    loadInterface: async () => ({ apply() {} }),
    installInterface(content) { window.CaatuuI18n = content; },
    async loadShared(src) {
      if (src.includes("caatuu-chrome.js")) window.CaatuuChrome = { getSpeechMuted: () => true };
    },
    async initializeMusic() { window.CaatuuMusic = {}; },
    async importFeature() {}
  };
  return { document, window, options, ready };
}

test("legacy games receive music after their locale and saved mute preferences are available", async () => {
  const { document, window, options, ready } = fixture();
  let music;
  options.initializeMusic = async () => {
    assert.ok(window.CaatuuI18n);
    assert.equal(window.CaatuuChrome.getSpeechMuted(), true);
    const style = document.querySelector("link[data-caatuu-music-styles]");
    assert.equal(style.rel, "stylesheet");
    assert.equal(style.href, "/language-runtime/static/styles/music-controls.css");
    music = { savedMute: true };
    window.CaatuuMusic = music;
    assert.deepEqual(ready, [], "mounting music must not imply setup or page readiness");
  };
  options.importFeature = async () => {
    assert.equal(window.CaatuuMusic, music, "the feature must see the installed player");
    assert.deepEqual(ready, []);
  };
  await bootstrapLegacyPage(options);
  assert.deepEqual(ready, ["true"]);
  assert.equal(document.documentElement.dataset.caatuuAppReady, undefined,
    "a legacy feature loading cannot claim that setup completed");
});

test("legacy Settings styles are loaded once even when a page is initialized again", async () => {
  const { document, options } = fixture();
  await bootstrapLegacyPage(options);
  await bootstrapLegacyPage(options);
  assert.equal(document.querySelectorAll("link[data-caatuu-music-styles]").length, 1);
});

test("a failed legacy feature cannot announce readiness to the music player", async () => {
  const { document, options, ready } = fixture();
  options.importFeature = async () => { throw new Error("feature unavailable"); };
  await assert.rejects(bootstrapLegacyPage(options), /feature unavailable/u);
  assert.deepEqual(ready, []);
  assert.equal(document.documentElement.dataset.caatuuLegacyPageReady, undefined);
});

test("unsafe legacy feature routes are rejected before music starts", async () => {
  const { options, ready } = fixture();
  let initialized = false;
  options.featureModule = "https://another.test/game.js";
  options.initializeMusic = async () => { initialized = true; };
  await assert.rejects(bootstrapLegacyPage(options), /confined/u);
  assert.equal(initialized, false);
  assert.deepEqual(ready, []);
});
