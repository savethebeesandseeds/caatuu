#!/usr/bin/env node
// Preserve deployment artifacts, never compile application sources on an APK update.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { sha256File } from "./pages-baseline.mjs";

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const origin = "https://caatuu.waajacu.com";
const repository = "savethebeesandseeds/caatuu";
const inventoryPath = "caatuu-web-bundle.json";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function safePublicPath(path) {
  assert.equal(typeof path, "string");
  assert.ok(path.length > 0 && !path.includes("\\") && !path.includes("\0") && !/[?#%\r\n]/u.test(path));
  assert.ok(!path.startsWith("/") && path.split("/").every((part) => part && part !== "." && part !== ".."));
  return path;
}

function generatedPath(path, workspaceRoot) {
  const root = resolve(workspaceRoot, "artifacts/web");
  const target = resolve(path);
  const rel = relative(root, target);
  assert.ok(rel && !rel.startsWith("..") && !rel.includes(":"), "Snapshot output must be below artifacts/web");
  for (let cursor = target; ; cursor = dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), `Snapshot path is a symlink: ${cursor}`);
    if (cursor === root) break;
  }
  return target;
}

export function validatePublishedInventory(value) {
  assert.equal(value.schema_name, "caatuu-web-bundle");
  assert.equal(value.schema_version, 1);
  assert.equal(value.canonicalOrigin, origin);
  assert.equal(value.profile, "web-static-pages-cutover");
  assert.ok(Array.isArray(value.files) && value.files.length > 0);
  const paths = new Set();
  let bytes = 0;
  for (const record of value.files) {
    safePublicPath(record.path);
    assert.notEqual(record.path, inventoryPath);
    const folded = record.path.toLowerCase();
    assert.ok(!paths.has(folded), `Duplicate snapshot path: ${record.path}`);
    paths.add(folded);
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0);
    assert.match(record.sha256, /^[a-f0-9]{64}$/u);
    bytes += record.bytes;
  }
  assert.equal(value.payloadFileCount, value.files.length);
  assert.equal(value.payloadBytes, bytes);
  assert.ok(bytes < 1_000_000_000, "Published website exceeds the Pages payload budget");
  assert.equal(value.payloadSha256, hash(value.files.map((f) => `${f.path}\0${f.bytes}\0${f.sha256}`).join("\n")));
  return value;
}

export function validateWebsiteSnapshot(value) {
  assert.equal(value?.schemaVersion, 1);
  assert.match(value.sourceRevision, /^[a-f0-9]{40}$/u);
  assert.equal(value.tag, `caatuu-web-${value.sourceRevision}`);
  assert.equal(value.downloadUrl, `https://github.com/${repository}/releases/download/${value.tag}/caatuu-website.tar`);
  assert.ok(Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes < 1_100_000_000);
  assert.match(value.sha256, /^[a-f0-9]{64}$/u);
  assert.match(value.payloadSha256, /^[a-f0-9]{64}$/u);
  return value;
}

async function publicInventory(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${origin}/${inventoryPath}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  assert.equal(response.url, `${origin}/${inventoryPath}`);
  assert.ok(response.ok, `Published inventory returned ${response.status}`);
  return validatePublishedInventory(await response.json());
}

function matches(path, record) {
  return existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()
    && lstatSync(path).size === record.bytes && sha256File(path) === record.sha256;
}

async function download(url, output, expected, { fetchImpl = globalThis.fetch, replace = false } = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(180_000) });
  assert.ok(response.ok && response.body, `Snapshot download failed: ${response.status} ${url}`);
  assert.equal(new URL(response.url).protocol, "https:");
  mkdirSync(dirname(output), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(output, { flags: replace ? "w" : "wx" }));
  assert.ok(matches(output, expected), `Downloaded bytes do not match the receipt: ${url}`);
}

function verifyDirectory(siteDir, manifest) {
  const actual = [];
  function walk(dir, prefix = "") {
    for (const name of readdirSync(dir)) {
      const path = prefix ? `${prefix}/${name}` : name;
      safePublicPath(path);
      const stat = lstatSync(join(dir, name));
      assert.ok(!stat.isSymbolicLink(), `Snapshot contains a symlink: ${path}`);
      if (stat.isDirectory()) walk(join(dir, name), path);
      else { assert.ok(stat.isFile()); actual.push(path); }
    }
  }
  walk(siteDir);
  assert.deepEqual(actual.sort(), [...manifest.files.map((f) => f.path), inventoryPath].sort());
  for (const record of manifest.files) assert.ok(matches(join(siteDir, record.path), record), `Snapshot mismatch: ${record.path}`);
}

// One-time migration for a previously deployed site whose Actions artifact expired.
// Cache candidates are accepted only if they match the live site's signed-off inventory.
export async function capturePublishedWebsite({ workspaceRoot = workspaceDefault, siteDir, cacheDir }) {
  const output = generatedPath(siteDir, workspaceRoot);
  assert.ok(!existsSync(output), "Capture target must be new");
  const manifest = await publicInventory();
  mkdirSync(output, { recursive: true });
  let cursor = 0;
  let cached = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < manifest.files.length) {
      const record = manifest.files[cursor++];
      const destination = join(output, record.path);
      mkdirSync(dirname(destination), { recursive: true });
      const candidate = cacheDir && join(generatedPath(cacheDir, workspaceRoot), record.path);
      if (candidate && matches(candidate, record)) { copyFileSync(candidate, destination); cached += 1; }
      else await download(`${origin}/${record.path}`, destination, record);
    }
  }));
  const current = await publicInventory();
  assert.equal(current.payloadSha256, manifest.payloadSha256, "Website changed during capture; do not publish this snapshot");
  writeFileSync(join(output, inventoryPath), `${JSON.stringify(manifest, null, 2)}\n`);
  verifyDirectory(output, manifest);
  return { siteDir: output, cached, downloaded: manifest.files.length - cached, payloadSha256: manifest.payloadSha256 };
}

export function sealWebsiteSnapshot({ workspaceRoot = workspaceDefault, siteDir, archivePath, sourceRevision }) {
  const site = generatedPath(siteDir, workspaceRoot);
  const archive = generatedPath(archivePath, workspaceRoot);
  assert.ok(!existsSync(archive), "Refusing to overwrite a website snapshot archive");
  assert.match(sourceRevision, /^[a-f0-9]{40}$/u);
  const manifest = validatePublishedInventory(JSON.parse(readFileSync(join(site, inventoryPath), "utf8")));
  verifyDirectory(site, manifest);
  mkdirSync(dirname(archive), { recursive: true });
  execFileSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--format=ustar", "-cf", archive, "-C", site, "."]);
  const tag = `caatuu-web-${sourceRevision}`;
  const snapshot = validateWebsiteSnapshot({
    schemaVersion: 1, tag, sourceRevision,
    downloadUrl: `https://github.com/${repository}/releases/download/${tag}/caatuu-website.tar`,
    bytes: lstatSync(archive).size, sha256: sha256File(archive), payloadSha256: manifest.payloadSha256,
  });
  writeFileSync(`${archive}.json`, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
  // The archive contains the prior inventory. This field records provenance,
  // not a self-referential hash of the archive that contains it.
  writeFileSync(join(site, inventoryPath), `${JSON.stringify({ ...manifest, websiteSnapshot: snapshot }, null, 2)}\n`);
  return snapshot;
}

export async function restorePublishedWebsite({ workspaceRoot = workspaceDefault, siteDir, archivePath, bootstrapPath, fetchImpl = globalThis.fetch }) {
  const output = generatedPath(siteDir, workspaceRoot);
  const archive = generatedPath(archivePath, workspaceRoot);
  assert.ok(!existsSync(output), "Restore target must be new");
  const live = await publicInventory(fetchImpl);
  const bootstrap = !live.websiteSnapshot;
  const snapshot = validateWebsiteSnapshot(bootstrap
    ? JSON.parse(readFileSync(bootstrapPath, "utf8")) : live.websiteSnapshot);
  if (bootstrap) assert.equal(live.payloadSha256, snapshot.payloadSha256, "Public website differs from its migration snapshot");
  if (!existsSync(archive)) await download(snapshot.downloadUrl, archive, snapshot, { fetchImpl });
  assert.ok(matches(archive, snapshot), "Website archive differs from its pinned receipt");
  const listing = execFileSync("tar", ["-tf", archive], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  for (const entry of listing.trim().split("\n")) {
    if (entry === "./") continue;
    safePublicPath(entry.replace(/^\.\//u, "").replace(/\/$/u, ""));
  }
  const types = execFileSync("tar", ["-tvf", archive], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.ok(types.trim().split("\n").every((line) => /^[d-]/u.test(line)), "Website archive contains links or special files");
  mkdirSync(output, { recursive: true });
  execFileSync("tar", ["--extract", "--file", archive, "--directory", output, "--no-same-owner", "--no-same-permissions"]);
  const manifest = validatePublishedInventory(JSON.parse(readFileSync(join(output, inventoryPath), "utf8")));
  assert.equal(manifest.payloadSha256, snapshot.payloadSha256);
  verifyDirectory(output, manifest);

  // The snapshot is the last website build, not necessarily the last Android
  // publication. Preserve the complete CURRENT inventory, including assets that
  // older installed APKs still need but the new APK no longer references.
  const liveFiles = new Map(live.files.map((record) => [record.path, record]));
  const aliases = new Set(["android/caatuu.apk", "android/caatuu.json"]);
  for (const record of manifest.files) {
    const published = liveFiles.get(record.path);
    assert.ok(published, `Published website removed a snapshot file: ${record.path}`);
    if (!aliases.has(record.path)) assert.deepEqual(published, record, `Published website changed immutable snapshot bytes: ${record.path}`);
  }
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < live.files.length) {
      const record = live.files[cursor++];
      const destination = join(output, record.path);
      if (matches(destination, record)) continue;
      // Workflow inputs already contain retained release files. Reuse them only
      // when their identity matches the live public inventory exactly.
      const retained = /^android\/releases\/[1-9][0-9]*\/(?:caatuu\.apk|caatuu\.json|caatuu-release-candidate\.json)$/u.test(record.path);
      const stableVersion = live.android?.stableVersionCode;
      const candidate = retained ? join(workspaceRoot, "artifacts", record.path)
        : aliases.has(record.path) && Number.isSafeInteger(stableVersion) && stableVersion > 0
          ? join(workspaceRoot, "artifacts/android/releases", String(stableVersion), record.path.slice("android/".length)) : null;
      mkdirSync(dirname(destination), { recursive: true });
      if (candidate && matches(candidate, record)) copyFileSync(candidate, destination);
      else await download(`${origin}/${record.path}`, destination, record, { fetchImpl, replace: aliases.has(record.path) });
    }
  }));
  writeFileSync(join(output, inventoryPath), `${JSON.stringify(live, null, 2)}\n`);
  verifyDirectory(output, live);
  const current = await publicInventory(fetchImpl);
  assert.deepEqual(current, live, "Website changed during restoration");
  return { siteDir: output, snapshot, publicPayloadSha256: live.payloadSha256 };
}

async function main(argv) {
  const [command, ...args] = argv;
  const options = { workspaceRoot: workspaceDefault };
  for (let index = 0; index < args.length; index += 2) {
    const key = { "--workspace-root": "workspaceRoot", "--site": "siteDir", "--archive": "archivePath", "--cache": "cacheDir", "--revision": "sourceRevision", "--bootstrap": "bootstrapPath", "--descriptor": "descriptorPath" }[args[index]];
    assert.ok(key && args[index + 1], `Invalid argument: ${args[index]}`);
    options[key] = args[index + 1];
  }
  if (command === "capture") return capturePublishedWebsite(options);
  if (command === "seal") return sealWebsiteSnapshot(options);
  if (command === "android") {
    const restored = await restorePublishedWebsite(options);
    const { overlayAndroidReleaseSite } = await import("./pages-android-overlay.mjs");
    const result = overlayAndroidReleaseSite({ ...options, websiteSnapshot: restored.snapshot });
    return {
      versionCode: result.versionCode,
      preservedFileCount: result.preservedFileCount,
      addedSetupPaths: result.addedSetupPaths,
      websiteSnapshot: restored.snapshot.tag,
      payloadSha256: result.manifest.payloadSha256,
    };
  }
  throw new Error(`Unknown snapshot command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { console.error(error.stack); process.exitCode = 1; });
}
