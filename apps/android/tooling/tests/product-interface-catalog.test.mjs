import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformProductInterfaceCatalog } from "../build-product-assets.mjs";
import { assertProductSourceText } from "../product-source-policy.mjs";
import { validateInterfaceCatalogParity } from "../../../language-runtime/static/source/interface-content.mjs";

test("product interface catalogs omit disabled generation offers without changing the browser authority", () => {
  const products = [];
  for (const locale of ["en", "es"]) {
    const input = readFileSync(new URL(`../../../language-runtime/static/data/interface/${locale}.v1.json`, import.meta.url), "utf8");
    const original = JSON.parse(input);
    const output = transformProductInterfaceCatalog(input);
    const product = JSON.parse(output);
    assert.ok(original.messages["wordworld.generative.confirm"]);
    assert.equal(product.messages["wordworld.generative.confirm"], undefined);
    assert.doesNotMatch(output, /\bGenerative mode\b/iu);
    assertProductSourceText(output, `${locale} product catalog`);
    assert.equal(product.revision, original.revision);
    for (const [key, value] of Object.entries(original.messages)) {
      if (!key.startsWith("wordworld.generative.") || key.startsWith("wordworld.generative.unavailable.")
        || key.startsWith("wordworld.generative.dialog.disabled")) {
        assert.deepEqual(product.messages[key], value, `unrelated or unavailable-state message ${key} must remain exact`);
      }
    }
    assert.equal(transformProductInterfaceCatalog(output), output);
    products.push(product);
  }
  const parity = validateInterfaceCatalogParity(...products);
  assert.ok(parity.valid, parity.errors.join("; "));
});

test("the shared preflight and signed-package text policy rejects disabled product integrations", () => {
  for (const source of [
    '{"offer":"Prepare Generative mode?"}',
    'models.generate("prompt")',
    'import("@mlc-ai/web-llm")',
    'nativeCall("start_download")',
    '<a href="chat.html">Chat</a>',
  ]) assert.throws(() => assertProductSourceText(source, "injected asset"), /forbidden product pattern/u);
  assert.doesNotThrow(() => assertProductSourceText('{"capabilities":{"generation":false,"godot":false}}', "profile"));
});
