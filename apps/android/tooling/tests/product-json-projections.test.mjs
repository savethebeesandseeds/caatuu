import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transformManifest, transformWordWorldManifest, transformWebViewEmbeddingCatalog } from "../build-product-assets.mjs";

test("compact product app metadata preserves authored values while excluding disabled shortcuts", () => {
  const metadata = { name: "Caatuu", description: "Language practice", custom: { text: "Keep  spaces\nand Unicode: Čeština" },
    shortcuts: [{ name: "Practice", url: "./index.html" }, { name: "Chat", url: "./chat.html" }] };
  const input = JSON.stringify(metadata, null, 2);
  const output = transformManifest(input);
  assert.deepEqual(JSON.parse(output), { ...metadata, shortcuts: [metadata.shortcuts[0]] });
  assert.ok(Buffer.byteLength(output) < Buffer.byteLength(input));
  assert.equal(JSON.parse(input).shortcuts.length, 2, "authoring metadata is preserved");
});

test("compact Word World metadata preserves its standard content contract and authored whitespace", () => {
  const metadata = { mode: "standard", generationStrategy: { disabled: true },
    sessionProvider: { kind: "standard-corpus", note: "First line\n  indented second line" },
    chunks: [{ path: "data/words.json", sha256: "a".repeat(64), bytes: 1234 }] };
  const input = JSON.stringify(metadata, null, 2);
  const output = transformWordWorldManifest(input);
  const { generationStrategy, ...expected } = metadata;
  assert.deepEqual(JSON.parse(output), expected);
  assert.ok(Buffer.byteLength(output) < Buffer.byteLength(input));
});

test("compact native embedding metadata retains all provider and license values", async () => {
  const input = await readFile(new URL("../../../languages/mandarin-simplified/static/data/embeddings/catalog.json", import.meta.url), "utf8");
  const before = JSON.parse(input);
  const output = transformWebViewEmbeddingCatalog(input);
  assert.deepEqual(JSON.parse(output), { ...before, runtime: { ...before.runtime, modelDelivery: "android-setup-download" } });
  assert.ok(Buffer.byteLength(output) < Buffer.byteLength(input));
});
