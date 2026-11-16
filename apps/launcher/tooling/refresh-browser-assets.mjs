import assert from "node:assert/strict";
import { sourcePathForArtifact } from "../../server/tooling/refresh-setup-assets.mjs";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "../../..");
const catalogRelativePath = "apps/launcher/static/assets/browser-assets.json";
const kinds = new Set(["visual-asset", "asset-keymap", "music", "music-license"]);

function canonicalFile(path, root, label) {
  const suffix = relative(root, path);
  assert.ok(suffix && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix),
    `${label} must remain inside the launcher asset authority`);
  const stats = lstatSync(path);
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `${label} must be a regular file`);
  assert.equal(realpathSync(path), path, `${label} must resolve to its canonical source, without aliases`);
}

/** Refresh receipts of explicitly reviewed entries; never discover or add assets. */
export function refreshSharedBrowserAssetReceipts({ workspaceRoot = defaultWorkspaceRoot, write = false } = {}) {
  const workspace = realpathSync(resolve(workspaceRoot));
  const launcher = resolve(workspace, "apps/launcher/static");
  assert.equal(realpathSync(launcher), launcher, "Launcher authority must be canonical");
  const catalogPath = resolve(workspace, catalogRelativePath);
  canonicalFile(catalogPath, launcher, "Shared browser catalog");
  const manifest = JSON.parse(readFileSync(catalogPath, "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.cache_name, "caatuu-shared-browser-assets-v1");
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0);
  const keys = new Set(), destinations = new Set(), changes = [];
  for (const artifact of manifest.artifacts) {
    assert.ok(typeof artifact.key === "string" && artifact.key && !keys.has(artifact.key), "Shared artifact keys must be unique");
    keys.add(artifact.key);
    assert.ok(kinds.has(artifact.artifact_kind), `Unsupported shared artifact kind: ${artifact.key}`);
    assert.ok(typeof artifact.url === "string" && artifact.url.startsWith("/assets/"), "Shared artifact URLs must be rooted under /assets/");
    const url = new URL(artifact.url, "https://caatuu.invalid");
    assert.equal(url.origin, "https://caatuu.invalid");
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    const publicPath = decodeURIComponent(url.pathname.slice(1));
    assert.ok(publicPath.startsWith("assets/") && publicPath.split("/").every(part => part && part !== "." && part !== ".."),
      "Shared artifact paths must be normalized below assets");
    assert.notEqual(publicPath, "assets/browser-assets.json", "The receipt catalog cannot declare itself as an asset");
    assert.equal(artifact.asset_path, publicPath, `${artifact.key} URL and source asset path must agree`);
    const destination = publicPath.toLocaleLowerCase("en-US");
    assert.ok(!destinations.has(destination), "Shared artifact paths must be unique without case distinctions");
    destinations.add(destination);
    const sourcePath = sourcePathForArtifact({
      artifact, launcherStaticDir: launcher, languageStaticDir: launcher,
      languageRoutePrefix: "/shared-browser-assets",
    });
    canonicalFile(sourcePath, resolve(launcher, "assets"), artifact.key);
    const data = readFileSync(sourcePath);
    const bytes = data.length;
    const sha256 = createHash("sha256").update(data).digest("hex");
    assert.ok(bytes > 0, `${artifact.key} is empty`);
    if (artifact.bytes !== bytes || artifact.sha256 !== sha256) {
      changes.push({ key: artifact.key, previousBytes: artifact.bytes, bytes, previousSha256: artifact.sha256, sha256 });
      artifact.bytes = bytes;
      artifact.sha256 = sha256;
    }
  }
  if (write && changes.length) writeFileSync(catalogPath, JSON.stringify(manifest, null, 2) + "\n");
  return { catalogPath, artifactCount: manifest.artifacts.length, changes, written: write && changes.length > 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 1 && ["--check", "--write"].includes(args[0]),
    "Usage: node apps/launcher/tooling/refresh-browser-assets.mjs --check|--write");
  const report = refreshSharedBrowserAssetReceipts({ write: args[0] === "--write" });
  console.log(JSON.stringify(report, null, 2));
  if (args[0] === "--check" && report.changes.length) process.exitCode = 1;
}
