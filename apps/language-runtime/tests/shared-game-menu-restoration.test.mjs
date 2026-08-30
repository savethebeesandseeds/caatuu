import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const chromeSource = await readFile(
  new URL("../static/source/caatuu-chrome.js", import.meta.url),
  "utf8"
);
const selectionStart = chromeSource.indexOf("function selectGameFromMenu(gameId)");
const selectionEnd = chromeSource.indexOf("function currentGameId()", selectionStart);
const selectionSource = chromeSource.slice(selectionStart, selectionEnd);

function navigationFixture({ sharedGamesView = "hidden" } = {}) {
  let clicks = 0;
  let remembered = "";
  let closes = 0;
  const gamesView = sharedGamesView === "absent"
    ? null
    : { classList: { contains: (name) => name === "is-active" && sharedGamesView === "active" } };
  const context = {
    course: { routes: { games: "index.html" } },
    currentGameId: () => "word-net",
    normalizeGameId: (value) => value,
    closeGameMenu() { closes += 1; },
    closeSharedSettings() {},
    gamePresentationHref: () => "fallback.html",
    rememberActiveGame(value) { remembered = value; },
    rememberNavigationRequest() {},
    document: {
      querySelector(selector) {
        if (selector === "#settingsPanel") return null;
        if (selector === "#view-verbs") return gamesView;
        if (selector === '[data-train-tab="word-net"]') return { click() { clicks += 1; } };
        return null;
      }
    },
    window: { location: { href: "" } }
  };
  vm.runInNewContext(`${selectionSource}\nthis.selectGame = selectGameFromMenu;`, context);
  return {
    select: () => context.selectGame("word-net"),
    clicks: () => clicks,
    remembered: () => remembered,
    closes: () => closes
  };
}

test("Home to Games to the remembered game restores the shared game view", () => {
  const fixture = navigationFixture({ sharedGamesView: "hidden" });
  fixture.select();
  assert.equal(fixture.clicks(), 1, "the local game tab must restore the hidden Games view");
  assert.equal(fixture.remembered(), "word-net");
  assert.equal(fixture.closes(), 1);
});

test("selecting the already visible game only closes the chooser", () => {
  for (const sharedGamesView of ["active", "absent"]) {
    const fixture = navigationFixture({ sharedGamesView });
    fixture.select();
    assert.equal(fixture.clicks(), 0);
    assert.equal(fixture.remembered(), "");
    assert.equal(fixture.closes(), 1);
  }
});
