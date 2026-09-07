import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { sha256Bytes } from "../pages-baseline.mjs";
import { packageSetupPayload, parseSetupPayloadArchive, readSetupPayloadArchive, validateSetupPayloadForApk } from "../setup-payload.mjs";
import { sealCandidateReceipt, verifyCandidateReceipt } from "../release-candidate.mjs";
import { advancePagesCurrentReleaseDescriptor, assertPagesReleaseHistoryPrefix, pagesCurrentReleaseDownloadPlan } from "../pages-current-release.mjs";
import { verifyPublicSetupPayload } from "../verify-public-pages-release.mjs";

const descriptor = JSON.parse(readFileSync(new URL("../pages-current-release.json", import.meta.url)));
const version = descriptor.releases.at(-1).versionCode + 1;
const origin = descriptor.canonicalOrigin;
const digest = (bytes) => ({ bytes: Buffer.byteLength(bytes), sha256: sha256Bytes(bytes) });

function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [path, value] of entries) {
    const name = Buffer.from(path), bytes = Buffer.from(value);
    const local = Buffer.alloc(30 + name.length + bytes.length);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    name.copy(local, 30); bytes.copy(local, 30 + name.length);
    const record = Buffer.alloc(46 + name.length);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    name.copy(record, 46); locals.push(local); central.push(record); offset += local.length;
  }
  const end = Buffer.alloc(22), directory = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function fixture(t) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "caatuu-setup-transport-"));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const inputDir = join(workspaceRoot, "generated/setup");
  const artifacts = [], content = new Map();
  for (const [assetPath, bytes] of [["assets/art.png", "shared artwork"], ["courses/cz/data/lesson.json", '{"word":"learn"}']]) {
    const identity = digest(bytes), basename = assetPath.split("/").at(-1);
    const record = { path: `assets/setup/${identity.sha256}/${basename}`, file: `objects/${identity.sha256}/${basename}`, assetPath, ...identity };
    artifacts.push(record); content.set(record.path, Buffer.from(bytes));
    mkdirSync(dirname(join(inputDir, record.file)), { recursive: true }); writeFileSync(join(inputDir, record.file), bytes);
  }
  writeFileSync(join(inputDir, "caatuu-setup-payload.json"), JSON.stringify({ schemaVersion: 1, artifacts }));
  const archive = join(workspaceRoot, "artifacts/android/release-candidates/setup.tar");
  const bundle = { $schema: "https://caatuu.org/schemas/android-course-bundle-runtime.v1.schema.json", schemaVersion: 1, defaultCourseId: "cz", courses: [{ id: "cz", assetPrefix: "courses/cz" }] };
  const setup = { artifacts: artifacts.map((record, index) => ({ key: `payload-${index}`, url: `/${record.path}`, asset_path: record.assetPath.replace(/^courses\/cz\//u, ""), native_required: true, bytes: record.bytes, sha256: record.sha256 })) };
  const apkBytes = () => zip([["assets/caatuu-course-bundle.json", JSON.stringify(bundle)], ["assets/courses/cz/setup-assets.json", JSON.stringify(setup)]]);
  const apk = join(workspaceRoot, "artifacts/android/candidate.apk");
  packageSetupPayload({ workspaceRoot, inputDir, output: archive });
  writeFileSync(apk, apkBytes());
  return { workspaceRoot, inputDir, archive, artifacts, content, bundle, setup, apk, apkBytes };
}

test("setup archive is deterministic, inventory-exact, and preserves a previously sealed candidate", (t) => {
  const f = fixture(t), first = readFileSync(f.archive);
  packageSetupPayload({ workspaceRoot: f.workspaceRoot, inputDir: f.inputDir, output: f.archive });
  assert.ok(first.equals(readFileSync(f.archive)));
  const payload = validateSetupPayloadForApk(f.apk, readSetupPayloadArchive(f.archive));
  assert.equal(payload.size, 2);
  for (const [path, object] of payload) assert.ok(object.content.equals(f.content.get(path)));
  writeFileSync(join(f.inputDir, "unlisted.txt"), "not approved");
  assert.throws(() => packageSetupPayload({ workspaceRoot: f.workspaceRoot, inputDir: f.inputDir, output: f.archive }), /missing or unlisted/u);
  assert.ok(first.equals(readFileSync(f.archive)));
});

test("setup transport rejects changed bytes, links, traversal, truncation and missing APK dependencies", (t) => {
  const f = fixture(t);
  const changed = Buffer.from(readFileSync(f.archive)); changed[0] ^= 1;
  assert.throws(() => parseSetupPayloadArchive(changed), /checksum/u);
  assert.throws(() => parseSetupPayloadArchive(readFileSync(f.archive).subarray(0, 1024)), /truncated|terminator/u);
  const payload = readSetupPayloadArchive(f.archive); payload.delete(f.artifacts[1].path);
  assert.throws(() => validateSetupPayloadForApk(f.apk, payload), /missing from sealed/u);
  f.setup.artifacts[1].sha256 = "0".repeat(64); writeFileSync(f.apk, f.apkBytes());
  assert.throws(() => validateSetupPayloadForApk(f.apk, readSetupPayloadArchive(f.archive)), /hash differs/u);
  f.artifacts[0].assetPath = "../escape";
  writeFileSync(join(f.inputDir, "caatuu-setup-payload.json"), JSON.stringify({ schemaVersion: 1, artifacts: f.artifacts }));
  assert.throws(() => packageSetupPayload({ workspaceRoot: f.workspaceRoot, inputDir: f.inputDir, output: f.archive }), /Unsafe/u);
  const symlink = join(f.workspaceRoot, "alias"); symlinkSync(f.inputDir, symlink, "dir");
  assert.throws(() => packageSetupPayload({ workspaceRoot: f.workspaceRoot, inputDir: symlink, output: f.archive }), /symbolic link/u);
});

test("content-addressed candidate archives allow a repaired build while preserving earlier attempts", (t) => {
  const f = fixture(t);
  const options = { workspaceRoot: f.workspaceRoot, inputDir: f.inputDir, outputDir: join(f.workspaceRoot, "artifacts/android/release-candidates/setup") };
  const first = packageSetupPayload(options);
  assert.equal(first.path, `artifacts/android/release-candidates/setup/${first.sha256}.tar`);
  assert.deepEqual(packageSetupPayload(options), first);
  f.artifacts[0].assetPath = "assets/art-v2.png";
  writeFileSync(join(f.inputDir, "caatuu-setup-payload.json"), JSON.stringify({ schemaVersion: 1, artifacts: f.artifacts }));
  const repaired = packageSetupPayload(options);
  assert.notEqual(repaired.path, first.path);
  assert.equal(sha256Bytes(readFileSync(join(f.workspaceRoot, first.path))), first.sha256);
  assert.equal(sha256Bytes(readFileSync(join(f.workspaceRoot, repaired.path))), repaired.sha256);
});

function finalized(f) {
  const aab = join(f.workspaceRoot, "artifacts/android/candidate.aab"); writeFileSync(aab, "sealed aab");
  const sourceRevision = "a".repeat(40);
  const receipt = sealCandidateReceipt({ repoRoot: f.workspaceRoot, apk: "artifacts/android/candidate.apk", aab: "artifacts/android/candidate.aab", setup: "artifacts/android/release-candidates/setup.tar", sourceRevision, packageName: "com.waajacu.caatuu", versionCode: version, versionName: "1.2.3", debuggable: false, signerSha256: "b".repeat(64), mode: "builder-emitted", verifyCommit() {}, output: "artifacts/android/candidate.json" });
  const directory = join(f.workspaceRoot, "artifacts/android/releases", String(version)); mkdirSync(directory, { recursive: true });
  const receiptPath = join(directory, "caatuu-release-candidate.json"), apkPath = join(directory, "caatuu.apk"), manifestPath = join(directory, "caatuu.json");
  const rawReceipt = readFileSync(join(f.workspaceRoot, "artifacts/android/candidate.json"));
  writeFileSync(receiptPath, rawReceipt); copyFileSync(f.apk, apkPath); copyFileSync(f.archive, join(directory, "caatuu-setup-payload.tar"));
  writeFileSync(manifestPath, JSON.stringify({ schema_version: 1, profile: "product", channel: "stable", signing_lineage: "direct-release-v1", package_name: "com.waajacu.caatuu", version_code: version, version_name: "1.2.3", build_type: "release", debuggable: false, apk_url: `${origin}/android/releases/${version}/caatuu.apk`, ...digest(readFileSync(apkPath)), signer_certificate_sha256: "b".repeat(64), source_revision: sourceRevision, source_url: `https://github.com/${descriptor.repository}/tree/${sourceRevision}`, audit: { bundletool: "passed", product_package: "passed", candidate_receipt_sha256: sha256Bytes(rawReceipt) } }));
  return { receipt, workspaceRoot: f.workspaceRoot, descriptor, receiptPath, apkPath, manifestPath, directory };
}

test("receipt and append-only Pages handoff bind a fourth artifact without changing legacy releases", (t) => {
  const f = fixture(t), release = finalized(f);
  verifyCandidateReceipt({ repoRoot: f.workspaceRoot, receipt: release.receipt, verifyCommit() {} });
  const advance = advancePagesCurrentReleaseDescriptor(release);
  assert.deepEqual(advance.assets.map(({ kind }) => kind).sort(), ["apk", "manifest", "receipt", "setup"]);
  assert.deepEqual(advance.descriptor.releases.slice(0, -1), descriptor.releases);
  assertPagesReleaseHistoryPrefix(descriptor, advance.descriptor);
  const again = advancePagesCurrentReleaseDescriptor({ ...release, descriptor: advance.descriptor });
  assert.equal(again.action, "reuse");
  const setupAsset = pagesCurrentReleaseDownloadPlan(advance.descriptor).assets.find((asset) =>
    asset.kind === "setup" && asset.releaseAssetName === `caatuu-${version}-setup-payload.tar`);
  assert.ok(setupAsset, "the appended release must retain its own setup companion");
  assert.equal(setupAsset.sourcePath, `artifacts/android/releases/${version}/caatuu-setup-payload.tar`);
  assert.equal(setupAsset.releaseAssetName, `caatuu-${version}-setup-payload.tar`);
  writeFileSync(join(release.directory, "caatuu-setup-payload.tar"), "changed finalized content");
  assert.throws(() => advancePagesCurrentReleaseDescriptor(release), /payload byte count changed/u);
  writeFileSync(f.archive, "changed candidate content");
  assert.throws(() => verifyCandidateReceipt({ repoRoot: f.workspaceRoot, receipt: release.receipt, verifyCommit() {} }), /SETUP bytes changed/u);
});

test("public verification fetches exact APK-pinned setup URLs and rejects missing or corrupt content", async (t) => {
  const f = fixture(t);
  const bundle = { files: f.artifacts.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) };
  const calls = [];
  const request = async (_origin, path, _options, consume) => { calls.push(path); return consume(new Response(f.content.get(path.slice(1)))); };
  assert.equal(await verifyPublicSetupPayload({ apkBytes: f.apkBytes(), bundle, request, origin }), 2);
  assert.deepEqual(calls.sort(), f.artifacts.map(({ path }) => `/${path}`).sort());
  f.content.set(f.artifacts[0].path, Buffer.from("wrong"));
  await assert.rejects(verifyPublicSetupPayload({ apkBytes: f.apkBytes(), bundle, request, origin }), /byte count changed/u);
  await assert.rejects(verifyPublicSetupPayload({ apkBytes: f.apkBytes(), bundle: { files: [] }, request, origin }), /inventory/u);
});

test("Pages refuses a receipt that omits the companion required by its exact APK", (t) => {
  const f = fixture(t), release = finalized(f);
  const receipt = JSON.parse(readFileSync(release.receiptPath));
  delete receipt.artifacts.setup;
  const raw = Buffer.from(JSON.stringify(receipt));
  writeFileSync(release.receiptPath, raw);
  const manifest = JSON.parse(readFileSync(release.manifestPath));
  manifest.audit.candidate_receipt_sha256 = sha256Bytes(raw);
  writeFileSync(release.manifestPath, JSON.stringify(manifest));
  assert.throws(() => advancePagesCurrentReleaseDescriptor(release), /missing from sealed payload/u);
});
