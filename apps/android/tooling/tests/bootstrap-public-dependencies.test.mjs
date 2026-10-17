import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertPublicSetupDependencies } from "../android-artifact-contract.mjs";
import { compileProductAssetBundle, validateBootstrapSetupDependencies, validateProductAssetBundle } from "../build-product-assets.mjs";
import { planProductDelivery } from "../product-delivery.mjs";

const origin = "https://caatuu.waajacu.com";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => Buffer.from(JSON.stringify(value));
const identity = bytes => ({ bytes: bytes.length, sha256: hash(bytes) });
function inventory(files) {
  return { canonicalOrigin: origin, files, payloadFileCount: files.length,
    payloadBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    payloadSha256: hash(files.map(file => `${file.path}\0${file.bytes}\0${file.sha256}`).join("\n")) };
}

function fixture() {
  const original = json({ "/assets/pictures/allowed.png": { description: "Allowed picture" },
    "/assets/pictures/omitted.png": { description: "Not delivered" } });
  const transformed = json({ "/assets/pictures/allowed.png": { description: "Allowed picture" } });
  const resident = Buffer.from("resident Home artwork"), external = Buffer.from("immutable external model");
  const externalArtifact = { key: "external-model", artifact_kind: "embedding-runtime", native_required: true,
    asset_path: "language-runtime/model.onnx", url: "/language-runtime/model.onnx", ...identity(external) };
  const setup = { artifacts: [
    { key: "picture-keymap", artifact_kind: "asset-keymap", native_required: true,
      asset_path: "assets/pictures/keymap.json", url: "/assets/pictures/keymap.json", ...identity(original) },
    { key: "resident", artifact_kind: "visual-asset", native_required: false, android_packaged: true,
      asset_path: "assets/home.png", url: "/assets/home.png", ...identity(resident) },
    externalArtifact,
  ] };
  const bundle = { courses: [{ id: "a", assetPrefix: "courses/a" }] };
  const files = new Map([["index.html", Buffer.from("<html></html>")],
    ["caatuu-course-bundle.json", json(bundle)], ["courses/a/setup-assets.json", json(setup)],
    ["assets/pictures/keymap.json", transformed], ["assets/home.png", resident]]);
  const delivery = planProductDelivery({ files, courseIds: ["a"], profile: { assets: [...files.keys()] },
    bootstrapAssets: new Set(["assets/home.png"]) });
  const publicInventory = inventory([
    { path: "assets/pictures/keymap.json", ...identity(Buffer.from("older public compatibility keymap")) },
    { path: "language-runtime/model.onnx", ...identity(external) },
  ]);
  const readSetup = () => JSON.parse(delivery.bundledFiles.get("courses/a/setup-assets.json"));
  const writeSetup = value => delivery.bundledFiles.set("courses/a/setup-assets.json", json(value));
  return { delivery, publicInventory, readSetup, writeSetup, transformed, original, setup, externalArtifact };
}

test("changed metadata in the exact companion does not depend on the legacy public metadata URL", () => {
  const f = fixture();
  assert.throws(() => assertPublicSetupDependencies(f.setup, f.publicInventory), /bytes\/hash differ/u,
    "the unchanged full/legacy gate still rejects the original public receipt");
  const remaining = validateBootstrapSetupDependencies(f.delivery, { publicInventory: f.publicInventory });
  const actual = f.readSetup().artifacts.find(item => item.key === "picture-keymap");
  assert.match(actual.url, /^\/assets\/setup\//u);
  assert.deepEqual({ bytes: actual.bytes, sha256: actual.sha256 }, identity(f.transformed));
  assert.notDeepEqual(identity(f.original), identity(f.transformed));
  assert.deepEqual(remaining.get("a").artifacts.filter(item => item.native_required).map(item => item.key), ["external-model"]);
});

test("missing, changed and unlisted companion bytes fail before public dependency filtering", () => {
  for (const mutation of [
    f => f.delivery.setupObjects.delete(f.delivery.setupPayload.artifacts[0].file),
    f => f.delivery.setupObjects.set(f.delivery.setupPayload.artifacts[0].file, Buffer.from("tampered")),
    f => { const file = f.delivery.setupPayload.artifacts[0].file; const bytes = Buffer.from(f.delivery.setupObjects.get(file)); bytes[0] ^= 1; f.delivery.setupObjects.set(file, bytes); },
    f => f.delivery.setupObjects.set("objects/unlisted/object.json", Buffer.from("unlisted")),
  ]) {
    const f = fixture(); mutation(f);
    assert.throws(() => validateBootstrapSetupDependencies(f.delivery, { publicInventory: f.publicInventory }),
      /missing|bytes changed|hash changed|unlisted/u);
  }
});

test("companion records must bind exact final APK receipts and logical ownership", () => {
  for (const mutation of [
    f => { const setup = f.readSetup(); setup.artifacts.find(item => item.key === "picture-keymap").sha256 = "a".repeat(64); f.writeSetup(setup); },
    f => { const setup = f.readSetup(); setup.artifacts.find(item => item.key === "picture-keymap").asset_path = "assets/pictures/other.json"; f.writeSetup(setup); },
    f => { const setup = f.readSetup(); setup.artifacts = setup.artifacts.filter(item => item.key !== "picture-keymap"); f.writeSetup(setup); },
    f => { const setup = f.readSetup(); setup.artifacts.find(item => item.key === "picture-keymap").url += "?other=1"; f.writeSetup(setup); },
  ]) {
    const f = fixture(); mutation(f);
    assert.throws(() => validateBootstrapSetupDependencies(f.delivery, { publicInventory: f.publicInventory }),
      /hash differs|logical path differs|Unreferenced|exact immutable bytes/u);
  }
});

test("companion object paths reject case collisions just like the sealed archive contract", () => {
  const f = fixture(), record = f.delivery.setupPayload.artifacts[0];
  const other = { ...record, assetPath: "assets/pictures/other.json",
    path: record.path.replace(/keymap\.json$/u, "KEYMAP.JSON"),
    file: record.file.replace(/keymap\.json$/u, "KEYMAP.JSON") };
  assert.notEqual(other.path, record.path);
  f.delivery.setupPayload.artifacts.push(other);
  f.delivery.setupObjects.set(other.file, f.delivery.setupObjects.get(record.file));
  assert.throws(() => validateBootstrapSetupDependencies(f.delivery), /case-colliding object paths/u);
});

test("an APK-resident skipped download still requires exact packaged bytes", () => {
  const f = fixture();
  f.delivery.bundledFiles.set("assets/home.png", Buffer.from("changed resident artwork"));
  assert.throws(() => validateBootstrapSetupDependencies(f.delivery, { publicInventory: f.publicInventory }),
    /skipped download has no exact matching packaged bytes/u);
});

test("a genuine external dependency retains missing-file and hash mismatch failures", () => {
  const f = fixture();
  const stale = structuredClone(f.publicInventory.files);
  stale.find(file => file.path === "language-runtime/model.onnx").sha256 = "0".repeat(64);
  assert.throws(() => validateBootstrapSetupDependencies(f.delivery, { publicInventory: inventory(stale) }), /bytes\/hash differ/u);
  const absent = f.publicInventory.files.filter(file => file.path !== "language-runtime/model.onnx");
  assert.throws(() => validateBootstrapSetupDependencies(f.delivery, { publicInventory: inventory(absent) }), /required public asset is missing/u);
});

test("the canonical bootstrap compiler checks final external receipts rather than pre-delivery logical receipts", t => {
  const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const artifacts = join(workspaceRoot, "apps/android/product/build/bootstrap-dependency-tests");
  mkdirSync(artifacts, { recursive: true });
  const directory = mkdtempSync(join(artifacts, "bootstrap-dependency-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const previous = process.env.CAATUU_RELEASE_PUBLIC_INVENTORY;
  delete process.env.CAATUU_RELEASE_PUBLIC_INVENTORY;
  t.after(() => {
    if (previous === undefined) delete process.env.CAATUU_RELEASE_PUBLIC_INVENTORY;
    else process.env.CAATUU_RELEASE_PUBLIC_INVENTORY = previous;
  });
  const options = { outputDir: join(directory, "product"), allowMissingSetupDeliveredRuntimeFiles: true };
  compileProductAssetBundle(options);
  const bundle = JSON.parse(readFileSync(join(options.outputDir, "caatuu-course-bundle.json")));
  const external = new Map();
  for (const course of bundle.courses) {
    const setup = JSON.parse(readFileSync(join(options.outputDir, course.assetPrefix, "setup-assets.json")));
    for (const artifact of setup.artifacts.filter(item => item.native_required === true)) {
      const path = decodeURIComponent(new URL(artifact.url, origin).pathname).slice(1);
      if (path.startsWith("assets/setup/")) continue;
      external.set(path, { path, bytes: artifact.bytes, sha256: artifact.sha256 });
    }
  }
  assert.ok(external.size > 0, "the real compiler still has independently hosted model/dictionary dependencies");
  const inventoryPath = join(directory, "public-assets.json");
  writeFileSync(inventoryPath, JSON.stringify(inventory([...external.values()])));
  process.env.CAATUU_RELEASE_PUBLIC_INVENTORY = inventoryPath;
  const result = validateProductAssetBundle(options);
  assert.equal(result.deliveryMode, "bootstrap");
  const [first] = external.values();
  first.sha256 = "0".repeat(64);
  writeFileSync(inventoryPath, JSON.stringify(inventory([...external.values()])));
  assert.throws(() => validateProductAssetBundle(options), /required public asset bytes\/hash differ/u,
    "the production bootstrap call path must retain the external public gate");
});
