import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { safePublicPath, validatePublishedInventory, validateWebsiteSnapshot, sealWebsiteSnapshot, restorePublishedWebsite } from "../pages-website-snapshot.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture(copy = "Any runtime-localized wording 🌍") {
  const files = [{ path: "index.html", bytes: Buffer.byteLength(copy), sha256: hash(copy) }];
  return { schema_name: "caatuu-web-bundle", schema_version: 1, profile: "web-static-pages-cutover", canonicalOrigin: "https://caatuu.waajacu.com", files, payloadFileCount: 1, payloadBytes: files[0].bytes, payloadSha256: hash(files.map((f) => `${f.path}\0${f.bytes}\0${f.sha256}`).join("\n")) };
}
test("website preservation depends on bytes, not interface copy or artwork names", () => {
  for (const copy of ["Text changes at runtime", "Nuevas palabras", "Nový obrázek"]) assert.equal(validatePublishedInventory(fixture(copy)).files.length, 1);
});
test("snapshot inventory rejects path escapes, duplicates, and changed bytes", () => {
  for (const path of ["../secret", "/etc/passwd", "a/../b", "a\\b", "x%2fy", "a?b", "a\nb"]) assert.throws(() => safePublicPath(path));
  const invalid = fixture(); invalid.files.push({ ...invalid.files[0], path: "INDEX.HTML" });
  assert.throws(() => validatePublishedInventory(invalid), /Duplicate/);
  const changed = fixture(); changed.files[0].sha256 = "a".repeat(64);
  assert.throws(() => validatePublishedInventory(changed));
});
test("website archives are source-pinned immutable and content verified before sealing", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "caatuu-snapshot-test-"));
  const siteDir = join(workspaceRoot, "artifacts/web/site");
  mkdirSync(siteDir, { recursive: true });
  writeFileSync(join(siteDir, "index.html"), "Any runtime-localized wording 🌍");
  writeFileSync(join(siteDir, "caatuu-web-bundle.json"), JSON.stringify(fixture()));
  const archivePath = join(workspaceRoot, "artifacts/web/website.tar");
  const snapshot = sealWebsiteSnapshot({ workspaceRoot, siteDir, archivePath, sourceRevision: "a".repeat(40) });
  assert.equal(validateWebsiteSnapshot(snapshot).sha256, hash(readFileSync(archivePath)));
  assert.equal(JSON.parse(readFileSync(join(siteDir, "caatuu-web-bundle.json"))).websiteSnapshot.tag, snapshot.tag);
  assert.throws(() => sealWebsiteSnapshot({ workspaceRoot, siteDir, archivePath, sourceRevision: "b".repeat(40) }), /overwrite/);
  assert.throws(() => validateWebsiteSnapshot({ ...snapshot, downloadUrl: "https://evil.example/site.tar" }));
  writeFileSync(join(siteDir, "index.html"), "changed after validation");
  assert.throws(() => sealWebsiteSnapshot({ workspaceRoot, siteDir, archivePath: `${archivePath}.new`, sourceRevision: "b".repeat(40) }), /mismatch/);
});

function restoreFixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "caatuu-snapshot-restore-"));
  const siteDir = join(workspaceRoot, "artifacts/web/base");
  mkdirSync(join(siteDir, "android"), { recursive: true });
  const baseFiles = { "index.html": "Unchanged localized website", "android/caatuu.json": "old manifest" };
  const inventory = (contents, metadata = {}) => {
    const files = Object.entries(contents).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), sha256: hash(text) })).sort((a, b) => a.path.localeCompare(b.path, "en"));
    return { ...fixture(), ...metadata, files, payloadFileCount: files.length, payloadBytes: files.reduce((sum, file) => sum + file.bytes, 0), payloadSha256: hash(files.map((f) => `${f.path}\0${f.bytes}\0${f.sha256}`).join("\n")) };
  };
  for (const [path, content] of Object.entries(baseFiles)) writeFileSync(join(siteDir, path), content);
  writeFileSync(join(siteDir, "caatuu-web-bundle.json"), JSON.stringify(inventory(baseFiles)));
  const archivePath = join(workspaceRoot, "artifacts/web/base.tar");
  const snapshot = sealWebsiteSnapshot({ workspaceRoot, siteDir, archivePath, sourceRevision: "a".repeat(40) });
  const oldNativePath = `assets/planets/releases/${hash("old installed app artwork").slice(0, 16)}/old-native.png`;
  const liveFiles = { ...baseFiles, "android/caatuu.json": "current manifest", "android/releases/166/caatuu.json": "current manifest", [oldNativePath]: "old installed app artwork" };
  const live = inventory(liveFiles, { websiteSnapshot: snapshot, android: { stableVersionCode: 166 } });
  const fetches = [];
  let inventoryReads = 0;
  const fixtureState = { workspaceRoot, archivePath, snapshot, live, liveFiles, oldNativePath, inventory, fetches };
  fixtureState.restore = (options = {}) => restorePublishedWebsite({
    workspaceRoot, archivePath, siteDir: join(workspaceRoot, "artifacts/web/restored"),
    fetchImpl: async (url) => {
      const path = new URL(url).pathname.slice(1);
      fetches.push(path);
      const content = path === "caatuu-web-bundle.json"
        ? JSON.stringify(++inventoryReads === 1 ? fixtureState.live : (fixtureState.after || fixtureState.live))
        : fixtureState.liveFiles[path];
      assert.notEqual(content, undefined, `Unexpected restore request: ${path}`);
      const response = new Response(content);
      Object.defineProperty(response, "url", { value: url });
      return response;
    }, ...options,
  });
  return fixtureState;
}

test("Android restoration preserves live additions from intermediate releases and the live version floor", async () => {
  const value = restoreFixture();
  const releaseDir = join(value.workspaceRoot, "artifacts/android/releases/166");
  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(join(releaseDir, "caatuu.json"), "current manifest");
  const result = await value.restore();
  const restored = JSON.parse(readFileSync(join(result.siteDir, "caatuu-web-bundle.json")));
  assert.deepEqual(restored, value.live);
  assert.equal(restored.android.stableVersionCode, 166);
  assert.equal(readFileSync(join(result.siteDir, value.oldNativePath), "utf8"), "old installed app artwork");
  assert.deepEqual(value.fetches, ["caatuu-web-bundle.json", value.oldNativePath, "caatuu-web-bundle.json"]);
  assert.equal(result.publicPayloadSha256, value.live.payloadSha256);
  assert.notEqual(result.publicPayloadSha256, value.snapshot.payloadSha256);
});

test("Android restoration refuses website changes or removals relative to its sealed snapshot", async () => {
  for (const remove of [false, true]) {
    const value = restoreFixture();
    if (remove) delete value.liveFiles["index.html"];
    else value.liveFiles["index.html"] = "unrelated website replacement";
    value.live = value.inventory(value.liveFiles, { websiteSnapshot: value.snapshot });
    await assert.rejects(value.restore(), /snapshot (?:file|bytes)/);
  }
});

test("Android restoration verifies downloaded additions and refuses concurrent publication", async () => {
  const corrupt = restoreFixture();
  corrupt.liveFiles[corrupt.oldNativePath] = "corrupt downloaded asset";
  await assert.rejects(corrupt.restore(), /Downloaded bytes do not match/);
  const changed = restoreFixture();
  changed.after = { ...changed.live, android: { stableVersionCode: 167 } };
  await assert.rejects(changed.restore(), /Website changed during restoration/);
});
