import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageSourceReader, packagePublicationPlan, packageStaticTextFormat, packageCanonicalAppEntry } from "../package-source-contract.mjs";
import { loadAndroidCourseBundleCatalogPlan, PRODUCT_STATIC_TEXT_FORMAT, transformIndex } from "../build-product-assets.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

test("receipt source selects historical or compact HTML without accepting unknown formatting policies", () => {
  const current = packageSourceReader(workspaceRoot);
  const html = current("apps/language-runtime/static/app/index.html").toString("utf8");
  const reader = (compiler) => (path) => path.endsWith("build-product-assets.mjs") ? Buffer.from(compiler) : current(path);
  const legacy = reader("// Historical compiler with unmodified HTML indentation.\n");
  const compact = reader(`export const PRODUCT_STATIC_TEXT_FORMAT = ${JSON.stringify(PRODUCT_STATIC_TEXT_FORMAT)};\n`);
  assert.equal(packageStaticTextFormat(legacy), null);
  assert.equal(packageCanonicalAppEntry(legacy).toString(), transformIndex(html, { compact: false }));
  assert.equal(packageStaticTextFormat(compact), PRODUCT_STATIC_TEXT_FORMAT);
  assert.equal(packageCanonicalAppEntry(compact).toString(), transformIndex(html));
  assert.ok(packageCanonicalAppEntry(compact).length < packageCanonicalAppEntry(legacy).length);
  for (const declaration of [
    'export const PRODUCT_STATIC_TEXT_FORMAT = "unknown";',
    'export const PRODUCT_STATIC_TEXT_FORMAT = getFormat();',
    `export const PRODUCT_STATIC_TEXT_FORMAT = "${PRODUCT_STATIC_TEXT_FORMAT}";\nexport const PRODUCT_STATIC_TEXT_FORMAT = "${PRODUCT_STATIC_TEXT_FORMAT}";`,
  ]) assert.throws(() => packageCanonicalAppEntry(reader(declaration)), /format/u);
});

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
