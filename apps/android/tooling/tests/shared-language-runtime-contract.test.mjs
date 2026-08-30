import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtime = readFileSync(
  new URL("../../../languages/czech/static/source/shared/runtime.js", import.meta.url),
  "utf8"
);
const chrome = readFileSync(
  new URL("../../../language-runtime/static/source/caatuu-chrome.js", import.meta.url),
  "utf8"
);
const comet = readFileSync(
  new URL("../../../languages/czech/static/source/games/conjugation-comet/conjugation-comet.js", import.meta.url),
  "utf8"
);
const bridge = readFileSync(
  new URL("../../app/src/main/java/com/caatuu/android/CaatuuBridge.kt", import.meta.url),
  "utf8"
);
const home = readFileSync(
  new URL("../../../language-runtime/static/app/index.html", import.meta.url),
  "utf8"
);
const setup = readFileSync(
  new URL("../../../languages/czech/static/source/features/setup/setup.js", import.meta.url),
  "utf8"
);

test("embedded language games share the shell runtime and native reply registry", () => {
  assert.match(runtime, /window\.parent\.location\.origin !== window\.location\.origin/);
  assert.match(runtime, /window\.CaatuuNative = window\.parent\.CaatuuNative/);
  assert.match(runtime, /window\.CaatuuRuntime = parentRuntime/);
  assert.match(bridge, /window\.CaatuuNative && window\.CaatuuNative\.receive/);
});

test("Android developer previews use an explicit build signal instead of hostname drift", () => {
  assert.match(bridge, /fun isDeveloperPreview\(\): Boolean = BuildConfig\.DEBUG/);
  assert.match(runtime, /window\.CaatuuAndroid\.isDeveloperPreview\(\) === true/);
});

test("Home uses shared ready wording without implying a selected game", () => {
  assert.match(home, /data-caatuu-page-kicker="Caatuu"/);
  assert.doesNotMatch(home, /data-caatuu-page-kicker="Caatuu Czech"/);
  assert.doesNotMatch(setup, /Caatuu is current/);
  assert.match(chrome, /syncGameNavigationIndicators\(currentGameId\(\)\)/);
  assert.doesNotMatch(chrome, /syncGameNavigationIndicators\(activeGameId \|\| readRememberedGame\(\)\)/);
});
