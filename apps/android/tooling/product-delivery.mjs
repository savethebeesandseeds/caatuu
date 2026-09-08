import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  assertCompatibleSharedStorage,
  assertNormalizedRelativePath,
  assertSetupArtifactMetadata,
  setupStorageRecord,
} from "./android-artifact-contract.mjs";

export const SETUP_PAYLOAD_MANIFEST = "caatuu-setup-payload.json";
export const BOOTSTRAP_SMALL_ASSET_BYTES = 128 * 1024;
export const HOME_BOOTSTRAP_ASSET_MAX_BYTES = 256 * 1024;
// The familiar Home, its navigation, and language selection render before any
// selected-course download. Keep these reviewed UI images with the application;
// larger game artwork and curriculum still belong to setup delivery.
export const HOME_BOOTSTRAP_ARTWORK = Object.freeze([
  "language-runtime/static/assets/caatuu-shell-512.png",
  "assets/icons/hello.png",
  "assets/icons/home_icon.png",
  "assets/icons/homebase_icon.png",
  "assets/icons/social_icon.png",
  "assets/icons/store_icon.png",
  "assets/icons/games_icon.png",
  "assets/icons/backpack_icon.png",
  "assets/icons/items_icon.png",
  "assets/icons/stats_icon.png",
  "assets/icons/gear_icon.png",
  "assets/icons/icon_gem.png",
  "assets/icons/coin_icon_ui.png",
  "assets/icons/streak_icon.png",
  "assets/icons/light_mode_ui.png",
  "assets/icons/dark_mode_ui.png",
]);
// Separate residency and content budgets; independently delivered model and
// dictionary binaries are not duplicated in this companion payload.
export const PRODUCT_BOOTSTRAP_MAX_BYTES = 8_000_000;
export const PRODUCT_SETUP_PAYLOAD_MAX_BYTES = 72_000_000;

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

/** Course manifests own their flags, including both directions of each pair. */
export function homeBootstrapAssets(files, courses) {
  const required = new Set(HOME_BOOTSTRAP_ARTWORK);
  for (const course of courses) {
    for (const language of [course.sourceLanguage, course.targetLanguage]) {
      assert.equal(typeof language?.flagSrc, "string", `Home language flag is missing for ${course.id}`);
      assert.match(language.flagSrc, /^\/assets\//u, `Home language flag must use local shared assets: ${language.flagSrc}`);
      const path = decodeURIComponent(language.flagSrc.split(/[?#]/u)[0].slice(1));
      assertNormalizedRelativePath(path, "Home language flag");
      required.add(path);
    }
  }
  for (const path of required) {
    assert.ok(files.has(path), `Home bootstrap artwork is missing: ${path}`);
    assert.ok(files.get(path).length <= HOME_BOOTSTRAP_ASSET_MAX_BYTES,
      `Home bootstrap artwork exceeds the reviewed ${HOME_BOOTSTRAP_ASSET_MAX_BYTES}-byte UI budget: ${path}`);
  }
  return required;
}

/** Native managers read these descriptors directly before setup can run. */
export function nativeBootstrapCatalogAssets(files, courseCatalog) {
  const required = new Set();
  for (const course of courseCatalog.courses) {
    for (const provider of Object.values(course.nativeProviders.providers)) {
      const path = provider.catalogAsset;
      if (!path) continue;
      assertNormalizedRelativePath(path, "Native bootstrap catalog");
      assert.ok(files.has(path), `Native bootstrap catalog is missing: ${path}`);
      required.add(path);
      if (provider.implementation !== "vector-database-catalog-v1") continue;
      const catalog = JSON.parse(files.get(path).toString("utf8"));
      const directory = posix.dirname(path);
      const coursePrefix = `${course.assetPrefix}/`;
      for (const model of (catalog.models ?? []).filter(({ status }) => status === "active")) {
        const reference = assertNormalizedRelativePath(model.manifest_file, "Native embedding manifest");
        const courseDirectory = directory.startsWith(coursePrefix) ? directory.slice(coursePrefix.length) : directory;
        const manifest = reference.startsWith(`${courseDirectory}/`)
          ? `${coursePrefix}${reference}` : `${directory}/${reference}`;
        assert.ok(files.has(manifest), `Native embedding manifest must remain available before setup: ${manifest}`);
        required.add(manifest);
      }
    }
  }
  return required;
}

/** Logical catalogs remain complete; this policy controls APK residency only. */
export function isSetupDeliveredAsset(path, bytes, { bootstrapAssets = new Set(), providerCatalogs = new Set() } = {}) {
  assertNormalizedRelativePath(path, "Product delivery asset");
  assert.ok(Buffer.isBuffer(bytes), `Product delivery requires exact bytes: ${path}`);
  if (providerCatalogs.has(path)) return false;
  if (bootstrapAssets.has(path)) {
    assert.ok(bytes.length <= HOME_BOOTSTRAP_ASSET_MAX_BYTES,
      `Home bootstrap artwork exceeds the reviewed ${HOME_BOOTSTRAP_ASSET_MAX_BYTES}-byte UI budget: ${path}`);
    return false;
  }
  if (path.startsWith("language-runtime/static/data/interface/")) return false;
  // Keep music and its attribution together in the shared setup download.
  if (path.startsWith("assets/music/")) return true;
  const courseData = /^courses\/[^/]+\/data\//u.test(path);
  if (courseData && /\/(?:manifest|catalog|models)\.json$/u.test(path)
      && bytes.length <= BOOTSTRAP_SMALL_ASSET_BYTES) return false;
  if (courseData || path.startsWith("language-runtime/static/data/")) return true;
  if (/\.(?:png|jpe?g|webp|avif|gif|mp3|ogg|wav|m4a)$/iu.test(path)) return true;
  if (path.startsWith("assets/") && /\.(?:json|svg)$/iu.test(path)) return true;
  return false;
}

function immutableObject(assetPath, bytes) {
  const sha256 = hash(bytes);
  // Distinct logical paths can contain identical data. Keep their receipts
  // distinct without putting course-specific copies of a shared path in storage.
  const basename = `${hash(assetPath).slice(0, 16)}-${posix.basename(assetPath)
    .replace(/[^a-zA-Z0-9._-]/gu, "_").slice(-80)}`;
  return {
    path: `assets/setup/${sha256}/${basename}`,
    file: `objects/${sha256}/${basename}`,
    assetPath,
    bytes: bytes.length,
    sha256,
  };
}

function logicalArtifactPath(artifact, courseId) {
  const path = artifact.asset_path;
  if (!path) return null;
  return path.startsWith("assets/") || path.startsWith("language-runtime/")
    ? path : `courses/${courseId}/${path}`;
}

/** Split fully transformed product bytes into the APK and sealed setup objects. */
export function planProductDelivery({ files, courseIds, profile, bootstrapAssets, providerCatalogs }) {
  assert.ok(files instanceof Map, "Product delivery requires a logical file map");
  assert.ok(Array.isArray(courseIds) && new Set(courseIds).size === courseIds.length,
    "Product delivery course IDs must be unique");
  const bundledFiles = new Map();
  const setupObjects = new Map();
  const records = [];
  for (const [path, bytes] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    if (!isSetupDeliveredAsset(path, bytes, { bootstrapAssets, providerCatalogs })) {
      bundledFiles.set(path, bytes);
      continue;
    }
    assert.ok(bytes.length > 0, `A setup-delivered asset must be nonempty: ${path}`);
    const record = immutableObject(path, bytes);
    records.push(record);
    setupObjects.set(record.file, bytes);
  }
  const sharedRecords = records.filter(({ assetPath }) => !assetPath.startsWith("courses/"));
  const artifactKinds = new Map();
  const sharedDownloads = new Map();
  const sharedDownloadOwnership = [];
  for (const courseId of courseIds) {
    const setup = JSON.parse(files.get(`courses/${courseId}/setup-assets.json`).toString("utf8"));
    for (const artifact of setup.artifacts) {
      const path = logicalArtifactPath(artifact, courseId);
      if (path && artifact.artifact_kind && !artifactKinds.has(path)) artifactKinds.set(path, artifact.artifact_kind);
      // These objects already live in public setup storage, so they never enter
      // the APK file map above. Shared picture catalogs still reference them.
      // Installing any first course must install the same required library.
      if (artifact.native_required === true && path && !path.startsWith("courses/") && !files.has(path)) {
        sharedDownloadOwnership.push(setupStorageRecord(artifact, courseId, `${courseId} shared download ${artifact.key}`));
        if (!sharedDownloads.has(path)) sharedDownloads.set(path, artifact);
      }
    }
  }
  assertCompatibleSharedStorage(sharedDownloadOwnership, "Product shared downloads");
  const ownership = [];
  for (const courseId of courseIds) {
    const assetPrefix = `courses/${courseId}/`;
    const setupPath = `${assetPrefix}setup-assets.json`;
    assert.ok(bundledFiles.has(setupPath), `Product bootstrap requires ${setupPath}`);
    const setup = JSON.parse(bundledFiles.get(setupPath).toString("utf8"));
    const declared = new Set(setup.artifacts.map((artifact) => logicalArtifactPath(artifact, courseId)));
    setup.artifacts = setup.artifacts.map((artifact) => {
      const shared = sharedDownloads.get(logicalArtifactPath(artifact, courseId));
      return shared && artifact.native_required !== true ? { ...shared, key: artifact.key } : artifact;
    });
    for (const [path, artifact] of sharedDownloads) {
      if (!declared.has(path)) setup.artifacts.push({
        ...artifact,
        key: `product-shared-${hash(path).slice(0, 24)}`,
        browser_required: false,
      });
    }
    const courseRecords = [...sharedRecords, ...records.filter(({ assetPath }) => assetPath.startsWith(assetPrefix))];
    const byAsset = new Map(courseRecords.map((record) => [record.assetPath, record]));
    const consumed = new Set();
    const artifactFor = (record, previous = {}) => {
      const { android_packaged: _packaged, ...metadata } = previous;
      return {
        ...metadata,
        key: previous.key || `product-${hash(record.assetPath).slice(0, 24)}`,
        label: previous.label || (record.assetPath.startsWith(assetPrefix) ? "Course learning content" : "Shared game assets"),
        artifact_kind: artifactKinds.get(record.assetPath) || (record.assetPath.startsWith(assetPrefix) ? "course-content" : "shared-asset"),
        url: `/${record.path}`,
        asset_path: record.assetPath.startsWith(assetPrefix) ? record.assetPath.slice(assetPrefix.length) : record.assetPath,
        native_required: true,
        browser_required: false,
        bytes: record.bytes,
        sha256: record.sha256,
      };
    };
    setup.artifacts = setup.artifacts.map((artifact) => {
      const path = logicalArtifactPath(artifact, courseId);
      const record = byAsset.get(path);
      if (!record) return artifact;
      assert.ok(!consumed.has(path), `${courseId} setup repeats delivery ownership for ${path}`);
      consumed.add(path);
      return artifactFor(record, artifact);
    });
    for (const record of courseRecords) {
      if (!consumed.has(record.assetPath)) setup.artifacts.push(artifactFor(record));
    }
    assertSetupArtifactMetadata(setup, `${courseId} bootstrap setup`);
    ownership.push(...setup.artifacts.filter((artifact) => artifact.native_required === true)
      .map((artifact) => setupStorageRecord(artifact, courseId, `${courseId} bootstrap setup ${artifact.key}`)));
    bundledFiles.set(setupPath, jsonBytes(setup));
  }
  assertCompatibleSharedStorage(ownership, "Product setup delivery");
  const delivered = new Set(records.map(({ assetPath }) => assetPath));
  assert.deepEqual([...new Set([...bundledFiles.keys(), ...delivered])].sort(), [...files.keys()].sort(),
    "APK and setup objects must cover the exact logical product allowlist");
  const deliveredProfile = { ...profile, assets: [...bundledFiles.keys()].filter((path) => path !== "caatuu-profile.json").sort() };
  bundledFiles.set("caatuu-profile.json", jsonBytes(deliveredProfile));
  const byteCounts = {
    bootstrap: [...bundledFiles.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    setup: [...setupObjects.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    shared: sharedRecords.reduce((sum, record) => sum + record.bytes, 0),
    courses: Object.fromEntries(courseIds.map((id) => [id, records
      .filter(({ assetPath }) => assetPath.startsWith(`courses/${id}/`))
      .reduce((sum, record) => sum + record.bytes, 0)])),
  };
  assert.ok(byteCounts.bootstrap <= PRODUCT_BOOTSTRAP_MAX_BYTES,
    `Bootstrap APK assets exceed the reviewed ${PRODUCT_BOOTSTRAP_MAX_BYTES}-byte budget: ${byteCounts.bootstrap}`);
  assert.ok(byteCounts.setup <= PRODUCT_SETUP_PAYLOAD_MAX_BYTES,
    `Setup payload exceeds the reviewed ${PRODUCT_SETUP_PAYLOAD_MAX_BYTES}-byte budget: ${byteCounts.setup}`);
  return {
    bundledFiles,
    setupPayload: { schemaVersion: 1, artifacts: records.sort((left, right) => left.assetPath.localeCompare(right.assetPath)) },
    setupObjects,
    downloadedAssets: [...delivered].sort(),
    profile: deliveredProfile,
    sharedStorageRecords: ownership,
    byteCounts,
  };
}
