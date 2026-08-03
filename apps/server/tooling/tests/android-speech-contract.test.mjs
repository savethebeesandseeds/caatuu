import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const androidRoot = new URL("apps/android/app/src/main/", repoRoot);
const staticRoot = new URL("apps/languages/czech/static/", repoRoot);

const [manager, bridge, activity, manifest, runtime, wordNet, wordNetHtml, wordNetCore, chrome] = await Promise.all([
  readFile(new URL("java/com/caatuu/android/AndroidSpeechManager.kt", androidRoot), "utf8"),
  readFile(new URL("java/com/caatuu/android/CaatuuBridge.kt", androidRoot), "utf8"),
  readFile(new URL("java/com/caatuu/android/MainActivity.kt", androidRoot), "utf8"),
  readFile(new URL("AndroidManifest.xml", androidRoot), "utf8"),
  readFile(new URL("runtime.js", staticRoot), "utf8"),
  readFile(new URL("word-net.js", staticRoot), "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("word-net-core.mjs", staticRoot), "utf8"),
  readFile(new URL("chrome.js", staticRoot), "utf8"),
]);

function rateForDifficulty(source, difficulty) {
  const match = source.match(new RegExp(
    `${difficulty}:\\s*Object\\.freeze\\(\\{\\s*rate:\\s*([0-9.]+),\\s*label:`,
  ));
  assert.ok(match, `speech rate for difficulty ${difficulty} is declared`);
  return Number(match[1]);
}

function rateForPreference(source, preference) {
  const match = source.match(new RegExp(
    `${preference}:\\s*Object\\.freeze\\(\\{\\s*label:\\s*"[^"]+",\\s*rate:\\s*([0-9.]+)`,
  ));
  assert.ok(match, `speech rate for ${preference} is declared`);
  return Number(match[1]);
}

test("Android text-to-speech initializes asynchronously and reports Czech availability", () => {
  assert.match(manager, /class AndroidSpeechManager\(context: Context\)/);
  assert.match(manager, /TextToSpeech\(applicationContext\)/);
  assert.match(manager, /CompletableDeferred<Int>\(\)/);
  assert.match(manager, /withTimeoutOrNull\(INITIALIZATION_TIMEOUT_MILLIS\)/);
  assert.match(manager, /Locale\.forLanguageTag\(normalized\)/);
  assert.match(manager, /isLanguageAvailable\(locale\)/);
  assert.match(manager, /TextToSpeech\.LANG_MISSING_DATA/);
  assert.match(manager, /TextToSpeech\.LANG_NOT_SUPPORTED/);
  assert.match(manager, /isNetworkConnectionRequired/);
  assert.match(manager, /private fun eligibleVoices\(currentEngine: TextToSpeech, locale: Locale\): List<Voice>/);
  assert.match(manager, /filter \{ it\.locale\.language\.equals\(locale\.language, ignoreCase = true\) \}/);
  assert.match(manager, /val voice = selectVoice\(voices, requested\)/);
  assert.match(manager, /\.put\("localVoiceAvailable", voices\.any \{ !it\.isNetworkConnectionRequired \}\)/);
  assert.match(manager, /\.put\("voices", voiceOptions\(voices\)\)/);
  assert.match(manager, /\.put\("id", voice\.name\)[\s\S]*?\.put\("localService", !voice\.isNetworkConnectionRequired\)/);
  assert.match(manager, /private const val CZECH_LANGUAGE = "cs"/);
});

test("speech pace choices remain audibly distinct and reach both playback backends", () => {
  const coreRates = [1, 2, 3].map((difficulty) => rateForDifficulty(wordNetCore, difficulty));
  const chromeRates = ["slower", "slow", "normal"]
    .map((preference) => rateForPreference(chrome, preference));

  assert.deepEqual(chromeRates, coreRates, "shared controls and Word World use the same rates");
  assert.ok(coreRates[0] <= 0.7, "the slowest pace is clearly slower than normal speech");
  assert.ok(coreRates[1] - coreRates[0] >= 0.15, "slower and slow remain distinguishable");
  assert.ok(coreRates[2] - coreRates[1] >= 0.15, "slow and normal remain distinguishable");
  assert.equal(coreRates[2], 1, "normal keeps the platform's natural rate");

  assert.match(wordNet, /utterance\.rate = pace\.rate/);
  assert.match(wordNet, /speech\.speak\([\s\S]*?rate: pace\.rate/);
  assert.match(chrome, /utterance\.rate = rate/);
  assert.match(chrome, /speech\.speak\([\s\S]*?\{ locale, rate, pitch, voice \}/);
  assert.match(runtime, /rate: Number\.isFinite\(rate\) \? Math\.max\(0\.5, Math\.min\(1\.5, rate\)\)/);
  assert.match(manager, /setSpeechRate\(rate\.coerceIn\(MIN_RATE, MAX_RATE\)\)/);
});

test("Android offers only installed Czech voices and rejects silent voice fallback", () => {
  const eligibleVoiceStart = manager.indexOf("private fun eligibleVoices");
  const eligibleVoiceEnd = manager.indexOf("private fun selectVoice", eligibleVoiceStart);
  const eligibleVoicePath = manager.slice(eligibleVoiceStart, eligibleVoiceEnd);
  assert.ok(eligibleVoiceStart >= 0 && eligibleVoiceEnd > eligibleVoiceStart);
  assert.match(manager, /TextToSpeech\.Engine\.KEY_FEATURE_NOT_INSTALLED/);
  assert.match(
    eligibleVoicePath,
    /filterNot \{[^\n]*(?:KEY_FEATURE_NOT_INSTALLED|voiceDataIsMissing)[^\n]*\}/,
  );

  const selectVoiceStart = manager.indexOf("private fun selectVoice");
  const selectVoiceEnd = manager.indexOf("private fun stopActiveUtterance", selectVoiceStart);
  const selectVoicePath = manager.slice(selectVoiceStart, selectVoiceEnd);
  assert.ok(selectVoiceStart >= 0 && selectVoiceEnd > selectVoiceStart);
  assert.doesNotMatch(
    selectVoicePath,
    /firstOrNull \{ requested\.isNotBlank\(\)[\s\S]*?\}\s*\?:\s*voices\.firstOrNull\(\)/,
  );

  assert.match(manager, /setVoice\(/);
  assert.match(
    manager,
    /(?:setVoice\([^)]*\)[\s\S]{0,240}TextToSpeech\.SUCCESS|TextToSpeech\.SUCCESS[\s\S]{0,240}setVoice\()/,
  );
  assert.match(
    manager,
    /val activeVoice = currentEngine\.voice[\s\S]{0,240}activeVoice\.name == selectedVoice\.name/,
  );
  assert.doesNotMatch(manager, /currentEngine\.voice\s*=/);
});

test("Android speech validates short input and owns the full utterance lifecycle", () => {
  assert.match(manager, /TextToSpeech\.getMaxSpeechInputLength\(\)/);
  assert.match(manager, /MAX_SENTENCE_CHARACTERS = 1_000/);
  assert.match(manager, /setSpeechRate\(rate\.coerceIn\(MIN_RATE, MAX_RATE\)\)/);
  assert.match(manager, /setPitch\(pitch\.coerceIn\(MIN_PITCH, MAX_PITCH\)\)/);
  assert.match(manager, /TextToSpeech\.QUEUE_FLUSH/);
  assert.match(manager, /object : UtteranceProgressListener\(\)/);
  assert.match(manager, /override fun onStart\(utteranceId: String\?\)/);
  assert.match(manager, /override fun onDone\(utteranceId: String\?\)/);
  assert.match(manager, /override fun onStop\(utteranceId: String\?, interrupted: Boolean\)/);
  assert.match(manager, /override fun onError\(utteranceId: String\?, errorCode: Int\)/);
  assert.match(manager, /continuation\.invokeOnCancellation \{ cancelUtterance\(utteranceId\) \}/);
  assert.match(manager, /activeUtterance\?\.takeIf \{ it\.id == utteranceId \}/);
  assert.match(manager, /requireSpeechRequestIsCurrent\(requestGeneration\)/);
  assert.match(manager, /catch \(error: Exception\) \{\s*failUtterance\(utteranceId, error\)/);
  assert.match(manager, /currentEngine\.stop\(\)/);
  assert.match(manager, /currentEngine\.shutdown\(\)/);
});

test("the Android bridge keeps speech requests pending through completion", () => {
  assert.match(bridge, /"speech_status" -> speechStatus\(id, request\)/);
  assert.match(bridge, /"speech_speak" -> speakSpeech\(id, request\)/);
  assert.match(bridge, /"speech_stop" -> stopSpeech\(id\)/);
  const speakStart = bridge.indexOf("private suspend fun speakSpeech");
  const speakEnd = bridge.indexOf("private fun stopSpeech", speakStart);
  const speakPath = bridge.slice(speakStart, speakEnd);
  assert.ok(speakStart >= 0 && speakEnd > speakStart);
  assert.match(speakPath, /val result = speechManager\.speak/);
  assert.match(speakPath, /val voice = request\.optString\("voice"\)\.trim\(\)/);
  assert.match(speakPath, /speechManager\.speak\(text, locale, rate, pitch, voice\)/);
  assert.match(bridge, /speechManager\.status\(locale, voice\)/);
  assert.match(bridge, /MAX_SPEECH_VOICE_CHARACTERS = 256/);
  assert.match(speakPath, /"speech"[\s\S]*?\.put\("phase", "started"\)/);
  assert.ok(speakPath.indexOf("speechManager.speak") < speakPath.indexOf("emitDone(id, result)"));
  assert.match(bridge, /fun onPause\(\) \{\s*speechManager\.onPause\(\)/);
  assert.match(bridge, /fun onResume\(\) \{\s*speechManager\.onResume\(\)/);
  assert.match(bridge, /fun destroy\(\) \{\s*speechManager\.destroy\(\)/);
});

test("the Activity and manifest expose lifecycle-safe TTS without microphone access", () => {
  assert.match(activity, /speechManager = AndroidSpeechManager\(applicationContext\)/);
  assert.match(activity, /override fun onPause\(\)[\s\S]*?bridge\.onPause\(\)/);
  assert.match(activity, /override fun onResume\(\)[\s\S]*?bridge\.onResume\(\)/);
  assert.match(manifest, /<queries>[\s\S]*?android\.intent\.action\.TTS_SERVICE[\s\S]*?<\/queries>/);
  assert.doesNotMatch(manifest, /android\.permission\.RECORD_AUDIO/);
});

test("the shared runtime exposes bounded native speech calls", () => {
  assert.match(runtime, /nativeTextToSpeech: env === "android"/);
  assert.match(runtime, /speech:\s*\{/);
  assert.match(runtime, /nativeCall\(\s*"speech_status"/);
  assert.match(runtime, /nativeCall\(\s*"speech_speak"/);
  assert.match(runtime, /nativeCall\(\s*"speech_stop"/);
  assert.match(runtime, /status\(locale = course\.targetLanguage\.locale, options = \{\}\)/);
  assert.match(runtime, /voice: String\(options\.voice \|\| ""\)\.trim\(\)\.slice\(0, 256\)/);
  assert.match(runtime, /const voice = String\(options\.voice \|\| ""\)\.trim\(\)\.slice\(0, 256\)/);
  assert.match(runtime, /timeoutMs: 10_000/);
  assert.match(runtime, /timeoutMs: Number\(handlers\.timeoutMs \|\| 60_000\)/);
  assert.match(runtime, /timeoutMs: 3_000/);
});

test("Android exposes the standard system voice installer through the runtime", () => {
  const androidInstallPath = `${manager}\n${bridge}\n${activity}`;
  assert.match(bridge, /"speech_install_data" -> [a-zA-Z]+\(id\)/);
  assert.match(androidInstallPath, /Intent\(TextToSpeech\.Engine\.ACTION_INSTALL_TTS_DATA\)/);
  assert.match(androidInstallPath, /com\.android\.settings\.TTS_SETTINGS/);
  assert.match(androidInstallPath, /startActivity/);
  assert.match(bridge, /speechManager\.refreshVoiceDataAfterInstallerReturns\(\)/);
  assert.match(
    manager,
    /fun onResume\(\)[\s\S]*?refreshVoiceDataOnResume[\s\S]*?reinitializeEngine\(\)/,
  );
  assert.match(runtime, /installData\(\)\s*\{[\s\S]*?nativeCall\(\s*"speech_install_data"/);
});

test("Word World offers voice installation only for native missing-voice states", () => {
  assert.match(
    wordNetHtml,
    /id="wordNetAudioInstallVoice"[^>]*\bhidden\b|\bhidden\b[^>]*id="wordNetAudioInstallVoice"/,
  );

  const installReferences = [...wordNet.matchAll(/wordNetAudioInstallVoice/g)];
  assert.ok(installReferences.length >= 2, "the install control is synchronized and interactive");
  const installPaths = installReferences
    .map(({ index }) => wordNet.slice(Math.max(0, index - 500), index + 1_200))
    .join("\n");
  assert.match(
    chrome,
    /canInstallVoice:\s*backend === "android"[\s\S]{0,300}reason === "missing-language-data"[\s\S]{0,160}reason === "no-language-voice"/,
  );
  assert.match(
    wordNet,
    /installButton\.hidden = result\?\.backend !== "android" \|\| result\?\.canInstallVoice !== true/,
  );
  assert.match(installPaths, /const install = window\.CaatuuChrome\?\.installCzechSpeechData/);
  assert.match(installPaths, /!androidSpeechRuntime\(\)/);
  assert.match(installPaths, /const result = await install\(\)/);
  assert.match(installPaths, /refreshAndroidSpeechStatus\(\{ force: true \}\)/);
  assert.match(
    chrome,
    /async function installCzechSpeechData\(\)[\s\S]*?if \(!isNativeShell\(\)\)[\s\S]*?window\.CaatuuRuntime\?\.speech\?\.installData/,
  );
});

test("the shared Settings and developer preview use the Android speech lifecycle", () => {
  assert.match(chrome, /normalizedText\.length > 1_000/);
  assert.match(chrome, /const speech = window\.CaatuuRuntime\?\.speech/);
  assert.match(chrome, /speech\.speak\([\s\S]*?locale, rate, pitch, voice[\s\S]*?onEvent\(event\)/);
  assert.match(chrome, /event\?\.kind === "speech" && event\?\.phase === "started"/);
  assert.match(chrome, /window\.CaatuuRuntime\?\.speech\?\.stop\?\.\(\)/);
});

test("Word World prefers Android TTS and retains browser Web Speech fallback", () => {
  assert.match(wordNet, /function androidSpeechRuntime\(\)/);
  assert.match(wordNet, /runtime\?\.env !== "android"/);
  assert.match(wordNet, /async function refreshAndroidSpeechStatus\(\{ force = false \} = \{\}\)/);
  assert.match(wordNet, /await speech\.status\(targetLocale, \{ voice: preferredSpeechVoice\(\) \}\)/);
  assert.match(wordNet, /function speakCzechWithAndroid\(text, source, pace\)/);
  assert.match(wordNet, /speech\.speak\([\s\S]*?locale: targetLocale, rate: pace\.rate[\s\S]*?voice: preferredSpeechVoice\(\)/);
  assert.match(wordNet, /function speakCzechWithBrowser\(text, source, pace\)/);
  assert.match(wordNet, /new window\.SpeechSynthesisUtterance\(text\)/);
  assert.match(wordNet, /const savedVoice = voices\.find[\s\S]*?savedVoice \|\| selectSpeechSynthesisVoice/);
  assert.match(wordNet, /function toggleCzechSpeech\(text, source\)[\s\S]*?const pace = czechSpeechPace\(\);[\s\S]*?if \(androidSpeechRuntime\(\)\) speakCzechWithAndroid\(normalizedText, source, pace\);\s*else speakCzechWithBrowser\(normalizedText, source, pace\);/);
  assert.match(wordNet, /backend === "android"[\s\S]*?session\?\.controller\?\.abort\?\.\(\)/);
  assert.match(wordNet, /signal: session\.controller\.signal/);
  assert.match(wordNet, /visibilityState === "hidden"\)[\s\S]*?cancelCzechSpeech\(\)/);
  assert.match(wordNet, /window\.addEventListener\("pagehide", \(\) => cancelCzechSpeech\(\)\)/);
});
