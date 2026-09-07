import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageSourceReader, packagePublicationPlan } from "../package-source-contract.mjs";
import { loadAndroidCourseBundleCatalogPlan } from "../build-product-assets.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

test("source-only package projection matches the compiler publication plan", () => {
  assert.deepEqual(packagePublicationPlan(packageSourceReader(workspaceRoot)),
    loadAndroidCourseBundleCatalogPlan({ workspaceRoot }).publicationPlan);
});

test("receipt source reads use immutable Git objects and reject escaping paths", () => {
  const revision = execFileSync("git", ["-C", workspaceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const readSource = packageSourceReader(workspaceRoot, revision);
  const file = "apps/android/course-bundle.json";
  assert.deepEqual(readSource(file), execFileSync("git", ["-C", workspaceRoot, "show", `${revision}:${file}`]));
  assert.ok(packagePublicationPlan(readSource).courses.length > 0);
  for (const path of ["../outside", "/etc/passwd", "C:/outside", "a\\b", "a//b"]) {
    assert.throws(() => readSource(path));
  }
  assert.throws(() => packageSourceReader(workspaceRoot, "HEAD"));
  assert.throws(() => readSource("does-not-exist-in-source.json"));
});

test("a changed course catalog cannot silently replace a receipt's source plan", () => {
  const readSource = packageSourceReader(workspaceRoot);
  const file = "apps/android/course-bundle.json";
  const changed = JSON.parse(readSource(file));
  changed.courses.pop();
  assert.throws(() => packagePublicationPlan((path) => path === file
    ? Buffer.from(JSON.stringify(changed)) : readSource(path)), /course/u);
});
