import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const source = await readFile(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
const ignoredKeys = [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }];

test("Word World menu keyboard bindings preserve composition and consumed input", () => {
  const browser = createBrowserHarness();
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) {
      const element = browser.document.createElement("button");
      browser.document.body.append(element);
      nodes.set(id, element);
    }
    return nodes.get(id);
  };
  const actions = [];
  Object.assign(browser.context, {
    $: node,
    closeDisplayMenu: options => actions.push(["display", options]),
    closeAudioMenu: options => actions.push(["audio", options]),
    closeTranslationMenu: options => actions.push(["translation", options]),
    closeGenerationMenu: () => actions.push(["generation"]),
    openAudioMenu: () => actions.push(["open-audio"])
  });
  const binding = (marker) => {
    const start = source.indexOf(marker);
    const end = source.indexOf("\n  });", start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end + "\n  });".length), browser.context);
  };
  for (const id of ["wordNetDisplayMenu", "wordNetAudioMenu", "wordNetSound"]) {
    binding(`  $("#${id}")?.addEventListener("keydown", (event) => {`);
    const target = node(`#${id}`);
    const key = id === "wordNetSound" ? "ArrowDown" : "Escape";
    for (const ignored of ignoredKeys) {
      target.dispatchEvent({ type: "keydown", key, ...ignored });
      assert.equal(actions.length, 0, id);
    }
    target.dispatchEvent({ type: "keydown", key });
    assert.equal(actions.length, 1, "ordinary input retains its menu action");
    if (key === "Escape") assert.equal(actions[0][1].restoreFocus, true);
    actions.length = 0;
  }
  binding('  document.addEventListener("keydown", (event) => {');
  for (const ignored of ignoredKeys) {
    browser.document.dispatchEvent({ type: "keydown", key: "Escape", ...ignored });
    assert.equal(actions.length, 0);
  }
  browser.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(actions.length, 4);
});

test("Word World translation menu arrows and Escape honor the same keyboard ownership", () => {
  const browser = createBrowserHarness();
  const menu = browser.document.createElement("div");
  const options = [browser.document.createElement("button"), browser.document.createElement("button")];
  menu.append(...options);
  browser.document.body.append(menu);
  const actions = [];
  Object.assign(browser.context, {
    $: () => menu, translationMenuItems: () => options,
    openTranslationMenu: () => actions.push("open"), closeTranslationMenu: () => actions.push("close")
  });
  for (const name of ["handleTranslationToggleKeydown", "handleTranslationMenuKeydown"]) {
    const body = source.match(new RegExp(`(?:^|\\n)(function ${name}\\([\\s\\S]*?\\n\\})(?=\\r?\\n|$)`, "u"))?.[1];
    assert.ok(body);
    vm.runInContext(body, browser.context);
  }
  options[0].focus();
  for (const ignored of ignoredKeys) {
    for (const key of ["ArrowDown", "Escape", "Tab"]) {
      const event = { key, preventDefault() {}, ...ignored };
      browser.context.handleTranslationToggleKeydown(event);
      browser.context.handleTranslationMenuKeydown(event);
      assert.equal(actions.length, 0);
      assert.equal(browser.document.activeElement, options[0]);
    }
  }
  browser.context.handleTranslationMenuKeydown({ key: "ArrowDown", preventDefault() {} });
  assert.equal(browser.document.activeElement, options[1]);
  browser.context.handleTranslationMenuKeydown({ key: "Escape", preventDefault() {} });
  assert.deepEqual(actions, ["close"]);
});
