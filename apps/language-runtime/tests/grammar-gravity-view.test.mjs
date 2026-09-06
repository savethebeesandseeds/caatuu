import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { placeGravityGameHeader } from "../static/source/games/grammar-gravity/grammar-gravity-host.mjs";

const [markup, styles, wordWorldMarkup] = await Promise.all([
  readFile(new URL("../static/games/grammar-gravity.html", import.meta.url), "utf8"),
  readFile(new URL("../static/styles/games/grammar-gravity.css", import.meta.url), "utf8"),
  readFile(new URL("../static/app/index.html", import.meta.url), "utf8")
]);

function viewDocument() {
  const { document } = createBrowserHarness();
  const source = /<main\b[\s\S]*?<\/main>/u.exec(markup)?.[0];
  assert.ok(source, "the game has a main landmark");
  const stack = [document.body];
  const voidTags = new Set(["img", "input", "br", "hr", "source", "wbr"]);
  for (const token of source.match(/<!--[^]*?-->|<[^>]+>|[^<]+/gu) || []) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (!token.startsWith("<")) { stack.at(-1).append(token); continue; }
    const [, tag, attributes] = /^<([\w-]+)\b([^]*)>$/u.exec(token);
    const element = document.createElement(tag);
    for (const [, name, value] of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) {
      element.setAttribute(name, value ?? "");
    }
    stack.at(-1).append(element);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(element);
  }
  return document;
}

function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]+)\\}`, "gu"))];
  assert.ok(matches.length, `${selector} has a maintained style contract`);
  return matches.map((match) => match[1]).join("\n");
}

test("the parachute is a small decorative attachment with reduced-motion-safe animation", () => {
  const document = viewDocument();
  const parachute = document.getElementById("gravityAdjectiveParachute");
  assert.equal(parachute.parentElement, document.getElementById("gravityAdjectiveDrop"));
  assert.equal(parachute.getAttribute("src"), "/assets/micelaneous/parashute.png");
  assert.equal(parachute.getAttribute("alt"), "");
  assert.equal(parachute.getAttribute("aria-hidden"), "true");
  assert.equal(parachute.getAttribute("draggable"), "false");
  assert.equal(parachute.hidden, true);
  assert.match(declarations(".gravity-drop-parachute"), /width:\s*clamp\(78px, 15vw, 108px\)/u);
  assert.match(declarations(".gravity-drop-parachute"), /pointer-events:\s*none/u);
  assert.match(declarations(".gravity-adjective-arena"), /--gravity-art-opacity:\s*0\.8\s*;/u);
  assert.match(declarations(".gravity-drop-parachute"), /opacity:\s*var\(--gravity-art-opacity\)/u);
  assert.match(declarations("#gravityAdjectiveVisual"), /opacity:\s*var\(--gravity-art-opacity\)/u);
  assert.match(styles, /@keyframes gravity-parachute-fold\s*\{\s*from\s*\{\s*opacity:\s*var\(--gravity-art-opacity\)/u);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.gravity-adjective-mode\s+\*[\s\S]*?animation:\s*none\s*!important/u);
});

test("first paint shows only the loading state, never the old noun board", () => {
  const document = viewDocument();
  assert.equal(document.getElementById("gravityModeLoading").hidden, false);
  for (const id of ["grammarGravityNounMode", "grammarGravityPhraseMode", "gravityNounInfo"]) {
    assert.equal(document.getElementById(id).hidden, true, id);
  }
});

test("one shared toolbar serves the automatic practice flow without tabs or manual round controls", () => {
  const document = viewDocument();
  const panel = document.getElementById("grammarGravityPanel");
  const toolbar = document.getElementById("gravityNounControls");
  const header = document.getElementById("gravityGameHeader");
  assert.equal(toolbar.parentElement, header);
  assert.equal(header.parentElement, document.getElementById("gravityNounArena"));
  assert.equal(document.getElementById("grammarGravityPhraseMode").contains(toolbar), false);
  for (const id of ["grammarGravityModeSwitcher", "grammarGravityNounModeButton", "grammarGravityPhraseModeButton",
    "gravityNounStart", "gravityNounNext", "gravityNounDrop", "gravityNounPause", "gravityNounUntimed",
    "gravityNounProgress", "gravityNounStreak", "gravityNounSummary", "gravityNounRestart", "grammarGravityNext"]) {
    assert.equal(document.getElementById(id), null, `${id} must not return to the learner's view`);
  }
  for (const id of ["gravityIllustrationsSettings", "gravityShowIllustrations"]) {
    assert.equal(document.getElementById(id), null, "the feather toggles art directly without a second control");
  }
  for (const id of ["gravityChallengeSettings"]) {
    const content = document.getElementById(id);
    assert.equal(content.parentElement, panel, "shared controls own the menu content, not either practice mode");
    assert.equal(content.hidden, true, "menu contents stay hidden until mounted in their shared popover");
  }
  const timing = document.getElementById("gravityFallDuration");
  assert.equal(timing.tagName, "FIELDSET");
  assert.equal(document.getElementById("gravityFallDurationLabel").tagName, "LEGEND");
  assert.equal(document.getElementById("gravityFallDurationLabel").parentElement, timing);
  assert.equal(document.getElementById("gravityFallDurationChoices").parentElement, timing);
  assert.equal(timing.querySelector("select"), null);
});

test("one in-arena header follows modes while keeping the same controls and the steps beneath its clock", () => {
  const document = viewDocument();
  const header = document.getElementById("gravityGameHeader");
  const toolbar = document.getElementById("gravityNounControls");
  const clock = document.getElementById("gravityNounClock");
  const progress = document.getElementById("gravityAdjectiveProgress");
  assert.equal(clock.parentElement, progress.parentElement);
  assert.deepEqual(clock.parentElement.children, [clock, progress]);
  for (const [mode, flight, target, showProgress] of [
    ["phrases", true, "gravityAdjectiveArena", true],
    ["nouns", false, "gravityNounArena", false],
    ["transition", true, "grammarGravityPanel", false],
    ["phrases", false, "grammarGravityPanel", false],
    ["phrases", true, "gravityAdjectiveArena", true]
  ]) {
    placeGravityGameHeader(mode, flight, document);
    assert.equal(header.parentElement, document.getElementById(target));
    assert.equal(header.contains(toolbar), true, "settings retain their original controls and handlers");
    assert.equal(header.contains(clock), true);
    assert.equal(progress.hidden, !showProgress);
    assert.equal(document.querySelectorAll("#gravityGameHeader").length, 1);
  }
  assert.match(declarations(".gravity-noun-header"), /z-index:\s*10\s*;/u);
  for (const selector of [".gravity-noun-arena", ".gravity-adjective-arena"]) {
    assert.match(declarations(selector), /overflow:\s*visible\s*;/u, "settings popovers must not be clipped");
  }
  assert.match(declarations(".gravity-noun-lanes"), /overflow:\s*hidden\s*;/u);
  assert.match(declarations(".gravity-header-status > .gravity-adjective-progress"), /grid-row:\s*2\s*;/u);
  assert.doesNotMatch(declarations(".gravity-adjective-progress"), /position:\s*absolute/u);
});

test("the challenge header stays compact above a vertical list of timing choices", () => {
  const header = declarations(".gravity-time-options legend");
  assert.match(header, /font-size:\s*0\.78rem\s*;/u);
  assert.match(header, /font-weight:\s*750\s*;/u);
  const choices = declarations("#gravityFallDurationChoices");
  assert.match(choices, /display:\s*grid\s*;/u);
  assert.match(choices, /grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
  assert.match(choices, /gap:\s*0\s*;/u);
  assert.match(declarations("#gravityFallDurationChoices .gravity-settings-checkbox"), /min-height:\s*32px/u);
});

test("the current journey step has a distinct green in both themes", () => {
  const current = declarations('.gravity-adjective-progress [aria-current="step"]');
  assert.match(current, /color:\s*#185c37\s*;/u);
  assert.match(current, /font-weight:\s*800\s*;/u);
  assert.match(declarations('[data-theme="dark"] .gravity-adjective-progress [aria-current="step"]'), /color:\s*#8dcda5\s*;/u);
});

test("mistakes retain a separate reddish cross without replacing the green current step", () => {
  assert.match(declarations(".gravity-adjective-mistake"), /color:\s*#b3423c\s*;/u);
  assert.match(declarations('[data-theme="dark"] .gravity-adjective-mistake'), /color:\s*#ee9990\s*;/u);
  assert.match(declarations('.gravity-adjective-progress [aria-current="step"]'), /color:\s*#185c37/u);
});

test("adjective preview is a larger centered reading card without overriding gravity positioning", () => {
  const card = declarations('.gravity-adjective-arena[data-state="preview"] .gravity-adjective-drop');
  assert.match(card, /left:\s*0\s*;/u);
  assert.match(card, /right:\s*0\s*;/u);
  assert.match(card, /margin-inline:\s*auto\s*;/u);
  assert.match(card, /width:\s*min\(420px,\s*calc\(100%\s*-\s*48px\)\)/u);
  assert.match(card, /border-radius:\s*18px\s*;/u);
  assert.doesNotMatch(card, /(?:^|;)\s*(?:transform|translate):/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="preview"] #gravityAdjectiveNoun'), /font-size:\s*clamp\(1\.35rem,\s*4\.5vw,\s*2rem\)/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="preview"] #gravityAdjectiveVisual'), /opacity:\s*0\.25/u);
});

test("the recap uses a compact gender badge and an illustration behind the phrase without a table", () => {
  const document = viewDocument();
  const recap = document.getElementById("gravityAdjectiveRecap");
  assert.equal(recap.hidden, true);
  assert.equal(document.getElementById("gravityAdjectiveDrop").contains(recap), true);
  assert.equal(document.getElementById("gravityAdjectiveRecapAnswers"), null);
  assert.equal(document.getElementById("gravityAdjectiveNext").tagName, "BUTTON");
  assert.equal(document.getElementById("gravityAdjectiveNext").disabled, true);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] .gravity-adjective-drop'), /overflow-y:\s*auto/u);
  assert.match(declarations('.gravity-adjective-next'), /min-height:\s*44px/u);
  assert.match(declarations('.gravity-adjective-next:focus-visible'), /outline:\s*3px/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] #gravityAdjectiveVisual'), /inset:\s*0 0 0 auto/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] #gravityAdjectiveVisual'), /width:\s*56%/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] #gravityAdjectiveVisual'), /object-position:\s*right center/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] #gravityAdjectiveVisual'), /opacity:\s*0\.16/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] .gravity-adjective-dock'), /z-index:\s*1/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] .gravity-adjective-context'), /border-radius:\s*999px/u);
});

test("recap typography leads with a black left-aligned phrase and keeps the ending highlight", () => {
  const phrase = declarations('.gravity-adjective-arena[data-state="recap"] #gravityAdjectiveNoun');
  assert.match(phrase, /color:\s*#171717/u);
  assert.match(phrase, /text-align:\s*left/u);
  assert.match(phrase, /padding-inline-end:\s*54px/u);
  assert.match(declarations('[data-theme="dark"] .gravity-adjective-arena[data-state="recap"] #gravityAdjectiveNoun'), /color:\s*var\(--theme-ink/u);
  assert.match(declarations('.gravity-adjective-ending'), /background:\s*color-mix/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] #gravityAdjectiveMeaning'), /font-size:\s*clamp\(0\.95rem,\s*3vw,\s*1\.1rem\)/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] #gravityAdjectiveMeaning'), /font-weight:\s*650/u);
});

test("the recap speaker is upper-right and gender sits below the translation on the right", () => {
  const speaker = declarations('.gravity-adjective-arena[data-state="recap"] .gravity-adjective-speak');
  assert.match(speaker, /position:\s*absolute/u);
  assert.match(speaker, /top:\s*0/u);
  assert.match(speaker, /right:\s*0/u);
  assert.match(speaker, /min-height:\s*44px/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] .gravity-adjective-translation'), /grid-row:\s*2/u);
  const gender = declarations('.gravity-adjective-arena[data-state="recap"] .gravity-adjective-context');
  assert.match(gender, /grid-row:\s*3/u);
  assert.match(gender, /justify-self:\s*end/u);
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] .gravity-adjective-recap'), /grid-row:\s*4/u);
});

test("the recap entrance eases in independently of gravity and respects reduced motion", () => {
  assert.match(declarations('.gravity-adjective-arena[data-state="recap"] .gravity-adjective-drop'), /animation:\s*gravity-recap-reveal 340ms/u);
  const reveal = /@keyframes gravity-recap-reveal\s*\{([\s\S]*?\n\})/u.exec(styles)?.[1];
  assert.ok(reveal);
  assert.match(reveal, /opacity:\s*0/u);
  assert.match(reveal, /scale:\s*0\.96/u);
  assert.match(reveal, /translate:\s*0 12px/u);
  assert.doesNotMatch(reveal, /\btransform:/u, "the entrance must not override the host's centered translateY");
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.gravity-adjective-mode\s+\*[\s\S]*?animation:\s*none\s*!important/u);
});

test("the adjective blank uses a single CSS underline", () => {
  assert.match(declarations('#gravityAdjectivePrompt'), /border-bottom:\s*2px solid currentColor/u);
  assert.doesNotMatch(declarations('#gravityAdjectivePrompt'), /text-decoration|content:/u);
});

test("journey art moves right, center, then left while the card keeps a clear fall path", () => {
  const art = declarations("#gravityAdjectiveVisual");
  assert.match(art, /left:\s*3%\s*;/u);
  assert.match(art, /bottom:\s*calc\(var\(--adjective-choice-height\)\s*\+\s*12px\)/u);
  assert.match(art, /object-position:\s*left bottom\s*;/u);
  assert.match(art, /pointer-events:\s*none\s*;/u);
  const meaning = declarations('.gravity-adjective-arena[data-step="meaning"] #gravityAdjectiveVisual');
  assert.match(meaning, /right:\s*3%\s*;/u);
  assert.match(meaning, /left:\s*auto\s*;/u);
  assert.match(meaning, /object-position:\s*right bottom\s*;/u);
  const meaningCard = declarations('.gravity-adjective-arena[data-step="meaning"] .gravity-adjective-drop');
  assert.match(meaningCard, /left:\s*3%\s*;/u);
  assert.match(meaningCard, /right:\s*auto\s*;/u);
  const gender = declarations('.gravity-adjective-arena[data-step="category"] #gravityAdjectiveVisual');
  for (const edge of ["top", "right", "left"]) assert.match(gender, new RegExp(`${edge}:\\s*0\\s*;`, "u"));
  assert.match(gender, /bottom:\s*var\(--adjective-choice-height\)\s*;/u);
  assert.match(gender, /margin:\s*auto\s*;/u);
  assert.match(gender, /object-position:\s*center\s*;/u);
  assert.match(gender, /opacity:\s*var\(--gravity-art-opacity\)\s*;/u);
  const genderCard = declarations('.gravity-adjective-arena[data-step="category"] .gravity-adjective-drop');
  assert.match(genderCard, /left:\s*0\s*;/u);
  assert.match(genderCard, /right:\s*0\s*;/u);
  assert.match(genderCard, /margin-inline:\s*auto\s*;/u);
  assert.doesNotMatch(genderCard, /(?:^|;)\s*(?:transform|translate):/u, "centering must not override falling or mistake motion");
  assert.match(declarations(".gravity-adjective-drop"), /right:\s*3%\s*;/u);
});

test("gender options fit decorative catalog icons beside labels and stack on narrow screens", () => {
  const choice = declarations('.gravity-adjective-arena[data-step="category"] .gravity-adjective-choice');
  assert.match(choice, /display:\s*flex\s*;/u);
  assert.match(choice, /align-items:\s*center\s*;/u);
  assert.match(choice, /justify-content:\s*center\s*;/u);
  assert.match(declarations(".gravity-adjective-choice-label"), /min-width:\s*0\s*;/u);
  const icon = declarations(".gravity-adjective-gender-icon");
  assert.match(icon, /object-fit:\s*contain\s*;/u);
  assert.match(icon, /width:\s*clamp\(26px,\s*5\.5vw,\s*40px\)/u);
  assert.match(icon, /height:\s*clamp\(26px,\s*5\.5vw,\s*40px\)/u);
  assert.match(icon, /pointer-events:\s*none\s*;/u);
  assert.match(styles, /@media\s*\(max-width:\s*400px\)[\s\S]*?\.gravity-adjective-arena\[data-step="category"\]\s*\{\s*--adjective-choice-height:\s*104px/u);
  assert.match(styles, /@media\s*\(max-width:\s*400px\)[\s\S]*?\.gravity-adjective-arena\[data-step="category"\] \.gravity-adjective-choice\s*\{\s*flex-direction:\s*column/u);
});

test("instructions remain visible in their own panel and result feedback never becomes a popup", () => {
  const document = viewDocument();
  const panel = document.getElementById("grammarGravityPanel");
  const info = document.getElementById("gravityNounInfo");
  assert.equal(info.parentElement, panel.parentElement);
  assert.equal(panel.contains(info), false);
  assert.equal(info.tagName, "FOOTER");
  assert.equal(info.hidden, true, "instructions appear when a playable mode is selected");
  assert.equal(info.querySelector("details"), null);
  assert.ok(info.contains(document.getElementById("gravityNounHelp")));
  assert.equal(info.querySelector(".gravity-info-icon").getAttribute("aria-hidden"), "true");
  for (const id of ["gravityNounResult", "gravityNounResultMark", "gravityNounInfoButton"]) {
    assert.equal(document.getElementById(id), null);
  }
  const status = document.getElementById("gravityNounFeedback");
  assert.equal(status.hidden, false, "screen readers must retain the live correction region");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.ok(status.classList.contains("gravity-visually-hidden"));
  assert.match(declarations(".gravity-visually-hidden"), /clip-path:\s*inset\(50%\)/u);
});

test("muted labels sit at the lower right of small course images on distinct paper lanes", () => {
  assert.match(declarations(".gravity-noun-lane-label"), /order:\s*0\s*;/u);
  const lane = declarations(".gravity-noun-lane");
  assert.match(lane, /flex-direction:\s*row/u);
  assert.match(lane, /align-items:\s*flex-end/u);
  assert.match(lane, /color:\s*var\(--theme-quiet/u);
  assert.match(lane, /font-weight:\s*600\s*;/u);
  assert.match(lane, /background-image:\s*url\(["']\.\/gravity-paper\.svg(?:\?[^"']*)?["']\)/u);
  assert.doesNotMatch(lane, /gradient/u);
  assert.match(declarations(".gravity-noun-arena"), /border:\s*2px\s+solid/u);
  const neutral = /--gravity-lane-tint:\s*([^;]+);/u.exec(lane)?.[1];
  const masculine = /--gravity-lane-tint:\s*([^;]+);/u.exec(declarations('.gravity-noun-lane[data-lane-id="masculine"]'))?.[1];
  const feminine = /--gravity-lane-tint:\s*([^;]+);/u.exec(declarations('.gravity-noun-lane[data-lane-id="feminine"]'))?.[1];
  assert.equal(new Set([neutral, masculine, feminine]).size, 3);
  const height = Number(/height:\s*(\d+)px/u.exec(declarations(".gravity-noun-lane-image"))?.[1]);
  assert.ok(height > 0 && height <= 70, "lane illustrations should stay secondary to the falling word");
  const hidden = declarations('.gravity-noun-mode[data-illustrations="hidden"] .gravity-noun-arena');
  assert.match(hidden, /--gravity-lane-reserve:\s*34px/u);
  const landing = declarations(".gravity-noun-lane::before");
  assert.match(landing, /height:\s*var\(--gravity-lane-reserve\)/u);
  assert.match(landing, /border-top:\s*4px\s+solid/u);
  assert.match(landing, /pointer-events:\s*none/u);
});

test("optional noun art cannot intercept answers and the clock is separate from illustration visibility", () => {
  const document = viewDocument();
  const visual = document.getElementById("gravityNounVisual");
  assert.equal(visual.tagName, "IMG");
  assert.equal(visual.hidden, true);
  assert.equal(visual.getAttribute("src"), null, "retrieval must choose the current noun image");
  assert.equal(visual.getAttribute("alt"), "");
  assert.equal(visual.getAttribute("aria-hidden"), "true");
  assert.match(declarations(".gravity-noun-visual"), /pointer-events:\s*none/u);
  assert.match(declarations(".gravity-noun-visual"), /object-fit:\s*contain/u);
  assert.match(declarations(".gravity-noun-visual"), /width:\s*min\(240px,\s*45%\)/u);
  const clock = document.getElementById("gravityNounClock");
  assert.equal(clock.getAttribute("role"), "progressbar");
  assert.equal(clock.getAttribute("aria-valuemin"), "0");
  assert.equal(clock.hidden, true, "the countdown starts only after content is ready");
  assert.ok(document.getElementById("gravityNounControls").parentElement.contains(clock));
  assert.equal(document.getElementById("gravityNounArena").contains(clock), true);
  assert.match(clock.querySelector("img").getAttribute("src"), /\/assets\/icons\/clock_icon\.png$/u);
  assert.equal(clock.querySelector("img").getAttribute("alt"), "");
  assert.match(declarations(".gravity-noun-clock img"), /transform:\s*scaleX\(-1\)\s+rotate\(var\(--gravity-clock-turn/u);
  assert.match(declarations(".gravity-clock-track > span"), /scaleX\(var\(--gravity-time-left/u);
});

test("the word card follows dictionary typography and preserves a bare accessible audio target", () => {
  assert.match(declarations("#gravityNounWord"), /justify-self:\s*center/u);
  const meaning = declarations("#gravityNounMeaning");
  assert.match(meaning, /color:\s*var\(--theme-entry-accent/u);
  assert.match(meaning, /text-align:\s*left/u);
  const speech = declarations(".gravity-noun-speak");
  assert.match(speech, /grid-column:\s*2\s*;/u);
  assert.match(speech, /width:\s*44px\s*;/u);
  assert.match(speech, /height:\s*44px\s*;/u);
  assert.match(speech, /border:\s*0\s*;/u);
  assert.match(speech, /background:\s*transparent\s*;/u);
  assert.match(declarations(".gravity-noun-block"), /min-width:\s*min\(116px,\s*calc\(100%\s*-\s*16px\)\)/u);
});

test("the shell owns viewport height while panel and arena grow around the separate information footer", () => {
  assert.match(declarations(".grammar-gravity-shell"), /display:\s*flex/u);
  assert.match(declarations(".grammar-gravity-panel"), /min-height:\s*0\s*;/u);
  assert.match(declarations(".grammar-gravity-panel"), /flex:\s*1\s*;/u);
  assert.match(declarations(".gravity-noun-mode"), /flex:\s*1\s*;/u);
  const arena = declarations(".gravity-noun-arena");
  assert.match(arena, /flex:\s*1\s*;/u);
  assert.doesNotMatch(arena, /(?:^|;)\s*height:/u, "no fixed arena height should recreate the spare footer gap");
  const embedded = declarations(".grammar-gravity-page.caatuu-embedded-shell .grammar-gravity-shell");
  assert.match(embedded, /min-height:\s*calc\(100dvh\s*-\s*24px\)/u);
  assert.doesNotMatch(declarations(".gravity-noun-info"), /position:\s*absolute/u);
});

test("all Grammar Gravity loading states use the shared text-free robot presentation", () => {
  const document = viewDocument();
  for (const id of ["gravityModeLoading", "gravityNounLoading", "grammarGravityLoading"]) {
    const loading = document.getElementById(id);
    const image = loading.querySelector("img");
    assert.equal(loading.textContent.trim(), "");
    assert.ok(loading.classList.contains("caatuu-game-robot-loading"));
    assert.ok(image.classList.contains("caatuu-game-robot-loading-art"));
    assert.ok(wordWorldMarkup.includes(image.getAttribute("src")));
    assert.equal(image.getAttribute("alt"), "");
    assert.equal(image.getAttribute("aria-hidden"), "true");
  }
  assert.doesNotMatch(styles, /gravity-(?:noun|mode)-loading|word-net-robot-breathe|grammar-gravity-loading/u);
});
