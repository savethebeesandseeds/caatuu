import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  CAMPAIGN_GAME_IDS,
  GAME_IDS,
  NON_CAMPAIGN_GAME_IDS,
  PLANET_GAME_CONTRACT,
  availableDeveloperLinks,
  availableGames,
  availableGameIds,
  availableSettingsSectionIds,
  derivePrimaryNavigation,
  deriveShellPolicy,
  gameAvailable,
  gameState,
  hasAvailableGames,
  isDeveloperLinkAvailable,
  isGameAvailable,
  localAiAvailability,
  normalizeGameId,
  presentedGameIds,
  targetScriptToken,
  visiblePrimaryNavigation,
  visibleSettings
} from "../static/source/shell-policy.mjs";

async function json(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), "utf8"));
}

const czech = await json("../../languages/czech/course.json");
const mandarin = await json("../../languages/mandarin-simplified/course.json");
const spanish = await json("../../languages/spanish/course.json");

test("both retired identities resolve to one canonical Grammar Gravity planet", () => {
  for (const legacyId of ["agreement-aurora", "triangular-thermosphere"]) {
    assert.equal(normalizeGameId(` ${legacyId} `), "grammar-gravity");
    assert.equal(normalizeGameId(normalizeGameId(legacyId)), "grammar-gravity");
    assert.equal(GAME_IDS.includes(legacyId), false);
    assert.equal(CAMPAIGN_GAME_IDS.includes(legacyId), false);
  }
  assert.equal(normalizeGameId("grammar-gravity"), "grammar-gravity");
  assert.equal(normalizeGameId("word-net"), "word-net");
  assert.equal(normalizeGameId(null), "");
  assert.equal(GAME_IDS.filter((id) => id === "grammar-gravity").length, 1);
  assert.equal(CAMPAIGN_GAME_IDS.filter((id) => id === "grammar-gravity").length, 1);

  const course = {
    capabilities: {},
    games: ["grammar-gravity"],
    linguisticFeatures: ["grammatical-agreement"],
    routes: { grammarGravity: "/language-runtime/static/games/grammar-gravity.html" }
  };
  assert.deepEqual(availableGames(course), ["campaign", "grammar-gravity"]);
  for (const gameId of ["agreement-aurora", "triangular-thermosphere", "grammar-gravity"]) {
    assert.equal(gameAvailable(course, gameId), true);
    assert.equal(gameState(course, gameId), "playable");
    assert.equal(gameAvailable({ ...course, games: [] }, gameId), false,
      "compatibility must not bypass course availability");
    assert.equal(gameState({ ...course, games: [] }, gameId), "hidden");
    assert.equal(gameAvailable({ ...course, routes: {} }, gameId), false);
    assert.equal(gameAvailable({ ...course, linguisticFeatures: [] }, gameId), false);
    assert.equal(gameState({ ...course, games: [], upcomingGames: ["grammar-gravity"] }, gameId), "upcoming");
  }
});

test("target-script presentation is reusable by any course with the same writing system", async () => {
  assert.equal(targetScriptToken(mandarin), "Hans");
  assert.equal(targetScriptToken({
    id: "future-hans-course",
    targetLanguage: { id: "yue", script: "Hans" }
  }), "Hans");
  assert.equal(targetScriptToken({ targetLanguage: { script: "invalid" } }), "Zyyy");

  const styles = await readFile(new URL("../static/styles/caatuu-workspace.css", import.meta.url), "utf8");
  const hanziRules = styles.slice(styles.indexOf("/* Keep Hanzi and pinyin"), styles.indexOf("/* Embedded games"));
  assert.match(hanziRules, /body\[data-target-script\^="Han"\]/u);
  assert.doesNotMatch(hanziRules, /data-course-id/u);
});

test("feature bootstrap follows independent game and provider declarations", async () => {
  const bootstrap = await readFile(new URL("../static/source/app-bootstrap.mjs", import.meta.url), "utf8");
  const providers = bootstrap.slice(
    bootstrap.indexOf("async function loadCourseFeatureProviders"),
    bootstrap.indexOf("async function registerCourseServiceWorker")
  );
  assert.doesNotMatch(providers, /source\/games\/(?:case-cosmos|grammar-gravity)\/launcher\.css/u);
  assert.doesNotMatch(providers, /capabilities\?\.verbs|\bconst verbs\b/u);
  for (const provider of [
    "semanticLearningProvider",
    "setupProgressProvider",
    "setupProvider"
  ]) {
    assert.match(providers, new RegExp(`"${provider}"`, "u"));
  }
  assert.match(providers, /declaredBrowserProvider\(providerName\)/u);
});

test("classic source exposes an immutable browser-compatible global", async () => {
  const source = await readFile(new URL("../static/source/shell-policy.js", import.meta.url), "utf8");
  const browser = {};
  vm.runInNewContext(source, browser, { filename: "shell-policy.js" });

  assert.equal(typeof browser.CaatuuShellPolicy?.deriveShellPolicy, "function");
  assert.equal(Object.isFrozen(browser.CaatuuShellPolicy), true);
  assert.equal(Object.isFrozen(browser.CaatuuShellPolicy.PLANET_GAME_CONTRACT), true);
  assert.equal(Object.isFrozen(browser.CaatuuShellPolicy.PLANET_GAME_CONTRACT.planets), true);
  assert.equal(Object.isFrozen(browser.CaatuuShellPolicy.NON_CAMPAIGN_GAME_REGISTRY), true);
});

test("one declarative planet contract governs IDs, requirements, and Campaign eligibility", () => {
  assert.deepEqual(GAME_IDS, ["campaign", ...NON_CAMPAIGN_GAME_IDS]);
  assert.deepEqual(
    NON_CAMPAIGN_GAME_IDS,
    Object.keys(PLANET_GAME_CONTRACT.planets)
  );
  assert.deepEqual(CAMPAIGN_GAME_IDS, [
    "verb-lab",
    "word-net",
    "conjugation-comet",
    "case-cosmos",
    "grammar-gravity"
  ]);
  assert.equal(PLANET_GAME_CONTRACT.campaign.minimumEligibleGames, 1);
  assert.deepEqual(
    PLANET_GAME_CONTRACT.planets["naturalization-nucleus"].linguisticFeatures,
    ["hanzi-pinyin"]
  );
  assert.equal(
    PLANET_GAME_CONTRACT.planets["naturalization-nucleus"].resources[0].name,
    "naturalizationNucleusCatalog"
  );
  assert.deepEqual(PLANET_GAME_CONTRACT.planets["sound-quasar"].capabilities, ["speech"]);
  assert.equal(PLANET_GAME_CONTRACT.planets["sound-quasar"].implementationState, "implemented");
  assert.equal(PLANET_GAME_CONTRACT.planets["sound-quasar"].campaignEligible, false);
  assert.equal(
    PLANET_GAME_CONTRACT.planets["conjugation-comet"].sharedHost,
    "/language-runtime/static/games/conjugation-comet.html"
  );
  assert.equal(
    PLANET_GAME_CONTRACT.planets["grammar-gravity"].sharedHost,
    "/language-runtime/static/games/grammar-gravity.html"
  );
  for (const game of Object.values(PLANET_GAME_CONTRACT.planets)) {
    for (const resource of game.resources) {
      assert.match(resource.englishAuditContract, /-v[1-9]\d*$/u);
    }
  }
});

test("Czech receives the complete shared navigation, game, and settings matrix", () => {
  const policy = deriveShellPolicy(czech);

  assert.deepEqual(policy.primaryNavigation.map(({ id }) => id), ["home", "games", "backpack"]);
  assert.deepEqual(visiblePrimaryNavigation(czech), ["home", "games", "backpack"]);
  assert.deepEqual(policy.games, [
    "campaign",
    "verb-lab",
    "word-net",
    "conjugation-comet",
    "case-cosmos",
    "grammar-gravity",
    "sound-quasar"
  ]);
  assert.deepEqual(policy.presentedGames, [...policy.games.slice(0, -1), "memory-moon", "sound-quasar"]);
  assert.equal(gameState(czech, "memory-moon"), "upcoming");
  assert.equal(gameState(czech, "sound-quasar"), "playable");
  assert.deepEqual(policy.settingsSections, [
    "items",
    "progress",
    "appearance",
    "course-storage",
    "speech",
    "ai-model",
    "chat",
    "dictionary"
  ]);
  assert.equal(policy.gameAvailability.campaign, true);
  assert.equal(hasAvailableGames(czech), true);
  assert.equal(gameAvailable(czech, "grammar-gravity"), true);
  assert.deepEqual(availableGames(czech), policy.games);
  assert.deepEqual(visibleSettings(czech), policy.settingsSections);
  assert.equal(policy.settingsSections.includes("pronunciation"), false);
});

test("Mandarin keeps the shared settings structure while precise unsupported controls stay gated", () => {
  const policy = deriveShellPolicy(mandarin);

  assert.deepEqual(policy.primaryNavigation.map(({ id }) => id), ["home", "games", "backpack"]);
  assert.deepEqual(policy.games, ["campaign", "verb-lab", "word-net", "naturalization-nucleus", "sound-quasar"]);
  assert.deepEqual(policy.presentedGames, ["campaign", "verb-lab", "word-net", "naturalization-nucleus", "memory-moon", "sound-quasar"]);
  assert.deepEqual(policy.settingsSections, ["items", "progress", "appearance", "course-storage", "speech", "ai-model"]);
  assert.equal(policy.gameAvailability["verb-lab"], true);
  assert.equal(mandarin.capabilities.verbs, false, "game availability must not load the legacy Czech provider bundle");
  assert.equal(gameState(mandarin, "memory-moon"), "upcoming");
  assert.equal(gameState(mandarin, "sound-quasar"), "playable");
  assert.deepEqual(presentedGameIds(mandarin), policy.presentedGames);
  assert.equal(policy.gameAvailability["case-cosmos"], false);
  assert.equal(policy.gameAvailability["grammar-gravity"], false);
  assert.equal(policy.gameAvailability["naturalization-nucleus"], true);
});

test("Spanish projects its authored grammar games through the same shared shell matrix", () => {
  const policy = deriveShellPolicy(spanish);

  assert.deepEqual(policy.primaryNavigation.map(({ id }) => id), ["home", "games", "backpack"]);
  assert.deepEqual(policy.games, [
    "campaign",
    "verb-lab",
    "word-net",
    "conjugation-comet",
    "grammar-gravity",
    "sound-quasar"
  ]);
  assert.deepEqual(policy.presentedGames, [...policy.games.slice(0, -1), "memory-moon", "sound-quasar"]);
  assert.deepEqual(policy.settingsSections, [
    "items",
    "progress",
    "appearance",
    "course-storage",
    "speech",
    "ai-model"
  ]);
  assert.equal(spanish.capabilities.verbs, false);
  assert.equal(spanish.capabilities.conjugationComet, true);
  assert.equal(gameAvailable(spanish, "conjugation-comet"), true);
  assert.equal(gameAvailable(spanish, "grammar-gravity"), true);
  assert.equal(gameAvailable(spanish, "case-cosmos"), false);
  assert.equal(gameState(spanish, "memory-moon"), "upcoming");
  assert.equal(gameState(spanish, "sound-quasar"), "playable");
});

test("Sounds Quasar is shared speech practice outside Campaign", () => {
  for (const course of [czech, mandarin, spanish]) {
    assert.equal(course.upcomingGames.includes("sound-quasar"), false, course.id);
    assert.equal(gameState(course, "sound-quasar"), "playable", course.id);
    assert.equal(isGameAvailable("sound-quasar", course), true, course.id);
    assert.equal(course.routes.soundQuasar, "/language-runtime/static/games/sound-quasar.html");
    assert.equal(course.resources.soundQuasarCatalog.revision, "sound-quasar-items-v2");
    const noSpeech = structuredClone(course);
    noSpeech.capabilities.speech = false;
    assert.equal(isGameAvailable("sound-quasar", noSpeech), false);
    const noRoute = structuredClone(course);
    delete noRoute.routes.soundQuasar;
    assert.equal(isGameAvailable("sound-quasar", noRoute), false);
  }
  assert.equal(CAMPAIGN_GAME_IDS.includes("sound-quasar"), false);
});

test("Games remains visible when Word World is the only playable game and verbs are disabled", () => {
  const capabilities = {
    verbs: false,
    wordWorld: true,
    conjugationComet: false,
    dictionary: false,
    memory: false
  };

  assert.deepEqual(availableGameIds(capabilities), ["campaign", "word-net"]);
  assert.deepEqual(derivePrimaryNavigation(capabilities).map(({ id }) => id), [
    "home",
    "games",
    "backpack"
  ]);
  assert.equal(isGameAvailable("campaign", capabilities), true);
});

test("Games is omitted only when no registered game is playable", () => {
  assert.deepEqual(availableGameIds({}), []);
  assert.deepEqual(derivePrimaryNavigation({}).map(({ id }) => id), ["home", "backpack"]);
});

test("game lookup is fail-closed for unknown IDs, undeclared games, and missing linguistic features", () => {
  assert.equal(isGameAvailable("unknown-game", czech), false);
  assert.equal(isGameAvailable("case-cosmos", {
    capabilities: {},
    linguisticFeatures: ["grammatical-case"],
    games: []
  }), false);
  assert.equal(isGameAvailable("grammar-gravity", {
    capabilities: {},
    linguisticFeatures: [],
    games: ["grammar-gravity"],
    routes: { grammarGravity: "grammar-gravity.html" }
  }), false);
  assert.equal(isGameAvailable("case-cosmos", {
    capabilities: {},
    linguisticFeatures: ["grammatical-case"],
    games: ["case-cosmos"],
    routes: { caseCosmos: "case-cosmos.html" }
  }), true);
  assert.equal(isGameAvailable("naturalization-nucleus", {
    capabilities: {},
    linguisticFeatures: [],
    games: ["naturalization-nucleus"],
    routes: { naturalizationNucleus: "index.html?game=naturalization-nucleus" }
  }), false);
});

test("Campaign is synthesized only from explicitly eligible playable planets", () => {
  const naturalizationOnly = {
    capabilities: {},
    linguisticFeatures: ["hanzi-pinyin"],
    games: ["naturalization-nucleus"],
    routes: { naturalizationNucleus: "index.html?game=naturalization-nucleus" }
  };
  assert.equal(isGameAvailable("naturalization-nucleus", naturalizationOnly), true);
  assert.equal(isGameAvailable("campaign", naturalizationOnly), false);

  const memoryOnly = {
    capabilities: { memory: true },
    linguisticFeatures: [],
    games: ["memory-moon"],
    routes: { memoryMoon: "index.html?game=memory-moon" }
  };
  assert.equal(isGameAvailable("memory-moon", memoryOnly), true);
  assert.equal(isGameAvailable("campaign", memoryOnly), false);
});

test("course game routes are explicit while capability-only fixtures stay usable", () => {
  const course = {
    capabilities: { wordWorld: true, memory: true },
    linguisticFeatures: [],
    games: ["word-net"],
    routes: { wordWorld: "word-world.html" }
  };
  assert.deepEqual(availableGameIds(course), ["campaign", "word-net"]);
  assert.equal(isGameAvailable("memory-moon", course), false);
  assert.equal(gameState({ ...course, upcomingGames: ["memory-moon"] }, "memory-moon"), "upcoming");
  assert.equal(gameState({ ...course, upcomingGames: ["sound-quasar"] }, "sound-quasar"), "upcoming");
  assert.deepEqual(availableGameIds({ wordWorld: true, memory: true }), [
    "campaign",
    "word-net",
    "memory-moon"
  ]);
});

test("AI/model settings remain in the shared structure regardless of course capability", () => {
  for (const capability of ["llm", "generation", "offlineModels"]) {
    assert.equal(availableSettingsSectionIds({ [capability]: true }).includes("ai-model"), true);
  }
  assert.equal(availableSettingsSectionIds({}).includes("ai-model"), true);
});

test("local AI requires both course support and runtime enablement", () => {
  const browserRuntime = {
    env: "browser",
    capabilities: { webGpu: true },
    models: { generate() {} }
  };
  const nativeRuntime = {
    env: "android",
    models: { generate() {} }
  };

  assert.deepEqual(localAiAvailability(czech, browserRuntime, "generation"), {
    feature: "generation",
    supported: true,
    enabled: false,
    reason: "runtime-disabled",
    message: "Local AI is currently disabled in this app. No model will be downloaded or loaded."
  });
  assert.equal(localAiAvailability(czech, nativeRuntime, "generation").enabled, true);
  assert.equal(localAiAvailability(czech, nativeRuntime, "chat").enabled, true);
  assert.deepEqual(localAiAvailability(mandarin, nativeRuntime, "generation"), {
    feature: "generation",
    supported: false,
    enabled: false,
    reason: "course-unsupported",
    message: "Local AI is not available for this course. These controls are disabled, and no generation model will be downloaded or loaded."
  });
  assert.equal(localAiAvailability(czech, {
    ...browserRuntime,
    featureAvailability: { generation: { enabled: true } }
  }, "generation").enabled, true, "a future browser runtime can opt in explicitly");
  assert.equal(localAiAvailability(czech, {
    ...nativeRuntime,
    featureAvailability: { generation: { enabled: false } }
  }, "generation").enabled, false, "an explicit runtime disable overrides native implementation presence");
});

test("developer links require both an enabled capability and an explicit usable route or path", () => {
  const candidates = [
    { id: "dictionary", capability: "dictionary", path: "index.html?view=dictionary" },
    { id: "conjugation", capability: "conjugationComet", route: "conjugationComet" },
    { id: "missing-route", capability: "dictionary", route: "missingDeveloperRoute" },
    { id: "disabled", capability: "pronunciationGuides", path: "pronunciation.html" },
    { id: "missing-capability", path: "debug.html" }
  ];

  assert.deepEqual(
    availableDeveloperLinks(czech, candidates).map(({ id, href }) => [id, href]),
    [
      ["dictionary", "index.html?view=dictionary"],
      ["conjugation", czech.routes.conjugationComet]
    ]
  );
  assert.equal(isDeveloperLinkAvailable(mandarin, {
    capability: "wordWorld",
    route: "wordWorld"
  }), true);
  assert.equal(isDeveloperLinkAvailable(mandarin, {
    capability: "dictionary",
    path: "dictionary.html"
  }), false);
  assert.deepEqual(availableDeveloperLinks(czech, null), []);
});
