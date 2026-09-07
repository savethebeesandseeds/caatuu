import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadAndroidCourseBundleConfiguration, createAndroidProductDelivery } from "../build-product-assets.mjs";
import { readImageEmbeddingIndex, imageVectorKey } from "../../../language-runtime/static/source/image-embedding-index.mjs";
import { normalizeImageCatalog, IMAGE_SOURCES } from "../../../language-runtime/static/source/english-image-search.mjs";

test("all Android courses share one setup-delivered artwork index with vectors for their packaged images", () => {
  const configuration = loadAndroidCourseBundleConfiguration({ allowMissingSetupDeliveredRuntimeFiles: true });
  const delivery = createAndroidProductDelivery(configuration);
  const path = "language-runtime/static/data/image-embeddings/minilm-v1.json";
  const data = delivery.logicalFiles.get(path);
  assert.ok(data, "Shared image index must survive product transformation");
  const vectors = readImageEmbeddingIndex(JSON.parse(data));
  assert.equal(configuration.sharedAssets.filter(asset => asset.output === path).length, 1);
  assert.ok(delivery.downloadedAssets.includes(path), "The shared image index follows selected-course setup delivery");
  for (const { course, languageStaticDir } of configuration.configurations) {
    const manifest = JSON.parse(readFileSync(`${languageStaticDir}/setup-assets.json`, "utf8"));
    assert.ok(manifest.offline.assets.some(asset => asset.split("?")[0] === `/${path}`), `${course.id}: shared offline image index`);
    assert.ok(!delivery.logicalFiles.has(`courses/${course.id}/${path}`), "The index must not be duplicated per course");
  }
  for (const source of IMAGE_SOURCES) {
    const raw = JSON.parse(delivery.logicalFiles.get(source.path.slice(1)));
    const rows = normalizeImageCatalog(raw, source.kind);
    assert.ok(rows.length > 0);
    for (const row of rows) assert.equal(vectors.get(imageVectorKey(row))?.embeddingText, row.embeddingText, row.path);
  }
});
