import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  offlineCachesRuntimeReference,
  revisionedRuntimeModuleReference,
  wordClickSelectsTranslation,
} from "../audit-runtime-boundary.mjs";

const source = (name) => readFileSync(new URL(`../../../language-runtime/static/source/${name}`, import.meta.url), "utf8");

test("the audit follows loader revisions and rejects missing, foreign or ambiguous module references", () => {
  for (const [importer, target] of [
    ["app-bootstrap.mjs", "word-world-host.mjs"],
    ["word-world-host.mjs", "word-world-provider.mjs"],
    ["word-world-provider.mjs", "product-word-world.mjs"],
  ]) {
    assert.ok(revisionedRuntimeModuleReference(source(importer), importer, target));
  }
  const importer = "app-bootstrap.mjs";
  const target = "word-world-host.mjs";
  for (const revision of ["host-next", "host-9999"]) {
    const code = `await import('./${target}?v=${revision}')`;
    assert.equal(revisionedRuntimeModuleReference(code, importer, target), `/language-runtime/static/source/${target}?v=${revision}`);
  }
  for (const code of [
    "", `const unused = './${target}?v=1'`,
    `import('./${target}')`, `import('https://outside.test/language-runtime/static/source/${target}?v=1')`,
    `import('./${target}?v=1#fragment')`,
    `import('./${target}?v=1'); import('./${target}?v=2')`,
    `// import('./${target}?v=1')`,
    `/* import('./${target}?v=1') */`,
    `const example = "import('./${target}?v=1')"`,
  ]) assert.equal(revisionedRuntimeModuleReference(code, importer, target), null, code);
  assert.equal(revisionedRuntimeModuleReference(`/* import('./${target}?v=old') */\nimport('./${target}?v=current')`, importer, target), `/language-runtime/static/source/${target}?v=current`);
});

test("offline membership must match the loaded revision exactly once", () => {
  const reference = "/language-runtime/static/source/word-world-host.mjs?v=host-next";
  const setup = (...assets) => ({ offline: { assets } });
  assert.equal(offlineCachesRuntimeReference(setup(reference), reference), true);
  for (const catalog of [
    {}, setup(), setup(reference.replace("host-next", "host-old")),
    setup(reference, reference), setup(reference, reference.replace("host-next", "host-old")),
    setup(`https://outside.test${reference}`),
  ]) assert.equal(offlineCachesRuntimeReference(catalog, reference), false);
});

test("word selection accepts formatting and token context but cannot advance the sentence", () => {
  const renderer = source("product-word-world.mjs");
  assert.equal(wordClickSelectsTranslation(renderer), true);
  assert.equal(wordClickSelectsTranslation("selectWord(button.dataset.word, { userInitiated: true })"), true);
  assert.equal(wordClickSelectsTranslation("selectWord( button.dataset.word, { tokenIndex: 2,\n userInitiated: true, })"), true);
  assert.equal(wordClickSelectsTranslation(renderer.replace("selectWord(button.dataset.word,", "ignoreWord(button.dataset.word,")), false);
  assert.equal(wordClickSelectsTranslation(renderer + "\ngenerateSentenceForWord(\n button.dataset.word, { source: 'choice' })"), false);
  assert.equal(wordClickSelectsTranslation("selectWord(button.dataset.word, { userInitiated: false })"), false);
});
