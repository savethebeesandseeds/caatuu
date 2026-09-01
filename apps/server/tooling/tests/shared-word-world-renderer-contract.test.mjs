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

test("shared Word World queue remains byte-exact while the core preserves authority plus multilingual reconstruction", async () => {
  const [core, queue] = await Promise.all([
    readFile(coreUrl, "utf8"),
    readFile(queueUrl, "utf8")
  ]);
  const authorityCore = authority("word-net-core.mjs");
  const authorityFunctions = functionDeclarations(authorityCore);
  const sharedFunctions = functionDeclarations(core);
  assert.deepEqual(
    [...authorityFunctions].filter((name) => !sharedFunctions.has(name)),
    [],
    "the shared core must preserve every historical authority function"
  );
  assert.deepEqual(
    [...sharedFunctions].filter((name) => !authorityFunctions.has(name)),
    ["buildTokenReconstructionChallenge"],
    "multilingual token reconstruction is the only approved core function extension"
  );
  assert.match(core, /export function buildTokenReconstructionChallenge\(/u);
  assert.match(core, /buildWordReconstructionChallenge\([\s\S]*?buildTokenReconstructionChallenge\(answerParts, candidateParts/u);
  assert.equal(queue, authority("word-net-queue.mjs"));
});

test("the promoted controller retains the Czech authority behavior surface", async () => {
  const [renderer, legacy] = await Promise.all([
    readFile(rendererUrl, "utf8"),
    Promise.resolve(authority("word-net.js"))
  ]);
  const promotedFunctions = functionDeclarations(renderer);
  const intentionallyReplaced = new Set(["bindEmbeddedShellBridge", "notifyEmbeddedShell"]);
  const missing = [...functionDeclarations(legacy)]
    .filter((name) => !intentionallyReplaced.has(name) && !promotedFunctions.has(name));

  assert.deepEqual(missing, [], "mechanical promotion must retain every authority controller function");
  assert.match(renderer, /export async function mountProductWordWorld\(root, preparedContext, options = \{\}\)/u);
  assert.match(renderer, /export default mountProductWordWorld/u);
  assert.doesNotMatch(renderer, /void init\(\)/u);
  assert.doesNotMatch(renderer, /bindEmbeddedShellBridge/u);
  assert.doesNotMatch(renderer, /word-net-standard\.mjs/u);
  assert.doesNotMatch(renderer, /createElement\([^\n]*["']word-net-game["']/u);
});

test("one controller consumes narrow language and provider seams", async () => {
  const renderer = await readFile(rendererUrl, "utf8");

  assert.match(renderer, /options\.providerContext \|\| preparedContext/u);
  assert.match(renderer, /providerContext\?\.selectionProvider/u);
  assert.match(renderer, /providerContext\.sessionRecord\(state\.currentEntryId\)/u);
  assert.match(renderer, /providerContext\.segment\(learnerContent, \{ record: currentRecord \}\)/u);
  assert.match(renderer, /providerContext\.lookupMeaning\(/u);
  assert.match(renderer, /searchEnglish: providerContext\?\.searchEnglish/u);
  assert.match(renderer, /providerContext\.sceneForRecord\(record\)/u);
  assert.match(renderer, /providerContext\.report\(/u);
  assert.match(renderer, /import \{ localAiAvailability \} from "\.\/shell-policy\.mjs";/u);
  assert.match(renderer, /localAiAvailability\(course, runtimeAdapter\(\), "generation"\)/u);
  assert.match(renderer, /generationAvailability\(\)\.supported/u);
  assert.match(renderer, /generationAvailability\(\)\.enabled/u);
  assert.match(renderer, /targetSpeechLocale = course\.targetLanguage\.speechLocale \|\| targetLocale/u);
  assert.match(renderer, /api\?\.speakText \|\| api\?\.speakCzechText/u);
  assert.match(renderer, /api\?\.stopSpeech \|\| api\?\.stopCzechSpeech/u);
  assert.match(renderer, /return text\.replaceAll\("Czech", targetLanguageLabel\)/u);
  assert.doesNotMatch(renderer, /targetLanguageLabel === "Czech"/u);
  assert.match(renderer, /\["#wordNetSentence", "#wordNetSelectedWord"\]/u);
  assert.match(renderer, /node\.setAttribute\("lang", lang\)/u);
  assert.match(renderer, /node\.setAttribute\("dir", direction\)/u);
  assert.match(renderer, /\["#wordNetSentence", "#wordNetNext", "#wordNetPrevious", "#wordNetStatus"\]/u);
});

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
