import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const launcherRoot = new URL("apps/launcher/static/", repoRoot);
const staticRoot = new URL("apps/languages/czech/static/", repoRoot);
const mandarinStaticRoot = new URL("apps/languages/mandarin-simplified/static/", repoRoot);
const spanishStaticRoot = new URL("apps/languages/spanish/static/", repoRoot);
const appEntry = new URL("apps/language-runtime/static/app/index.html", repoRoot);
const sharedGameRoot = new URL("apps/language-runtime/static/games/", repoRoot);
const planetRoot = new URL("assets/planets/", launcherRoot);

const canonicalAssets = Object.freeze({
  "planet-word-net": "word-world.png",
  "planet-verb": "verb-nebula.png",
  "planet-conjugation": "conjugation-comet.png",
  "planet-case-cosmos": "case-cosmos.png",
  "planet-agreement-aurora": "agreement-aurora.png",
  "planet-campaign": "campaign-mode.png",
  "planet-memory": "memory-moon.png",
  "planet-sound-quasar": "sounds-quasar.png"
});

const mandarinOnlyAssets = Object.freeze({
  "planet-naturalization-nucleus": "naturalization-nucleus.png"
});

const [
  filenames,
  gamesPage,
  chrome,
  serviceWorker,
  setupManifest,
  mandarinSetupManifest,
  spanishSetupManifest,
  cometPage,
  casePage,
  agreementPage,
  agreementBytes,
  cometBytes,
  campaignBytes,
  campaignSourceBytes,
  naturalizationBytes,
  soundsQuasarBytes
] = await Promise.all([
  readdir(planetRoot),
  readFile(appEntry, "utf8"),
  readFile(new URL("apps/language-runtime/static/source/caatuu-chrome.js", repoRoot), "utf8"),
  readFile(new URL("setup-assets.json", staticRoot), "utf8"),
  readFile(new URL("setup-assets.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("setup-assets.json", mandarinStaticRoot), "utf8").then(JSON.parse),
  readFile(new URL("setup-assets.json", spanishStaticRoot), "utf8").then(JSON.parse),
  readFile(new URL("conjugation-comet.html", sharedGameRoot), "utf8"),
  readFile(new URL("case-cosmos.html", staticRoot), "utf8"),
  readFile(new URL("agreement-aurora.html", sharedGameRoot), "utf8"),
  readFile(new URL("assets/planets/agreement-aurora.png", launcherRoot)),
  readFile(new URL("assets/planets/conjugation-comet.png", launcherRoot)),
  readFile(new URL("assets/planets/campaign-mode.png", launcherRoot)),
  readFile(new URL("assets/visual-vocabulary/miscellaneous (7).png", launcherRoot)),
  readFile(new URL("assets/planets/naturalization-nucleus.png", launcherRoot)),
  readFile(new URL("assets/planets/sounds-quasar.png", launcherRoot))
]);

test("planet files use canonical game-based names without generic letter aliases", () => {
  const actualPngs = filenames.filter((name) => name.endsWith(".png")).sort();
  assert.deepEqual(actualPngs, [...Object.values(canonicalAssets), ...Object.values(mandarinOnlyAssets)].sort());
  assert.ok(actualPngs.every((name) => !/^planet_[A-D]\.png$/.test(name)));
  assert.ok(!actualPngs.includes("nebula.png"));
});

test("Naturalization Nucleus art is delivered only by the Mandarin course", () => {
  const filename = mandarinOnlyAssets["planet-naturalization-nucleus"];
  const publicUrl = `/assets/planets/${filename}`;
  assert.match(gamesPage + chrome, new RegExp(publicUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(mandarinSetupManifest.offline.assets.includes(publicUrl));
  assert.ok(!setupManifest.offline.assets.includes(publicUrl));
  assert.equal(
    mandarinSetupManifest.artifacts.find(({ key }) => key === "planet-naturalization-nucleus")?.url,
    publicUrl
  );
  assert.equal(
    createHash("sha256").update(naturalizationBytes).digest("hex"),
    "ac7954074fc337d42d3f1610f55c7f5e60dff722a6d9d0794972a13737d105cd"
  );
});

test("Sounds Quasar art is a shared coming-later asset for every browser course", () => {
  const publicUrl = "/assets/planets/sounds-quasar.png";
  assert.match(gamesPage + chrome, /\/assets\/planets\/sounds-quasar\.png/u);
  for (const manifest of [setupManifest, mandarinSetupManifest, spanishSetupManifest]) {
    assert.ok(manifest.offline.assets.includes(publicUrl));
  }
  const artifact = setupManifest.artifacts.find(({ key }) => key === "planet-sound-quasar");
  assert.equal(artifact?.url, publicUrl);
  assert.equal(artifact?.asset_path, "assets/planets/sounds-quasar.png");
  assert.equal(artifact?.bytes, 790655);
  assert.equal(artifact?.sha256, "aca07dcd615c021c00896ecd8698f14cf2f47522a64dc9e2a2cb539dc9a88e64");
  assert.equal(soundsQuasarBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(soundsQuasarBytes.readUInt32BE(16), 1254);
  assert.equal(soundsQuasarBytes.readUInt32BE(20), 1254);
  assert.equal(
    createHash("sha256").update(soundsQuasarBytes).digest("hex"),
    "aca07dcd615c021c00896ecd8698f14cf2f47522a64dc9e2a2cb539dc9a88e64"
  );
});

test("navigation, offline caching, pages, and setup delivery share those names", () => {
  const runtimeSources = [gamesPage, chrome, serviceWorker, cometPage, casePage, agreementPage].join("\n");
  assert.doesNotMatch(runtimeSources, /assets\/planets\/(?:planet_[A-D]|nebula)\.png/);

  for (const [key, filename] of Object.entries(canonicalAssets)) {
    const publicUrl = `/assets/planets/${filename}`;
    assert.match(gamesPage + chrome, new RegExp(publicUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(serviceWorker.includes(publicUrl), `service worker must precache ${publicUrl}`);
    const artifact = setupManifest.artifacts.find((entry) => entry.key === key);
    assert.equal(artifact?.url, publicUrl);
    assert.equal(artifact?.asset_path, `assets/planets/${filename}`);
  }
});

test("the generated Agreement Aurora runtime image is the reviewed RGBA artifact", () => {
  assert.equal(agreementBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(agreementBytes.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(agreementBytes.readUInt32BE(16), 1254);
  assert.equal(agreementBytes.readUInt32BE(20), 1254);
  assert.equal(agreementBytes[24], 8);
  assert.equal(agreementBytes[25], 6);
  assert.equal(
    createHash("sha256").update(agreementBytes).digest("hex"),
    "5fe5c25467d51dbec0c7e6600f187a685ccb0d42c34a47c3d1a737d2b6051966"
  );
});

test("Campaign Mode uses the requested miscellaneous spacecraft as a byte-identical alias", () => {
  assert.deepEqual(campaignBytes, campaignSourceBytes);
  assert.equal(
    createHash("sha256").update(campaignBytes).digest("hex"),
    "7a520ce44254c280ab463fcf0f5eb273ccdcbd29f7a3771e0d2843f8b825f4aa"
  );
});

test("the generated Conjugation Comet runtime image is the reviewed RGBA artifact", () => {
  assert.equal(cometBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(cometBytes.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(cometBytes.readUInt32BE(16), 1254);
  assert.equal(cometBytes.readUInt32BE(20), 1254);
  assert.equal(cometBytes[24], 8);
  assert.equal(cometBytes[25], 6);
  assert.equal(
    createHash("sha256").update(cometBytes).digest("hex"),
    "78e59571a850aa92a3c3d6862f676d1b7fad54137b8ad10a74ef2eaaba20fee0"
  );
});
