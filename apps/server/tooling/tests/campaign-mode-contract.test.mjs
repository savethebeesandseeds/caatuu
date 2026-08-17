import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const staticRoot = new URL("apps/languages/czech/static/", repoRoot);

const [
  page,
  campaignStyles,
  app,
  chrome,
  chromeStyles,
  wordWorld,
  comet,
  caseCosmos,
  agreementAurora,
  serviceWorker,
  gamesPlan
] = await Promise.all([
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("source/features/campaign/campaign.css", staticRoot), "utf8"),
  readFile(new URL("source/games/verb-nebula/app.js", staticRoot), "utf8"),
  readFile(new URL("source/shared/chrome.js", staticRoot), "utf8"),
  readFile(new URL("source/shared/chrome.css", staticRoot), "utf8"),
  readFile(new URL("source/games/word-world/word-net.js", staticRoot), "utf8"),
  readFile(new URL("source/games/conjugation-comet/conjugation-comet.js", staticRoot), "utf8"),
  readFile(new URL("source/games/case-cosmos/case-cosmos.js", staticRoot), "utf8"),
  readFile(new URL("source/games/agreement-aurora/agreement-aurora.js", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  readFile(new URL("docs/GAMES.md", repoRoot), "utf8")
]);

test("Campaign Mode is a prominent mixed-play route with its requested artwork", () => {
  assert.match(page, /class="train-world train-world-campaign"[^>]*data-train-tab="campaign"/);
  assert.match(page, /src="\/assets\/planets\/campaign-mode\.png"/);
  assert.match(page, /source\/features\/campaign\/campaign\.css\?v=campaign-2/);
  assert.match(page, /id="campaignTransition"[\s\S]*?id="campaignTransitionRobot"/);
  assert.doesNotMatch(page, /Traveling to another planet|One successful round opens the next game/);
  assert.match(campaignStyles, /\.train-world-campaign[\s\S]*?left:\s*50%/);
  assert.match(campaignStyles, /@media screen and \(max-width: 760px\)[\s\S]*?\.train-world-campaign[\s\S]*?grid-column:\s*1 \/ -1/);
  assert.match(chromeStyles, /data-game-menu-target="campaign"[\s\S]*?width:\s*min\(calc\(100% - 24px\), 360px\)[\s\S]*?min-height:\s*104px/);
  assert.match(chromeStyles, /data-game-menu-target="campaign"\] img[\s\S]*?width:\s*88px[\s\S]*?height:\s*58px/);
  assert.match(serviceWorker, /campaign\.css\?v=campaign-2/);
  assert.match(serviceWorker, /\/assets\/planets\/campaign-mode\.png/);
});

test("Campaign Mode keeps route identity while a shuffled no-repeat planet plays", () => {
  const playableBlock = app.match(/const campaignPlayableTabs = Object\.freeze\(\[[\s\S]*?\]\);/)?.[0] || "";
  for (const gameId of ["verb-lab", "word-net", "conjugation-comet", "case-cosmos", "agreement-aurora"]) {
    assert.match(playableBlock, new RegExp(`"${gameId}"`));
  }
  assert.doesNotMatch(playableBlock, /memory-moon/);
  assert.match(app, /function nextCampaignTab\(previousTab = state\.trainTab\)[\s\S]*?state\.campaignQueue\[0\] === previousTab[\s\S]*?gameId !== previousTab/);
  assert.match(app, /document\.body\.dataset\.campaignActive = "true"/);
  assert.match(app, /const title = state\.campaignActive \? "Campaign Mode"/);
  assert.match(app, /button\.dataset\.trainTab === "campaign"/);
  assert.match(chrome, /campaign:\s*\{[\s\S]*?title: "Campaign Mode"[\s\S]*?campaign-mode\.png/);
  assert.match(chrome, /document\.body\?\.dataset\.campaignActive === "true"\) return "campaign"/);
  assert.match(chromeStyles, /data-game-menu-target="campaign"[\s\S]*?grid-column:\s*1 \/ -1/);
});

test("only genuine successful rounds signal the campaign shell", () => {
  assert.match(app, /if \(roundComplete && !state\.verbGuidedMode\)[\s\S]*?completeCampaignRound\("verb-lab", window\)/);
  assert.match(wordWorld, /if \(!guidedRound\)[\s\S]*?if \(round\.correct\) announceCampaignRoundSuccess\(\)/);

  const cometSuccess = comet.match(/function acceptCorrectPair\([\s\S]*?\n\}/)?.[0] || "";
  const cometReveal = comet.match(/function revealAnswers\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(cometSuccess, /matchedCueKeys\.size === state\.exerciseForms\.length[\s\S]*?announceRoundSuccess\(\)/);
  assert.doesNotMatch(cometReveal, /announceRoundSuccess/);

  assert.match(caseCosmos, /state\.matched\.size === round\.matches\.length[\s\S]*?record\(\{ rounds: 1, xp: 1 \}\);[\s\S]*?announceRoundSuccess\(\)/);
  assert.match(agreementAurora, /state\.matched\.size === round\.matches\.length[\s\S]*?record\(\{ rounds: 1, xp: 1 \}\);[\s\S]*?announceRoundSuccess\(\)/);
});

test("the shell validates iframe success and shows a robot before switching planets", () => {
  assert.match(app, /function handleCampaignGameMessage\(event\)[\s\S]*?event\.origin !== window\.location\.origin[\s\S]*?event\.source !== frame\.contentWindow/);
  assert.match(app, /message\?\.source !== "caatuu-game" \|\| message\.type !== "round-success"/);
  assert.match(app, /function completeCampaignRound\([\s\S]*?showCampaignTransition\([\s\S]*?waitForVerbTransition\(campaignTransitionMillis\)[\s\S]*?setTrainTab\(nextGameId\)/);
  assert.match(app, /fetch\(verbRobotKeymapUrl/);
  assert.match(wordWorld, /type: "campaign-advance"|event\.data\.type === "campaign-advance"/);
  assert.match(caseCosmos, /event\.data\.type !== "campaign-advance"[\s\S]*?nextRound\(\)/);
  assert.match(agreementAurora, /event\.data\.type !== "campaign-advance"[\s\S]*?nextRound\(\)/);
});

test("the first Campaign Mode click also shows the robot before revealing its first planet", () => {
  assert.match(app, /async function startCampaign\(\)[\s\S]*?setTrainTab\(firstGameId\)[\s\S]*?showCampaignTransition\(transitionId\)[\s\S]*?waitForVerbTransition\(campaignTransitionMillis\)[\s\S]*?hideCampaignTransition\(\)/);
  assert.match(app, /selectedTab === "campaign"[\s\S]*?void startCampaign\(\)/);
  assert.doesNotMatch(app, /campaignTransitionTitle|Traveling to/);
  assert.doesNotMatch(campaignStyles, /campaign-transition-card (?:span|strong|small)/);
});

test("the plan keeps challenge ownership in each planet and defers guided routing", () => {
  assert.match(gamesPlan, /Campaign Mode is shell-owned orchestration, not a new language-content planet/);
  assert.match(gamesPlan, /has no challenge JSON/);
  assert.match(gamesPlan, /selects both the next owning planet \*\*and the\s+exact challenge within it\*\*/);
  assert.match(gamesPlan, /This random first version is variety, not curriculum guidance/);
});
