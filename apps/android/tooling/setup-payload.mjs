#!/usr/bin/env node

import assert from "node:assert/strict";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readZipEntry, sha256Bytes } from "./pages-baseline.mjs";

export const setupPayloadInventory = "caatuu-setup-payload.json";
const origin = "https://caatuu.waajacu.com";
const maxArchiveBytes = 256 * 1024 * 1024;

function safePath(path) {
  assert.equal(typeof path, "string", "Setup payload path must be a string");
  assert.ok(path && !isAbsolute(path) && !/[\\\x00-\x1f:<>"|?*]/u.test(path), `Unsafe setup payload path: ${path}`);
  assert.ok(path.split("/").every((part) => part && part !== "." && part !== ".." && !/[. ]$/u.test(part)), `Unsafe setup payload path: ${path}`);
  return path;
}

function validateInventory(value) {
  assert.deepEqual(Object.keys(value).sort(), ["artifacts", "schemaVersion"]);
  assert.equal(value.schemaVersion, 1);
  assert.ok(Array.isArray(value.artifacts), "Setup payload inventory has no artifacts");
  const targets = new Set();
  const objects = new Map();
  for (const record of value.artifacts) {
    assert.deepEqual(Object.keys(record).sort(), ["assetPath", "bytes", "file", "path", "sha256"]);
    safePath(record.assetPath);
    assert.ok(!targets.has(record.assetPath.toLowerCase()), `Repeated setup payload asset: ${record.assetPath}`);
    targets.add(record.assetPath.toLowerCase());
    assert.match(record.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes > 0, "Invalid setup payload byte count");
    const match = /^assets\/setup\/([a-f0-9]{64})\/([A-Za-z0-9_.-]+)$/u.exec(safePath(record.path));
    assert.ok(match && match[1] === record.sha256, `Setup payload URL is not content-addressed: ${record.path}`);
    assert.equal(record.file, `objects/${record.sha256}/${match[2]}`, "Setup payload file differs from its public path");
    safePath(record.file);
    const previous = objects.get(record.path);
    if (previous) {
      assert.equal(previous.bytes, record.bytes, `Conflicting setup payload: ${record.path}`);
      assert.equal(previous.file, record.file, `Conflicting setup payload file: ${record.path}`);
      previous.assetPaths.push(record.assetPath);
    } else objects.set(record.path, { ...record, assetPaths: [record.assetPath] });
  }
  assert.equal(new Set([...objects.keys()].map((path) => path.toLowerCase())).size, objects.size, "Case-colliding setup payload objects");
  return objects;
}

function verifyEntries(entries) {
  assert.ok(entries.has(setupPayloadInventory), "Setup payload inventory is missing");
  const objects = validateInventory(JSON.parse(entries.get(setupPayloadInventory).toString("utf8")));
  const expected = new Set([setupPayloadInventory, ...[...objects.values()].map(({ file }) => file)]);
  assert.deepEqual([...entries.keys()].sort(), [...expected].sort(), "Setup payload has missing or unlisted files");
  for (const object of objects.values()) {
    object.content = entries.get(object.file);
    assert.equal(object.content.length, object.bytes, `Setup payload bytes changed: ${object.path}`);
    assert.equal(sha256Bytes(object.content), object.sha256, `Setup payload hash changed: ${object.path}`);
  }
  return objects;
}

/** Parse regular ustar files without extracting paths supplied by an archive. */
export function parseSetupPayloadArchive(buffer) {
  assert.ok(Buffer.isBuffer(buffer) && buffer.length <= maxArchiveBytes, "Setup payload archive exceeds its 256 MiB safety limit");
  const entries = new Map();
  const field = (header, start, size) => header.subarray(start, start + size).toString("utf8").replace(/\0.*$/su, "");
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      assert.ok(buffer.length - offset >= 1024 && buffer.subarray(offset).every((byte) => byte === 0), "Setup tar has invalid termination or trailing bytes");
      return verifyEntries(entries);
    }
    assert.equal(field(header, 257, 6), "ustar", "Setup archive must use ustar");
    const checksum = field(header, 148, 8).trim();
    assert.match(checksum, /^[0-7]+$/u);
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(actualChecksum, Number.parseInt(checksum, 8), "Setup tar checksum changed");
    assert.ok(header[156] === 0 || header[156] === 48, "Setup archive contains a link, directory or special file");
    const prefix = field(header, 345, 155);
    const path = safePath(`${prefix ? `${prefix}/` : ""}${field(header, 0, 100)}`);
    assert.ok(!entries.has(path), `Setup archive repeats ${path}`);
    const size = field(header, 124, 12).trim();
    assert.match(size, /^[0-7]+$/u);
    const bytes = Number.parseInt(size, 8);
    assert.ok(Number.isSafeInteger(bytes) && offset + 512 + bytes <= buffer.length, "Setup tar entry is truncated");
    entries.set(path, buffer.subarray(offset + 512, offset + 512 + bytes));
    offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  throw new Error("Setup tar is missing its terminator");
}

export function readSetupPayloadArchive(path) {
  const stats = lstatSync(path);
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), "Setup archive must be a regular file");
  assert.ok(stats.size <= maxArchiveBytes, "Setup payload archive exceeds its 256 MiB safety limit");
  return parseSetupPayloadArchive(readFileSync(path));
}

function confined(root, path) {
  const rel = relative(root, path);
  assert.ok(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "Setup payload path escapes workspace");
  for (let current = path; current !== root; current = dirname(current)) {
    if (existsSync(current)) assert.ok(!lstatSync(current).isSymbolicLink(), "Setup payload uses a symbolic link");
  }
}

/** Called by the real builder once, before package audit and candidate sealing. */
export function packageSetupPayload({ workspaceRoot, inputDir, output, outputDir }) {
  const root = resolve(workspaceRoot);
  const input = resolve(inputDir);
  assert.ok(Boolean(output) !== Boolean(outputDir), "Specify exactly one setup payload output file or directory");
  let archive = output ? resolve(output) : null;
  const destination = archive ? dirname(archive) : resolve(outputDir);
  confined(root, input);
  confined(root, archive ?? destination);
  const entries = new Map();
  function visit(directory, prefix = "") {
    for (const name of readdirSync(directory).sort()) {
      const path = safePath(prefix ? `${prefix}/${name}` : name);
      const absolute = resolve(input, path);
      const stats = lstatSync(absolute);
      assert.ok(!stats.isSymbolicLink(), "Setup payload contains a symbolic link");
      if (stats.isDirectory()) visit(absolute, path);
      else { assert.ok(stats.isFile(), "Setup payload contains a special file"); entries.set(path, readFileSync(absolute)); }
    }
  }
  visit(input);
  verifyEntries(entries);
  mkdirSync(destination, { recursive: true });
  const temporary = resolve(destination, `.setup-payload.${randomBytes(8).toString("hex")}.tmp`);
  try {
    execFileSync("tar", ["--format=ustar", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--mode=0644", "--no-recursion", "-cf", temporary, "-C", input, "--verbatim-files-from", "--files-from=-"], { input: `${[...entries.keys()].sort().join("\n")}\n`, windowsHide: true });
    const payload = readSetupPayloadArchive(temporary);
    const sha256 = sha256Bytes(readFileSync(temporary));
    archive ??= resolve(destination, `${sha256}.tar`);
    confined(root, archive);
    if (existsSync(archive)) assert.equal(sha256Bytes(readFileSync(archive)), sha256Bytes(readFileSync(temporary)), "Refusing to replace a different sealed setup payload");
    else copyFileSync(temporary, archive, constants.COPYFILE_EXCL);
    return { path: relative(root, archive).split(sep).join("/"), objects: payload.size, bytes: lstatSync(archive).size, sha256 };
  } finally { rmSync(temporary, { force: true }); }
}

/** All companion objects must be reachable from APK-pinned course setup catalogs. */
export function validateSetupPayloadForApk(apkPath, payload, readApkAsset = readZipEntry) {
  const bundle = JSON.parse(readApkAsset(apkPath, "assets/caatuu-course-bundle.json").toString("utf8"));
  const required = new Map();
  for (const course of bundle.courses) {
    safePath(course.assetPrefix);
    const setup = JSON.parse(readApkAsset(apkPath, `assets/${course.assetPrefix}/setup-assets.json`).toString("utf8"));
    for (const artifact of setup.artifacts.filter((item) => item.native_required === true)) {
      const url = new URL(artifact.url, origin);
      if (!url.pathname.startsWith("/assets/setup/")) continue;
      assert.equal(url.origin, origin, "Setup payload origin differs from the APK");
      assert.ok(!url.search && !url.hash && !url.username && !url.password, "Setup payload URL must name exact immutable bytes");
      const path = safePath(url.pathname.slice(1));
      const object = payload.get(path);
      assert.ok(object, `APK setup object is missing from sealed payload: ${path}`);
      assert.equal(object.bytes, artifact.bytes, `APK setup byte count differs: ${path}`);
      assert.equal(object.sha256, artifact.sha256, `APK setup hash differs: ${path}`);
      const localPath = safePath(artifact.asset_path);
      const assetPath = /^(?:assets|language-runtime)\//u.test(localPath) ? localPath : `${course.assetPrefix}/${localPath}`;
      assert.ok(object.assetPaths.includes(assetPath), `APK setup logical path differs: ${assetPath}`);
      required.set(assetPath, path);
    }
  }
  for (const [path, object] of payload) {
    for (const assetPath of object.assetPaths) assert.equal(required.get(assetPath), path, `Unreferenced setup payload asset: ${assetPath}`);
  }
  return payload;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2].replace(/^--/u, ""), args[i * 2 + 1]]));
    if (command === "package") process.stdout.write(`${JSON.stringify(packageSetupPayload({ workspaceRoot: options["repo-root"], inputDir: options.input, output: options.output, outputDir: options["output-dir"] }))}\n`);
    else if (command === "verify") { const payload = readSetupPayloadArchive(options.archive); if (options.apk) validateSetupPayloadForApk(options.apk, payload); process.stdout.write(`${JSON.stringify({ objects: payload.size })}\n`); }
    else throw new Error("Usage: setup-payload.mjs package|verify [options]");
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
