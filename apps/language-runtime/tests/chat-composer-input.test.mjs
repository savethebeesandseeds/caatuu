import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const source = await readFile(new URL("../../languages/czech/static/source/features/chat/chat.js", import.meta.url), "utf8");
const start = source.indexOf('  $("#promptInput").addEventListener("keydown",');
const end = source.indexOf('  $("#promptInput").addEventListener("input",', start);
assert.ok(start >= 0 && end > start, "the real composer keyboard binding is available");

test("chat Enter submits once while composition, held keys, modifiers and consumed input retain ownership", () => {
  const browser = createBrowserHarness();
  const input = browser.document.createElement("textarea");
  let submissions = 0;
  const form = { requestSubmit() { submissions += 1; } };
  browser.context.$ = (selector) => selector === "#promptInput" ? input : form;
  vm.runInContext(source.slice(start, end), browser.context);
  for (const details of [
    { isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true },
    { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }
  ]) {
    const event = { type: "keydown", key: "Enter", ...details };
    input.dispatchEvent(event);
    assert.equal(submissions, 0);
    assert.equal(event.defaultPrevented, Boolean(details.defaultPrevented));
  }
  const enter = { type: "keydown", key: "Enter" };
  input.dispatchEvent(enter);
  input.dispatchEvent({ type: "keydown", key: "Enter", repeat: true });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(submissions, 1);
  input.dispatchEvent({ type: "keydown", key: "Enter", shiftKey: true });
  assert.equal(submissions, 1, "Shift+Enter remains a newline");
});
