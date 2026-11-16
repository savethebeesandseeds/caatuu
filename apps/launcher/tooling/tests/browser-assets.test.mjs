import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { refreshSharedBrowserAssetReceipts } from "../refresh-browser-assets.mjs";

test("shared browser receipts refresh only declared canonical assets and reject aliases", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "caatuu-browser-receipts-"));
  try {
    const assets = join(workspaceRoot, "apps/launcher/static/assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "sample.txt"), "reviewed bytes\n");
    const catalogPath = join(assets, "browser-assets.json");
    const manifest = { version: 1, cache_name: "caatuu-shared-browser-assets-v1", artifacts: [{
      key: "sample", artifact_kind: "music-license", asset_path: "assets/sample.txt",
      url: "/assets/sample.txt", bytes: 1, sha256: "0".repeat(64),
    }] };
    writeFileSync(catalogPath, JSON.stringify(manifest));
    const checked = refreshSharedBrowserAssetReceipts({ workspaceRoot });
    assert.equal(checked.changes.length, 1);
    assert.equal(checked.written, false);
    assert.equal(JSON.parse(readFileSync(catalogPath)).artifacts[0].bytes, 1);
    const written = refreshSharedBrowserAssetReceipts({ workspaceRoot, write: true });
    assert.equal(written.written, true);
    assert.equal(written.changes[0].sha256, createHash("sha256").update("reviewed bytes\n").digest("hex"));
    assert.deepEqual(refreshSharedBrowserAssetReceipts({ workspaceRoot }).changes, []);
    symlinkSync(join(assets, "sample.txt"), join(assets, "alias.txt"));
    manifest.artifacts[0].asset_path = "assets/alias.txt";
    manifest.artifacts[0].url = "/assets/alias.txt";
    writeFileSync(catalogPath, JSON.stringify(manifest));
    assert.throws(() => refreshSharedBrowserAssetReceipts({ workspaceRoot, write: true }), /regular file|canonical source/u);
    writeFileSync(join(assets, "../app.css"), "must not become a shared asset");
    manifest.artifacts[0].url = "/assets/../app.css";
    manifest.artifacts[0].asset_path = "app.css";
    writeFileSync(catalogPath, JSON.stringify(manifest));
    assert.throws(() => refreshSharedBrowserAssetReceipts({ workspaceRoot }), /normalized below assets/u);
    manifest.artifacts[0].url = "/cz/sample.txt";
    writeFileSync(catalogPath, JSON.stringify(manifest));
    assert.throws(() => refreshSharedBrowserAssetReceipts({ workspaceRoot }), /under \/assets\//u);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
