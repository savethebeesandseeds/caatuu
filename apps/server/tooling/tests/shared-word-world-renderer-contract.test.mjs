import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const rendererUrl = new URL(
  "apps/language-runtime/static/source/product-word-world.mjs",
  repoRoot
);
const coreUrl = new URL("apps/language-runtime/static/source/word-net-core.mjs", repoRoot);
const queueUrl = new URL("apps/language-runtime/static/source/word-net-queue.mjs", repoRoot);
const authorityCommit = "cf29a378dc7fcb3552c8f8427dad92d59bdf2eb3";
const authorityBase = "apps/languages/czech/static/source/games/word-world";
const cwd = repoRoot.pathname;

function authority(path) {
  return execFileSync("git", ["show", `${authorityCommit}:${authorityBase}/${path}`], {
    cwd,
    encoding: "utf8"
  });
}

function functionDeclarations(source) {
  return new Set(
    [...source.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gu)]
      .map((match) => match[1])
  );
}

test("the shared history renders complete base and target sentences with their own language metadata", async () => {
  const renderer = await readFile(rendererUrl, "utf8");

  assert.match(renderer, /base\.className = "word-net-trail-base"/u);
  assert.match(renderer, /target\.className = "word-net-trail-target"/u);
  assert.match(renderer, /base\.textContent = item\.en \|\| localTranslation\(item\.sentence, item\.word\)/u);
  assert.match(renderer, /target\.textContent = item\.sentence/u);
  assert.doesNotMatch(renderer, /word\.textContent = item\.word/u);
  assert.match(renderer, /if \(sourceLang\) base\.setAttribute\("lang", sourceLang\)/u);
  assert.match(renderer, /if \(targetLang\) target\.setAttribute\("lang", targetLang\)/u);
  assert.match(renderer, /saveHistory\(\);\s+renderTrail\(\);/u);
});
