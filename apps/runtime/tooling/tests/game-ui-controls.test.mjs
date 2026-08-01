import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [app, appCss, indexHtml, chrome, chromeCss, wordNetCss, wordNetHtml, wordNetJs, audioLabHtml, audioLabCss, audioLabJs] = await Promise.all([
  readFile(new URL("app.js", staticRoot), "utf8"),
  readFile(new URL("app.css", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("chrome.js", staticRoot), "utf8"),
  readFile(new URL("chrome.css", staticRoot), "utf8"),
  readFile(new URL("word-net.css", staticRoot), "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("word-net.js", staticRoot), "utf8"),
  readFile(new URL("audio-lab.html", staticRoot), "utf8"),
  readFile(new URL("audio-lab.css", staticRoot), "utf8"),
  readFile(new URL("audio-lab.js", staticRoot), "utf8")
]);
const actionKeymap = JSON.parse(await readFile(
  new URL("../../../launcher/static/assets/macaw/actions/keymaps.json", staticRoot),
  "utf8"
));

test("shared app headers use the standard icon, kicker, and title pattern", () => {
  assert.match(chrome, /pageCopy\.className = "app-header-page-copy"/);
  assert.match(chrome, /pageCopy\.append\(pageKickerLabel, pageTitleLabel\)/);
  assert.match(chrome, /brand\.append\(mark, pageCopy\)/);
});

test("game-local theme controls preserve centered artwork and Word World chrome", () => {
  assert.match(appCss, /\.verb-match-control-cluster > \.theme-toggle \{[\s\S]*?padding: 0;[\s\S]*?place-items: center;/);
  assert.match(appCss, /html\[data-theme\] \.verb-match-control-cluster > \.theme-toggle \{[\s\S]*?border:[\s\S]*?background:/);
  assert.match(appCss, /html\[data-theme\] \.verb-match-control-cluster > \.theme-toggle\.is-selected \{[\s\S]*?border-color:[\s\S]*?background:/);
  assert.match(wordNetCss, /\.word-net-panel-actions > \.theme-toggle \{[\s\S]*?border: 1px solid[\s\S]*?place-items: center;/);
  assert.match(wordNetCss, /html\[data-theme\] \.word-net-panel-actions > \.theme-toggle \{[\s\S]*?border-color:[\s\S]*?background:/);
});

test("Verb Nebula reveal shows animated answers and automatically advances Explore only", () => {
  assert.match(app, /async function toggleVerbSolution\(\)/);
  assert.match(app, /if \(state\.verbSolutionRevealed\) \{[\s\S]*?state\.verbSolutionRevealed = false/);
  assert.match(app, /state\.verbSolutionRevealed = true/);
  assert.match(app, /if \(!state\.verbGuidedMode\) \{[\s\S]*?state\.verbSolutionAdvanceTimer = window\.setTimeout/);
  assert.match(app, /transitionToNextVerbRound\(\{ holdMillis: 0 \}\)/);
  assert.match(app, /const verbSolutionRevealBaseMillis = 1400/);
  assert.match(app, /const verbSolutionRevealMillisPerPair = 450/);
  assert.match(app, /function verbSolutionRevealDuration\(pairCount\)/);
  assert.match(app, /const revealDuration = verbSolutionRevealDuration\(state\.verbRound\.length\)/);
  assert.match(app, /svg\.classList\.toggle\("is-visible", Boolean\(visible\)\)/);
  assert.match(appCss, /\.verb-solution-arrows\.is-visible \{[\s\S]*?display: block;/);
  assert.match(app, /const verbSolutionRouteColors = \[/);
  assert.match(app, /route\.classList\.add\("verb-solution-route"\)/);
  assert.match(app, /halo\.classList\.add\("verb-solution-route-halo"\)/);
  assert.match(app, /line\.classList\.add\("verb-solution-route-line"\)/);
  assert.match(app, /card\.style\.setProperty\("--verb-solution-color", routeColor\)/);
  assert.match(appCss, /\.verb-solution-route-halo \{[\s\S]*?stroke-width: 8;/);
  assert.match(appCss, /\.verb-solution-route-line \{[\s\S]*?stroke: var\(--verb-solution-color/);
  assert.match(appCss, /\.verb-match-card\.is-solution \{[\s\S]*?--verb-solution-color/);
  assert.match(app, /svg\.toggleAttribute\("hidden", !visible\);/);
  assert.match(app, /svg\.toggleAttribute\("hidden", true\);/);
  assert.match(app, /revealButton\.setAttribute\("aria-pressed", String\(state\.verbSolutionRevealed\)\)/);
});

test("Verb Nebula initial and subsequent rounds share the robot preparation screen", () => {
  assert.match(app, /async function startVerbRound\(options = \{\}\)/);
  assert.match(app, /await prepareVerbRound\(planVerbRound\(\), transitionId\)/);
  assert.match(app, /async function prepareVerbRound\(nextRound, transitionId\)/);
  assert.match(app, /state\.verbRoundInterstitial = true/);
  assert.match(app, /state\.verbInterstitialRobotPath = verbRobotFallbackPath/);
  assert.match(app, /const robotPromise = nextVerbInterstitialRobot\(\)/);
  assert.match(app, /waitForVerbTransition\(verbRoundInterstitialMillis\)/);
  assert.match(app, /const verbRoundInterstitialMillis = 1600/);
});

test("Verb Nebula gives match words more presence and celebrates earned round XP", () => {
  assert.match(appCss, /\.verb-match-card-copy \{[\s\S]*?font-size: clamp\(1rem, 2\.35vw, 1\.18rem\)/);
  assert.match(appCss, /\.verb-match-card-copy \{[\s\S]*?font-weight: 500/);
  assert.match(appCss, /@media \(max-width: 430px\)[\s\S]*?\.verb-match-card-copy \{[\s\S]*?font-size: 0\.98rem/);
  assert.match(indexHtml, /id="verbRoundReward"[\s\S]*?\/assets\/icons\/icon_gem\.png[\s\S]*?id="verbRoundRewardAmount"/);

  const settleStart = app.indexOf("function settleVerbMatch()");
  const settleEnd = app.indexOf("function chooseVerbMatchCard", settleStart);
  const settlePath = app.slice(settleStart, settleEnd);
  assert.ok(settleStart >= 0 && settleEnd > settleStart, "the Verb Nebula match path must remain inspectable");
  assert.match(settlePath, /state\.verbRoundRewardXp = state\.verbGuidedMode \? 0 : state\.verbRound\.length/);
  assert.match(settlePath, /successes: 1,[\s\S]*?xp: 1,[\s\S]*?rounds: roundComplete \? 1 : 0/);
  assert.match(settlePath, /renderVerbNebula\(\);[\s\S]*?if \(roundComplete\) \{[\s\S]*?transitionToNextVerbRound\(\)/);

  assert.match(app, /function renderVerbRoundInterstitial\(\)[\s\S]*?const rewardVisible = active && rewardXp > 0[\s\S]*?\+\$\{rewardXp\} XP/);
  assert.match(app, /function applyVerbRound\([\s\S]*?state\.verbRoundRewardXp = 0/);
  assert.match(appCss, /\.verb-round-reward\.is-visible \{[\s\S]*?animation: verb-round-reward-arrive/);
  assert.match(appCss, /@keyframes verb-round-reward-gem-comet/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.verb-round-reward\.is-visible[\s\S]*?animation: none/);
});

test("Verb Nebula pins clear action clues for hearing and seeing", () => {
  assert.match(app, /const verbHintExactAssets = new Map\([\s\S]*?"hear"[\s\S]*?180-hear_listen\.png[\s\S]*?"see"[\s\S]*?181-see_look\.png/);
  assert.match(app, /function cachedVerbHintCandidates\(pair\)[\s\S]*?verbHintExactAssets\.get\(key\)[\s\S]*?score: 1000/);
  assert.equal(actionKeymap["/assets/macaw/actions/180-hear_listen.png"]?.action, "hear_listen");
  assert.equal(actionKeymap["/assets/macaw/actions/181-see_look.png"]?.action, "see_look");
});

test("Generative mode requires an explicit local-model download confirmation", () => {
  assert.match(wordNetHtml, /id="wordNetGenerativeDialog"[\s\S]*?about 1\.9 GB[\s\S]*?value="cancel"[\s\S]*?value="confirm"/);
  assert.match(wordNetHtml, /word-net-generative-dialog-art[\s\S]*?\/assets\/robots\/word-world-waiting\.svg/);
  assert.match(wordNetCss, /\.word-net-generative-dialog-card \{[\s\S]*?box-shadow:[\s\S]*?grid-template-columns:/);
  assert.match(wordNetJs, /function confirmGenerativeMode\(\)[\s\S]*?dialog\.showModal\(\)/);
  assert.match(wordNetJs, /mode === "generative" && !\(await confirmGenerativeMode\(\)\)/);
});

test("Word World translations reuse the quiet dictionary accent", () => {
  assert.match(wordNetCss, /\.word-net-translation \{[\s\S]*?color: var\(--theme-entry-accent, #8f4b40\)/);
});

test("Word World reads Czech sentences with the device speech engine", () => {
  assert.match(
    wordNetHtml,
    /id="wordNetSound"[^>]*aria-label="Play Czech sentence aloud"[^>]*aria-pressed="false"[^>]*disabled/
  );
  assert.doesNotMatch(wordNetHtml, /Sound unavailable|Sound is not available yet/);
  assert.match(wordNetHtml, /<svg class="word-net-sound-icon" data-speech-icon="play"[\s\S]*?<svg class="word-net-sound-icon" data-speech-icon="stop"/);
  assert.match(wordNetCss, /\.word-net-sound-toggle\.is-speaking \{[\s\S]*?border-color:[\s\S]*?background:/);
  assert.match(wordNetCss, /\.word-net-sound-toggle \{[\s\S]*?position: relative;[\s\S]*?padding: 0;/);
  assert.match(wordNetCss, /\.word-net-sound-toggle \[data-speech-icon\] \{[\s\S]*?top: 50%;[\s\S]*?left: 50%;[\s\S]*?width: 24px;[\s\S]*?height: 24px;[\s\S]*?transform: translate\(-50%, -50%\)/);
  assert.match(wordNetCss, /\.word-net-sound-icon \{[\s\S]*?stroke: currentColor;/);

  assert.match(wordNetJs, /function browserSpeechSynthesisSupported\(\)[\s\S]*?isSpeechSynthesisSupported\([\s\S]*?window\.speechSynthesis[\s\S]*?window\.SpeechSynthesisUtterance/);
  assert.match(wordNetJs, /function androidSpeechRuntime\(\)[\s\S]*?runtime\?\.env !== "android"/);
  assert.match(wordNetJs, /function syncSpeechControl\(\)[\s\S]*?const sentenceButton = \$\("#wordNetSound"\)[\s\S]*?const wordButton = \$\("#wordNetSelectedWordSound"\)[\s\S]*?sentenceButton\.disabled = checking \|\| state\.busy \|\| !supported \|\| !hasSentence[\s\S]*?wordButton\.disabled = checking \|\| state\.busy \|\| !supported \|\| !wordAvailable/);
  assert.match(wordNetJs, /function unavailableSpeechLabel\(\)[\s\S]*?install or enable a Czech voice/);
  assert.match(wordNetJs, /synthesis\.addEventListener\("voiceschanged", syncSpeechControl\)/);
  assert.match(chrome, /speechVoiceStorageKey = `\$\{course\.storage\.namespace[^;]+\.speech\.voice\.v1`/);
  assert.match(chrome, /id="settingsSpeechVoice"[\s\S]*?Automatic \(recommended\)[\s\S]*?id="settingsSpeechVoiceStatus"/);
  assert.match(chrome, /const lightModeIconSrc = "\/assets\/icons\/light_mode_ui\.png"/);
  assert.match(chrome, /data-theme-option="light"[\s\S]*?src="\$\{lightModeIconSrc\}"[\s\S]*?<b>Light<\/b>/);
  assert.doesNotMatch(chrome, /<h3>Pronunciation<\/h3>/);
  assert.doesNotMatch(chrome, /Choose the installed voice that reads Czech sentences aloud\./);
  assert.match(chrome, /Automatic will use the best available Czech voice\./);
  assert.match(chrome, /function getSpeechVoicePreference\(\)/);
  assert.match(chrome, /synthesis\.addEventListener\("voiceschanged", \(\) =>/);
  assert.match(chrome, /window\.dispatchEvent\(new CustomEvent\("caatuu:speech-voice-change"/);

  const browserStart = wordNetJs.indexOf("function speakCzechWithBrowser");
  const browserEnd = wordNetJs.indexOf("function toggleCzechSpeech", browserStart);
  const browserPath = wordNetJs.slice(browserStart, browserEnd);
  assert.ok(browserStart >= 0 && browserEnd > browserStart, "the browser speech path must remain inspectable");
  assert.match(browserPath, /let utterance = null;[\s\S]*?try \{[\s\S]*?utterance = new window\.SpeechSynthesisUtterance\(text\)/);
  assert.match(browserPath, /utterance\.lang = targetLocale/);
  assert.match(browserPath, /utterance\.rate = CZECH_SPEECH_RATE/);
  assert.match(browserPath, /const voices = typeof synthesis\.getVoices === "function" \? synthesis\.getVoices\(\) : \[\]/);
  assert.match(browserPath, /const savedVoice = voices\.find[\s\S]*?savedVoice \|\| selectSpeechSynthesisVoice\(voices, targetLocale\)/);
  assert.match(browserPath, /const requestedVoice = preferredSpeechVoice\(\)/);
  assert.match(browserPath, /utterance\.onstart =/);
  assert.match(browserPath, /utterance\.onend =/);
  assert.match(browserPath, /utterance\.onerror =/);
  assert.match(browserPath, /state\.speechTimeoutId = window\.setTimeout\([\s\S]*?"synthesis-timeout"[\s\S]*?CZECH_SPEECH_TIMEOUT_MS/);
  const cancelIndex = browserPath.indexOf("synthesis.cancel()");
  const speakIndex = browserPath.indexOf("synthesis.speak(utterance)");
  assert.ok(cancelIndex >= 0 && speakIndex >= 0 && cancelIndex < speakIndex);

  const nativeStart = wordNetJs.indexOf("function speakCzechWithAndroid");
  const nativeEnd = wordNetJs.indexOf("function speakCzechWithBrowser", nativeStart);
  const nativePath = wordNetJs.slice(nativeStart, nativeEnd);
  assert.ok(nativeStart >= 0 && nativeEnd > nativeStart, "the Android speech path must remain inspectable");
  assert.match(nativePath, /speech\.speak\([\s\S]*?text,[\s\S]*?locale: targetLocale[\s\S]*?voice: preferredSpeechVoice\(\)/);
  assert.match(nativePath, /event\?\.kind !== "speech"[\s\S]*?event\?\.phase !== "started"/);
  assert.match(nativePath, /finishCzechSpeech\(session, requestId/);

  const dispatcherStart = wordNetJs.indexOf("function toggleCzechSpeech");
  const dispatcherEnd = wordNetJs.indexOf("async function refreshAndroidSpeechStatus", dispatcherStart);
  const dispatcherPath = wordNetJs.slice(dispatcherStart, dispatcherEnd);
  assert.match(dispatcherPath, /String\(text \|\| ""\)[\s\S]*?state\.speechSource === source[\s\S]*?state\.speechText === normalizedText/);
  assert.match(dispatcherPath, /if \(androidSpeechRuntime\(\)\) speakCzechWithAndroid\(normalizedText, source\);\s*else speakCzechWithBrowser\(normalizedText, source\);/);
  assert.match(dispatcherPath, /function speakCurrentCzechSentence\(\)[\s\S]*?toggleCzechSpeech\(state\.currentSentence, "sentence"\)/);
  assert.match(dispatcherPath, /function speakSelectedCzechWord\(\)[\s\S]*?toggleCzechSpeech\(state\.selectedWord, "word"\)/);

  const finishStart = wordNetJs.indexOf("function finishCzechSpeech");
  const finishEnd = wordNetJs.indexOf("function speakCzechWithAndroid", finishStart);
  const finishPath = wordNetJs.slice(finishStart, finishEnd);
  assert.match(finishPath, /state\.speechSession !== session \|\| state\.speechRequestId !== requestId/);
  assert.match(finishPath, /clearCzechSpeechTimeout\(\)/);

  assert.match(wordNetJs, /async function refreshAndroidSpeechStatus\(\{ force = false \} = \{\}\)[\s\S]*?await speech\.status\(targetLocale, \{ voice: preferredSpeechVoice\(\) \}\)/);
  assert.match(wordNetJs, /window\.addEventListener\("caatuu:speech-voice-change"[\s\S]*?cancelCzechSpeech\(\)[\s\S]*?refreshAndroidSpeechStatus\(\{ force: true \}\)/);
  assert.match(wordNetJs, /backend === "android"[\s\S]*?session\?\.controller\?\.abort/);
  assert.match(wordNetJs, /signal: session\.controller\.signal/);

  const busyStart = wordNetJs.indexOf("function setBusy");
  const busyEnd = wordNetJs.indexOf("function renderTrail", busyStart);
  assert.match(wordNetJs.slice(busyStart, busyEnd), /if \(busy\) \{[\s\S]*?cancelCzechSpeech\(\)/);
  assert.match(wordNetJs, /visibilityState === "hidden"\)[\s\S]*?cancelCzechSpeech\(\)/);
  assert.match(wordNetJs, /window\.addEventListener\("pagehide", \(\) => cancelCzechSpeech\(\)\)/);
  assert.match(wordNetJs, /\$\("#wordNetSound"\)\?\.addEventListener\("click", speakCurrentCzechSentence\)/);
  assert.match(wordNetJs, /\$\("#wordNetSelectedWordSound"\)\?\.addEventListener\("click", speakSelectedCzechWord\)/);
});

test("Settings and Audio Lab share one selectable Czech speech service", () => {
  assert.match(chrome, /class="speech-voice-row"[\s\S]*?id="settingsSpeechVoice"[\s\S]*?id="settingsSpeechVoiceTest"[\s\S]*?id="settingsSpeechVoiceStatus"/);
  assert.match(chrome, /async function listSpeechVoiceOptions\(\)/);
  assert.match(chrome, /async function speakCzechText\(text, options = \{\}\)/);
  assert.match(chrome, /normalizedText\.length > 1_000/);
  assert.match(chrome, /speech\.speak\([\s\S]*?onEvent\(event\)[\s\S]*?event\?\.phase === "started"/);
  assert.match(chrome, /new Utterance\(normalizedText\)/);
  assert.match(chrome, /activeBrowserSpeechSession\.stop\(\)/);
  assert.match(chrome, /href="audio-lab\.html">audio-lab<\/a>/);
  assert.match(chromeCss, /\.speech-voice-row \{[\s\S]*?grid-template-columns:/);
  assert.match(chromeCss, /\.speech-voice-controls \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(chromeCss, /\.settings-raised-action \{[\s\S]*?border-bottom-width: 3px;/);

  assert.match(audioLabHtml, /id="audioLabVoice"/);
  assert.equal([...audioLabHtml.matchAll(/data-audio-sample=/g)].length, 4);
  assert.match(audioLabHtml, /id="audioLabText"[\s\S]*?maxlength="1000"/);
  assert.match(audioLabHtml, /id="audioLabRate"[\s\S]*?id="audioLabPitch"/);
  assert.match(audioLabHtml, /id="audioLabStop"[\s\S]*?id="audioLabPlay"[\s\S]*?role="status"/);
  assert.match(audioLabCss, /\.audio-lab-sample-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(audioLabCss, /\.audio-lab-page \{[\s\S]*?margin: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?font-family:/);
  assert.match(audioLabJs, /api\.listSpeechVoiceOptions\(\)/);
  assert.match(audioLabJs, /api\.speakCzechText\(normalizedText/);
  assert.match(audioLabJs, /stopCzechSpeech/);
  assert.doesNotMatch(audioLabJs, /new SpeechSynthesisUtterance|CaatuuRuntime\?\.speech\?\.speak/);
});

test("Word World reuses the sentence audio control and keeps dictionary options in the Aa menu", () => {
  assert.match(wordNetHtml, /id="wordNetSelectedWordSound"[^>]*aria-label="Play selected Czech word aloud"[^>]*aria-pressed="false"[^>]*disabled/);
  assert.match(wordNetHtml, /class="word-net-sound-toggle word-net-word-pronounce" id="wordNetSelectedWordSound"/);
  assert.equal([...wordNetHtml.matchAll(/class="word-net-sound-icon" data-speech-icon="play"/g)].length, 2);
  assert.equal([...wordNetHtml.matchAll(/class="word-net-sound-icon" data-speech-icon="stop"/g)].length, 2);
  assert.doesNotMatch(wordNetHtml, /word-net-word-sound-icon|data-word-speech-icon/);
  assert.match(wordNetHtml, /id="wordNetTranslationToggle"[^>]*aria-haspopup="menu"[^>]*aria-controls="wordNetTranslationMenu"[^>]*aria-expanded="false"/);
  assert.match(wordNetHtml, /id="wordNetTranslationMenu"[^>]*role="menu"[^>]*aria-label="English answer and dictionary settings"[^>]*hidden>[\s\S]*?wordNetAnswerSettingsLabel[\s\S]*?wordNetDictionarySettingsLabel/);
  assert.match(wordNetHtml, /role="group" aria-labelledby="wordNetAnswerSettingsLabel">[\s\S]*?data-answer-mode="reconstruct"[\s\S]*?data-answer-mode="wait"[\s\S]*?id="wordNetTranslationTimers"[^>]*role="group"[^>]*hidden>[\s\S]*?data-translation-delay="timer-0"[\s\S]*?data-translation-delay="timer-5"[\s\S]*?data-translation-delay="timer-10"[\s\S]*?data-translation-delay="timer-30"[\s\S]*?<\/section>/);
  for (const mode of ["reconstruct", "wait"]) {
    assert.match(wordNetHtml, new RegExp(`role="menuitemradio"[^>]*tabindex="-1"[^>]*aria-checked="(?:true|false)"[^>]*data-answer-mode="${mode}"`));
  }
  assert.doesNotMatch(wordNetHtml, /data-translation-mode="(?:off|visible)"|wordNetRevealTimerToggle|data-translation-disclosure/);
  assert.match(wordNetHtml, /role="menuitemcheckbox"[^>]*tabindex="-1"[^>]*data-word-card-setting="showCard"[^>]*aria-checked="true"[^>]*>Show dictionary card<\/button>/);
  assert.match(wordNetHtml, /role="menuitemcheckbox"[^>]*tabindex="-1"[^>]*data-word-card-setting="autoPronounce"[^>]*aria-checked="false"/);
  assert.match(wordNetHtml, /role="menuitem"[^>]*id="wordNetDictionaryGapExport"[^>]*data-dictionary-gap-action="copy"[\s\S]*?Copy missing-word batch[\s\S]*?Narrow device-local JSON for Codex/);
  assert.doesNotMatch(wordNetHtml, /wordNetWordCardSettings|wordNetWordCardSettingsMenu/);
  assert.match(wordNetHtml, /word-net-word-card-copy" role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(wordNetHtml, /id="wordNetWordTranslation"[^>]*aria-live=/);
  assert.match(wordNetCss, /\.word-net-word-pronounce\.word-net-sound-toggle \{[\s\S]*?position: absolute;[\s\S]*?top: 0;[\s\S]*?left: 0;[\s\S]*?width: 34px;[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?color: var\(--theme-amber/);
  assert.match(wordNetCss, /\.word-net-icon-button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?border-radius: 999px;/);
  assert.match(wordNetCss, /\.word-net-sound-toggle \[data-speech-icon\] \{[\s\S]*?width: 24px;[\s\S]*?height: 24px;/);
  assert.doesNotMatch(wordNetCss, /data-word-speech-icon|word-net-word-sound-icon/);
  assert.match(wordNetCss, /\.word-net-translation-menu \{[\s\S]*?width: min\(276px, calc\(100vw - 24px\)\)[\s\S]*?overflow-y: auto/);
  assert.match(wordNetCss, /@media \(max-width: 560px\) \{[\s\S]*?\.word-net-translation-menu \{\s*right: 0;/);
  assert.match(wordNetCss, /\.word-net-translation-menu-section \{[\s\S]*?border-bottom:/);
  assert.match(wordNetCss, /\.word-net-translation-timers \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(wordNetCss, /\.word-net-translation-timers\[hidden\] \{\s*display: none;/);
  assert.doesNotMatch(wordNetCss, /word-net-translation-disclosure/);
  assert.doesNotMatch(wordNetCss, /word-net-word-settings-menu|word-net-word-card-button/);
  assert.match(wordNetJs, /WORD_CARD_PREFERENCES_STORAGE_KEY = `\$\{course\.storage\.namespace\}\.wordNet\.wordCardPreferences\.v1`/);
  assert.match(wordNetJs, /function loadWordCardPreferences\(\)[\s\S]*?showCard: stored\.showCard !== false[\s\S]*?autoPronounce: stored\.autoPronounce === true/);
  assert.match(wordNetJs, /function toggleWordCardPreference\(key\)[\s\S]*?saveWordCardPreferences\(\)[\s\S]*?syncTranslationMenu\(\)[\s\S]*?syncWordTranslation\(\)/);
  assert.match(wordNetJs, /function translationMenuItems\(\)[\s\S]*?\[role="menuitem"\][\s\S]*?filter\(\(item\) => !item\.closest\("\[hidden\]"\)\)/);
  assert.match(wordNetJs, /function syncTranslationMenu\(\)[\s\S]*?isTimedTranslationMode\(state\.translationMode\)[\s\S]*?timers\.hidden = !showTimers[\s\S]*?\[data-word-card-setting\][\s\S]*?state\.wordCardPreferences\[key\]/);
  assert.doesNotMatch(wordNetJs, /toggleTranslationTimers|translationTimerChoicesExpanded|data-translation-disclosure/);
  assert.match(wordNetJs, /wordNetTranslationMenu"\)\?\.addEventListener\("click"[\s\S]*?closest\("button\[data-answer-mode\]"\)[\s\S]*?setTranslationMode\("reconstruct"\)[\s\S]*?setTranslationMode\(delay, \{ closeMenu: false \}\)[\s\S]*?closest\("button\[data-translation-delay\]"\)[\s\S]*?closest\("button\[data-word-card-setting\]"\)/);
  assert.match(wordNetJs, /async function copyDictionaryGapBatch\(\)[\s\S]*?maintenance\?\.exportDictionaryGaps\?\.\(\)[\s\S]*?copyTextToClipboard\(copy\)[\s\S]*?Paste the JSON into a Codex maintenance task/);
  assert.match(wordNetJs, /closest\("button\[data-dictionary-gap-action\]"\)[\s\S]*?copyDictionaryGapBatch\(\)/);
  assert.match(wordNetCss, /button\[data-dictionary-gap-action\]::before[\s\S]*?content: "\\2193"/);
  assert.match(wordNetJs, /function syncWordTranslation\(\)[\s\S]*?Boolean\(state\.selectedWord\)[\s\S]*?state\.wordCardPreferences\.showCard[\s\S]*?guidedCardAllowed[\s\S]*?metaNode\.hidden = !metaNode\.textContent/);
  assert.match(wordNetJs, /function selectWord\(word, \{ lookup = true, render = true, userInitiated = false \} = \{\}\)[\s\S]*?userInitiated[\s\S]*?state\.wordCardPreferences\.autoPronounce[\s\S]*?speakSelectedCzechWord\(\)/);
  assert.match(wordNetJs, /wordButton\.querySelector\('\[data-speech-icon="play"\]'\)[\s\S]*?wordButton\.querySelector\('\[data-speech-icon="stop"\]'\)/);
  assert.match(wordNetJs, /selectWord\(button\.dataset\.word, \{ userInitiated: true \}\)/);
  assert.match(wordNetJs, /function handleTranslationMenuKeydown\(event\)[\s\S]*?event\.key === "Escape"[\s\S]*?event\.key === "Tab"[\s\S]*?event\.preventDefault\(\)[\s\S]*?wordNetGenerationToggle[\s\S]*?event\.key === "ArrowDown"[\s\S]*?event\.key === "ArrowUp"[\s\S]*?event\.key === "Home"[\s\S]*?event\.key === "End"/);
  assert.match(wordNetJs, /function handleTranslationToggleKeydown\(event\)[\s\S]*?"ArrowDown"[\s\S]*?"ArrowUp"[\s\S]*?openTranslationMenu/);
  assert.doesNotMatch(wordNetJs, /handleWordCardSettingsKeydown|wordNetWordCardSettingsMenu/);
});

test("Word World persists missing dictionary entries without silently stopping at the gap-ledger limit", () => {
  const rememberStart = wordNetJs.indexOf("function rememberDictionaryGap");
  const rememberEnd = wordNetJs.indexOf("function forgetDictionaryGap", rememberStart);
  const rememberPath = wordNetJs.slice(rememberStart, rememberEnd);
  assert.match(rememberPath, /slice\(-\(DICTIONARY_GAP_LIMIT - 1\)\)[\s\S]*?localStorage\.setItem\(DICTIONARY_GAP_STORAGE_KEY/);
  assert.match(rememberPath, /const previousKeys = \[\.\.\.state\.dictionaryGapKeys\][\s\S]*?state\.dictionaryGapKeys = previousKeys/);

  const forgetStart = wordNetJs.indexOf("function forgetDictionaryGap");
  const forgetEnd = wordNetJs.indexOf("function loadHistory", forgetStart);
  const forgetPath = wordNetJs.slice(forgetStart, forgetEnd);
  assert.match(forgetPath, /filter\(\(value\) => value !== normalized\)[\s\S]*?localStorage\.setItem\(DICTIONARY_GAP_STORAGE_KEY/);

  const queueStart = wordNetJs.indexOf("async function queueMissingDictionaryFeedback");
  const queueEnd = wordNetJs.indexOf("async function lookupSelectedWord", queueStart);
  const queuePath = wordNetJs.slice(queueStart, queueEnd);
  assert.match(queuePath, /kind: "dictionary_missing_entry"/);
  assert.match(wordNetJs, /const DICTIONARY_GAP_NOTICE = "Missing word saved on this device\. Sending is not enabled yet\."/);
  assert.match(queuePath, /Number\(lookupReturned\) > 0 \? "no_exact_usable_entry" : "no_results"/);
  assert.match(queuePath, /maintenance\?\.enqueueReport\?\.\(payload,[\s\S]*?dedupeKey: \[feedback\.kind, feedback\.dictionaryDirection, feedback\.dictionaryKey, normalizedWord\]/);
  assert.match(queuePath, /queued\?\.queued[\s\S]*?queued\.persisted === false[\s\S]*?rememberDictionaryGap\(normalizedWord\)/);
  assert.doesNotMatch(queuePath, /dictionaryGapKeys\.length >= DICTIONARY_GAP_LIMIT/);

  const lookupStart = wordNetJs.indexOf("async function lookupSelectedWord");
  const lookupEnd = wordNetJs.indexOf("function selectWord", lookupStart);
  const lookupPath = wordNetJs.slice(lookupStart, lookupEnd);
  assert.match(lookupPath, /if \(!result\) void queueMissingDictionaryFeedback\(selectedWord, \{ lookupReturned \}\)/);
  assert.match(lookupPath, /if \(result\) forgetDictionaryGap\(key\)[\s\S]*?if \(result\) state\.selectedWordGapNotice = ""/);
  const lookupCatch = lookupPath.slice(lookupPath.indexOf("} catch (error)"));
  assert.doesNotMatch(lookupCatch, /queueMissingDictionaryFeedback/);
});

test("Word World Rebuild uses an in-composer send control and keeps detailed results inside the game layout", () => {
  assert.match(wordNetHtml, /data-answer-mode="reconstruct">[\s\S]*?Rebuild English[\s\S]*?<\/button>/);
  assert.match(wordNetHtml, /id="wordNetReconstruction"[\s\S]*?aria-label="Rebuild the English sentence"/);
  assert.match(wordNetHtml, /id="wordNetReconstructionAnswer"[\s\S]*?aria-label="Your English sentence"/);
  assert.match(wordNetHtml, /id="wordNetReconstructionAnswer"[^>]*aria-describedby="wordNetInstructions"/);
  assert.match(wordNetHtml, /id="wordNetReconstructionBank"[\s\S]*?aria-label="English word choices"/);
  const resultMarkupStart = wordNetHtml.indexOf('id="wordNetReconstructionResult"');
  const feedbackMarkupStart = wordNetHtml.indexOf('<div class="word-net-feedback">', resultMarkupStart);
  const resultMarkup = wordNetHtml.slice(resultMarkupStart, feedbackMarkupStart);
  assert.doesNotMatch(resultMarkup, /wordNetReportToggle/);
  assert.match(wordNetHtml.slice(feedbackMarkupStart), /class="word-net-feedback">\s*<button class="word-net-report-toggle" id="wordNetReportToggle"[^>]*hidden>Report this sentence<\/button>/);
  assert.match(wordNetHtml, /class="word-net-reconstruction-composer">[\s\S]*?id="wordNetReconstructionAnswer"[\s\S]*?id="wordNetReconstructionActions"[^>]*hidden>[\s\S]*?id="wordNetReconstructionSubmit"[^>]*aria-label="Submit answer"[^>]*disabled>[\s\S]*?class="word-net-reconstruction-submit-symbol"[^>]*>&#10148;<\/span>/);
  assert.doesNotMatch(wordNetHtml, /class="word-net-feedback">[\s\S]*?id="wordNetReconstructionActions"/);
  assert.doesNotMatch(wordNetHtml, /id="wordNetReconstructionNext"/);
  assert.doesNotMatch(wordNetJs, /wordNetReconstructionNext/);
  assert.doesNotMatch(wordNetCss, /wordNetReconstructionNext/);
  assert.doesNotMatch(wordNetHtml, /wordNetReconstructionPrompt|Tap the words in order to rebuild the English sentence/);
  assert.match(wordNetHtml, /class="word-net-reconstruction-composer"[\s\S]*?class="word-net-reconstruction-language"[^>]*>EN<\/span>[\s\S]*?id="wordNetReconstructionAnswer"/);
  assert.match(wordNetHtml, /class="word-net-status-panel"[\s\S]*?id="wordNetInstructions"[\s\S]*?id="wordNetStatus"[^>]*hidden/);
  assert.doesNotMatch(wordNetHtml, /wordNetReconstructionSkip|>Skip<\/button>|Check answer/);
  assert.doesNotMatch(wordNetHtml, /Your sentence appears here|word-net-reconstruction-placeholder/);
  assert.doesNotMatch(wordNetJs, /Your sentence appears here|word-net-reconstruction-placeholder/);
  assert.doesNotMatch(wordNetCss, /word-net-reconstruction-placeholder/);
  assert.match(wordNetHtml, /id="wordNetReconstructionPlay"[\s\S]*?<section class="word-net-reconstruction-result" id="wordNetReconstructionResult"[^>]*hidden>[\s\S]*?id="wordNetReconstructionResultPoints"[\s\S]*?id="wordNetReconstructionResultAttempt"[\s\S]*?id="wordNetReconstructionResultCorrect"[\s\S]*?class="word-net-visually-hidden" id="wordNetReconstructionStatus"/);
  assert.doesNotMatch(wordNetHtml, /<dialog[^>]*wordNetReconstructionResult|wordNetReconstructionResultImage|wordNetReconstructionResultScene|aria-modal="true"[^>]*wordNetReconstructionResult/);
  assert.match(wordNetJs, /reconstruct: \{ label: "Rebuild", delayMs: null \}/);
  assert.match(wordNetJs, /"timer-0": \{ label: "0s", delayMs: 0 \}/);
  assert.match(wordNetJs, /buildWordReconstructionChallenge\([\s\S]*?distractorCount: RECONSTRUCTION_DISTRACTOR_COUNT/);
  assert.match(wordNetJs, /async function submitReconstructionChallenge\(\)[\s\S]*?isWordReconstructionCorrect/);
  assert.doesNotMatch(wordNetJs, /function revealReconstructionChallenge|Skip and reveal answer/);
  assert.match(wordNetJs, /function shouldBlockReconstructionAdvance\(\)[\s\S]*?Submit your answer before moving to the next sentence/);
  const translationModeStart = wordNetJs.indexOf("function loadTranslationMode");
  const translationModeEnd = wordNetJs.indexOf("function loadGenerationMode", translationModeStart);
  const translationModePath = wordNetJs.slice(translationModeStart, translationModeEnd);
  assert.match(translationModePath, /if \(hasTranslationMode\(value\)\) return value/);
  assert.match(translationModePath, /value === "visible" \|\| value === "off"[\s\S]*?"timer-5"/);
  assert.match(translationModePath, /return "reconstruct"/);
  assert.doesNotMatch(translationModePath, /return "visible"/);

  const resultStart = wordNetJs.indexOf("function renderReconstructionResult");
  const resultEnd = wordNetJs.indexOf("function renderReconstruction()", resultStart);
  const resultPath = wordNetJs.slice(resultStart, resultEnd);
  assert.match(resultPath, /const outcome = round\.correct \? "correct" : "incorrect"/);
  assert.match(resultPath, /if \(title\) title\.textContent = state\.currentSentence/);
  assert.doesNotMatch(resultPath, /title:\s*"(?:Correct!|Not quite|Answer revealed)"/);
  assert.match(resultPath, /points: `\+\$\{round\.awardedXp \|\| 0\} XP`[\s\S]*?points: "\+0 XP"/);
  assert.match(resultPath, /result\.dataset\.outcome = outcome/);
  assert.doesNotMatch(wordNetJs, /placeSentenceReportToggle|insideResult/);
  assert.doesNotMatch(resultPath, /You rebuilt the English sentence correctly/);
  assert.match(resultPath, /points\.classList\.add\("is-xp-awarded"\)/);
  assert.match(wordNetJs, /async function submitReconstructionChallenge\(\)[\s\S]*?guidedRound \? false : claimSentenceReward\(round\.key\)[\s\S]*?round\.awardedXp = round\.correct && rewardAvailable \? 3 : 0[\s\S]*?Correct\. 3 XP gained\.[\s\S]*?if \(!guidedRound\) \{[\s\S]*?successes: round\.correct \? 1 : 0,[\s\S]*?xp: round\.awardedXp/);
  assert.match(wordNetJs, /function awardTimedRevealXp\(\)[\s\S]*?claimSentenceReward\(\)[\s\S]*?CaatuuLearning\?\.record\("word-world", \{ xp: 1 \}\)[\s\S]*?English revealed\. \+1 XP\./);
  assert.match(wordNetJs, /function applyTranslationMode\([\s\S]*?isTimedTranslationMode\(mode\)[\s\S]*?Number\.isFinite\(delayMs\)[\s\S]*?window\.setTimeout\([\s\S]*?awardTimedRevealXp\(\)[\s\S]*?, delayMs\)/);
  assert.match(wordNetJs, /state\.translationVisible = true;[\s\S]*?syncTranslationToggle\(\);[\s\S]*?awardTimedRevealXp\(\)/);
  assert.doesNotMatch(wordNetJs, /snapshotCurrentSceneAsset|syncReconstructionResultDialog|round\.sceneAsset|wordNetReconstructionResultImage/);
  const diffStart = wordNetJs.indexOf("function renderReconstructionAttempt");
  const diffEnd = wordNetJs.indexOf("function renderReconstructionResult", diffStart);
  const diffPath = wordNetJs.slice(diffStart, diffEnd);
  assert.match(diffPath, /if \(round\.correct\)[\s\S]*?host\.textContent = sentence[\s\S]*?Your answer: \$\{sentence\} Correct\.[\s\S]*?return;/);
  assert.match(diffPath, /alignWordReconstructionAttempt\([\s\S]*?operation\.type === "missing"[\s\S]*?Replace \$\{operation\.entered\} with \$\{operation\.expected\}[\s\S]*?Add missing word[\s\S]*?Remove extra word/);
  const nextStart = wordNetJs.indexOf("function activateNextSentence");
  const nextEnd = wordNetJs.indexOf("function applyTranslationMode", nextStart);
  const nextPath = wordNetJs.slice(nextStart, nextEnd);
  assert.match(nextPath, /shouldBlockReconstructionAdvance\(\)[\s\S]*?generateFromConfiguredMode\(state\.generationMode, \{ force: true \}\)/);
  assert.match(wordNetJs, /\$\("#wordNetNext"\)\?\.addEventListener\("click", activateNextSentence\)/);
  assert.match(wordNetJs, /action === "random"[\s\S]*?activateNextSentence\(\)/);
  assert.match(wordNetJs, /function syncNextSentenceControl[\s\S]*?challengeLocked[\s\S]*?next\.disabled = state\.busy \|\| challengeLocked \|\| state\.guidedRequested[\s\S]*?is-challenge-ready[\s\S]*?"Next sentence"/);
  assert.match(wordNetJs, /const reconstructionInstruction = "Build the English sentence\. Submit, then swipe to continue\.";[\s\S]*?function syncPlayInstruction\(\)[\s\S]*?currentPlayInstruction\(\)/);
  assert.match(wordNetJs, /const answerNodes = selected\.map\(\(option\) => reconstructionTokenButton\(option, "answer"\)\)/);
  assert.doesNotMatch(wordNetJs, /word-net-reconstruction-slot|data\.reconstructionPosition/);
  const reconstructionStart = wordNetJs.indexOf("function renderReconstruction()");
  const reconstructionEnd = wordNetJs.indexOf("function stabilizeReconstructionResultViewport", reconstructionStart);
  const reconstructionPath = wordNetJs.slice(reconstructionStart, reconstructionEnd);
  assert.match(reconstructionPath, /round\.challenge\.options\.map\([\s\S]*?inAnswer: selectedIds\.has\(option\.id\)/);
  assert.doesNotMatch(reconstructionPath, /answerIsFull|locked:/);
  assert.match(reconstructionPath, /submit\.disabled = state\.busy \|\| guidedWordInteractionLocked\(\) \|\| round\.evidencePending \|\| selected\.length === 0/);
  assert.doesNotMatch(reconstructionPath, /\.filter\(\(option\) => !selectedIds\.has/);
  assert.match(reconstructionPath, /classList\.toggle\("has-reconstruction-result", Boolean\(round\?\.submitted\)\)/);
  assert.match(reconstructionPath, /actions\.hidden = true[\s\S]*?actions\.hidden = round\.submitted/);
  assert.match(wordNetJs, /round\.announcement = `Added \$\{option\.text\}\.`/);
  assert.doesNotMatch(wordNetJs, /Added \$\{option\.text\}\. \$\{round\.selectedIds\.length\} of/);
  assert.match(wordNetJs, /function animateReconstructionTransfer\([\s\S]*?prefers-reduced-motion: reduce[\s\S]*?getBoundingClientRect\(\)[\s\S]*?target\.animate\([\s\S]*?translate3d/);
  assert.match(wordNetJs, /function selectReconstructionOption\([\s\S]*?source\?\.getBoundingClientRect\(\)[\s\S]*?animateReconstructionTransfer\(id, sourceRect, "answer"/);
  assert.match(wordNetJs, /function removeReconstructionOption\([\s\S]*?source\?\.getBoundingClientRect\(\)[\s\S]*?animateReconstructionTransfer\(id, sourceRect, "bank"/);
  assert.match(wordNetJs, /\$\("#wordNetReconstructionSubmit"\)\?\.addEventListener\("click", submitReconstructionChallenge\)/);
  assert.match(wordNetJs, /function stabilizeReconstructionResultViewport\(\)[\s\S]*?const scrollTop = window\.scrollY[\s\S]*?const restoreScroll = \(\) => window\.scrollTo\(scrollLeft, scrollTop\)[\s\S]*?window\.requestAnimationFrame\(restoreScroll\)/);
  assert.doesNotMatch(wordNetJs, /wordNetReconstructionResultTitle"\)\?\.focus|focusReconstructionResult/);
  assert.match(wordNetCss, /\.word-net-reconstruction-composer,[\s\S]*?\.word-net-reconstruction-bank/);
  assert.doesNotMatch(wordNetCss, /word-net-reconstruction-slot/);
  assert.match(wordNetCss, /\.word-net-reconstruction-bank \.word-net-reconstruction-token\.is-in-answer \{[\s\S]*?opacity: 0\.34;[\s\S]*?pointer-events: none/);
  assert.doesNotMatch(wordNetCss, /\.word-net-reconstruction-bank \.word-net-reconstruction-token\.is-locked/);
  assert.match(wordNetCss, /\.word-net-reconstruction\.is-transferring \.word-net-reconstruction-token \{[\s\S]*?pointer-events: none/);
  assert.match(wordNetCss, /\.word-net-reconstruction-composer \{[\s\S]*?position: relative;[\s\S]*?padding: 7px 58px 7px 8px/);
  assert.match(wordNetCss, /\.word-net-reconstruction-submit \{[\s\S]*?width: 42px;[\s\S]*?height: 42px;[\s\S]*?border-radius: 999px;[\s\S]*?background: var\(--theme-green[\s\S]*?display: grid;[\s\S]*?place-items: center/);
  assert.match(wordNetCss, /\.word-net-reconstruction-submit-symbol \{[\s\S]*?font-size: 1\.02rem;[\s\S]*?transform: translateX\(1px\)/);
  assert.match(wordNetCss, /\.word-net-reconstruction-submit:focus-visible,[\s\S]*?outline: 3px solid var\(--theme-focus-ring/);
  assert.match(wordNetCss, /\.word-net-feedback \{[\s\S]*?inset: 0;[\s\S]*?pointer-events: none/);
  assert.match(wordNetCss, /\.word-net-feedback \.word-net-report-toggle \{[\s\S]*?bottom: 8px;[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none/);
  assert.match(wordNetCss, /\.word-net-reconstruction-actions \{[\s\S]*?position: absolute;[\s\S]*?right: 8px;[\s\S]*?bottom: 8px;[\s\S]*?display: block/);
  assert.doesNotMatch(wordNetCss, /\.word-net-feedback \.word-net-reconstruction-actions/);
  assert.doesNotMatch(wordNetCss, /\.has-reconstruction-actions \.word-net-phrase-stack/);
  assert.match(wordNetCss, /\.word-net-sentence-panel\.has-reconstruction-result #wordNetSentence \{\s*display: none;/);
  assert.match(wordNetCss, /\.word-net-sentence-panel\.has-reconstruction-result \.word-net-scene img \{\s*filter: none;/);
  assert.match(wordNetCss, /\.word-net-sentence-panel\.has-reconstruction-result \.word-net-phrase-stack \{\s*bottom: clamp\(58px, 8dvh, 72px\);/);
  assert.doesNotMatch(wordNetCss, /\.word-net-reconstruction-result > \.word-net-report-toggle/);
  assert.match(wordNetCss, /\.word-net-visually-hidden \{[\s\S]*?width: 1px[\s\S]*?clip-path: inset\(50%\)/);
  assert.match(wordNetCss, /\.word-net-sentence-panel\[data-translation-mode="reconstruct"\] \{\s*min-height: clamp\(620px, 70dvh, 720px\)/);
  assert.match(wordNetCss, /\.word-net-sentence-panel \{[\s\S]*?overflow-anchor: none;/);
  assert.match(wordNetCss, /\.word-net-reconstruction-token,[\s\S]*?min-height: 44px/);
  const resultCssStart = wordNetCss.indexOf(".word-net-reconstruction-result {");
  const resultCssEnd = wordNetCss.indexOf(".word-net-sentence-panel[data-translation-mode=\"reconstruct\"]", resultCssStart);
  const resultCssPath = wordNetCss.slice(resultCssStart, resultCssEnd);
  assert.match(resultCssPath, /width: 100%;[\s\S]*?display: grid;/);
  assert.match(resultCssPath, /padding: 10px 12px 12px/);
  assert.doesNotMatch(resultCssPath, /position: fixed|100dvw|100dvh|::backdrop|\[open\]/);
  assert.match(resultCssPath, /\.word-net-reconstruction-result-answer\.is-correct-attempt[\s\S]*?background: transparent/);
  assert.match(resultCssPath, /\.word-net-reconstruction-result-diff\.is-complete-sentence[\s\S]*?display: block/);
  assert.match(resultCssPath, /\.is-extra \.word-net-reconstruction-result-entered[\s\S]*?text-decoration: line-through/);
  assert.match(wordNetCss, /\.word-net-reconstruction-result\.is-correct[\s\S]*?\.word-net-reconstruction-result\.is-incorrect/);
  assert.match(wordNetCss, /\.word-net-reconstruction-result-points\.is-xp-awarded[\s\S]*?word-net-xp-awarded/);
  assert.match(wordNetCss, /\.word-net-side-next\.is-challenge-ready[\s\S]*?animation: word-net-next-ready/);
  assert.match(wordNetCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.word-net-side-next\.is-challenge-ready[\s\S]*?\.word-net-reconstruction-result-points\.is-xp-awarded[\s\S]*?animation: none/);
  assert.doesNotMatch(wordNetJs, /You skipped this challenge/);
});

test("Word World keeps the loading cover until the central scene image is ready", () => {
  const loaderStart = wordNetJs.indexOf("async function waitForImageLoad");
  const loaderEnd = wordNetJs.indexOf("async function renderSceneCandidate", loaderStart);
  const loaderPath = wordNetJs.slice(loaderStart, loaderEnd);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, "the real-image loader must remain inspectable");
  assert.match(loaderPath, /image\.addEventListener\("load", onLoad\)/);
  assert.match(loaderPath, /image\.addEventListener\("error", onError\)/);
  assert.match(loaderPath, /image\.removeEventListener\("load", onLoad\)/);
  assert.match(loaderPath, /image\.removeEventListener\("error", onError\)/);
  assert.match(loaderPath, /image\.decode\(\)[\s\S]*?image\.complete && image\.naturalWidth/);

  const renderStart = wordNetJs.indexOf("async function renderSceneCandidate");
  const renderEnd = wordNetJs.indexOf("async function updateSceneAsset", renderStart);
  const renderPath = wordNetJs.slice(renderStart, renderEnd);
  assert.doesNotMatch(renderPath, /new Image\(\)|\bprobe\b/);
  assert.match(wordNetJs, /const SCENE_CANDIDATE_LOAD_TIMEOUT_MS = 1200/);
  assert.match(renderPath, /performance\.now\(\) \+ SCENE_CANDIDATE_LOAD_TIMEOUT_MS/);
  assert.match(renderPath, /await waitForImageLoad\(image,/);
  assert.match(renderPath, /await waitForImageDecode\(image,/);
  assert.match(renderPath, /state\.currentSceneAsset = \{[\s\S]*?image\.currentSrc \|\| image\.src \|\| candidate\.assetPath[\s\S]*?alt: candidate\.description/);
  assert.ok(renderPath.indexOf("await waitForImageDecode(image") < renderPath.indexOf("scene.hidden = false"));
  assert.ok(renderPath.indexOf("await waitForImageDecode(image") < renderPath.indexOf("state.currentSceneAsset ="));
  assert.doesNotMatch(renderPath, /sceneReady|dataset\.sceneReady/);

  const updateStart = wordNetJs.indexOf("async function updateSceneAsset");
  const updateEnd = wordNetJs.indexOf("function isAbortError", updateStart);
  const updatePath = wordNetJs.slice(updateStart, updateEnd);
  assert.match(wordNetJs, /const SCENE_SEMANTIC_SEARCH_TIMEOUT_MS = 1600/);
  assert.match(wordNetJs, /const SCENE_CANDIDATE_SEARCH_TIMEOUT_MS = 3600/);
  assert.match(updatePath, /rankedSceneCandidates\(englishText\)[\s\S]*?SCENE_CANDIDATE_SEARCH_TIMEOUT_MS/);
  assert.match(updatePath, /const fallbackBudget = [^;]+/);
  assert.match(updatePath, /rankedKeymapSceneCandidates\(/);
  assert.match(updatePath, /sceneDelay\(fallbackBudget, \[\]\)/);
  assert.doesNotMatch(wordNetCss, /data-scene-ready/);
  assert.match(wordNetCss, /\.word-net-loading \{[\s\S]*?background: var\(--theme-panel-raised, #ffffff\)/);

  const rankingStart = wordNetJs.indexOf("async function rankedSceneCandidates");
  const rankingEnd = wordNetJs.indexOf("function englishSceneTokens", rankingStart);
  const rankingPath = wordNetJs.slice(rankingStart, rankingEnd);
  assert.match(wordNetJs, /const SCENE_KEYMAP_SEARCH_TIMEOUT_MS = 1800/);
  assert.match(rankingPath, /const \[semanticRows, keymapRows\] = await Promise\.all/);
  assert.match(rankingPath, /semanticSceneCandidates\(text\)[\s\S]*?rankedKeymapSceneCandidates\(text\)/);
  assert.match(rankingPath, /sceneDelay\(SCENE_KEYMAP_SEARCH_TIMEOUT_MS, \[\]\)/);
  assert.match(rankingPath, /\[\.\.\.semanticRows, \.\.\.keymapRows\]/);

  const robotStart = wordNetJs.indexOf("async function showLoadingRobot");
  const robotEnd = wordNetJs.indexOf("async function holdSentenceTransition", robotStart);
  const robotPath = wordNetJs.slice(robotStart, robotEnd);
  assert.match(robotPath, /image\.addEventListener\("load", loadHandler\)/);
  assert.match(robotPath, /image\.removeEventListener\("load", loadHandler\)/);
  assert.doesNotMatch(robotPath, /image\.onload\s*=/);

  for (const [startMarker, endMarker] of [
    ["async function restoreSavedGenerativePhraseAtInit", "function wordNetPrompt"],
    ["async function showStandardPhrase", "function takeQueuedRandomCandidate"],
    ["async function showPreviousSentence", "function rememberSeenSentence"]
  ]) {
    const start = wordNetJs.indexOf(startMarker);
    const end = wordNetJs.indexOf(endMarker, start);
    const transitionPath = wordNetJs.slice(start, end);
    assert.ok(start >= 0 && end > start, `${startMarker} must remain inspectable`);
    assert.match(transitionPath, /updateSceneAsset\(/);
    assert.ok(
      transitionPath.indexOf("hideSceneAsset({ cancel: true })") < transitionPath.indexOf("setBusy(true)"),
      `${startMarker} must clear the previous scene before showing the loading cover`
    );
    assert.match(transitionPath, /await Promise\.all\(\[holdSentenceTransition\(transitionStartedAt\), (?:sceneReady|updateSceneAsset\(sceneText\))\]\)/);
    assert.ok(
      transitionPath.indexOf("await Promise.all") < transitionPath.lastIndexOf("setBusy(false)"),
      `${startMarker} must await the scene before removing the loading cover`
    );
  }

  const preparedStart = wordNetJs.indexOf("async function showPreparedPhrase");
  const preparedEnd = wordNetJs.indexOf("function freshSeedWord", preparedStart);
  assert.match(wordNetJs.slice(preparedStart, preparedEnd), /await updateSceneAsset\(sceneText\)/);
  assert.match(wordNetJs, /async function presentPreparedCandidate[\s\S]*?if \(requestId === state\.phraseRequestId\) setBusy\(false\)/);
  assert.match(wordNetJs, /generateStandardFromConfiguredMode\("random", \{ allowBusy: true \}\)/);
  assert.match(wordNetJs, /catch \(error\) \{\s*if \(!state\.busy\) setBusy\(true\);\s*await presentPreparedCandidate/);
});
