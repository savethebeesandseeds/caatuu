import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { transformIndex, assertStagedCourseAsset } from "../build-product-assets.mjs";
import { projectBundledSetupArtifacts } from "../android-artifact-contract.mjs";

const canonical = readFileSync(new URL("../../../language-runtime/static/app/index.html", import.meta.url), "utf8");

test("single and multi-course byte validation compares the final bundled setup projection", (t) => {
  const root = mkdtempSync(join(tmpdir(), "caatuu-setup-projection-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from("exact reviewed lesson");
  const authored = { artifacts: [{ key: "lesson", url: "/xy/data/lesson.txt", asset_path: "data/lesson.txt",
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    native_required: true, browser_required: true }] };
  const source = join(root, "authored-setup.json");
  writeFileSync(source, JSON.stringify(authored));
  for (const assetPrefix of ["", "courses/xy"]) {
    const packageRoot = join(root, assetPrefix ? "bundle" : "single");
    const courseRoot = join(packageRoot, assetPrefix);
    mkdirSync(join(courseRoot, "data"), { recursive: true });
    writeFileSync(join(courseRoot, "data/lesson.txt"), bytes);
    const output = join(courseRoot, "setup-assets.json");
    const projected = projectBundledSetupArtifacts(authored, {
      assetPrefix, readAsset: (path) => readFileSync(join(packageRoot, path)),
    });
    writeFileSync(output, `${JSON.stringify(projected, null, 2)}\n`);
    const options = { source, output, path: "setup-assets.json", transform: (value) => value, packageRoot, assetPrefix };
    assert.doesNotThrow(() => assertStagedCourseAsset(options));
    writeFileSync(output, `${JSON.stringify(authored, null, 2)}\n`);
    assert.throws(() => assertStagedCourseAsset(options), /final product projection/u,
      "a stale raw transform must not pass validation instead of the packaged projection");
    writeFileSync(output, `${JSON.stringify(projected, null, 2)}\n`);
    writeFileSync(join(courseRoot, "data/lesson.txt"), "tampered bytes");
    assert.throws(() => assertStagedCourseAsset(options), /final product projection/u);
  }
});

test("Android HTML projection follows structural elements when copy, locale, spacing and attribute order change", () => {
  const localized = canonical
    .replace(/<div\b[^>]*id="wordNetGenerationMenu"[^>]*>/u,
      "<div hidden data-i18n-aria-label='wordworld.generation.menu' aria-label='Nächster > Satz' role='menu' id = 'wordNetGenerationMenu'>")
    .replace('<dt data-i18n="wordworld.diagnostics.model">model</dt>',
      "<dt class='metric' data-i18n = 'wordworld.diagnostics.model'>Modèle <span>local</span></dt>")
    .replace('<dd id="wordNetMetaModel" data-i18n="wordworld.diagnostics.browserfallback">browser fallback</dd>',
      "<dd data-i18n='wordworld.diagnostics.browserfallback' class='metric' id = 'wordNetMetaModel'><b>Dans ce navigateur</b></dd>")
    .replace('<section class="word-net-generation-menu-section" role="group" aria-labelledby="wordNetContentSourceLabel">',
      "<section aria-labelledby = 'wordNetContentSourceLabel' class='redesigned-section' role='group'>")
    .replace(/<dialog\s+class="word-net-generative-dialog"\s+id="wordNetGenerativeDialog"[^>]*>/u,
      "<dialog id = 'wordNetGenerativeDialog' class='new-dialog-design'>")
    .replace(/data-generation-mode="(random|selected)"/gu, "data-generation-mode = '$1'")
    .replace(/^[ \t]+/gmu, "");
  assert.notEqual(localized, canonical);
  for (const source of [canonical, localized]) {
    const output = transformIndex(source);
    assert.match(output, /data-i18n-aria-label="wordworld\.generation\.nextoptions"/u);
    assert.match(output, /data-i18n="wordworld\.diagnostics\.content"/u);
    assert.match(output, /data-i18n="wordworld\.diagnostics\.model\.curated"/u);
    assert.doesNotMatch(output, /wordNetContentSourceLabel|wordNetGenerativeDialog|data-content-mode/u);
    assert.match(output, /id="wordNetEmbeddedStatus"/u, "the sibling loading screen stays intact");
    for (const mode of ["random", "selected"]) {
      assert.match(output, new RegExp(`data-generation-mode\\s*=\\s*["']${mode}["']`, "u"));
    }
  }
  assert.ok(transformIndex(`${canonical}<p>Generative mode is unavailable.</p>`).endsWith("<p>Generative mode is unavailable.</p>"),
    "explanatory wording does not enable an executable capability");
});

test("Android HTML projection fails closed for missing, duplicated or remaining disabled controls", () => {
  assert.throws(() => transformIndex(canonical.replace('id="wordNetGenerationMenu"', 'id="differentMenu"')), /structural anchor/u);
  assert.throws(() => transformIndex(`${canonical}<div id="wordNetGenerationMenu"></div>`), /structural anchor/u);
  assert.throws(() => transformIndex(`${canonical}<button data-content-mode = 'generative'>Go</button>`), /disabled generative controls/u);
});
