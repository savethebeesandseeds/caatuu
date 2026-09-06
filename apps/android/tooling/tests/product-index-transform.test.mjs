import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformIndex } from "../build-product-assets.mjs";

const canonical = readFileSync(new URL("../../../language-runtime/static/app/index.html", import.meta.url), "utf8");

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
