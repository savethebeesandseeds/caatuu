import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const repositoryRoot = new URL("../../../../", import.meta.url);

test("every exact Verb Nebula picture clue is bundled for all Android courses", async () => {
  const [workspace, catalogText] = await Promise.all([
    readFile(new URL("apps/language-runtime/static/source/caatuu-workspace.js", repositoryRoot), "utf8"),
    readFile(new URL("apps/language-runtime/app-assets.json", repositoryRoot), "utf8"),
  ]);
  // Read the live clue authority so adding an override also requires packaging it.
  const declaration = workspace.match(/const verbHintExactAssets = new Map\((\[[\s\S]*?\n\])\);/u);
  assert.ok(declaration, "the shared workspace must declare its exact picture clues");
  const clues = runInNewContext(`new Map(${declaration[1]})`);
  assert.ok(clues.size > 0, "the clue authority must not be empty");
  const { assets } = JSON.parse(catalogText);

  for (const [meaning, { assetPath }] of clues) {
    const output = decodeURIComponent(new URL(assetPath, "https://caatuu.invalid/").pathname).slice(1);
    const mappings = assets.filter((asset) => asset.output === output);
    assert.equal(mappings.length, 1, `${meaning}: ${output} must have one shared Android asset mapping`);
    assert.equal(mappings[0].source, `apps/launcher/static/${output}`, `${meaning}: Android must use the browser's artwork`);
    const source = await stat(new URL(mappings[0].source, repositoryRoot));
    assert.ok(source.isFile() && source.size > 0, `${meaning}: the picture clue source must exist and be nonempty`);
  }
});
