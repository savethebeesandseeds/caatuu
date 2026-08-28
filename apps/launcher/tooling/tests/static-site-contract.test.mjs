import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { compileStaticSite, validateStaticSite } from "../build-static-site.mjs";

test("static compiler closes the complete Pages payload", { timeout: 300_000 }, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "caatuu-static-contract-"));
  const outputDir = join(temporaryRoot, "github-pages");
  try {
    const built = compileStaticSite({ outputDir });
    assert.equal(built.profile, "web-static-core");
    assert.equal(built.fileCount, 730);
    assert.ok(built.totalBytes < 800_000_000);
    assert.ok(built.setupRequiredBytes > 0 && built.setupRequiredBytes < 1024 * 1024);
    const firstManifest = JSON.parse(
      readFileSync(join(outputDir, "caatuu-web-bundle.json"), "utf8"),
    );

    const rebuilt = compileStaticSite({ outputDir });
    assert.deepEqual(rebuilt, built);

    const validated = validateStaticSite({ outputDir });
    assert.deepEqual(validated, built);
    const manifest = JSON.parse(readFileSync(join(outputDir, "caatuu-web-bundle.json"), "utf8"));
    assert.deepEqual(manifest, firstManifest);
    assert.equal(manifest.schema_name, "caatuu-web-bundle");
    assert.equal(manifest.schema_version, 1);
    assert.ok(!Object.hasOwn(manifest, "schemaName"));
    assert.ok(!Object.hasOwn(manifest, "schemaVersion"));
    assert.equal(manifest.payloadFileCount, 729);
    assert.equal(manifest.requiredSetupArtifacts, 3);
    assert.equal(manifest.publishedVisualAssets, 647);
    assert.equal(manifest.basePath, "/");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
