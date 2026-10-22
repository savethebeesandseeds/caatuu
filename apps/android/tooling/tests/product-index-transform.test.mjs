import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { compactProductCss, compactProductHtml, transformChromeCss, transformHomeCss,
  transformIndex, assertStagedCourseAsset } from "../build-product-assets.mjs";
import { projectBundledSetupArtifacts } from "../android-artifact-contract.mjs";

const canonical = readFileSync(new URL("../../../language-runtime/static/app/index.html", import.meta.url), "utf8");

test("product HTML removes tag indentation while preserving literal blocks, attributes, text and comments", () => {
  const literalBlocks = [
    '<!--\n    <span title="comment">keep this indentation</span>\n  -->',
    '<pre>\n    <b>spaced text</b>\n  </pre>',
    '<textarea>\n    <div>literal text</div>\n  </textarea>',
    '<script>\n    const value = "<div>keep</div>";\n    const other = "</script-not>";\n  </script>',
    '<style>\n    .label { content: "  <span>"; }\n  </style>',
    '<title>\n    <span>literal title</span>\n  </title>',
    '<template>\n    <p>template markup</p>\n  </template>',
    '<noscript>\n    <p>fallback</p>\n  </noscript>',
  ];
  const attributes = '<div title="a > b\n    <span>attribute text</span>" data-value=\'still > exact\'>';
  const input = `    <section>\n      ${attributes}\n    meaningful  text\n      </div>\n${literalBlocks.map(block => `    ${block}`).join("\n")}\n    </section>`;
  const output = compactProductHtml(input);
  assert.ok(output.startsWith(`<section>\n${attributes}\n    meaningful  text\n</div>\n`));
  for (const block of literalBlocks) assert.ok(output.includes(`    ${block}`), "literal content remains byte-identical");
  assert.ok(output.endsWith("\n</section>"));
  assert.equal(compactProductHtml(output), output, "HTML packaging is idempotent");
  assert.equal(compactProductHtml('<script>\n    unclosed raw content\n    <div>still literal'),
    '<script>\n    unclosed raw content\n    <div>still literal', "unclosed raw blocks are preserved conservatively");
});

test("the canonical product entry retains its tags and attributes with less authoring whitespace", (t) => {
  const output = compactProductHtml(canonical);
  const tagTokens = source => [...source.matchAll(/<!--[\s\S]*?-->|<[^>"']*(?:"[^"]*"|'[^']*')[^>]*>|<[^>]*>/gu)].map(match => match[0]);
  assert.deepEqual(tagTokens(output), tagTokens(canonical), "packaging preserves the complete markup token sequence");
  assert.equal(compactProductHtml(output), output);
  const savings = Buffer.byteLength(canonical) - Buffer.byteLength(output);
  assert.ok(savings > 0, "canonical entry does not package authoring indentation");
  t.diagnostic(`Product HTML indentation saves ${savings} bytes.`);
  const legacyProjection = transformIndex(canonical, { compact: false });
  const packagedProjection = transformIndex(canonical);
  assert.equal(packagedProjection, compactProductHtml(legacyProjection),
    "historical receipts retain the prior product projection before indentation packaging");
  t.diagnostic(`Final product HTML indentation saves ${Buffer.byteLength(legacyProjection) - Buffer.byteLength(packagedProjection)} bytes.`);
});

test("product CSS omits indentation while preserving declarations, comments and literal string whitespace", () => {
  const comment = "/*! copyright and license\n    keep every byte */";
  const quoted = '"two  spaces; /* literal */\\\n    continued string"';
  const input = `    ${comment}\n    .label .child {\n      content: ${quoted};\n      --tokens: 1  2;\n      width: calc(100% -  2px);\n      background: url("data:image/svg+xml;utf8,<svg>  </svg>");\n    }\n`;
  const output = compactProductCss(input);
  assert.equal(output, `${comment}\n.label .child {\ncontent: ${quoted};\n--tokens: 1  2;\nwidth: calc(100% -  2px);\nbackground: url("data:image/svg+xml;utf8,<svg>  </svg>");\n}\n`);
  assert.equal(compactProductCss(output), output);
});

test("CSS escapes retain their optional whitespace terminators and following indentation", () => {
  for (const escape of ["\\31\n", "\\000031\r\n", "\\\n", "\\\r\n"]) {
    const input = `.number${escape}    0 {\n    color: green;\n}\n`;
    const output = compactProductCss(input);
    assert.equal(output, `.number${escape}    0 {\ncolor: green;\n}\n`);
    assert.equal(compactProductCss(output), output);
  }
  assert.equal(compactProductCss("    .\\31  0 { color: green; }"), ".\\31  0 { color: green; }");
  assert.equal(compactProductCss("    .space\\ name { color: green; }"), ".space\\ name { color: green; }");
});

test("CSS packaging refuses unterminated literal regions instead of altering their contents", () => {
  assert.throws(() => compactProductCss('a { content: "unterminated'), /string must be closed/u);
  assert.throws(() => compactProductCss("a { /* unterminated"), /comment must be closed/u);
});

test("current shared styles preserve every non-indentation byte under the package projection", (t) => {
  const catalog = JSON.parse(readFileSync(new URL("../../../language-runtime/app-assets.json", import.meta.url), "utf8"));
  const root = new URL("../../../../", import.meta.url);
  let savings = 0;
  for (const asset of catalog.assets.filter(asset => asset.output.endsWith(".css"))) {
    let source = readFileSync(new URL(asset.source, root), "utf8").replace(/\r\n?/gu, "\n");
    if (asset.output.endsWith("/caatuu-chrome.css")) source = transformChromeCss(source);
    if (asset.output.endsWith("/caatuu-home.css")) source = transformHomeCss(source);
    const output = compactProductCss(source);
    assert.equal(output.replace(/^[\t ]+/gmu, ""), source.replace(/^[\t ]+/gmu, ""),
      `${asset.output}: only line-leading indentation may change`);
    assert.equal(compactProductCss(output), output, `${asset.output}: projection is idempotent`);
    savings += Buffer.byteLength(source) - Buffer.byteLength(output);
  }
  assert.ok(savings > 0);
  t.diagnostic(`Shared CSS indentation saves ${savings} bytes.`);
});

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
