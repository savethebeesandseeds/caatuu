import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const AUTHORITATIVE_CZECH_DOCUMENT = new URL(
  "./fixtures/czech-word-world-0.1.7-authority.html.fixture",
  import.meta.url
);
const AUTHORITY_COMMIT = "cf29a378dc7fcb3552c8f8427dad92d59bdf2eb3";
const REPOSITORY_ROOT = new URL("../../../", import.meta.url);
const AUTHORITATIVE_CZECH_CSS = execFileSync(
  "git",
  ["show", `${AUTHORITY_COMMIT}:apps/languages/czech/static/source/games/word-world/word-net.css`],
  { cwd: fileURLToPath(REPOSITORY_ROOT), maxBuffer: 16 * 1024 * 1024 }
);
const SHARED_PRODUCT_DOCUMENT = new URL("../static/app/index.html", import.meta.url);
const SHARED_WORD_WORLD_CSS = new URL(
  "../static/styles/caatuu-word-world.css",
  import.meta.url
);

// These hashes pin the complete Czech 0.1.7 Word World sources from
// cf29a378dc7fcb3552c8f8427dad92d59bdf2eb3. The current HEAD has the same
// source blobs. Updating either value is an explicit interface-baseline change,
// not a normal multilingual-renderer maintenance step.
const GOLDEN_DOCUMENT_SHA256 =
  "755af769f1a4c819c398647762df056aef6f1d881621712a1fbf150575943161";
const GOLDEN_CSS_SHA256 =
  "0df7102e42304f6f43886b7913d3a76ef94ff238ae7865ea12d482cb00200045";

const COMPONENT_CSS_ANCHOR = Buffer.from(".word-net-game {", "utf8");
const APPROVED_SHARED_CSS_DELTA_BYTES = 3577;
const APPROVED_SHARED_CSS_DELTA_SHA256 =
  "826b8f9f046cdc25662b618d9f5af45ce90a44d8e79d58c621675693b8336a39";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const SIGNATURE_ATTRIBUTES = new Set([
  "disabled",
  "for",
  "hidden",
  "lang",
  "max",
  "maxlength",
  "method",
  "min",
  "name",
  "open",
  "placeholder",
  "role",
  "rows",
  "selected",
  "step",
  "tabindex",
  "title",
  "type",
  "value"
]);

const REQUIRED_WORD_WORLD_IDS = Object.freeze([
  "wordNetWordTranslation",
  "wordNetSelectedWord",
  "wordNetSelectedMeaning",
  "wordNetSelectedWordSound",
  "wordNetDisplayToggle",
  "wordNetDisplayMenu",
  "wordNetSound",
  "wordNetAudioMenu",
  "wordNetTranslationToggle",
  "wordNetTranslationMenu",
  "wordNetGenerationToggle",
  "wordNetGenerationMenu",
  "wordNetPrevious",
  "wordNetNext",
  "wordNetLoading",
  "wordNetScene",
  "wordNetSceneImage",
  "wordNetSentence",
  "wordNetPhraseSound",
  "wordNetTranslation",
  "wordNetReconstruction",
  "wordNetReconstructionAnswer",
  "wordNetReconstructionSubmit",
  "wordNetReconstructionBank",
  "wordNetReconstructionResult",
  "wordNetReportToggle",
  "wordNetFeedbackDialog",
  "wordNetStatus",
  "wordNetDiagnostics",
  "wordNetProgress",
  "wordNetTrail",
  "wordNetGenerativeDialog"
]);

const TOOLBAR_COMPONENT_ORDER = Object.freeze([
  "wordNetDisplayToggle",
  "wordNetDisplayMenu",
  "wordNetSound",
  "wordNetAudioMenu",
  "wordNetTranslationToggle",
  "wordNetTranslationMenu",
  "wordNetGenerationToggle",
  "wordNetGenerationMenu"
]);

const ALLOWED_INLINE_CONTEXT_SELECTORS = new Set([
  "#wordWorldRoot",
  "#wordWorldRoot *",
  "#wordWorldRoot *::before",
  "#wordWorldRoot *::after",
  "#wordWorldRoot button",
  "#wordWorldRoot a"
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSameBytes(actual, expected, message) {
  if (actual.equals(expected)) return;
  const sharedLength = Math.min(actual.length, expected.length);
  let firstDifference = 0;
  while (firstDifference < sharedLength && actual[firstDifference] === expected[firstDifference]) {
    firstDifference += 1;
  }
  assert.fail(
    `${message} First difference: byte ${firstDifference}; ` +
    `actual ${actual.length} bytes (${sha256(actual)}), ` +
    `expected ${expected.length} bytes (${sha256(expected)}).`
  );
}

function normalizeSpace(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

function parseAttributes(source) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLocaleLowerCase("en-US");
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.set(name, value);
  }
  return attributes;
}

function parseHtml(source) {
  const root = { tag: "#document", attributes: new Map(), children: [], parent: null };
  const stack = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/gu;

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    const closing = token.startsWith("</");
    const nameMatch = token.match(/^<\/?\s*([A-Za-z][\w:-]*)/u);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLocaleLowerCase("en-US");

    if (closing) {
      while (stack.length > 1) {
        const node = stack.pop();
        if (node.tag === tag) break;
      }
      continue;
    }

    const attributeStart = nameMatch[0].length;
    const attributeEnd = token.length - (token.endsWith("/>") ? 2 : 1);
    const node = {
      tag,
      attributes: parseAttributes(token.slice(attributeStart, attributeEnd)),
      children: [],
      parent: stack.at(-1)
    };
    stack.at(-1).children.push(node);
    if (!VOID_ELEMENTS.has(tag) && !token.endsWith("/>")) stack.push(node);
  }

  return root;
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function hasClass(node, className) {
  return normalizeSpace(node.attributes.get("class")).split(" ").includes(className);
}

function findAll(root, predicate) {
  return descendants(root).filter(predicate);
}

function findOne(root, predicate, label) {
  const matches = findAll(root, predicate);
  assert.equal(matches.length, 1, `${label} must appear exactly once; found ${matches.length}.`);
  return matches[0];
}

function contractAttributes(node) {
  const nodeId = node.attributes.get("id");
  return [...node.attributes]
    .filter(([name]) => (
      name === "id"
      || name === "class"
      || name.startsWith("aria-")
      || name.startsWith("data-")
      || SIGNATURE_ATTRIBUTES.has(name)
    ))
    .filter(([name]) => !(
      (nodeId === "wordNetAudioSpeed" && name === "aria-valuetext")
      || (nodeId === "wordNetTranslationToggle" && name === "aria-label")
      || (["wordNetReconstruction", "wordNetReconstructionAnswer", "wordNetReconstructionBank"].includes(nodeId) && name === "aria-label")
      || (nodeId === "wordNetReconstructionLanguage" && name === "id")
    ))
    .map(([name, value]) => [
      name,
      name === "class" ? normalizeSpace(value) : value
    ])
    .sort(([left], [right]) => left.localeCompare(right, "en-US"));
}

function nodeLabel(node, index = null) {
  const id = node.attributes.get("id");
  const className = normalizeSpace(node.attributes.get("class")).split(" ")[0];
  const suffix = id ? `#${id}` : className ? `.${className}` : "";
  return `${node.tag}${suffix}${index === null ? "" : `[${index}]`}`;
}

function assertSameComponentTree(actual, expected, path) {
  assert.equal(actual.tag, expected.tag, `${path}: element tag changed.`);
  assert.deepEqual(
    contractAttributes(actual),
    contractAttributes(expected),
    `${path}: id/class/component/ARIA/default-state attributes changed.`
  );
  assert.equal(
    actual.children.length,
    expected.children.length,
    `${path}: ordered child count changed.`
  );
  for (let index = 0; index < expected.children.length; index += 1) {
    const expectedChild = expected.children[index];
    assertSameComponentTree(
      actual.children[index],
      expectedChild,
      `${path} > ${nodeLabel(expectedChild, index)}`
    );
  }
}

function directChildIdentity(node) {
  return node.children.map((child) => (
    child.attributes.get("id")
    || child.attributes.get("data-course-control")
    || child.tag
  ));
}

function removeApprovedWordWorldExtensions(node) {
  const approvedIds = new Set([
    "wordNetTargetTextSettings"
  ]);
  node.children = node.children.filter((child) => (
    !approvedIds.has(child.attributes.get("id"))
    && child.attributes.get("aria-labelledby") !== "wordNetChallengePromptModeLabel"
  ));
  node.children.forEach(removeApprovedWordWorldExtensions);
}

function cssRules(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, "");
  const rules = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of withoutComments.matchAll(rulePattern)) {
    const selectors = match[1].split(",").map(normalizeSpace).filter(Boolean);
    const declarations = match[2]
      .split(";")
      .map(normalizeSpace)
      .filter(Boolean);
    rules.push({ selectors, declarations });
  }
  return rules;
}

function normalizedDeclarationSet(source) {
  return new Set(cssRules(source).flatMap(({ declarations }) => declarations));
}

test("the golden inputs are the pinned Czech 0.1.7 Word World authority", async () => {
  const [documentBytes, cssBytes] = await Promise.all([
    readFile(AUTHORITATIVE_CZECH_DOCUMENT),
    Promise.resolve(AUTHORITATIVE_CZECH_CSS)
  ]);

  assert.equal(
    sha256(documentBytes),
    GOLDEN_DOCUMENT_SHA256,
    "The preserved Czech 0.1.7 interface fixture changed; review and explicitly repin the authority."
  );
  assert.equal(
    sha256(cssBytes),
    GOLDEN_CSS_SHA256,
    "word-net.css changed; review and explicitly repin the Czech interface authority."
  );

  const golden = parseHtml(documentBytes.toString("utf8"));
  assert.equal(
    findAll(golden, (node) => node.attributes.has("id")).length,
    83,
    "The authoritative Czech document must retain its 83 learner-interface IDs."
  );
});

test("the live shared Word World subtree exactly preserves the Czech component signature", async () => {
  const [goldenSource, sharedSource] = await Promise.all([
    readFile(AUTHORITATIVE_CZECH_DOCUMENT, "utf8"),
    readFile(SHARED_PRODUCT_DOCUMENT, "utf8")
  ]);
  const golden = parseHtml(goldenSource);
  const shared = parseHtml(sharedSource);

  const goldenGame = findOne(
    golden,
    (node) => hasClass(node, "word-net-game"),
    "authoritative .word-net-game"
  );
  const goldenDialog = findOne(
    golden,
    (node) => node.attributes.get("id") === "wordNetGenerativeDialog",
    "authoritative #wordNetGenerativeDialog"
  );
  const root = findOne(
    shared,
    (node) => node.attributes.get("id") === "wordWorldRoot",
    "shared #wordWorldRoot"
  );
  const targetTextSettings = findOne(
    root,
    (node) => node.attributes.get("id") === "wordNetTargetTextSettings",
    "shared target-language text settings"
  );
  assert.equal(targetTextSettings.attributes.get("hidden"), "");
  assert.equal(findAll(targetTextSettings, (node) => node.attributes.has("data-target-text-setting")).length, 2);
  const challengePromptSettings = findOne(
    root,
    (node) => node.attributes.get("aria-labelledby") === "wordNetChallengePromptModeLabel",
    "shared challenge prompt settings"
  );
  assert.equal(findAll(challengePromptSettings, (node) => node.attributes.has("data-challenge-prompt-mode")).length, 3);

  assert.equal(
    findAll(shared, (node) => node.tag === "template" && (
      node.attributes.has("data-word-world-template")
      || node.attributes.get("id") === "wordWorldTemplate"
    )).length,
    0,
    "Word World must have one live component tree, not an inert duplicate template."
  );
  assert.equal(
    findAll(shared, (node) => node.tag === "iframe" && (
      node.attributes.get("data-src") === "word-net.html"
      || node.attributes.get("src") === "word-net.html"
    )).length,
    0,
    "The accepted shared Word World path must not embed the legacy document."
  );
  assert.equal(
    findAll(shared, (node) => hasClass(node, "word-net-game")).length,
    1,
    "The shared product document must contain exactly one live Word World game tree."
  );
  assert.deepEqual(
    root.children.map((node) => [
      node.tag,
      node.attributes.get("id") ?? "",
      normalizeSpace(node.attributes.get("class"))
    ]),
    [
      ["section", "", "word-net-game"],
      ["dialog", "wordNetGenerativeDialog", "word-net-generative-dialog"]
    ],
    "#wordWorldRoot must contain the authoritative game and generative dialog, in that order."
  );

  removeApprovedWordWorldExtensions(root);

  assertSameComponentTree(root.children[0], goldenGame, "#wordWorldRoot > .word-net-game");
  assertSameComponentTree(
    root.children[1],
    goldenDialog,
    "#wordWorldRoot > #wordNetGenerativeDialog"
  );

  for (const id of REQUIRED_WORD_WORLD_IDS) {
    assert.equal(
      findAll(root, (node) => node.attributes.get("id") === id).length,
      1,
      `The shared Word World tree must preserve required node #${id}.`
    );
  }

  const goldenToolbar = findOne(
    goldenGame,
    (node) => hasClass(node, "word-net-panel-actions"),
    "authoritative Word World toolbar"
  );
  const sharedToolbar = findOne(
    root,
    (node) => hasClass(node, "word-net-panel-actions"),
    "shared Word World toolbar"
  );
  assert.deepEqual(directChildIdentity(goldenToolbar), TOOLBAR_COMPONENT_ORDER);
  assert.deepEqual(
    directChildIdentity(sharedToolbar),
    TOOLBAR_COMPONENT_ORDER,
    "Display, audio, challenge/dictionary, and generation controls must retain Czech order."
  );
});

test("shared Word World CSS keeps every component byte and only the allowed inline delta", async () => {
  const [goldenCss, sharedCss] = await Promise.all([
    Promise.resolve(AUTHORITATIVE_CZECH_CSS),
    readFile(SHARED_WORD_WORLD_CSS)
  ]);
  assert.equal(sha256(goldenCss), GOLDEN_CSS_SHA256);

  const goldenAnchor = goldenCss.indexOf(COMPONENT_CSS_ANCHOR);
  const sharedAnchor = sharedCss.indexOf(COMPONENT_CSS_ANCHOR);
  assert.ok(goldenAnchor > 0, "The golden CSS is missing the .word-net-game anchor.");
  assert.ok(sharedAnchor > 0, "The shared CSS is missing the .word-net-game anchor.");

  const goldenPrefix = goldenCss.subarray(0, goldenAnchor).toString("utf8");
  const sharedPrefix = sharedCss.subarray(0, sharedAnchor).toString("utf8");
  const goldenComponent = goldenCss.subarray(goldenAnchor);
  const sharedComponentAndDelta = sharedCss.subarray(sharedAnchor);
  const sharedComponent = sharedComponentAndDelta.subarray(0, goldenComponent.length);
  const approvedDelta = sharedComponentAndDelta.subarray(goldenComponent.length);

  assertSameBytes(
    sharedComponent,
    goldenComponent,
    "The historical Word World component CSS must remain byte-exact before approved shared overrides."
  );
  assert.equal(approvedDelta.length, APPROVED_SHARED_CSS_DELTA_BYTES);
  assert.equal(
    sha256(approvedDelta),
    APPROVED_SHARED_CSS_DELTA_SHA256,
    "The approved shared overrides for target reading guides, tone colors, prompt direction, centered dictionary text, and base/target history changed."
  );
  const approvedDeltaText = approvedDelta.toString("utf8");
  for (const selector of [
    ".word-net-target-text-unit",
    "button[data-challenge-prompt-mode]",
    ".word-net-word-heading strong.has-target-text-guide",
    ".word-net-trail-base",
    ".word-net-trail-target"
  ]) assert.match(approvedDeltaText, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.ok(
    sharedPrefix.length <= goldenPrefix.length + 512,
    "The inline-context CSS prefix must remain a small mechanical transformation."
  );

  const goldenDeclarations = normalizedDeclarationSet(goldenPrefix);
  const sharedPrefixRules = cssRules(sharedPrefix);
  const sharedSelectors = new Set(sharedPrefixRules.flatMap(({ selectors }) => selectors));
  for (const selector of sharedSelectors) {
    assert.ok(
      ALLOWED_INLINE_CONTEXT_SELECTORS.has(selector),
      `Unexpected inline-context selector before .word-net-game: ${selector}`
    );
  }
  for (const declaration of sharedPrefixRules.flatMap(({ declarations }) => declarations)) {
    assert.ok(
      goldenDeclarations.has(declaration),
      `Inline-context CSS declaration is not derived from the Czech prefix: ${declaration}`
    );
  }
  for (const selector of [
    "#wordWorldRoot",
    "#wordWorldRoot *",
    "#wordWorldRoot *::before",
    "#wordWorldRoot *::after",
    "#wordWorldRoot button",
    "#wordWorldRoot a"
  ]) {
    assert.ok(sharedSelectors.has(selector), `Inline-context CSS must include ${selector}.`);
  }

  assert.doesNotMatch(
    sharedPrefix,
    /(^|[,}\n]\s*)(?:html|body|\*|button|a|\.word-net-(?:page|main))(?:\s*[,\{])/mu,
    "Shared prefix selectors must be confined to #wordWorldRoot."
  );
});
