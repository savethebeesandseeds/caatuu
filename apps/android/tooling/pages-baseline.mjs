import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from "node:fs";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(modulePath), "../../..");
export const defaultPagesBaselineDescriptor = resolve(dirname(modulePath), "pages-baseline.json");
export const baselineArchiveManifestPath = "caatuu-pages-baseline-manifest.json";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const zeroSha256 = "0".repeat(64);
const stableManifestPath = "android/releases/162/caatuu.json";
const stableApkPath = "android/releases/162/caatuu.apk";
const compatibilityManifestPath = "android/debug-releases/product-transition/161/caatuu-transition.json";
const compatibilityApkPath = "android/debug-releases/product-transition/161/caatuu-transition.apk";
const stableManifestArchivePath = `site/${stableManifestPath}`;
const stableApkArchivePath = `site/${stableApkPath}`;
const compatibilityManifestArchivePath = `site/${compatibilityManifestPath}`;
const compatibilityApkArchivePath = `site/${compatibilityApkPath}`;

function slashPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function normalizedArchivePath(value, label = "archive path") {
  const path = slashPath(value);
  assert.ok(path && !path.startsWith("/"), `${label} must be relative: ${path || "<empty>"}`);
  assert.ok(!path.includes("\0"), `${label} contains a NUL byte`);
  const parts = path.split("/");
  assert.ok(parts.every((part) => part && part !== "." && part !== ".."), `${label} is unsafe: ${path}`);
  assert.equal(parts.join("/"), path, `${label} is not normalized: ${path}`);
  return path;
}

function normalizedPublicPath(value, label = "public path") {
  const path = normalizedArchivePath(value, label);
  assert.doesNotMatch(path, /(?:^|\/)(?:\.git|secrets?|logs?)(?:\/|$)/iu, `${label} is not publishable: ${path}`);
  assert.doesNotMatch(path, /\.(?:aab|apks|jks|keystore)$/iu, `${label} is not publishable: ${path}`);
  return path;
}

function assertSha256(value, label) {
  assert.match(String(value || ""), sha256Pattern, `${label} must be a lowercase SHA-256 digest`);
}

function assertPositiveInteger(value, label) {
  assert.ok(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path) {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function assertNoSymlinkAncestors(path, boundary, label) {
  const root = resolve(boundary);
  let current = resolve(path);
  assert.ok(current === root || inside(root, current), `${label} escapes ${root}: ${current}`);
  while (current !== root) {
    if (existsSync(current)) {
      assert.ok(!lstatSync(current).isSymbolicLink(), `${label} uses a symbolic link: ${current}`);
    }
    current = dirname(current);
  }
}

function assertRegularSource(path, workspaceRoot, label) {
  const source = resolve(path);
  assert.ok(inside(workspaceRoot, source), `${label} escapes the workspace: ${source}`);
  assertNoSymlinkAncestors(source, workspaceRoot, label);
  assert.ok(existsSync(source), `${label} is missing: ${source}`);
  const stats = lstatSync(source);
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `${label} is not a regular file: ${source}`);
  return source;
}

function validatePackagedFile(file, label) {
  assert.ok(file && typeof file === "object" && !Array.isArray(file), `${label} is missing`);
  file.sourcePath = normalizedArchivePath(file.sourcePath, `${label}.sourcePath`);
  file.archivePath = normalizedArchivePath(file.archivePath, `${label}.archivePath`);
  assertPositiveInteger(file.bytes, `${label}.bytes`);
  assertSha256(file.sha256, `${label}.sha256`);
  if (file.publicPath) file.publicPath = normalizedPublicPath(file.publicPath, `${label}.publicPath`);
  if (file.publicPaths) {
    assert.ok(Array.isArray(file.publicPaths) && file.publicPaths.length > 0, `${label}.publicPaths must not be empty`);
    file.publicPaths = file.publicPaths.map((path, index) => normalizedPublicPath(path, `${label}.publicPaths[${index}]`));
    assert.equal(new Set(file.publicPaths).size, file.publicPaths.length, `${label}.publicPaths contains duplicates`);
  }
  return file;
}

function validateSourceFile(file, label) {
  assert.ok(file && typeof file === "object" && !Array.isArray(file), `${label} is missing`);
  assert.match(String(file.key || ""), /^[a-z0-9][a-z0-9-]*$/u, `${label}.key is invalid`);
  file.sourcePath = normalizedArchivePath(file.sourcePath, `${label}.sourcePath`);
  file.publicPath = normalizedPublicPath(file.publicPath, `${label}.publicPath`);
  assertPositiveInteger(file.bytes, `${label}.bytes`);
  assertSha256(file.sha256, `${label}.sha256`);
  return file;
}

export function packagedFilesFor(descriptor) {
  return [
    descriptor.stable.manifest,
    descriptor.stable.apk,
    descriptor.compatibility.manifest,
    descriptor.compatibility.apk
  ];
}

export function loadPagesBaseline({
  workspaceRoot = defaultWorkspaceRoot,
  descriptorPath = defaultPagesBaselineDescriptor,
  allowUnbuiltArchive = false
} = {}) {
  const workspace = resolve(workspaceRoot);
  const descriptorFile = assertRegularSource(resolve(descriptorPath), workspace, "Pages baseline descriptor");
  const descriptor = JSON.parse(readFileSync(descriptorFile, "utf8"));
  assert.equal(descriptor.schemaName, "caatuu-pages-baseline");
  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.channel, "existing-release-baseline");
  assert.equal(descriptor.canonicalOrigin, "https://caatuu.waajacu.com");
  assert.equal(descriptor.repository, "savethebeesandseeds/caatuu");

  const archive = descriptor.releaseArchive;
  assert.equal(archive.tag, "caatuu-pages-v162");
  assert.equal(archive.assetName, "caatuu-pages-v162.tar");
  assert.equal(
    archive.downloadUrl,
    `https://github.com/${descriptor.repository}/releases/download/${archive.tag}/${archive.assetName}`
  );
  assert.ok(Number.isSafeInteger(archive.bytes) && archive.bytes >= 0, "releaseArchive.bytes is invalid");
  assertSha256(archive.sha256, "releaseArchive.sha256");
  if (!allowUnbuiltArchive) {
    assertPositiveInteger(archive.bytes, "releaseArchive.bytes");
    assert.notEqual(archive.sha256, zeroSha256, "releaseArchive.sha256 has not been frozen yet");
  }

  assert.equal(descriptor.stable.versionCode, 162);
  assert.equal(descriptor.stable.versionName, "0.1.10");
  assert.equal(descriptor.compatibility.versionCode, 161);
  assert.equal(descriptor.compatibility.versionName, "0.1.10-transition.1");
  assert.equal(descriptor.stable.sourceRevision, descriptor.compatibility.sourceRevision);
  assert.match(descriptor.stable.sourceRevision, /^[a-f0-9]{40}$/u);
  validatePackagedFile(descriptor.stable.manifest, "stable.manifest");
  validatePackagedFile(descriptor.stable.apk, "stable.apk");
  validatePackagedFile(descriptor.compatibility.manifest, "compatibility.manifest");
  validatePackagedFile(descriptor.compatibility.apk, "compatibility.apk");
  assert.equal(descriptor.stable.manifest.archivePath, stableManifestArchivePath);
  assert.equal(descriptor.stable.apk.archivePath, stableApkArchivePath);
  assert.equal(descriptor.compatibility.manifest.archivePath, compatibilityManifestArchivePath);
  assert.equal(descriptor.compatibility.apk.archivePath, compatibilityApkArchivePath);
  assert.deepEqual(descriptor.stable.manifest.publicPaths, [stableManifestPath, "android/caatuu.json"]);
  assert.deepEqual(descriptor.stable.apk.publicPaths, [stableApkPath, "android/caatuu.apk"]);
  assert.deepEqual(descriptor.compatibility.manifest.publicPaths, [
    compatibilityManifestPath,
    "android/caatuu-debug.json"
  ]);
  assert.deepEqual(descriptor.compatibility.apk.publicPaths, [
    compatibilityApkPath,
    "android/caatuu-debug.apk"
  ]);

  const setup = descriptor.nativeSetup;
  setup.apkEntry = normalizedArchivePath(setup.apkEntry, "nativeSetup.apkEntry");
  setup.archivePath = normalizedArchivePath(setup.archivePath, "nativeSetup.archivePath");
  assert.equal(setup.apkEntry, "assets/courses/cz/setup-assets.json");
  assertPositiveInteger(setup.bytes, "nativeSetup.bytes");
  assertSha256(setup.sha256, "nativeSetup.sha256");
  assert.equal(setup.nativeArtifactCount, 662);
  assert.equal(setup.nativeArtifactBytes, 317718038);
  assert.equal(setup.completeDownloadBytes, 480853526);

  assert.ok(Array.isArray(descriptor.sourceOverrides) && descriptor.sourceOverrides.length === 5);
  descriptor.sourceOverrides = descriptor.sourceOverrides.map((file, index) => validateSourceFile(file, `sourceOverrides[${index}]`));
  assert.deepEqual(descriptor.sourceOverrides.map((file) => file.key), [
    "dictionary-sqlite",
    "release-onnx",
    "release-wasm",
    "legacy-czech-macaw",
    "legacy-agreement-aurora"
  ]);
  assert.ok(Array.isArray(descriptor.retainedFiles) && descriptor.retainedFiles.length === 6);
  descriptor.retainedFiles = descriptor.retainedFiles.map((file, index) => validateSourceFile(file, `retainedFiles[${index}]`));
  assert.deepEqual(descriptor.retainedFiles.map((file) => file.key), [
    "dictionary-catalog",
    "dictionary-manifest",
    "dictionary-sqlite",
    "embedding-catalog",
    "embedding-manifest",
    "embedding-sqlite"
  ]);
  const retainedDownloadBytes = descriptor.retainedFiles
    .filter((file) => ["dictionary-sqlite", "embedding-sqlite"].includes(file.key))
    .reduce((sum, file) => sum + file.bytes, 0);
  assert.equal(
    setup.nativeArtifactBytes + retainedDownloadBytes,
    setup.completeDownloadBytes,
    "nativeSetup.completeDownloadBytes does not match the fixed setup closure"
  );
  assert.ok(Array.isArray(descriptor.retiredPublicRoutes) && descriptor.retiredPublicRoutes.length > 0);
  assert.equal(new Set(descriptor.retiredPublicRoutes).size, descriptor.retiredPublicRoutes.length);
  assert.ok(descriptor.retiredPublicRoutes.every((route) => /^\/[a-z0-9_./-]+$/u.test(route)));

  const archivePaths = [setup.archivePath, baselineArchiveManifestPath];
  const publicPaths = [];
  for (const file of packagedFilesFor(descriptor)) {
    archivePaths.push(file.archivePath);
    if (file.publicPaths) publicPaths.push(...file.publicPaths);
  }
  publicPaths.push(...descriptor.retainedFiles.map((file) => file.publicPath));
  for (const [paths, label] of [[archivePaths, "archive"], [publicPaths, "public"]]) {
    assert.equal(new Set(paths).size, paths.length, `${label} paths must be unique`);
    assert.equal(
      new Set(paths.map((path) => path.toLocaleLowerCase("en-US"))).size,
      paths.length,
      `${label} paths must be unique without case distinctions`
    );
  }
  assert.equal(
    new Set(descriptor.sourceOverrides.map((file) => file.publicPath)).size,
    descriptor.sourceOverrides.length,
    "Source override public paths must be unique"
  );
  return { descriptor, descriptorPath: descriptorFile, workspaceRoot: workspace };
}

export function readZipEntry(zipPath, requestedEntry) {
  const source = readFileSync(zipPath);
  const eocdSignature = 0x06054b50;
  const minimumOffset = Math.max(0, source.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = source.length - 22; offset >= minimumOffset; offset -= 1) {
    if (source.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, `APK is missing its ZIP directory: ${zipPath}`);
  const entryCount = source.readUInt16LE(eocdOffset + 10);
  let offset = source.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(source.readUInt32LE(offset), 0x02014b50, `APK ZIP directory entry ${index} is invalid`);
    const method = source.readUInt16LE(offset + 10);
    const compressedBytes = source.readUInt32LE(offset + 20);
    const uncompressedBytes = source.readUInt32LE(offset + 24);
    const nameBytes = source.readUInt16LE(offset + 28);
    const extraBytes = source.readUInt16LE(offset + 30);
    const commentBytes = source.readUInt16LE(offset + 32);
    const localOffset = source.readUInt32LE(offset + 42);
    const name = source.subarray(offset + 46, offset + 46 + nameBytes).toString("utf8");
    if (name === requestedEntry) {
      assert.equal(source.readUInt32LE(localOffset), 0x04034b50, `APK ZIP local entry is invalid: ${name}`);
      const localNameBytes = source.readUInt16LE(localOffset + 26);
      const localExtraBytes = source.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameBytes + localExtraBytes;
      const compressed = source.subarray(dataOffset, dataOffset + compressedBytes);
      let value;
      if (method === 0) value = Buffer.from(compressed);
      else if (method === 8) value = inflateRawSync(compressed);
      else throw new Error(`Unsupported APK ZIP compression method ${method} for ${name}`);
      assert.equal(value.length, uncompressedBytes, `APK ZIP entry size changed: ${name}`);
      return value;
    }
    offset += 46 + nameBytes + extraBytes + commentBytes;
  }
  throw new Error(`APK does not contain ${requestedEntry}: ${zipPath}`);
}

function assertFileMatches(path, file, label) {
  const stats = statSync(path);
  assert.equal(stats.size, file.bytes, `${label} byte count changed`);
  assert.equal(sha256File(path), file.sha256, `${label} SHA-256 changed`);
}

function validateAndroidManifest(raw, channel, artifact) {
  const manifest = JSON.parse(raw.toString("utf8"));
  assert.equal(manifest.version_code, channel.versionCode);
  assert.equal(manifest.version_name, channel.versionName);
  assert.equal(manifest.source_revision, channel.sourceRevision);
  assert.equal(manifest.bytes, channel.apk.bytes);
  assert.equal(manifest.sha256, channel.apk.sha256);
  assert.equal(manifest.package_name, "com.waajacu.caatuu");
  assert.equal(new URL(manifest.apk_url).origin, "https://caatuu.waajacu.com");
  assert.equal(new URL(manifest.apk_url).pathname.slice(1), artifact.publicPaths[0].replace(/\.json$/u, ".apk"));
  return manifest;
}

function validateReleaseSetup(value, descriptor) {
  assert.equal(value.length, descriptor.nativeSetup.bytes, "Embedded release setup manifest byte count changed");
  assert.equal(sha256Bytes(value), descriptor.nativeSetup.sha256, "Embedded release setup manifest hash changed");
  const manifest = JSON.parse(value.toString("utf8"));
  const nativeArtifacts = manifest.artifacts.filter((artifact) => artifact.native_required === true);
  assert.equal(nativeArtifacts.length, descriptor.nativeSetup.nativeArtifactCount);
  assert.equal(
    nativeArtifacts.reduce((sum, artifact) => sum + Number(artifact.bytes || 0), 0),
    descriptor.nativeSetup.nativeArtifactBytes
  );
  return manifest;
}

function embeddedArchiveManifest(descriptor, files) {
  return {
    schemaName: "caatuu-pages-baseline-archive",
    schemaVersion: 1,
    channel: descriptor.channel,
    stableVersionCode: descriptor.stable.versionCode,
    compatibilityVersionCode: descriptor.compatibility.versionCode,
    sourceRevision: descriptor.stable.sourceRevision,
    nativeSetup: {
      path: descriptor.nativeSetup.archivePath,
      bytes: descriptor.nativeSetup.bytes,
      sha256: descriptor.nativeSetup.sha256,
      nativeArtifactCount: descriptor.nativeSetup.nativeArtifactCount,
      nativeArtifactBytes: descriptor.nativeSetup.nativeArtifactBytes,
      completeDownloadBytes: descriptor.nativeSetup.completeDownloadBytes
    },
    files: files
      .map((file) => ({ path: file.archivePath, bytes: file.bytes, sha256: file.sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path, "en"))
  };
}

function publicPathFromReleaseUrl(value, label) {
  const raw = String(value || "");
  assert.ok(raw.startsWith("/"), `${label} must use an origin-root URL: ${raw || "<empty>"}`);
  let decoded;
  try {
    decoded = decodeURIComponent(raw.split(/[?#]/u, 1)[0]);
  } catch (error) {
    throw new Error(`${label} has an invalid encoded URL: ${raw}`, { cause: error });
  }
  return normalizedPublicPath(decoded.slice(1), label);
}

function sourceOverrideFor(descriptor, publicPath) {
  return descriptor.sourceOverrides.find((file) => file.publicPath === publicPath);
}

function sourcePathForReleaseArtifact(workspace, publicPath) {
  if (publicPath.startsWith("assets/")) {
    let assetPath = publicPath.slice("assets/".length);
    if (assetPath.startsWith("loading_animation/")) {
      assetPath = `loading-animation/${assetPath.slice("loading_animation/".length)}`;
    } else if (assetPath.startsWith("miscellaneous/")) {
      assetPath = `visual-vocabulary/${assetPath.slice("miscellaneous/".length)}`;
    }
    return resolve(workspace, "apps/launcher/static/assets", assetPath);
  }
  if (publicPath.startsWith("language-runtime/")) {
    return resolve(workspace, "apps/language-runtime", publicPath.slice("language-runtime/".length));
  }
  if (publicPath.startsWith("cz/")) {
    return resolve(workspace, "apps/languages/czech/static", publicPath.slice("cz/".length));
  }
  throw new Error(`Unsupported release setup URL: /${publicPath}`);
}

function archiveEntryForReleaseArtifact({ artifact, descriptor, workspace }) {
  const publicPath = publicPathFromReleaseUrl(artifact.url, `${artifact.key || "release artifact"}.url`);
  const override = sourceOverrideFor(descriptor, publicPath);
  if (override) {
    assert.equal(override.bytes, Number(artifact.bytes), `${override.key} does not match the release setup byte count`);
    assert.equal(override.sha256, String(artifact.sha256).toLowerCase(), `${override.key} does not match the release setup hash`);
  }
  const sourcePath = assertRegularSource(
    override ? resolve(workspace, override.sourcePath) : sourcePathForReleaseArtifact(workspace, publicPath),
    workspace,
    artifact.key || publicPath
  );
  const expected = {
    bytes: Number(artifact.bytes),
    sha256: String(artifact.sha256).toLowerCase()
  };
  assertFileMatches(sourcePath, expected, artifact.key || publicPath);
  return {
    archivePath: `site/${publicPath}`,
    bytes: expected.bytes,
    sha256: expected.sha256,
    sourcePath
  };
}

function archiveEntryForRetainedFile({ file, descriptor, workspace }) {
  const override = sourceOverrideFor(descriptor, file.publicPath);
  if (override) {
    assert.equal(override.bytes, file.bytes, `${file.key} source override byte count changed`);
    assert.equal(override.sha256, file.sha256, `${file.key} source override hash changed`);
  }
  const sourcePath = assertRegularSource(
    resolve(workspace, override?.sourcePath || file.sourcePath),
    workspace,
    file.key
  );
  assertFileMatches(sourcePath, file, file.key);
  return {
    archivePath: `site/${file.publicPath}`,
    bytes: file.bytes,
    sha256: file.sha256,
    sourcePath
  };
}

function assertUniqueArchiveEntries(entries) {
  const paths = entries.map((entry) => entry.archivePath);
  assert.equal(new Set(paths).size, paths.length, "Baseline archive paths must be unique");
  assert.equal(
    new Set(paths.map((path) => path.toLocaleLowerCase("en-US"))).size,
    paths.length,
    "Baseline archive paths must be unique without case distinctions"
  );
}

export function baselineArchiveEntries({
  workspaceRoot = defaultWorkspaceRoot,
  descriptorPath = defaultPagesBaselineDescriptor
} = {}) {
  const { descriptor, workspaceRoot: workspace } = loadPagesBaseline({
    workspaceRoot,
    descriptorPath,
    allowUnbuiltArchive: true
  });
  const packaged = packagedFilesFor(descriptor).map((file) => {
    const sourcePath = assertRegularSource(resolve(workspace, file.sourcePath), workspace, file.key || file.archivePath);
    assertFileMatches(sourcePath, file, file.key || file.archivePath);
    return { ...file, sourcePath };
  });

  const stableManifest = packaged.find((file) => file.archivePath === stableManifestArchivePath);
  const stableApk = packaged.find((file) => file.archivePath === stableApkArchivePath);
  const compatibilityManifest = packaged.find((file) => file.archivePath === compatibilityManifestArchivePath);
  const compatibilityApk = packaged.find((file) => file.archivePath === compatibilityApkArchivePath);
  validateAndroidManifest(readFileSync(stableManifest.sourcePath), descriptor.stable, stableManifest);
  const transition = validateAndroidManifest(
    readFileSync(compatibilityManifest.sourcePath),
    descriptor.compatibility,
    compatibilityManifest
  );
  assert.equal(transition.stable_manifest_url, `${descriptor.canonicalOrigin}/android/caatuu.json`);

  const stableSetup = readZipEntry(stableApk.sourcePath, descriptor.nativeSetup.apkEntry);
  const compatibilitySetup = readZipEntry(compatibilityApk.sourcePath, descriptor.nativeSetup.apkEntry);
  assert.ok(stableSetup.equals(compatibilitySetup), "Stable 162 and compatibility 161 embed different setup manifests");
  const releaseSetup = validateReleaseSetup(stableSetup, descriptor);

  const nativeFiles = releaseSetup.artifacts
    .filter((artifact) => artifact.native_required === true)
    .map((artifact) => archiveEntryForReleaseArtifact({ artifact, descriptor, workspace }));
  const retainedFiles = descriptor.retainedFiles.map((file) =>
    archiveEntryForRetainedFile({ file, descriptor, workspace })
  );

  const payloadFiles = [
    ...packaged.map((file) => ({
      archivePath: file.archivePath,
      bytes: file.bytes,
      sha256: file.sha256,
      sourcePath: file.sourcePath
    })),
    ...nativeFiles,
    ...retainedFiles,
    {
      archivePath: descriptor.nativeSetup.archivePath,
      bytes: stableSetup.length,
      sha256: sha256Bytes(stableSetup),
      buffer: stableSetup
    }
  ].sort((left, right) => left.archivePath.localeCompare(right.archivePath, "en"));
  assertUniqueArchiveEntries(payloadFiles);
  const manifest = embeddedArchiveManifest(descriptor, payloadFiles);
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    descriptor,
    entries: [
      {
        archivePath: baselineArchiveManifestPath,
        bytes: manifestBuffer.length,
        sha256: sha256Bytes(manifestBuffer),
        buffer: manifestBuffer
      },
      ...payloadFiles
    ].sort((left, right) => left.archivePath.localeCompare(right.archivePath, "en")),
    manifest
  };
}

function octal(value, width, label) {
  const text = Number(value).toString(8);
  assert.ok(text.length <= width - 1, `${label} does not fit in a tar header`);
  return `${text.padStart(width - 1, "0")}\0`;
}

function splitTarPath(path) {
  if (Buffer.byteLength(path, "utf8") <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(name, "utf8") <= 100 && Buffer.byteLength(prefix, "utf8") <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`Archive path is too long for ustar: ${path}`);
}

function tarHeader(path, bytes) {
  const { name, prefix } = splitTarPath(path);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8, `${path} mode`), 100, 8, "ascii");
  header.write(octal(0, 8, `${path} uid`), 108, 8, "ascii");
  header.write(octal(0, 8, `${path} gid`), 116, 8, "ascii");
  header.write(octal(bytes, 12, `${path} size`), 124, 12, "ascii");
  header.write(octal(0, 12, `${path} mtime`), 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write(prefix, 345, 155, "utf8");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function writeBuffer(fd, value) {
  let offset = 0;
  while (offset < value.length) offset += writeSync(fd, value, offset, value.length - offset);
}

function writeSource(fd, sourcePath, expectedBytes, expectedSha256) {
  const sourceFd = openSync(sourcePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const hash = createHash("sha256");
  let total = 0;
  try {
    while (true) {
      const bytes = readSync(sourceFd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      const chunk = buffer.subarray(0, bytes);
      hash.update(chunk);
      writeBuffer(fd, chunk);
      total += bytes;
    }
  } finally {
    closeSync(sourceFd);
  }
  assert.equal(total, expectedBytes, `${sourcePath} changed while packaging`);
  assert.equal(hash.digest("hex"), expectedSha256, `${sourcePath} hash changed while packaging`);
}

export function packagePagesBaseline({
  workspaceRoot = defaultWorkspaceRoot,
  descriptorPath = defaultPagesBaselineDescriptor,
  outputPath
} = {}) {
  const workspace = resolve(workspaceRoot);
  const requestedOutput = resolve(outputPath || join(workspace, "artifacts/android/caatuu-pages-v162.tar"));
  const allowedOutputRoot = resolve(workspace, "artifacts/android");
  assert.ok(inside(allowedOutputRoot, requestedOutput), `Baseline archive output must be below ${allowedOutputRoot}`);
  assert.equal(basename(requestedOutput), "caatuu-pages-v162.tar");
  assertNoSymlinkAncestors(requestedOutput, workspace, "Baseline archive output");
  mkdirSync(dirname(requestedOutput), { recursive: true });
  const { descriptor, entries, manifest } = baselineArchiveEntries({ workspaceRoot: workspace, descriptorPath });
  const temporaryRoot = mkdtempSync(join(dirname(requestedOutput), ".caatuu-pages-baseline-"));
  const temporaryArchive = join(temporaryRoot, basename(requestedOutput));
  try {
    const fd = openSync(temporaryArchive, "wx", 0o600);
    try {
      for (const entry of entries) {
        writeBuffer(fd, tarHeader(entry.archivePath, entry.bytes));
        if (entry.buffer) writeBuffer(fd, entry.buffer);
        else writeSource(fd, entry.sourcePath, entry.bytes, entry.sha256);
        const padding = (512 - (entry.bytes % 512)) % 512;
        if (padding) writeBuffer(fd, Buffer.alloc(padding));
      }
      writeBuffer(fd, Buffer.alloc(1024));
    } finally {
      closeSync(fd);
    }
    const bytes = statSync(temporaryArchive).size;
    const sha256 = sha256File(temporaryArchive);
    if (descriptor.releaseArchive.bytes > 0 && descriptor.releaseArchive.sha256 !== zeroSha256) {
      assert.equal(bytes, descriptor.releaseArchive.bytes, "Generated archive byte count changed from the frozen descriptor");
      assert.equal(sha256, descriptor.releaseArchive.sha256, "Generated archive SHA-256 changed from the frozen descriptor");
    }
    if (existsSync(requestedOutput)) {
      const existing = lstatSync(requestedOutput);
      assert.ok(existing.isFile() && !existing.isSymbolicLink(), `Archive output is not a regular file: ${requestedOutput}`);
      if (existing.size === bytes && sha256File(requestedOutput) === sha256) {
        return { outputPath: requestedOutput, bytes, sha256, descriptor, manifest, reused: true };
      }
      throw new Error(`Refusing to replace a different baseline archive: ${requestedOutput}`);
    }
    renameSync(temporaryArchive, requestedOutput);
    return { outputPath: requestedOutput, bytes, sha256, descriptor, manifest, reused: false };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function readExact(fd, buffer, position, label) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytes = readSync(fd, buffer, offset, buffer.length - offset, position + offset);
    assert.ok(bytes > 0, `${label} ended unexpectedly`);
    offset += bytes;
  }
}

function tarString(header, offset, length) {
  const end = header.indexOf(0, offset);
  return header.subarray(offset, end >= offset && end < offset + length ? end : offset + length).toString("utf8");
}

function tarOctal(header, offset, length, label) {
  const value = header.subarray(offset, offset + length).toString("ascii").replace(/\0.*$/u, "").trim();
  assert.match(value, /^[0-7]+$/u, `${label} is not an octal tar field`);
  const parsed = Number.parseInt(value, 8);
  assert.ok(Number.isSafeInteger(parsed) && parsed >= 0, `${label} is invalid`);
  return parsed;
}

function assertTarChecksum(header, path) {
  const expected = tarOctal(header, 148, 8, `${path} checksum`);
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  assert.equal(actual, expected, `${path} tar checksum changed`);
}

function assertSafeExtractionDirectory(outputDir, workspaceRoot) {
  const output = resolve(outputDir);
  const workspace = resolve(workspaceRoot);
  const temporaryRoot = resolve(process.env.RUNNER_TEMP || tmpdir());
  if (inside(workspace, output)) {
    const allowed = resolve(workspace, "artifacts/android");
    assert.ok(inside(allowed, output), `Baseline extraction inside the workspace must be below ${allowed}`);
    assertNoSymlinkAncestors(output, workspace, "Baseline extraction");
  } else {
    assert.ok(inside(temporaryRoot, output), `Baseline extraction must be below ${temporaryRoot}`);
    assertNoSymlinkAncestors(output, temporaryRoot, "Baseline extraction");
  }
  assert.ok(!existsSync(output), `Baseline extraction target already exists: ${output}`);
  return output;
}

export function extractPagesBaselineArchive({
  workspaceRoot = defaultWorkspaceRoot,
  descriptorPath = defaultPagesBaselineDescriptor,
  archivePath,
  outputDir
} = {}) {
  const { descriptor, workspaceRoot: workspace } = loadPagesBaseline({ workspaceRoot, descriptorPath });
  const archive = resolve(archivePath);
  const archiveStats = lstatSync(archive);
  assert.ok(archiveStats.isFile() && !archiveStats.isSymbolicLink(), `Baseline archive is not a regular file: ${archive}`);
  assert.equal(archiveStats.size, descriptor.releaseArchive.bytes, "Baseline archive byte count does not match the pinned descriptor");
  assert.equal(sha256File(archive), descriptor.releaseArchive.sha256, "Baseline archive SHA-256 does not match the pinned descriptor");
  const output = assertSafeExtractionDirectory(outputDir, workspace);
  mkdirSync(output, { recursive: true });
  const fd = openSync(archive, "r");
  let fdOpen = true;
  let position = 0;
  let terminated = false;
  const seen = new Set();
  try {
    while (position < archiveStats.size) {
      const header = Buffer.alloc(512);
      readExact(fd, header, position, "Baseline tar header");
      position += 512;
      if (header.every((byte) => byte === 0)) {
        const finalBlock = Buffer.alloc(512);
        readExact(fd, finalBlock, position, "Baseline tar terminator");
        assert.ok(finalBlock.every((byte) => byte === 0), "Baseline tar has only one zero terminator block");
        position += 512;
        terminated = true;
        break;
      }
      assert.equal(tarString(header, 257, 6), "ustar", "Baseline archive is not ustar");
      const name = tarString(header, 0, 100);
      const prefix = tarString(header, 345, 155);
      const path = normalizedArchivePath(prefix ? `${prefix}/${name}` : name, "Baseline tar entry");
      assertTarChecksum(header, path);
      const type = header[156];
      assert.ok(type === 0 || type === "0".charCodeAt(0), `Baseline tar contains a non-file entry: ${path}`);
      const bytes = tarOctal(header, 124, 12, `${path} size`);
      assert.ok(!seen.has(path), `Baseline tar repeats ${path}`);
      seen.add(path);
      const destination = resolve(output, ...path.split("/"));
      assert.ok(inside(output, destination), `Baseline tar entry escapes extraction: ${path}`);
      mkdirSync(dirname(destination), { recursive: true });
      const destinationFd = openSync(destination, "wx", 0o600);
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let remaining = bytes;
      try {
        while (remaining > 0) {
          const wanted = Math.min(buffer.length, remaining);
          const chunk = buffer.subarray(0, wanted);
          readExact(fd, chunk, position, path);
          writeBuffer(destinationFd, chunk);
          position += wanted;
          remaining -= wanted;
        }
      } finally {
        closeSync(destinationFd);
      }
      const padding = (512 - (bytes % 512)) % 512;
      assert.ok(position + padding <= archiveStats.size, `${path} tar padding exceeds the archive`);
      position += padding;
    }
    assert.ok(terminated, "Baseline tar is missing its two-block terminator");
    assert.equal(position, archiveStats.size, "Baseline tar contains trailing or missing bytes");
    closeSync(fd);
    fdOpen = false;
    return validateExtractedPagesBaseline({
      workspaceRoot: workspace,
      descriptorPath,
      baselineDir: output
    });
  } catch (error) {
    if (fdOpen) closeSync(fd);
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

function allFiles(root) {
  const files = [];
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right, "en"))) {
      const absolute = join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const stats = lstatSync(absolute);
      assert.ok(!stats.isSymbolicLink(), `Baseline extraction contains a symbolic link: ${relativePath}`);
      if (stats.isDirectory()) visit(absolute, relativePath);
      else {
        assert.ok(stats.isFile(), `Baseline extraction contains a non-file entry: ${relativePath}`);
        files.push(relativePath);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export function validateExtractedPagesBaseline({
  workspaceRoot = defaultWorkspaceRoot,
  descriptorPath = defaultPagesBaselineDescriptor,
  baselineDir
} = {}) {
  const { descriptor, workspaceRoot: workspace } = loadPagesBaseline({ workspaceRoot, descriptorPath });
  const root = resolve(baselineDir);
  const temporaryRoot = resolve(process.env.RUNNER_TEMP || tmpdir());
  assert.ok(root !== workspace && (inside(workspace, root) || inside(temporaryRoot, root)), `Unsafe baseline directory: ${root}`);
  assertNoSymlinkAncestors(root, inside(workspace, root) ? workspace : temporaryRoot, "Baseline extraction");
  assert.ok(existsSync(root) && lstatSync(root).isDirectory(), `Baseline extraction is missing: ${root}`);
  const setupPath = join(root, descriptor.nativeSetup.archivePath);
  const setupBytes = readFileSync(setupPath);
  const setup = validateReleaseSetup(setupBytes, descriptor);
  const expectedRecords = [
    {
      path: descriptor.nativeSetup.archivePath,
      bytes: descriptor.nativeSetup.bytes,
      sha256: descriptor.nativeSetup.sha256
    },
    ...packagedFilesFor(descriptor).map((file) => ({
      path: file.archivePath,
      bytes: file.bytes,
      sha256: file.sha256
    })),
    ...setup.artifacts
      .filter((artifact) => artifact.native_required === true)
      .map((artifact) => ({
        path: `site/${publicPathFromReleaseUrl(artifact.url, `${artifact.key || "release artifact"}.url`)}`,
        bytes: Number(artifact.bytes),
        sha256: String(artifact.sha256).toLowerCase()
      })),
    ...descriptor.retainedFiles.map((file) => ({
      path: `site/${file.publicPath}`,
      bytes: file.bytes,
      sha256: file.sha256
    }))
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  assertUniqueArchiveEntries(expectedRecords.map((record) => ({ archivePath: record.path })));
  const expected = [baselineArchiveManifestPath, ...expectedRecords.map((record) => record.path)]
    .sort((left, right) => left.localeCompare(right, "en"));
  const files = allFiles(root);
  assert.deepEqual(files, expected, "Baseline extraction contains an unexpected file set");
  assert.equal(new Set(files.map((path) => path.toLocaleLowerCase("en-US"))).size, files.length, "Baseline extraction has a case-insensitive path collision");
  const inventory = expectedRecords.map((record) => ({
    path: record.path,
    bytes: statSync(join(root, record.path)).size,
    sha256: sha256File(join(root, record.path))
  }));
  assert.deepEqual(inventory, expectedRecords, "Baseline extraction bytes do not match the fixed release closure");
  for (const override of descriptor.sourceOverrides) {
    assert.ok(
      expectedRecords.some((record) => record.path === `site/${override.publicPath}`
        && record.bytes === override.bytes
        && record.sha256 === override.sha256),
      `Source override is not represented in the durable baseline: ${override.key}`
    );
  }
  const expectedManifest = embeddedArchiveManifest(
    descriptor,
    inventory.map((record) => ({
      archivePath: record.path,
      bytes: record.bytes,
      sha256: record.sha256
    }))
  );
  const actualManifest = JSON.parse(readFileSync(join(root, baselineArchiveManifestPath), "utf8"));
  assert.deepEqual(actualManifest, expectedManifest, "Baseline archive manifest does not match its extracted files");
  return { descriptor, baselineDir: root, files, inventory, setupManifest: setup, archiveManifest: actualManifest };
}
