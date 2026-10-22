import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { planProductDelivery } from "../product-delivery.mjs";
import { assertBootstrapDeliveryBytes } from "../validate-product-package.mjs";

const json = value => Buffer.from(`${JSON.stringify(value)}\n`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture({ sealVector = true } = {}) {
  const catalogPath = "courses/cz/data/embeddings/models.json";
  const databasePath = "courses/cz/data/embeddings/v1/curriculum.sqlite";
  const manifestPath = "courses/cz/data/embeddings/v1/manifest.json";
  const database = Buffer.from("reviewed native vector database");
  const model = { key: "v1", status: "active", artifact_kind: "embedding-vector-db",
    model_file: "v1/curriculum.sqlite", manifest_file: "v1/manifest.json",
    bytes: database.length, sha256: hash(database) };
  const bundle = { courses: [{ id: "cz", assetPrefix: "courses/cz", nativeProviders: { providers: {
    embeddings: { implementation: "vector-database-catalog-v1", catalogAsset: catalogPath },
  } } }] };
  const files = new Map([
    ["index.html", Buffer.from("<html></html>")],
    ["caatuu-profile.json", json({ assets: [] })],
    ["caatuu-course-bundle.json", json(bundle)],
    ["courses/cz/setup-assets.json", json({ artifacts: [] })],
    ["courses/cz/data/games/words.json", json({ words: ["one"] })],
    [catalogPath, json({ base_url: "https://caatuu.waajacu.com/legacy/embeddings", models: [model] })],
    [manifestPath, json({ file: "curriculum.sqlite", url: model.model_file,
      bytes: model.bytes, sha256: model.sha256 })],
  ]);
  const delivery = planProductDelivery({ files, courseIds: ["cz"], profile: { assets: [...files.keys()] },
    providerCatalogs: new Set([catalogPath, manifestPath]),
    providerFiles: sealVector ? new Map([[databasePath, database]]) : new Map() });
  const setupPayload = new Map(delivery.setupPayload.artifacts.map(record => [record.path, {
    ...record, assetPaths: [record.assetPath], content: delivery.setupObjects.get(record.file),
  }]));
  const input = { bundledFiles: delivery.bundledFiles, bundle, profile: delivery.profile,
    setupPayload, bootstrapAssets: new Set() };
  return { input, delivery, databasePath, catalogPath, model };
}

test("package audit reproduces sealed native vector ownership without a static duplicate", () => {
  const f = fixture();
  const replay = assertBootstrapDeliveryBytes(f.input);
  assert.deepEqual(replay.setupPayload, f.delivery.setupPayload);
  const projected = JSON.parse(replay.bundledFiles.get(f.catalogPath)).models[0];
  assert.match(projected.download_url, /^https:\/\/caatuu\.waajacu\.com\/assets\/setup\//u);
  assert.equal(projected.model_file, f.model.model_file);
  assert.equal(replay.bundledFiles.has(f.databasePath), false);
  const setup = JSON.parse(replay.bundledFiles.get("courses/cz/setup-assets.json"));
  assert.equal(setup.artifacts.some(item => item.sha256 === f.model.sha256), false);
  assert.equal(replay.byteCounts.nativeVectors, f.model.bytes);
});

test("package audit preserves historical independently hosted native vectors", () => {
  const f = fixture({ sealVector: false });
  const replay = assertBootstrapDeliveryBytes(f.input);
  assert.deepEqual(replay.setupPayload, f.delivery.setupPayload);
  assert.equal(JSON.parse(replay.bundledFiles.get(f.catalogPath)).models[0].download_url, undefined);
  assert.equal(replay.byteCounts.nativeVectors, 0);
});

test("package audit rejects altered native content and changed immutable transports", () => {
  const f = fixture();
  const native = [...f.input.setupPayload.values()].find(item => item.assetPath === f.databasePath);
  const changed = new Map(f.input.setupPayload);
  changed.set(native.path, { ...native, content: Buffer.alloc(native.bytes, 65) });
  assert.throws(() => assertBootstrapDeliveryBytes({ ...f.input, setupPayload: changed }), /hash changed/u);
  const catalog = JSON.parse(f.input.bundledFiles.get(f.catalogPath));
  delete catalog.models[0].download_url;
  const bundledFiles = new Map(f.input.bundledFiles);
  bundledFiles.set(f.catalogPath, json(catalog));
  assert.throws(() => assertBootstrapDeliveryBytes({ ...f.input, bundledFiles }), /bootstrap bytes differ/u);
});
