import assert from "node:assert/strict";
import { posix } from "node:path";
import {
  assertNormalizedRelativePath,
  assertSafeRelativePath,
  dictionaryStorageRecord,
  embeddingStorageRecord,
} from "./android-artifact-contract.mjs";

/** Read the same download identities as the APK's native database managers. */
export function nativeProviderDownloadArtifacts(course, readAsset) {
  if (course.nativeProviders == null) return [];
  const providers = course.nativeProviders.providers;
  assert.ok(providers && typeof providers === "object" && !Array.isArray(providers),
    `${course.id} native providers must be an object`);
  const prefix = `${assertNormalizedRelativePath(course.assetPrefix, "Native provider course prefix")}/`;
  const readJson = (path) => {
    assertNormalizedRelativePath(path, "Native provider packaged path");
    assert.ok(path.startsWith(prefix), `Native provider catalog must belong to ${course.id}: ${path}`);
    const bytes = readAsset(path);
    assert.ok(bytes != null, `Native provider metadata is missing: ${path}`);
    return JSON.parse(bytes.toString("utf8"));
  };
  const referencePath = (catalogPath, reference) => {
    const path = assertSafeRelativePath(reference, "Native provider reference");
    const directory = posix.dirname(catalogPath.slice(prefix.length));
    return directory === "." || path.startsWith(`${directory}/`) ? path : `${directory}/${path}`;
  };
  const receipt = (record, catalogPath, metadata = {}) => ({
    key: `native-${record.artifactKind}-${metadata.model_key ?? posix.basename(record.declaredPath)}`,
    url: record.source,
    asset_path: referencePath(catalogPath, record.declaredPath),
    bytes: record.bytes,
    sha256: record.sha256,
    artifact_kind: record.artifactKind,
    native_required: true,
    ...metadata,
  });
  const artifacts = [];
  const embedding = providers.embeddings;
  if (embedding?.implementation === "vector-database-catalog-v1") {
    const catalog = readJson(embedding.catalogAsset);
    assert.ok(Array.isArray(catalog.models), "Native embedding catalog must list models");
    for (const model of catalog.models.filter(({ status }) => status === "active")) {
      const manifestPath = `${prefix}${referencePath(embedding.catalogAsset, model.manifest_file)}`;
      const manifest = readJson(manifestPath);
      // Older sealed APKs wrote this metadata URL relative to the course root.
      // Accept only that exact spelling of the catalog-owned file. Transport
      // still comes from the catalog; new explicit download projections remain strict.
      const historicalCoursePath = referencePath(embedding.catalogAsset, model.model_file);
      const contractManifest = !Object.hasOwn(model, "download_url") && manifest.url === historicalCoursePath
        ? { ...manifest, url: model.model_file }
        : manifest;
      artifacts.push(receipt(embeddingStorageRecord(model, contractManifest, catalog.base_url, course.id,
        `${course.id} native embedding ${model.key}`), embedding.catalogAsset,
      { provider_catalog: embedding.catalogAsset, model_key: model.key }));
    }
  }
  const dictionary = providers.dictionary;
  if (dictionary) {
    const catalog = readJson(dictionary.catalogAsset);
    assert.ok(Array.isArray(catalog.dictionaries), "Native dictionary catalog must list dictionaries");
    for (const active of catalog.dictionaries.filter(({ status }) => status === "active")) {
      artifacts.push(receipt(dictionaryStorageRecord(active, course, course.id,
        `${course.id} native dictionary ${active.key}`), dictionary.catalogAsset));
    }
  }
  return artifacts;
}
