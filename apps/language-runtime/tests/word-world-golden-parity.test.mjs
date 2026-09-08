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
const APPROVED_SHARED_CSS_DELTA_BYTES = 3082;
const APPROVED_SHARED_CSS_DELTA_SHA256 =
  "6543430be21989bd200e5d8dc0a6085c7920d7486b9d71f2f2b7576b9541f781";

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

// Message IDs annotate the existing component; they do not change its layout.
// Keep the rendered ARIA/default attributes and every other data-* contract
// in the signature, and continue checking the exact ordered element tree.
const INTERFACE_MESSAGE_ATTRIBUTES = new Set([
  "data-i18n",
  "data-i18n-aria-description",
  "data-i18n-aria-label",
  "data-i18n-aria-valuetext",
  "data-i18n-placeholder",
  "data-i18n-title"
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
        node.contentSource = source.slice(node.contentStart, match.index);
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
      contentStart: match.index + token.length,
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
    .filter(([name]) => !INTERFACE_MESSAGE_ATTRIBUTES.has(name))
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
  if (node.attributes.get("id") === "wordNetAudioMenu") {
    const music = findAll(node, (child) => child.attributes.has("data-music-controls"));
    assert.equal(music.length, 1, "The audio menu mounts one shared music control.");
    assert.equal(music[0].tag, "div");
    assert.equal(music[0].children.length, 0, "The shared music module owns the control contents.");
  }
  const approvedIds = new Set([
    "wordNetTargetTextSettings",
    "wordNetImageToggle",
    "wordNetAudioMute"
  ]);
  node.children = node.children.filter((child) => (
    !approvedIds.has(child.attributes.get("id"))
    && child.attributes.get("aria-labelledby") !== "wordNetChallengePromptModeLabel"
  ));
  node.children.forEach(removeApprovedWordWorldExtensions);
}

function normalizeSharedRobotLoading(root, goldenGame) {
  const loading = findOne(root, (node) => node.attributes.get("id") === "wordNetLoading", "shared robot screen");
  const goldenLoading = findOne(goldenGame, (node) => node.attributes.get("id") === "wordNetLoading", "historical robot screen");
  assert.equal(loading.tag, "div");
  assert.deepEqual([...loading.attributes].sort(), [
    ["class", "word-net-loading caatuu-game-robot-loading"], ["hidden", ""],
    ["id", "wordNetLoading"], ["role", "status"]
  ].sort());
  assert.equal(loading.children.length, 1, "The shared robot replaces the separate spinner and image loader.");
  const image = loading.children[0];
  assert.equal(image.tag, "img");
  assert.deepEqual([...image.attributes].sort(), [
    ["alt", ""], ["aria-hidden", "true"], ["class", "caatuu-game-robot-loading-art"],
    ["id", "wordNetLoadingArt"], ["src", "/assets/robots/robot%20(1).png"]
  ].sort());
  // The user requested one shared centered blinking robot for every game. Only
  // this verified replacement is normalized before comparing the remaining UI.
  loading.attributes = new Map(goldenLoading.attributes);
  loading.children = goldenLoading.children;
}

function normalizeSharedDictionaryCard(root) {
  const card = findOne(root, (node) => node.attributes.get("id") === "wordNetWordTranslation", "shared dictionary card");
  const classes = new Set([
    "dictionary-word-card", "dictionary-word-card__copy", "dictionary-word-card__heading",
    "dictionary-word-card__word", "dictionary-word-card__pos", "dictionary-word-card__meaning",
    "dictionary-word-card__meta", "dictionary-word-card__pronounce"
  ]);
  const nodes = [card, ...findAll(card, () => true)];
  for (const name of classes) {
    assert.equal(nodes.filter((node) => hasClass(node, name)).length, 1, `The card must retain its shared ${name} hook.`);
  }
  for (const node of nodes) {
    const retained = normalizeSpace(node.attributes.get("class")).split(" ").filter((name) => !classes.has(name)).join(" ");
    if (retained) node.attributes.set("class", retained);
    else node.attributes.delete("class");
  }
}

function withSharedDictionaryCardCss(source) {
  // The requested common dictionary card owns presentation; Word World retains placement.
  return source
    .replace(/\.word-net-word-translation \{[\s\S]*?(?=\.word-net-display-menu,)/u,
      ".word-net-word-translation.dictionary-word-card { position: absolute; top: 14px; left: 14px; z-index: 3; }\n\n")
    .replace(/  \.word-net-word-translation \{\n    top: 12px;[\s\S]*?\n  \}/u,
      "  .word-net-word-translation.dictionary-word-card { top: 12px; left: 12px; }")
    .replace(/@media \(max-width: 380px\) \{\n  \.word-net-word-translation[\s\S]*?(?=@media \(max-width: 430px\))/u, "");
}

function withSharedRobotLoadingCss(source) {
  // Pin only the reviewed shared display controls and picture-toggle changes.
  const controlRules = [
  [
    ".word-net-display-menu",
    ".word-net-display-menu {\n  right: 0;\n  left: auto;\n  box-sizing: border-box;\n  width: min(288px, calc(100vw - 24px));\n  padding: 10px;\n  gap: 8px;\n  border-radius: 12px;\n  background: var(--panel);\n}"
  ],
  [
    ".word-net-display-options",
    ".word-net-display-options {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 7px;\n}"
  ],
  [
    ".word-net-display-options button",
    ".word-net-display-options button {\n  min-width: 0;\n  min-height: 43px;\n  padding: 7px;\n  border: 1px solid var(--theme-line-strong, var(--line));\n  border-radius: 9px;\n  background: var(--theme-input, var(--panel));\n  color: var(--ink);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 5px;\n  font: inherit;\n  font-size: 0.66rem;\n  font-weight: 850;\n  box-shadow: 0 2px 0 color-mix(in srgb, var(--gold) 48%, transparent);\n  cursor: pointer;\n}"
  ],
  [
    ".word-net-display-options button.is-active",
    ".word-net-display-options button.is-active {\n  border-color: var(--green-dark);\n  background: var(--green-dark);\n  color: #fff;\n  box-shadow: 0 2px 0 color-mix(in srgb, var(--green-dark) 72%, #000);\n}"
  ],
  [
    ".word-net-display-options img",
    ".word-net-display-options img {\n  width: 17px;\n  height: 17px;\n  object-fit: contain;\n}"
  ],
  [
    ".word-net-display-size-options button",
    ".word-net-display-size-options button {\n  min-height: 48px;\n  flex-direction: column;\n  gap: 1px;\n  font-size: 0.57rem;\n}"
  ],
  [
    ".word-net-display-size-sample.is-standard",
    ".word-net-display-size-sample.is-standard {\n  font-size: 0.96rem;\n}"
  ],
  [
    ".word-net-display-size-sample.is-small",
    ".word-net-display-size-sample.is-small {\n  font-size: 0.82rem;\n}"
  ],
  [
    ".word-net-display-size-sample.is-smaller",
    ".word-net-display-size-sample.is-smaller {\n  font-size: 0.7rem;\n}"
  ],
  [
    ".word-net-scene[hidden]",
    ".word-net-scene[hidden],\n.word-net-scene[data-illustrations=\"false\"] {\n  display: none;\n}"
  ]
];
  for (const [selector, replacement] of controlRules) {
    const start = source.indexOf("\n\n" + selector + " {") + 2;
    assert.ok(start >= 2, selector + " must exist in the historical authority");
    const end = source.indexOf("}", start) + 1;
    source = source.slice(0, start) + replacement + source.slice(end);
  }
  source = source.replace(".word-net-panel-actions > .theme-toggle {",
    ".word-net-image-toggle[aria-pressed=\"true\"] {\n  border-color: var(--theme-green, #22594d);\n  background: var(--theme-soft-green, #e8f5ee);\n}\n\n.word-net-panel-actions > .theme-toggle {");
  return source
    .replace(/^\.word-net-loading \{[^}]*\}/mu,
      ".word-net-loading {\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 240ms ease;\n}")
    .replace(/^[ \t]*\.word-net-loading-(?:art(?:\[hidden\])?|copy|spinner) \{[^}]*\}\n\n?/gmu, "")
    .replace(/^[ \t]*\.word-net-loading-(?:spinner|art),\n/gmu, "")
    .replace(/@keyframes word-net-(?:spin|robot-breathe) \{(?:[^{}]|\{[^{}]*\})*\}\n\n?/gu, "");
}

function normalizeApprovedInterfaceAnnotations(root) {
  const labels = [
    {
      className: "word-net-sentence-panel", tag: "section",
      attributes: ["aria-label"], messageId: "wordworld.sentence.generated",
      current: "Generated target-language sentence", golden: "Generated Czech sentence"
    },
    {
      id: "wordNetSelectedWordSound", tag: "button",
      attributes: ["aria-label", "title"], messageId: "wordworld.word.play",
      current: "Play selected target-language word aloud", golden: "Play selected Czech word aloud"
    },
    {
      id: "wordNetSound", tag: "button",
      attributes: ["aria-label", "title"], messageId: "wordworld.audio.settings",
      current: "Target-language audio settings", golden: "Czech audio settings"
    },
    {
      id: "wordNetPhraseSound", tag: "button",
      attributes: ["aria-label", "title"], messageId: "wordworld.sentence.play",
      current: "Play target-language sentence aloud", golden: "Play Czech sentence aloud"
    }
  ];
  for (const label of labels) {
    const identity = label.id || label.className;
    const node = findOne(root, (candidate) => label.id
      ? candidate.attributes.get("id") === label.id
      : hasClass(candidate, label.className), identity);
    assert.equal(node.tag, label.tag, `${identity}: localized element identity changed.`);
    for (const attribute of label.attributes) {
      assert.equal(node.attributes.get(attribute), label.current,
        `${identity}: only the reviewed target-neutral ${attribute} is allowed.`);
      assert.equal(node.attributes.get(`data-i18n-${attribute}`), label.messageId,
        `${identity}: the localized ${attribute} must use its reviewed message ID.`);
      node.attributes.set(attribute, label.golden);
    }
  }

  const ticks = findOne(root,
    (node) => hasClass(node, "caatuu-audio-speed-ticks"),
    "shared audio speed ticks");
  assert.equal(ticks.children.length, 3, "Audio speed ticks must retain three ordered labels.");
  const messages = [
    ["common.slower", "Slower"],
    ["common.slow", "Slow"],
    ["common.normal", "Normal"]
  ];
  ticks.children.forEach((tick, index) => {
    assert.equal(tick.tag, "span");
    assert.equal(tick.children.length, 2, "Only one label wrapper may precede the multiplier.");
    const [label, multiplier] = tick.children;
    const [messageId, fallback] = messages[index];
    assert.equal(label.tag, "span");
    assert.deepEqual([...label.attributes], [["data-i18n", messageId]],
      "A text wrapper must have no class, ID, style, or behavior attributes.");
    assert.equal(label.children.length, 0, "A localized label wrapper must contain plain text only.");
    assert.equal(normalizeSpace(label.contentSource), fallback,
      "A localized label wrapper must retain the reviewed literal fallback.");
    assert.equal(multiplier.tag, "small");
    // The signature does not include text nodes. Normalize this exact plain-text
    // wrapper back to the golden text-node shape before comparing all elements.
    tick.children = [multiplier];
  });
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
  findOne(
    root,
    (node) => node.attributes.has("data-voice-controls"),
    "shared Word World voice volume host"
  );
  findOne(root, (node) => node.attributes.has("data-music-controls"), "shared Word World music volume host");

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
  normalizeApprovedInterfaceAnnotations(root);
  normalizeSharedRobotLoading(root, goldenGame);
  normalizeSharedDictionaryCard(root);

  // The shared volume menu replaces the historical voice picker; its hosts,
  // slider and translations are checked above and behavior has dedicated tests.
  const audio = findOne(root, (node) => node.attributes.get("id") === "wordNetAudioMenu", "shared audio menu");
  const goldenAudio = findOne(goldenGame, (node) => node.attributes.get("id") === "wordNetAudioMenu", "historical audio menu");
  const speed = findOne(audio, (node) => node.attributes.get("id") === "wordNetAudioSpeed", "voice speed slider");
  assert.equal(speed.attributes.get("type"), "range");
  audio.attributes = new Map(goldenAudio.attributes);
  audio.children = goldenAudio.children;

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
  const goldenComponent = Buffer.from(withSharedDictionaryCardCss(withSharedRobotLoadingCss(goldenCss.subarray(goldenAnchor).toString("utf8"))));
  const sharedComponentAndDelta = sharedCss.subarray(sharedAnchor);
  const sharedComponent = sharedComponentAndDelta.subarray(0, goldenComponent.length);
  const approvedDelta = sharedComponentAndDelta.subarray(goldenComponent.length);

  assertSameBytes(
    sharedComponent,
    goldenComponent,
    "The historical Word World component CSS must remain byte-exact outside the shared robot/card migrations and approved shared overrides."
  );
  assert.equal(approvedDelta.length, APPROVED_SHARED_CSS_DELTA_BYTES);
  assert.equal(
    sha256(approvedDelta),
    APPROVED_SHARED_CSS_DELTA_SHA256,
    "The approved shared overrides for target reading guides, tone colors, prompt direction, and base/target history changed."
  );
  const approvedDeltaText = approvedDelta.toString("utf8");
  for (const selector of [
    ".word-net-target-text-unit",
    "button[data-challenge-prompt-mode]",
    ".word-net-trail-base",
    ".word-net-trail-target"
  ]) assert.match(approvedDeltaText, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  const dictionaryCss = await readFile(new URL("../static/styles/dictionary-word-card.css", import.meta.url), "utf8");
  assert.match(
    dictionaryCss,
    /\.dictionary-word-card__meaning\s*\{[^}]*text-align:\s*center;/u,
    "The selected meaning must remain centered under its target-language word."
  );
  assert.match(
    dictionaryCss,
    /\.dictionary-word-card\s*\{[^}]*width:\s*220px;\s*max-width:\s*244px;/u,
    "Shared dictionary cards must keep the requested wider desktop layout."
  );
  assert.match(
    dictionaryCss,
    /@media \(max-width:\s*560px\)\s*\{\s*\.dictionary-word-card\s*\{\s*max-width:\s*176px;/u,
    "Shared dictionary cards must retain their narrow-screen width ceiling."
  );
  assert.match(
    dictionaryCss,
    /\.dictionary-word-card__word\.has-target-text-guide\s*\{[^}]*overflow:\s*visible;/u,
    "Target reading guides must remain visible above their word."
  );
  assert.match(dictionaryCss, /@media \(max-width:\s*380px\)\s*\{\s*\.dictionary-word-card\s*\{\s*max-width:\s*140px;/u,
    "Phone cards must leave space for the adjacent game controls.");
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
