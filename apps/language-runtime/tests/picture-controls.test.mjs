import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [wordWorld, nucleus, markup, styles, nucleusStyles, workspace, english] = await Promise.all([
  read("../static/source/product-word-world.mjs"),
  read("../../languages/mandarin-simplified/static/source/games/naturalization-nucleus/naturalization-nucleus.js"),
  read("../static/app/index.html"),
  read("../static/styles/caatuu-word-world.css"),
  read("../../languages/mandarin-simplified/static/source/games/naturalization-nucleus/naturalization-nucleus.css"),
  read("../static/source/caatuu-workspace.js"),
  read("../static/data/interface/en.v1.json")
]);

function extract(source, name, indent = "") {
  const asyncStart = source.indexOf(`${indent}async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2);
}

function button() {
  return {
    attributes: {}, active: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    classList: { toggle() {} }
  };
}

test("Word World feather hides and restores the same scene without changing the turn", async () => {
  const scene = { dataset: {}, hidden: false };
  const imageToggle = button();
  const state = { imagesEnabled: true, sceneRequestId: 1, sceneCandidates: [{ assetPath: "/scene.png", description: "Scene" }] };
  const image = { src: "/scene.png" };
  const context = vm.createContext({
    state, performance,
    $: (selector) => ({ "#wordNetImageToggle": imageToggle, "#wordNetScene": scene, "#wordNetSceneImage": image })[selector],
    interfaceText: (key) => key.endsWith("hide") ? "Hide picture clues" : "Show picture clues",
    SCENE_CANDIDATE_LOAD_TIMEOUT_MS: 1000,
    waitForImageLoad: async () => true, waitForImageDecode: async () => true,
    waitForVisiblePaint: async () => true, sceneTimeRemaining: () => 100,
    sceneDelay: async () => true
  });
  vm.runInContext(["syncImageControl", "toggleSceneImage", "renderSceneCandidate"].map((name) => extract(wordWorld, name)).join("\n"), context);
  context.toggleSceneImage();
  assert.equal(scene.dataset.illustrations, "false");
  assert.equal(imageToggle.attributes["aria-pressed"], "false");
  assert.equal(imageToggle.title, "Show picture clues");
  assert.equal(await context.renderSceneCandidate(0, 1, performance.now() + 2000), true);
  assert.equal(scene.dataset.illustrations, "false", "late image loads must not override the toggle");
  context.toggleSceneImage();
  assert.equal(scene.dataset.illustrations, "true");
  assert.equal(image.src, "/scene.png");
  assert.equal(state.sceneRequestId, 1);
  assert.match(styles, /\.word-net-scene\[data-illustrations="false"\]\s*\{\s*display:\s*none/u);
});

test("Nucleus feather toggles only the central artwork and keeps the round intact", () => {
  const state = { imagesEnabled: true, roundIndex: 3 };
  const core = { hidden: false };
  const imageToggle = button();
  const context = vm.createContext({ state, core, imageToggle });
  vm.runInContext(["syncImageControl", "toggleImage"].map((name) => extract(nucleus, name, "    ")).join("\n"), context);
  context.toggleImage();
  assert.equal(core.hidden, true);
  assert.equal(imageToggle.attributes["aria-pressed"], "false");
  context.toggleImage();
  assert.equal(core.hidden, false);
  assert.equal(imageToggle.title, "Hide picture clues");
  assert.equal(state.roundIndex, 3);
  assert.match(nucleusStyles, /\.naturalization-nucleus-core\[hidden\]\s*\{\s*display:\s*none/u);
});

test("both games use the established feather and accessible direct-toggle wiring", () => {
  for (const id of ["wordNetImageToggle", "naturalizationNucleusImageToggle"]) {
    assert.match(markup, new RegExp(`id="${id}"[^>]*aria-pressed="true"[^>]*>\\s*<span aria-hidden="true">🪶</span>`));
  }
  assert.match(wordWorld, /\$\("#wordNetImageToggle"\)\?\.addEventListener\("click", toggleSceneImage\)/u);
  assert.match(nucleus, /listen\(imageToggle, "click", toggleImage\)/u);
});

test("audio label is language neutral and Word World text buttons show Aa samples", () => {
  assert.match(english, /"verbnebula.audio.speakontap": "Speak on tap"/u);
  assert.doesNotMatch(workspace, /Speak \$\{verbTargetLabel\} on tap/u);
  const menu = markup.slice(markup.indexOf('id="wordNetDisplayMenu"'), markup.indexOf('id="wordNetSound"'));
  assert.equal((menu.match(/aria-hidden="true">Aa<\/span>/gu) || []).length, 3);
  assert.match(styles, /\.word-net-display-size-options button\s*\{[^}]*font-size:\s*0\.57rem/u);
});
