import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const appEntry = new URL("../../../../apps/language-runtime/static/app/index.html", import.meta.url);
const launcherRoot = new URL("../../../../apps/launcher/static/", import.meta.url);
const [page, styles, gamesPage, appStyles, controller, serviceWorker, setupManifest, logoBytes, verbs] = await Promise.all([
  readFile(new URL("conjugation-comet.html", staticRoot), "utf8"),
  readFile(new URL("source/games/conjugation-comet/conjugation-comet.css", staticRoot), "utf8"),
  readFile(appEntry, "utf8"),
  readFile(new URL("../../../../apps/language-runtime/static/styles/caatuu-workspace.css", import.meta.url), "utf8"),
  readFile(new URL("source/games/conjugation-comet/conjugation-comet.js", staticRoot), "utf8"),
  readFile(new URL("setup-assets.json", staticRoot), "utf8"),
  readFile(new URL("setup-assets.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("assets/planets/conjugation-comet.png", launcherRoot)),
  readFile(new URL("data/games/conjugation-comet/verbs.json", staticRoot), "utf8").then(JSON.parse)
]);

test("Conjugation Comet preserves the Verb Nebula-derived two-column shell", () => {
  assert.match(page, /class="games-page conjugation-comet-page"/);
  assert.match(page, /class="train-tab-panel verb-match-panel conjugation-comet-panel is-active"/);
  const interstitialTag = page.match(/<section\s+class="conjugation-comet-interstitial"[^>]*>/)?.[0];
  assert.ok(interstitialTag, "the classical robot loader is present");
  assert.doesNotMatch(interstitialTag, /\shidden\b/, "the robot is visible before JavaScript initializes");
  assert.match(page, /id="conjugationCometRobot"[\s\S]*?src="\/assets\/robots\/robot%20\(1\)\.png"/);
  for (const id of [
    "verbMeaningGateBoard",
    "verbMeaningTargetColumn",
    "verbMeaningEnglishColumn",
    "verbMorphologyBoard",
    "verbMorphologyFormsColumn",
    "verbMorphologyCuesColumn"
  ]) assert.match(page, new RegExp(`id="${id}"`));
  assert.doesNotMatch(gamesPage, /id="verbMorphologyBoard"/);
  assert.doesNotMatch(appStyles, /verb-morphology|verbMorphology/);
});

test("the standalone page loads direct game data without the curriculum service", () => {
  const semantic = page.indexOf('src="source/shared/semantic-learning.js?v=semantic-learning-7"');
  const chrome = page.indexOf('src="/language-runtime/static/source/caatuu-chrome.js?v=chrome-124"');
  const game = page.indexOf('src="source/games/conjugation-comet/conjugation-comet.js?v=conjugation-comet-60"');
  assert.ok(semantic >= 0 && chrome > semantic && game > chrome);
  assert.doesNotMatch(page, /curriculum-service/);
  assert.match(controller, /const VERBS_URL = "data\/games\/conjugation-comet\/verbs\.json\?v=conjugation-comet-verbs-4"/);
  assert.doesNotMatch(controller, /CaatuuCurriculum|data\/curriculum|guided-opportunity/);
  assert.match(controller, /await waitForWindowLoad\(\);[\s\S]*?await transition\("Preparing the first challenge/);
  assert.match(controller, /async function transition\(message, action, milliseconds = 1000\)/);
  assert.match(controller, /state\.robotPath = path;[\s\S]*?robot\.src = path;[\s\S]*?await Promise\.all/);
  assert.doesNotMatch(controller, /state\.robotPath = path;\s*render\(\);/);
  assert.match(controller, /transition\("Preparing the first challenge…", prepareNextVerb, 1100\)/);
  assert.doesNotMatch(page, /id="conjugationCometInterstitialCopy"/);
  assert.match(controller, /#conjugationCometInterstitial"\)\.setAttribute\("aria-label", state\.transitionMessage\)/);
});

test("verbs.json supplies simple, complete six-form paradigms and fair English cues", () => {
  const labels = ["S1", "S2", "S3", "P1", "P2", "P3"];
  assert.equal(verbs.language, "cs");
  assert.ok(Array.isArray(verbs.verbs) && verbs.verbs.length >= 4);
  for (const verb of verbs.verbs) {
    assert.ok(verb.verb?.trim());
    assert.ok(verb.meaning?.trim());
    assert.equal(verb.forms?.length, 6, `${verb.verb} needs six forms`);
    assert.deepEqual(verb.forms.map((form) => form.label), labels);
    for (const form of verb.forms) {
      assert.ok(form.form?.trim(), `${verb.verb} ${form.label} needs a Czech form`);
      assert.ok(form.cue?.trim(), `${verb.verb} ${form.label} needs an English cue`);
      if (form.accepted !== undefined) {
        assert.ok(Array.isArray(form.accepted));
        assert.ok(form.accepted.every((accepted) => accepted?.trim()));
      }
    }
  }
  assert.doesNotMatch(controller, /FORM_KEYS|FORM_LABELS|FORM_BADGES|commonLevel/);
  assert.match(controller, /state\.exerciseForms = buildExerciseForms\(state\.current\)/);
  assert.match(controller, /formsAreEquivalent\([\s\S]*?exerciseFormForKey\(formKey\)/);
  assert.match(controller, /form\?\.accepted/);
  assert.match(controller, /conjugation-comet-cue-verb/);
  assert.match(controller, /label\.textContent = form\.label/);
  assert.match(styles, /\.conjugation-comet-cue-copy \{[\s\S]*?flex-direction: column/);
  assert.match(styles, /\.conjugation-comet-cue-label \{[\s\S]*?position: static;[\s\S]*?align-self: flex-end/);
  assert.match(page, /id="verbMorphologyLegend"/);
  assert.match(page, /id="conjugationCometUnavailable"[\s\S]*?<\/section>\s*<\/div>\s*<div\s+class="conjugation-comet-person-legend"/);
  assert.match(page, /<strong>S1:<\/strong> singular first person/);
  assert.match(page, /<strong>P3:<\/strong> plural third person/);
  assert.match(controller, /\$\("#verbMorphologyLegend"\)\.hidden = !formsVisible/);
  assert.match(styles, /\.conjugation-comet-person-legend\s*\{[\s\S]*?grid-template-columns/);
});

test("the first pilot derives a reviewed -ám family without adding JSON taxonomy", () => {
  const endings = { S1: "ám", S2: "áš", S3: "á", P1: "áme", P2: "áte", P3: "ají" };
  const matches = (verb) => Object.entries(endings).every(([label, ending]) => (
    verb.forms.find((form) => form.label === label)?.form.endsWith(ending)
  ));
  const training = verbs.verbs.filter((verb) => (
    verb.hint.startsWith("Imperfective.")
    && verb.verb.endsWith("at")
    && !verb.verb.includes(" ")
    && matches(verb)
  )).slice(0, 5);
  const transfer = verbs.verbs.find((verb) => (
    verb.hint.startsWith("Imperfective.")
    && verb.verb.endsWith("át")
    && !verb.verb.includes(" ")
    && matches(verb)
  ));
  assert.deepEqual(training.map((verb) => verb.verb), ["dělat", "hledat", "čekat", "znamenat", "volat"]);
  assert.equal(transfer?.verb, "znát");
  for (const verb of [...training, transfer]) assert.match(verb.hint, /surface family/);
  assert.doesNotMatch(JSON.stringify(verbs), /"family"|"pilot"|"challengeId"/);
  assert.match(controller, /function buildPilot\(verbs\)/);
  assert.match(controller, /state\.pilot = buildPilot\(state\.verbs\)/);
});

test("the pilot repeats one matching mechanic across a deliberate family sequence", () => {
  assert.match(controller, /state\.meaningOptions = shuffle\(\[state\.current, \.\.\.contrasts\]\)/);
  assert.match(controller, /contrasts\.length !== 3/);
  assert.match(controller, /state\.phase = "forms"/);
  assert.match(controller, /state\.queue = pilotVerbs\(\)/);
  assert.match(controller, /return state\.pilot \? \[\.\.\.state\.pilot\.training, state\.pilot\.transfer\]/);
  assert.match(controller, /state\.meaningKnown\.has\(state\.current\.verb\) \? "forms" : "meaning"/);
  assert.match(controller, /All forms matched\. You used the same family with a new verb\./);
  assert.match(controller, /P2: \{ person: "second-person plural or formal", subject: "you all \/ formal you" \}/);
  assert.doesNotMatch(controller, /state\.phase = "(?:pattern|prediction|production|transfer|complete)"/);
  assert.doesNotMatch(page, /conjugationCometLesson/);
  assert.doesNotMatch(controller, /window\.setTimeout\(startNextVerb, 1700\)/);
  assert.match(controller, /CaatuuLearning\?\.record\?\.\("conjugation-comet"/);
});

test("fresh form challenges never place a cue directly opposite its answer", () => {
  assert.match(controller, /function shuffleAwayFrom\(reference\)/);
  assert.match(controller, /candidate\.every\(\(value, index\) => value !== reference\[index\]\)/);
  assert.match(controller, /return \[\.\.\.values\.slice\(1\), values\[0\]\]/);
  assert.match(controller, /state\.cueOrder = shuffleAwayFrom\(state\.formOrder\)/);
});

test("Czech forms lead the matching board and always show two-tone subject phrases", () => {
  const czechHeading = page.indexOf('<div class="verb-match-column-heading verb-match-column-heading-cz">');
  const englishHeading = page.indexOf('<div class="verb-match-column-heading verb-match-column-heading-en">');
  const czechColumn = page.indexOf('id="verbMorphologyFormsColumn"');
  const englishColumn = page.indexOf('id="verbMorphologyCuesColumn"');
  assert.ok(czechHeading >= 0 && czechHeading < englishHeading);
  assert.ok(czechColumn >= 0 && czechColumn < englishColumn);
  assert.doesNotMatch(page, /verbMorphologySubjectButton|Show Czech subject phrases/);
  assert.doesNotMatch(controller, /CZECH_SUBJECT_STORAGE_KEY|czechSubjectPhrasesVisible|toggleCzechSubjectPhrases/);
  assert.match(controller, /function czechSubjectForForm\(form\)/);
  for (const subject of ["já", "ty", "on", "ona", "my", "vy", "oni"]) {
    assert.ok(controller.includes(`"${subject}"`), `the Czech subject map needs ${subject}`);
  }
  assert.match(controller, /function czechFormDisplay\(form\)/);
  assert.match(controller, /function createCzechFormCopy\(form\)/);
  assert.match(controller, /conjugation-comet-form-subject/);
  assert.match(controller, /conjugation-comet-form-verb/);
  assert.match(controller, /card\.copy\.replaceWith\(createCzechFormCopy\(form\)\)/);
  assert.match(controller, /speakCzech\(czechFormDisplay\(exerciseFormForKey\(key\)\)\)/);
  assert.match(styles, /\.conjugation-comet-form-subject \{[\s\S]*?color: var\(--muted\);[\s\S]*?font-weight: 800/);
  assert.match(styles, /\.conjugation-comet-form-verb \{[\s\S]*?color: var\(--ink\);[\s\S]*?font-weight: 850/);
  assert.match(styles, /\.conjugation-comet-cue-subject \{[\s\S]*?color: var\(--muted\);[\s\S]*?font-weight: 800/);
  assert.match(styles, /\.conjugation-comet-cue-verb \{[\s\S]*?color: var\(--ink\);[\s\S]*?font-weight: 850/);
  assert.match(styles, /#verbMorphologyBoard \.verb-match-column-heading-cz,[\s\S]*?#verbMorphologyFormsColumn \{[\s\S]*?grid-column: 1/);
  assert.match(styles, /#verbMorphologyBoard \.verb-match-column-heading-en,[\s\S]*?#verbMorphologyCuesColumn \{[\s\S]*?grid-column: 2/);
});

test("the single Czech meaning target is already selected and uses the Verb Nebula Macaw lookup sources", () => {
  assert.match(page, /The Czech verb is selected\. Choose its reviewed English meaning from four options\./);
  assert.doesNotMatch(controller, /meaningTargetSelected|handleMeaningTarget|data-meaning-target/);
  assert.match(controller, /window\.CaatuuRuntime\?\.vector\?\.search/);
  assert.match(controller, /sourceKinds: \["macaw_action_asset"\]/);
  assert.match(controller, /retrieveMeaningImage\(verb\.meaning\)/);
  assert.match(controller, /MACAW_KEYMAP_URL = "\/assets\/macaw\/actions\/keymaps\.json"/);
  assert.match(controller, /MACAW_FALLBACK = "\/assets\/macaw\/actions\/macaw \(71\)\.png"/);
  assert.match(controller, /function macawActionMatches\(englishMeaning, row\)/);
  assert.match(controller, /groundedVectorCandidates = vectorCandidates\.filter/);
  assert.match(controller, /conjugation-comet-meaning-target is-selected/);
  assert.match(styles, /\.conjugation-comet-meaning-macaw \{[\s\S]*?object-fit: contain/);
  assert.match(styles, /#verbMeaningTargetColumn \.conjugation-comet-meaning-target \{[\s\S]*?grid-template-rows: auto auto;[\s\S]*?row-gap: clamp\(18px, 2\.5vh, 26px\)/);
  assert.match(styles, /\.conjugation-comet-meaning-macaw \{[\s\S]*?min-height: 0;[\s\S]*?max-height: 100%/);
  assert.match(page, /id="verbMeaningHintButton"[\s\S]*?🪶/);
  assert.doesNotMatch(page, /conjugation-comet-phase-label">Meaning/);
  assert.match(controller, /meaningHintVisible: loadMeaningHintVisible\(\)/);
  assert.match(controller, /localStorage\.setItem\(MEANING_HINT_STORAGE_KEY, String\(state\.meaningHintVisible\)\)/);
  assert.match(controller, /if \(state\.meaningHintVisible\) ensureMeaningImage\(\)/);
  assert.match(controller, /const hintReady = state\.meaningHintVisible && state\.meaningImage\?\.status === "ready"/);
  assert.match(controller, /conjugation-comet-meaning-visual\$\{hintReady \? "" : " is-loading"\}/);
  assert.doesNotMatch(controller, /status: "loading",[\s\S]{0,100}assetPath: MACAW_FALLBACK/);
  assert.match(styles, /\.conjugation-comet-meaning-visual\.is-loading \{[\s\S]*?visibility: hidden/);
  assert.match(controller, /state\.meaningHintVisible \? "Hide picture clue" : "Show picture clue"/);
  assert.match(styles, /\.conjugation-comet-word-pronounce \{[\s\S]*?top: 10px;[\s\S]*?right: 10px/);
  assert.match(styles, /#verbMeaningGateFeedback \{[\s\S]*?font-weight: 400/);
});

test("controls remain usable at touch, keyboard, mobile, and reduced-motion boundaries", () => {
  assert.match(styles, /\.conjugation-comet-match-board \.verb-match-card:focus-visible[\s\S]*?outline: 3px solid/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.conjugation-comet-match-board \.verb-match-card/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none/);
  assert.match(styles, /\.conjugation-comet-match-board\[hidden\][\s\S]*?display: none/);
  assert.doesNotMatch(styles, /conjugation-comet-(?:lesson|choice|answer-input|ending-grid)/);
});

test("display controls include the shared theme and text-size menu while feedback keeps a stable full-width row", () => {
  assert.equal((page.match(/data-conjugation-display-control/g) || []).length, 2);
  assert.match(controller, /verb-toolbar-menu verb-display-menu/);
  assert.match(controller, /fontSizeOption/);
  assert.match(controller, /createDisplayOption\(\{ value: "largest", label: "Standard", kind: "size" \}\)/);
  assert.match(styles, /#verbMorphologyFooter \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-template-rows: 58px minmax\(22px, auto\)/);
  assert.match(styles, /#verbMorphologyFooter \.verb-match-note \{[\s\S]*?width: 100%;[\s\S]*?height: 58px/);
  assert.match(styles, /#verbMorphologyFooter \.verb-match-feedback \{[\s\S]*?width: 100%;[\s\S]*?min-height: 2\.6em/);
});

test("the meaning gate can switch between side-by-side and stacked 2-by-2 layouts", () => {
  assert.match(page, /id="verbMeaningLayoutButton"/);
  assert.match(page, /aria-label="Use stacked meaning layout"/);
  assert.doesNotMatch(page, /verb-match-column-heading-cz">\s*<span>Česky<\/span>/);
  assert.doesNotMatch(page, /verb-match-column-heading-en">\s*<span>English<\/span>/);
  assert.match(page, /<span>Czech forms<\/span>/);
  assert.match(page, /<span>English cues<\/span>/);
  assert.match(controller, /meaningLayout: loadMeaningLayout\(\)/);
  assert.match(controller, /state\.meaningLayout === "stacked" \? "split" : "stacked"/);
  assert.match(controller, /board\.classList\.toggle\("is-stacked-layout", stackedLayout\)/);
  assert.match(styles, /#verbMeaningGateBoard \.verb-match-control-cluster \{[\s\S]*?margin-left: auto/);
  assert.match(styles, /\.verb-match-control-cluster > \.verb-layout-button \{[\s\S]*?width: 36px;[\s\S]*?display: grid;[\s\S]*?place-items: center;[\s\S]*?padding: 0/);
  assert.match(styles, /#verbMeaningGateBoard\.is-stacked-layout \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /#verbMeaningGateBoard\.is-stacked-layout #verbMeaningEnglishColumn \{[\s\S]*?margin-top: 10px;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?grid-template-rows: repeat\(2, minmax\(58px, auto\)\);[\s\S]*?row-gap: 2px/);
  assert.match(styles, /#verbMeaningGateBoard\.is-stacked-layout:has\(\.conjugation-comet-meaning-visual\) \{[\s\S]*?minmax\(210px, auto\)/);
});

test("both stages use the established audio menu and the meaning card offers borderless replay", () => {
  assert.equal((page.match(/data-conjugation-audio-control/g) || []).length, 2);
  assert.match(controller, /verb-toolbar-menu verb-audio-menu/);
  assert.match(controller, /Speak Czech when selected/);
  assert.match(controller, /conjugationComet\.speakOnSelect\.v1/);
  assert.match(controller, /function loadSpeakOnSelect\(\)[\s\S]*?legacyTap === null \? true : legacyTap === "true"/);
  assert.match(controller, /function loadMeaningHintVisible\(\)[\s\S]*?stored === null \? true : stored === "true"/);
  assert.match(controller, /LEGACY_SPEAK_AT_START_STORAGE_KEY/);
  assert.match(controller, /conjugationAudioSpeed/);
  assert.match(controller, /conjugationAudioVoice/);
  assert.match(controller, /setSpeechPacePreference/);
  assert.match(controller, /setSpeechVoicePreference/);
  assert.match(controller, /window\.CaatuuChrome\?\.speakCzechText/);
  assert.match(controller, /createPronounceButton\(state\.current\.verb\)/);
  assert.match(controller, /function selectForm\(key\) \{[\s\S]*?if \(state\.speakOnSelect\) void speakCzech\(czechFormDisplay\(exerciseFormForKey\(key\)\)\)/);
  assert.match(controller, /function speakCurrentChallenge\(\) \{[\s\S]*?if \(!state\.speakOnSelect \|\| !state\.current\?\.verb\) return;[\s\S]*?void speakCzech\(state\.current\.verb\)/);
  assert.match(controller, /transition\("Choosing the next -ám verb…", prepareNextVerb, 1000\)[\s\S]*?\.then\(speakCurrentChallenge\)/);
  assert.match(controller, /await transition\("Preparing the first challenge…", prepareNextVerb, 1100\);[\s\S]*?speakCurrentChallenge\(\)/);
  assert.doesNotMatch(controller, /pendingSpeakAtStart|Speak when challenge starts/);
  assert.match(controller, /window\.CaatuuChrome\?\.stopCzechSpeech/);
  assert.match(controller, /window\.addEventListener\("pagehide"/);
  assert.match(styles, /\.conjugation-comet-word-pronounce \{[\s\S]*?border: 0;[\s\S]*?background: transparent/);
  assert.match(styles, /#verbMeaningGateBoard\.is-stacked-layout \.conjugation-comet-word-pronounce \{[\s\S]*?top: auto;[\s\S]*?bottom: 10px/);
  assert.match(styles, /\[data-conjugation-audio-voice-status\] \{[\s\S]*?font-size: 0\.52rem/);
});

test("the morphology feather toggles reviewed pronoun pictures beside Czech forms", () => {
  assert.match(page, /id="verbMorphologyHintButton"[\s\S]*?aria-label="Show pronoun picture clues"[\s\S]*?🪶/);
  assert.doesNotMatch(page, /id="verbMorphologyHint"/);
  assert.match(controller, /const PRONOUN_IMAGE_BASE = "\/assets\/macaw\/pronouns"/);
  assert.match(controller, /function pronounHintSprite\(form\)/);
  const spriteFiles = [
    "v1.png",
    "v2-formal-gala.png",
    "v3-costume-party.png",
    "v4-retro-vacation.png",
    "v5-chaotic-chefs.png",
    "v6-rainy-day.png",
    "v7-homemade-heroes.png",
    "v8-disco-fever.png",
    "v9-pajama-party.png",
    "v10-garden-club.png",
    "v11-steampunk-finale.png",
    "v12-chaotic-orchestra.png",
    "v13-circus-troupe.png",
    "v14-winter-festival.png"
  ];
  for (const file of spriteFiles) {
    assert.ok(controller.includes(`"${file}"`), `${file} needs a runtime sprite binding`);
    assert.ok(serviceWorker.includes(`"/assets/macaw/pronouns/${file}"`), `${file} needs offline support`);
    assert.ok(setupManifest.artifacts.some((artifact) => artifact.url === `/assets/macaw/pronouns/${file}`), `${file} needs setup support`);
  }
  assert.doesNotMatch(controller, /pronouns\/(?:i|you|he|she|we|they)\.png/);
  assert.match(controller, /cell: "S1", column: 0, row: 0/);
  assert.match(controller, /cell: "S2", column: 1, row: 0/);
  assert.match(controller, /cell: "S3-male", column: 2, row: 0/);
  assert.match(controller, /cell: "P2", column: 3, row: 0/);
  assert.match(controller, /cell: "S3-female", column: 0, row: 1/);
  assert.match(controller, /cell: "P1", column: 1, row: 1/);
  assert.match(controller, /cell: "P3", column: 2, row: 1/);
  assert.match(controller, /state\.pronounSpriteSheet = choosePronounSpriteSheet\(\)/);
  assert.match(controller, /function analyzePronounSprite\(image\)/);
  assert.match(controller, /alphaTotal \+= alpha/);
  assert.match(controller, /weightedX \+= \(x \+ 0\.5\) \* alpha/);
  assert.match(controller, /const centerX = weightedX \/ alphaTotal/);
  assert.match(controller, /function centeredCropStart\(/);
  assert.match(controller, /contentStart: paddedLeft,[\s\S]*?contentEnd: paddedRight,[\s\S]*?centerOfMass: centerX/);
  assert.match(controller, /const spriteSheet = state\.pronounSpriteSheet/);
  assert.match(controller, /loadPronounSpriteCrops\(spriteSheet\)\.then/);
  assert.match(controller, /document\.createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/);
  assert.match(controller, /image\.setAttribute\("viewBox", fallbackPronounViewBox\(sprite\)\)/);
  assert.match(controller, /image\.setAttribute\("viewBox", viewBox\)/);
  assert.match(controller, /sheet\.setAttribute\("href", `\$\{PRONOUN_IMAGE_BASE\}\/\$\{spriteSheet\}`\)/);
  assert.match(styles, /\.conjugation-comet-pronoun-hint-slot \{[\s\S]*?grid-column: 1;[\s\S]*?height: clamp\(56px, 8vw, 72px\)/);
  assert.match(styles, /\.conjugation-comet-pronoun-hint-image \{[\s\S]*?overflow: hidden/);
  assert.match(controller, /function buildExerciseForms\(verb\)/);
  assert.match(controller, /key: `\$\{key\}:he`, cue: `he \$\{predicate\}`/);
  assert.match(controller, /key: `\$\{key\}:she`, cue: `she \$\{predicate\}`/);
  assert.match(controller, /cue\.startsWith\("he "\)/);
  assert.match(controller, /function formsCanMatch\(formKey, cueKey\)/);
  assert.match(controller, /if \(formKey === cueKey\) return true/);
  assert.match(controller, /if \(genderCueKind\(form\) \|\| genderCueKind\(cue\)\) return false/);
  assert.doesNotMatch(controller, /shouldAlignGenderHint|alignGenderHintPair|animateGenderHintSwap|genderSwapInProgress|rotateY\(90deg\)/);
  assert.match(controller, /button\?\.hasAttribute\("data-meaning-option"\)/);
  assert.match(controller, /cue\.startsWith\("she "\)/);
  assert.match(controller, /state\.morphologyHintsVisible = !state\.morphologyHintsVisible/);
  assert.match(controller, /morphologyHintsVisible: loadMorphologyHintsVisible\(\)/);
  assert.match(controller, /return stored === null \? true : stored === "true"/);
  assert.match(controller, /localStorage\.setItem\(MORPHOLOGY_HINT_STORAGE_KEY, String\(state\.morphologyHintsVisible\)\)/);
  assert.match(controller, /state\.morphologyHintsVisible = !state\.morphologyHintsVisible;[\s\S]*?saveMorphologyHintsVisible\(\);[\s\S]*?renderForms\(\)/);
  assert.match(controller, /card\.row\.classList\.add\("conjugation-comet-form-row"\);[\s\S]*?card\.row\.prepend\(createPronounHintSlot\(form\)\)/);
  const cueCardBody = controller.match(/function createCueCard\(key\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(cueCardBody, /createPronounHintSlot/);
  assert.match(styles, /#verbMorphologyFormsColumn \.conjugation-comet-form-row:has\(\.conjugation-comet-pronoun-hint-slot:not\(\[hidden\]\)\)/);
  assert.doesNotMatch(styles, /#verbMorphologyCuesColumn \.conjugation-comet-cue-row:has\(\.conjugation-comet-pronoun-hint-slot/);
  assert.match(styles, /width: clamp\(56px, 8vw, 72px\)/);
  assert.match(styles, /\.conjugation-comet-cue-label \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?rgba\(184, 78, 69, 0\.68\)/);
  assert.match(styles, /#verbMorphologyCuesColumn \{[\s\S]*?grid-column: 1/);
  assert.match(styles, /#verbMorphologyFormsColumn \{[\s\S]*?grid-column: 2/);
  assert.match(controller, /Match each Czech form to its English cue\./);
});

test("revealed solutions animate Czech forms into aligned rows, draw short arrows, and advance automatically", () => {
  const revealBody = controller.match(/function revealAnswers\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(revealBody, /state\.revealed = true/);
  assert.match(revealBody, /state\.formOrder = \[\.\.\.state\.cueOrder\]/);
  assert.match(revealBody, /animateFormsIntoPairs\(previousPositions\)/);
  assert.match(controller, /dataset\.solutionLabel = form\.label/);
  assert.match(controller, /classList\.toggle\("is-solution-mode", state\.revealed\)/);
  assert.match(page, /id="verbMorphologySolutionArrows" class="verb-solution-arrows"/);
  assert.match(page, /id="verbMorphologySolutionArrowhead"/);
  assert.match(controller, /function renderMorphologySolutionArrows\(\)/);
  assert.match(controller, /marker-end", "url\(#verbMorphologySolutionArrowhead\)"/);
  assert.match(controller, /const routeData = `M \$\{startX\} \$\{startY\} L \$\{endX\} \$\{endY\}`/);
  assert.match(controller, /Review each aligned pair\./);
  assert.match(controller, /scheduleNextVerb\(state\.revealed \? solutionRevealDuration\(formCount\) : COMPLETED_ROUND_HOLD_MILLIS\)/);
  assert.doesNotMatch(page, /id="verbMorphologyNextButton"/);
  assert.match(styles, /#verbMorphologyBoard\.is-solution-mode \.verb-match-card\.is-solution/);
  assert.match(styles, /content: attr\(data-solution-label\)/);
  assert.match(styles, /\.conjugation-comet-person-legend-list li \{[\s\S]*?font-weight: 400/);
});

test("the offline shell pins the game, verb data, and logo together", () => {
  for (const asset of [
    "./conjugation-comet.html",
    "./source/games/conjugation-comet/conjugation-comet.css?v=conjugation-comet-46",
    "./source/games/conjugation-comet/conjugation-comet.js?v=conjugation-comet-60",
    "./data/games/conjugation-comet/verbs.json?v=conjugation-comet-verbs-4",
    "/assets/macaw/actions/keymaps.json",
    "/assets/macaw/actions/macaw%20(1).png",
    "/assets/planets/conjugation-comet.png"
  ]) assert.ok(serviceWorker.includes(`"${asset}"`), `service worker must precache ${asset}`);
});

test("browser setup and Android packaging share the exact reviewed logo", () => {
  const artifact = setupManifest.artifacts.find((entry) => entry.key === "planet-conjugation");
  assert.equal(artifact.url, "/assets/planets/conjugation-comet.png");
  assert.equal(logoBytes.byteLength, artifact.bytes);
  assert.equal(createHash("sha256").update(logoBytes).digest("hex"), artifact.sha256);
});
