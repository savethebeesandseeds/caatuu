import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterPackagedImageKeymap, transformPackagedImageKeymap } from "../developer-image-catalog.mjs";

test("packaged keymaps retain original keys and exact metadata only for copied outputs", () => {
  const metadata = Object.freeze({ description: "A macaw waves hello.", action: "wave_hello",
    embedding: Object.freeze({ database: "/cz/data/embeddings/catalog.sqlite", document_id: "original-id" }),
    attribution: Object.freeze({ creator: "Caatuu", license: "original" }) });
  const catalog = Object.freeze({
    "/assets/macaw/actions/macaw%20(4).png": metadata,
    "/assets/macaw/actions/missing.png": { description: "Not packaged." },
    "/assets/miscellaneous/book.png": { description: "A book." }
  });
  const result = filterPackagedImageKeymap(catalog, [
    { source: "original.png", output: "assets/macaw/actions/macaw (4).png" },
    { source: "not-book.png", output: "assets/icons/book.png" },
    { source: "runtime.mjs", output: "language-runtime/static/source/runtime.mjs" }
  ]);
  assert.deepEqual(Object.keys(result), ["/assets/macaw/actions/macaw%20(4).png"]);
  assert.equal(result[Object.keys(result)[0]], metadata, "the filter preserves every metadata field without rewriting it");
  assert.equal(Object.keys(catalog).length, 3);
});

test("the helper accepts both escaped and literal package output sets", () => {
  const catalog = { "/assets/miscellaneous/example%20(1).png": { description: "Example image." } };
  for (const outputs of [
    new Set(["assets/miscellaneous/example (1).png"]),
    new Set(["/assets/miscellaneous/example%20(1).png"])
  ]) assert.deepEqual(filterPackagedImageKeymap(catalog, outputs), catalog);
});

test("packaged action images still obey the maintained child-facing exclusions", () => {
  const catalog = {
    "/assets/macaw/actions/wave.png": { action: "wave_hello", description: "Wave." },
    "/assets/macaw/actions/sword.png": { action: "draw_sword", description: "Sword." },
    "/assets/macaw/actions/macaw%20(35).png": { description: "Excluded historical image." },
    "/assets/macaw/actions/169-bow_and_arrow.png": { description: "Excluded catalog image." }
  };
  const result = filterPackagedImageKeymap(catalog, new Set(Object.keys(catalog)));
  assert.deepEqual(Object.keys(result), ["/assets/macaw/actions/wave.png"]);
});

test("malformed, external, nested, escaped, and non-raster paths never enter the package catalog", () => {
  const paths = [
    "https://outside.test/image.png", "/assets/icons/image.png",
    "/assets/macaw/actions/nested/image.png", "/assets/macaw/actions/../image.png",
    "/assets/macaw/actions/%2e%2e%2fimage.png", "/assets/macaw/actions/%zz.png",
    "/assets/macaw/actions/image.png?query", "/assets/macaw/actions/image%3f.png",
    "/assets/macaw/actions/image.svg", "/assets/macaw/actions/image%5c.png"
  ];
  const catalog = Object.fromEntries(paths.map((path) => [path, { description: "Not eligible." }]));
  assert.deepEqual(filterPackagedImageKeymap(catalog, new Set(paths)), {});
});

test("transform serialization is deterministic and rejects malformed declarations", () => {
  const input = '{"/assets/miscellaneous/book.png":{"description":"A book."}}';
  const outputs = new Set(["assets/miscellaneous/book.png"]);
  const transformed = transformPackagedImageKeymap(input, outputs);
  assert.equal(transformPackagedImageKeymap(transformed, outputs), transformed);
  assert.ok(transformed.endsWith("\n"));
  assert.deepEqual(JSON.parse(transformPackagedImageKeymap(input, [])), {});
  assert.throws(() => transformPackagedImageKeymap("not json", outputs), SyntaxError);
  assert.throws(() => filterPackagedImageKeymap([], outputs), /JSON object/u);
  assert.throws(() => filterPackagedImageKeymap({}, null), /Packaged assets/u);
});

test("the real package artwork yields usable source catalogs without dangling image paths", async () => {
  const appAssets = JSON.parse(await readFile(new URL("../../../language-runtime/app-assets.json", import.meta.url), "utf8")).assets;
  const outputs = new Set(appAssets.map(({ output }) => `/${output}`));
  let packagedImageCount = 0;
  for (const path of [
    "../../../launcher/static/assets/visual-vocabulary/keymap.json",
    "../../../launcher/static/assets/macaw/actions/keymaps.json"
  ]) {
    const source = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
    const result = JSON.parse(transformPackagedImageKeymap(source, appAssets));
    packagedImageCount += Object.keys(result).length;
    assert.ok(Object.keys(result).length < Object.keys(source).length, "unpackaged artwork stays excluded");
    for (const [key, metadata] of Object.entries(result)) {
      assert.ok(outputs.has(decodeURIComponent(key)), `Packaged image exists: ${key}`);
      assert.deepEqual(metadata, source[key]);
    }
  }
  assert.ok(packagedImageCount > 0, "the combined catalog keeps usable package images");
});
