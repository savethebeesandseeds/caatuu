import assert from "node:assert/strict";
import test from "node:test";

import {
  productApkCanonicalEntryMatches,
  productApkAuditPlan,
  unzip,
  unzipBuffer
} from "../audit-runtime-boundary.mjs";

test("the runtime audit plans product APK assets from capabilities", () => {
  const plan = productApkAuditPlan({
    schemaVersion: 1,
    profile: "product",
    capabilities: {
      chat: false,
      llm: false,
      generation: false,
      godot: false,
      embeddings: true,
      dictionary: true,
      wordWorldStandardOnly: true
    }
  });

  assert.ok(plan.requiredEntries.includes("assets/caatuu-profile.json"));
  assert.ok(plan.requiredEntries.includes("assets/data/embeddings/all-minilm-l6-v2-qint8-v0.1/manifest.json"));
  assert.ok(plan.requiredEntries.includes("assets/data/dictionaries/catalog.json"));
  assert.ok(plan.requiredEntries.includes("assets/language-runtime/static/source/word-world-provider.mjs"));
  assert.ok(plan.requiredEntries.includes("assets/source/games/word-world/word-net-standard.mjs"));
  assert.ok(plan.requiredEntries.includes("assets/data/games/word-world/standard-v0.1/records.json"));
  assert.ok(!plan.requiredEntries.includes("assets/word-net.html"));
  assert.ok(!plan.requiredEntries.includes("assets/source/games/word-world/word-net.js"));
  assert.ok(!plan.requiredEntries.includes("assets/chat.html"));
  assert.ok(!plan.requiredEntries.includes("assets/source/features/chat/chat.js"));
  assert.ok(!plan.requiredEntries.includes("assets/data/models/phone-bench/models.json"));
  assert.ok(!plan.requiredEntries.includes("assets/data/embeddings/caatuu-local-hash-v0.1/manifest.json"));
  assert.ok(plan.forbiddenEntryPatterns.some((pattern) => pattern.test("assets/chat.html")));
  assert.ok(plan.forbiddenEntryPatterns.some((pattern) => pattern.test("assets/source/features/chat/chat.js")));
  for (const retiredWordWorldEntry of [
    "assets/source/games/word-world/word-net.js",
    "assets/source/games/word-world/word-net.css",
    "assets/source/games/word-world/word-net-core.mjs",
    "assets/source/games/word-world/word-net-queue.mjs"
  ]) {
    assert.ok(
      plan.forbiddenEntryPatterns.some((pattern) => pattern.test(retiredWordWorldEntry)),
      retiredWordWorldEntry,
    );
  }
  assert.ok(
    !plan.forbiddenEntryPatterns.some((pattern) => pattern.test("assets/language-runtime/static/source/word-net-core.mjs")),
  );
});

test("schema-v2 product APKs bind their entry document to the canonical shared app", () => {
  const schema2 = { schemaVersion: 2, profile: "product" };
  const schema1 = { schemaVersion: 1, profile: "product" };
  const canonical = Buffer.from("canonical shared app");

  assert.equal(productApkCanonicalEntryMatches(schema2, Buffer.from(canonical), canonical), true);
  assert.equal(productApkCanonicalEntryMatches(schema2, Buffer.from("parallel app"), canonical), false);
  assert.equal(productApkCanonicalEntryMatches(schema1, Buffer.from("legacy entry"), canonical), true);
});

test("archive fallback is reserved for a missing unzip executable", () => {
  const memberFailure = Object.assign(new Error("missing archive member"), { status: 11 });
  assert.throws(() => unzip(["-Z1", "app.apk"], () => { throw memberFailure; }), memberFailure);
  assert.throws(() => unzipBuffer("app.apk", "assets/missing.js", () => { throw memberFailure; }), memberFailure);

  const calls = [];
  const fallback = (command, args) => {
    calls.push([command, args]);
    if (command === "unzip") throw Object.assign(new Error("not installed"), { code: "ENOENT" });
    return "assets/index.html\n";
  };
  assert.equal(unzip(["-Z1", "app.apk"], fallback), "assets/index.html\n");
  assert.deepEqual(calls.map(([command]) => command), ["unzip", "tar"]);
});
