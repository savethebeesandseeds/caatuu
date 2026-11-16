import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformRuntime } from "../build-product-assets.mjs";

const source = readFileSync(new URL("../../../languages/czech/static/source/shared/runtime.js", import.meta.url), "utf8");
const disabledGate = "            send: sendDictionaryGapReport,\n            online: () => false,";
const localEnqueue = "    return { ...result, pending: outbox.list().length, automaticDelivery: false, localOnly: true };";
function assertLocalOnly(input) {
  const output = transformRuntime(input);
  assert.match(output, /online: \(\) => false/u);
  assert.match(output, /automaticDelivery: false, localOnly: true/u);
  assert.doesNotMatch(output, /scheduleDictionaryGapFlush\(|report_dictionary_gap|\/cz\/api\/dictionary\/gaps|automaticDelivery: true/u);
}

test("product transformation accepts an already-disabled local-only dictionary outbox", () => {
  assert.ok(source.includes(disabledGate));
  assert.ok(source.includes(localEnqueue));
  assertLocalOnly(source);
});

test("product transformation still closes the exact legacy online and enqueue gates", () => {
  const legacy = source.replace(disabledGate, disabledGate.replace("() => false", "() => navigator.onLine !== false"))
    .replace(localEnqueue, "    scheduleDictionaryGapFlush(0);\n    return { ...result, pending: outbox.list().length, automaticDelivery: true };");
  assertLocalOnly(legacy);
});

test("unknown network or delivery policy changes still fail closed", () => {
  assert.throws(() => transformRuntime(source.replace(disabledGate, disabledGate.replace("() => false", "() => true"))), /disable the network/u);
  assert.throws(() => transformRuntime(source.replace(localEnqueue, localEnqueue.replace("automaticDelivery: false", "automaticDelivery: true"))), /local-only/u);
});


test("compiled maintenance clears neutral root and retained course caches without touching unrelated caches", () => {
  const output = transformRuntime(source);
  const functionSource = /function shouldClearCacheName\(name\) \{[\s\S]*?\n  \}/u.exec(output)?.[0];
  assert.ok(functionSource);
  const shouldClear = runInNewContext(`(${functionSource})`);
  for (const name of ["caatuu-web-static-digest", "caatuu-czech-pwa-44", "caatuu-czech-setup-v1", "caatuu-czech-web-static-old"]) {
    assert.equal(shouldClear(name), true, name);
  }
  for (const name of ["unrelated", "other-caatuu-web-static-digest", "caatuu-spanish-pwa-1", "caatuu-czechish-cache", "webllm-model-cache", "caatuu-web-static"]) {
    assert.equal(shouldClear(name), false, name);
  }
});
