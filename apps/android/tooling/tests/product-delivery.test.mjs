import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { isSetupDeliveredAsset, nativeBootstrapCatalogAssets, planProductDelivery } from "../product-delivery.mjs";

const buffer = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const art = buffer("exact transformed artwork");
  const files = new Map([
    ["index.html", buffer("<html></html>")],
    ["caatuu-profile.json", buffer({ assets: [] })],
    ["language-runtime/static/source/engine.mjs", buffer("export const version = 1;")],
    ["language-runtime/static/data/interface/en.v1.json", buffer({ hello: "Hello" })],
    ["assets/planets/shared.png", art],
    ["courses/alpha/data/games/words.json", buffer({ words: ["one"] })],
    ["courses/beta/data/games/words.json", buffer({ words: ["two"] })],
    ["courses/alpha/setup-assets.json", buffer({ artifacts: [{
      key: "shared-art", label: "Shared artwork", artifact_kind: "visual-asset",
      url: "/assets/planets/shared.png", asset_path: "assets/planets/shared.png",
      bytes: art.length, sha256: digest(art), native_required: false, android_packaged: true,
    }] })],
    ["courses/beta/setup-assets.json", buffer({ artifacts: [] })],
  ]);
  return { files, courseIds: ["alpha", "beta"], profile: { assets: [...files.keys()] } };
}

test("bootstrap keeps engine, provider descriptors and small interface UI, while content and art use setup", () => {
  const flags = new Set(["assets/icons/course.png"]);
  const providers = new Set(["courses/a/data/custom/native.json"]);
  const options = { bootstrapAssets: flags, providerCatalogs: providers };
  for (const path of ["index.html", "language-runtime/static/source/engine.mjs", "vendor/sql.wasm",
    "language-runtime/static/data/interface/en.v1.json", "courses/a/setup-assets.json",
    "courses/a/data/custom/native.json", "courses/a/data/games/word-world/manifest.json", "assets/icons/course.png"]) {
    assert.equal(isSetupDeliveredAsset(path, buffer("small"), options), false, path);
  }
  for (const path of ["assets/planets/world.png", "assets/miscellaneous/keymap.json",
    "courses/a/data/games/words.json", "courses/a/data/dictionaries/reference.html",
    "language-runtime/static/data/english-concepts/words.json"]) {
    assert.equal(isSetupDeliveredAsset(path, buffer("content"), options), true, path);
  }
  assert.equal(isSetupDeliveredAsset("assets/icons/course.png", Buffer.alloc(200_000), options), true);
});

test("course selection installs only its own content and shared art has one physical object", () => {
  const result = planProductDelivery(fixture());
  assert.equal(result.setupPayload.artifacts.length, 3);
  assert.equal(result.setupObjects.size, 3);
  assert.equal(result.setupPayload.artifacts.filter(({ assetPath }) => assetPath === "assets/planets/shared.png").length, 1);
  const setups = ["alpha", "beta"].map((id) => JSON.parse(result.bundledFiles.get(`courses/${id}/setup-assets.json`)));
  const shared = setups.map((setup) => setup.artifacts.find(({ asset_path }) => asset_path === "assets/planets/shared.png"));
  assert.equal(shared[0].url, shared[1].url);
  assert.equal(shared[0].sha256, shared[1].sha256);
  assert.ok(shared.every((artifact) => artifact.native_required && !Object.hasOwn(artifact, "android_packaged")));
  for (let index = 0; index < setups.length; index += 1) {
    const own = setups[index].artifacts.find(({ asset_path }) => asset_path === "data/games/words.json");
    assert.equal(own.sha256, digest(buffer({ words: [index ? "two" : "one"] })));
    assert.equal(setups[index].artifacts.length, 2);
  }
  assert.deepEqual(result.profile.assets, [...result.bundledFiles.keys()].filter((path) => path !== "caatuu-profile.json").sort());
});

test("immutable records pin exact transformed bytes and are deterministic across input order", () => {
  const input = fixture();
  const result = planProductDelivery(input);
  const reordered = planProductDelivery({ ...input, files: new Map([...input.files].reverse()) });
  assert.deepEqual(result.setupPayload, reordered.setupPayload);
  for (const artifact of result.setupPayload.artifacts) {
    const bytes = result.setupObjects.get(artifact.file);
    assert.equal(artifact.bytes, bytes.length);
    assert.equal(artifact.sha256, digest(bytes));
    assert.ok(artifact.path.startsWith(`assets/setup/${artifact.sha256}/`));
    assert.ok(artifact.file.startsWith(`objects/${artifact.sha256}/`));
    assert.ok(!result.bundledFiles.has(artifact.assetPath));
  }
  assert.deepEqual([...result.bundledFiles.keys()], [...reordered.bundledFiles.keys()]);
  for (const [path, bytes] of result.bundledFiles) assert.ok(bytes.equals(reordered.bundledFiles.get(path)), path);
});

test("delivery rejects unsafe paths and duplicate logical setup ownership", () => {
  assert.throws(() => isSetupDeliveredAsset("assets/../secret.png", buffer("x")), /normalized/u);
  const input = fixture();
  const setup = JSON.parse(input.files.get("courses/alpha/setup-assets.json"));
  setup.artifacts.push({ ...setup.artifacts[0], key: "second-art" });
  input.files.set("courses/alpha/setup-assets.json", buffer(setup));
  assert.throws(() => planProductDelivery(input), /repeats delivery ownership/u);
});

test("native provider manifest references stay bundled independently of their names and sizes", () => {
  const catalogPath = "courses/a/data/semantic/catalog.json";
  const manifestPath = "courses/a/data/semantic/custom-model-descriptor.json";
  const files = new Map([
    [catalogPath, buffer({ models: [{ status: "active", manifest_file: "custom-model-descriptor.json" }] })],
    [manifestPath, Buffer.alloc(200_000)],
  ]);
  const courses = [{ assetPrefix: "courses/a", nativeProviders: { providers: {
    embeddings: { implementation: "vector-database-catalog-v1", catalogAsset: catalogPath },
  } } }];
  const providerCatalogs = nativeBootstrapCatalogAssets(files, { courses });
  assert.equal(providerCatalogs.has(manifestPath), true);
  assert.equal(isSetupDeliveredAsset(manifestPath, files.get(manifestPath), { providerCatalogs }), false);
  files.delete(manifestPath);
  assert.throws(() => nativeBootstrapCatalogAssets(files, { courses }), /manifest must remain available/u);
});

test("an engine-sized regression trips the bootstrap budget instead of moving it into a course download", () => {
  const input = fixture();
  input.files.set("language-runtime/static/source/oversized.mjs", Buffer.alloc(8_000_001));
  assert.throws(() => planProductDelivery(input), /Bootstrap APK assets exceed the reviewed/u);
});
