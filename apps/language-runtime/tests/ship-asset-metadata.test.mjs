import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { manualEnglishDescriptionEmbeddingInput } from "../../../tools/semantic-index/src/contract.mjs";
import { imageVectorKey, readImageEmbeddingIndex } from "../static/source/image-embedding-index.mjs";

const root = new URL("../../../", import.meta.url);
const metadataPath = "apps/launcher/static/assets/ships/meta.json";
const metadataUrl = "/assets/ships/meta.json";
const indexUrl = "/language-runtime/static/data/image-embeddings/minilm-v1.json";
const readJson = async name => JSON.parse(await readFile(new URL(name, root), "utf8"));
const metadata = await readJson(metadataPath);

test("ship metadata covers every PNG and declares an image-plane heading independently of its embedding", async () => {
  const files = (await readdir(new URL("apps/launcher/static/assets/ships/", root))).filter(name => name.endsWith(".png"));
  assert.ok(files.length > 0);
  assert.deepEqual(Object.keys(metadata).sort(), files.map(name => `/assets/ships/${encodeURIComponent(name)}`).sort());
  for (const [path, entry] of Object.entries(metadata)) {
    assert.equal(entry.category, "ship", path);
    assert.ok(Number.isFinite(entry.orientation?.heading_degrees), path);
    assert.ok(entry.orientation.heading_degrees >= 0 && entry.orientation.heading_degrees < 360, path);
    assert.deepEqual(entry.embedding, {
      index: indexUrl, model_id: "all-minilm-l6-v2-qint8-v0.1", source_kind: "ship_asset", asset_path: path,
    });
    const input = manualEnglishDescriptionEmbeddingInput(entry);
    assert.equal(input.text, entry.description);
    const rotated = { ...entry, orientation: { heading_degrees: (entry.orientation.heading_degrees + 90) % 360 } };
    assert.deepEqual(manualEnglishDescriptionEmbeddingInput(rotated), input);
  }
});

test("ship catalog is mapped for delivery and cached once with its exact hash", async () => {
  const assets = await readJson("apps/language-runtime/app-assets.json");
  const mappings = assets.assets.filter(item => item.output === metadataUrl.slice(1));
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].source, metadataPath);
  const setup = await readJson("apps/languages/czech/static/setup-assets.json");
  assert.equal(new Set(setup.artifacts.map(item => item.url)).size, setup.artifacts.length);
  assert.ok(setup.offline.assets.includes(metadataUrl));
  const artifacts = setup.artifacts.filter(item => item.url === metadataUrl);
  assert.equal(artifacts.length, 1);
  const bytes = await readFile(new URL(metadataPath, root));
  assert.equal(artifacts[0].bytes, bytes.length);
  assert.equal(artifacts[0].sha256, createHash("sha256").update(bytes).digest("hex"));
});

test("every ship description resolves to the shared vector index", async () => {
  const index = readImageEmbeddingIndex(await readJson(indexUrl.replace(/^\//u, "apps/")));
  for (const [path, entry] of Object.entries(metadata)) {
    const row = index.get(imageVectorKey({ path, sourceKind: entry.embedding.source_kind }));
    assert.ok(row, path);
    assert.equal(row.embeddingText, entry.description);
    assert.equal(row.vector.length, 384);
  }
});
