import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveEmbeddingRuntimeArtifactSource, verifyEmbeddingRuntimeArtifactSource } from "../build-product-assets.mjs";

test("source-only tests defer missing setup downloads explicitly without weakening byte or path checks", (t) => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "caatuu-runtime-source-"));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runtimeRoot = join(workspaceRoot, "apps/language-runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  const artifactPath = "models/reviewed/model.onnx";
  const bytes = Buffer.from("fixture runtime");
  const artifact = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const options = { workspaceRoot, artifactPath, allowMissingSetupDeliveredRuntimeFiles: true };
  const source = resolveEmbeddingRuntimeArtifactSource(options);
  assert.throws(() => resolveEmbeddingRuntimeArtifactSource({ workspaceRoot, artifactPath }), /missing/u);
  assert.throws(() => verifyEmbeddingRuntimeArtifactSource({ source, artifact, artifactPath }), /missing/u);
  assert.equal(verifyEmbeddingRuntimeArtifactSource({ ...options, source, artifact }), false);
  for (const patch of [{ bytes: 0 }, { bytes: "12" }, { sha256: "invalid" }]) {
    assert.throws(() => verifyEmbeddingRuntimeArtifactSource({ ...options, source, artifact: { ...artifact, ...patch } }));
  }
  mkdirSync(join(runtimeRoot, "models/reviewed"), { recursive: true });
  writeFileSync(source, bytes);
  assert.equal(resolveEmbeddingRuntimeArtifactSource({ workspaceRoot, artifactPath }), source);
  assert.equal(verifyEmbeddingRuntimeArtifactSource({ ...options, source, artifact }), true);
  for (const patch of [{ bytes: bytes.length + 1 }, { sha256: "a".repeat(64) }]) {
    assert.throws(() => verifyEmbeddingRuntimeArtifactSource({ ...options, source, artifact: { ...artifact, ...patch } }), /drifted/u);
  }
  for (const path of ["../outside.onnx", "/outside.onnx", "models/../../outside.onnx"]) {
    assert.throws(() => resolveEmbeddingRuntimeArtifactSource({ ...options, artifactPath: path }));
  }
  symlinkSync(join(runtimeRoot, "models/reviewed"), join(runtimeRoot, "alias"), "dir");
  assert.throws(() => resolveEmbeddingRuntimeArtifactSource({ ...options, artifactPath: "alias/missing.onnx" }), /symbolic-link|physical source/u);
  symlinkSync(join(runtimeRoot, "not-present"), join(runtimeRoot, "dangling"), "dir");
  assert.throws(() => resolveEmbeddingRuntimeArtifactSource({ ...options, artifactPath: "dangling/missing.onnx" }), /missing|symbolic-link/u);
});
