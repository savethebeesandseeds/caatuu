import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativeUrl) {
  return readFile(new URL(relativeUrl, import.meta.url), "utf8");
}

test("Word World explains a disabled Generative runtime before reconstruction can block the click", async () => {
  const wordWorld = await source("../static/source/product-word-world.mjs");
  const requestContentMode = /async function requestContentMode\(mode\) \{([\s\S]*?)\n\}/u.exec(wordWorld)?.[1] || "";
  const disabledPrompt = requestContentMode.indexOf('mode === "generative" && !generationAvailability().enabled');
  const reconstructionGuard = requestContentMode.indexOf("shouldBlockReconstructionAdvance()");

  assert.ok(disabledPrompt >= 0, "the supported-but-disabled Generative branch must exist");
  assert.ok(reconstructionGuard >= 0, "the unfinished reconstruction guard must remain intact");
  assert.ok(disabledPrompt < reconstructionGuard, "the accessible disabled prompt must run before the reconstruction guard");
  assert.match(wordWorld, /setAttribute\("aria-disabled", String\(button\.disabled \|\| runtimeDisabled\)\)/u);
  assert.match(wordWorld, /showGenerativeUnavailablePrompt\(\)[\s\S]*?dialog\.showModal\(\)/u);
});

test("Czech Chat replaces the log with the shared disabled condition and exits before model work", async () => {
  const chat = await source("../../languages/czech/static/source/features/chat/chat.js");
  const init = /async function init\(\) \{([\s\S]*?)\n\}/u.exec(chat)?.[1] || "";
  const syncSettings = /function syncSettingsUi\(\) \{([\s\S]*?)\n\}/u.exec(chat)?.[1] || "";
  const disabledExit = init.indexOf("if (!chatRuntimeEnabled()) return;");
  const catalogLoad = init.indexOf("await loadLocalModelManifest()");
  const modelStatus = init.indexOf("await refreshNativeStatus()");
  const autoLoad = init.indexOf("await autoLoadModel()");

  assert.match(chat, /localAiAvailability\?\.\([\s\S]*?"chat"/u);
  assert.match(chat, /function renderChatDisabledState\(\)[\s\S]*?resetChat\(message\)/u);
  assert.match(chat, /renderChatDisabledState\(\)[\s\S]*?setChatEvent\(message, \{ tone: "muted" \}\)/u);
  assert.match(syncSettings, /if \(!availability\.enabled\) \{[\s\S]*?#composerModel[\s\S]*?"disabled"[\s\S]*?#settingsModel[\s\S]*?"disabled"[\s\S]*?renderDisabledModelMeta\(\)/u);
  assert.ok(
    syncSettings.indexOf("if (!availability.enabled)") < syncSettings.indexOf("renderBrowserFallbackMeta()"),
    "disabled Chat must retain its disabled model selection instead of falling through to browser fallback metadata"
  );
  assert.match(chat, /function renderDisabledModelMeta\(\)[\s\S]*?Local AI is disabled in this app\./u);
  assert.match(chat, /async function loadModel\([\s\S]*?if \(!chatRuntimeEnabled\(\)\) \{[\s\S]*?return;/u);
  assert.ok(disabledExit >= 0, "disabled Chat must return from initialization");
  for (const modelOperation of [catalogLoad, modelStatus, autoLoad]) {
    assert.ok(modelOperation > disabledExit, "every model operation must remain after the disabled return");
  }
});
