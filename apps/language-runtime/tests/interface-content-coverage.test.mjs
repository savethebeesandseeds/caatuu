import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateInterfaceCatalog
} from "../static/source/interface-content.mjs";

const ENGLISH_CATALOG_URL = new URL("../static/data/interface/en.v1.json", import.meta.url);
const UI_CONSUMERS = Object.freeze([
  new URL("../static/app/index.html", import.meta.url),
  new URL("../static/source/app-bootstrap.mjs", import.meta.url),
  new URL("../static/source/developer-tools/developer-tools.mjs", import.meta.url),
  new URL("../static/source/developer-tools/audio-lab.mjs", import.meta.url),
  new URL("../static/source/developer-tools/catalog-inspectors.mjs", import.meta.url),
  new URL("../static/source/developer-tools/model-tools.mjs", import.meta.url),
  new URL("../static/source/caatuu-chrome.js", import.meta.url),
  new URL("../static/source/caatuu-workspace.js", import.meta.url),
  new URL("../static/source/legacy-page-bootstrap.mjs", import.meta.url),
  new URL("../static/source/maintenance-ui.js", import.meta.url),
  new URL("../static/source/games/grammar-gravity/grammar-gravity-host.mjs", import.meta.url),
  new URL("../static/source/product-word-world.mjs", import.meta.url),
  new URL("../../android/tooling/build-product-assets.mjs", import.meta.url),
  new URL("../../languages/czech/static/audio-lab.html", import.meta.url),
  new URL("../../languages/czech/static/case-cosmos.html", import.meta.url),
  new URL("../../languages/czech/static/chat.html", import.meta.url),
  new URL("../../languages/czech/static/embedding-images.html", import.meta.url),
  new URL("../../languages/czech/static/verb-difficulty.html", import.meta.url)
]);

const MESSAGE_ID = String.raw`[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+`;
const STATIC_REFERENCE_PATTERNS = Object.freeze([
  new RegExp(String.raw`\b(?:interfaceHtml|interfaceMessage|interfaceText|t)\(\s*["'](${MESSAGE_ID})["']`, "gu"),
  new RegExp(String.raw`\b(?:titleId|summaryId|labelId|messageId)\s*:\s*["'](${MESSAGE_ID})["']`, "gu")
]);
const STATIC_MARKER_PATTERN = new RegExp(
  String.raw`\bdata-i18n(?:-[a-z-]+)?\s*=\s*["'](${MESSAGE_ID})["']`,
  "gu"
);
const PLACEHOLDER_PATTERN = /\{[a-z][a-zA-Z0-9]*\}/u;

function collectMatches(source, pattern) {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

test("the English interface authority covers every static shared-app message reference", async () => {
  const catalog = JSON.parse(await readFile(ENGLISH_CATALOG_URL, "utf8"));
  assert.deepEqual(validateInterfaceCatalog(catalog), { valid: true, errors: [] });
  assert.deepEqual(
    Object.keys(catalog.messages),
    Object.keys(catalog.messages).sort(),
    "the authority stays deterministic and reviewable"
  );

  const references = new Map();
  const markerIds = new Set();
  for (const file of UI_CONSUMERS) {
    const source = await readFile(file, "utf8");
    const label = file.pathname.split("/").slice(-3).join("/");
    for (const pattern of STATIC_REFERENCE_PATTERNS) {
      for (const messageId of collectMatches(source, pattern)) {
        if (!references.has(messageId)) references.set(messageId, new Set());
        references.get(messageId).add(label);
      }
    }
    for (const messageId of collectMatches(source, STATIC_MARKER_PATTERN)) {
      markerIds.add(messageId);
      if (!references.has(messageId)) references.set(messageId, new Set());
      references.get(messageId).add(label);
    }
  }

  const missing = [...references]
    .filter(([messageId]) => !Object.hasOwn(catalog.messages, messageId))
    .map(([messageId, files]) => `${messageId} (${[...files].sort().join(", ")})`)
    .sort();
  assert.deepEqual(missing, [], "static UI references must exist in the English message authority");

  const invalidMarkers = [...markerIds].filter((messageId) => (
    typeof catalog.messages[messageId] !== "string"
    || PLACEHOLDER_PATTERN.test(catalog.messages[messageId])
  )).sort();
  assert.deepEqual(
    invalidMarkers,
    [],
    "declarative DOM markers cannot call plural or parameterized messages without parameters"
  );
});

test("the English authority explicitly names current and planned course languages", async () => {
  const catalog = JSON.parse(await readFile(ENGLISH_CATALOG_URL, "utf8"));
  assert.deepEqual(
    ["cs", "de", "en", "es", "fr", "ja", "ko", "zh", "zh.hans"]
      .map((language) => `languages.${language}`)
      .filter((messageId) => !Object.hasOwn(catalog.messages, messageId)),
    []
  );
});

test("noun landing interface copy comes from the learner-base catalog", async () => {
  const catalog = JSON.parse(await readFile(ENGLISH_CATALOG_URL, "utf8"));
  const host = await readFile(new URL("../static/source/games/grammar-gravity/noun-landing-host.mjs", import.meta.url), "utf8");
  const keys = new Set([
    ...[...host.matchAll(/\bt\("([a-z]+)"/gu)].map((match) => match[1]),
    // These are selected through the result state and information labels.
    "correct", "incorrect", "help", "info", "loading"
  ]);
  for (const key of ["arena", "lane", "result"]) assert.ok(keys.has(key));
  for (const key of keys) assert.equal(typeof catalog.messages[`games.grammargravity.nouns.${key}`], "string", key);
  for (const key of ["choose", "correction", "drop", "instruction", "next", "pause", "paused", "progress", "ready", "readyuntimed", "restart", "resume", "reviewrequired", "settings", "start", "steer", "streak", "summary", "title", "untimed"]) {
    assert.equal(Object.hasOwn(catalog.messages, `games.grammargravity.nouns.${key}`), false, `obsolete noun UI: ${key}`);
  }
  assert.doesNotMatch(host, /textContent\s*=\s*session\.item\.english/u);
});

test("shared source-language UI does not expose raw provider or native error prose", async () => {
  const workspace = await readFile(new URL("../static/source/caatuu-workspace.js", import.meta.url), "utf8");
  const chrome = await readFile(new URL("../static/source/caatuu-chrome.js", import.meta.url), "utf8");
  const maintenance = await readFile(new URL("../static/source/maintenance-ui.js", import.meta.url), "utf8");

  assert.doesNotMatch(workspace, /setText\("#maintenanceStatus",\s*(?:error|message)\?*\.message/gu);
  assert.doesNotMatch(chrome, /reportStatus\.textContent\s*=\s*error\?*\.message/gu);
  assert.doesNotMatch(chrome, /localAiAvailability\?*\.\([^)]*\)\?*\.message/gu);
  assert.doesNotMatch(maintenance, /return\s+message\?*\.message/gu);
});
