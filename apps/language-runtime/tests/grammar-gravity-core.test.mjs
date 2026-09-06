import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createInterfaceContent } from "../static/source/interface-content.mjs";
import { buildGrammarGravityRounds, validateGrammarGravityCategories, normalizeGrammarGravityPack } from "../static/source/games/grammar-gravity/grammar-gravity-core.mjs";
import { mountGrammarFlight } from "../static/source/games/grammar-gravity/adjective-flight-host.mjs";
async function json(url) { return JSON.parse(await readFile(url,"utf8")); }

async function mountSequence({ language = "spanish", nounReady = true, phraseFails = false, deferPhrase = false,
  distinctAudit = false, requestedPractice = "", invalidContent = false } = {}) {
  const spanishBase = language === "english-from-spanish";
  const course = { id: spanishBase ? "es-en" : language === "czech" ? "cz" : "es", routePrefix: spanishBase ? "/es-en" : language === "czech" ? "/cz" : "/es",
    sourceLanguage: { id: spanishBase ? "es" : "en", locale: spanishBase ? "es-ES" : "en" },
    targetLanguage: { id: spanishBase ? "en" : language === "czech" ? "cs" : "es", locale: spanishBase ? "en-US" : language === "czech" ? "cs-CZ" : "es-ES", label: spanishBase ? "English" : language === "czech" ? "Czech" : "Spanish" },
    capabilities: { speech: true } };
  const browser = createBrowserHarness({ course });
  const markup = await readFile(new URL("../static/games/grammar-gravity.html", import.meta.url), "utf8");
  const stack = [browser.document.body];
  const voidTags = new Set(["img", "input", "br", "hr", "source", "wbr"]);
  for (const token of /<main\b[\s\S]*?<\/main>/u.exec(markup)[0].match(/<!--[^]*?-->|<[^>]+>|[^<]+/gu)) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (!token.startsWith("<")) { stack.at(-1).append(token); continue; }
    const [, tag, attributes] = /^<([\w-]+)\b([^]*)>$/u.exec(token);
    const node = browser.document.createElement(tag);
    for (const [, name, value] of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) node.setAttribute(name, value ?? "");
    stack.at(-1).append(node);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
  const shell = createBrowserHarness().window;
  shell.document.documentElement.dataset.grammarGravityPractice = requestedPractice;
  const catalog = await json(new URL(`../static/data/interface/${spanishBase ? "es" : "en"}.v1.json`, import.meta.url));
  shell.CaatuuI18n = createInterfaceContent(catalog);
  const records = [];
  const messages = [];
  let difficulty = 1;
  shell.CaatuuLearning = { difficulty: () => difficulty, record: (id, delta) => records.push({ id, ...delta }) };
  shell.postMessage = (message) => messages.push(message);
  const noun = { options: null, resumes: 0, destroys: 0, nexts: 0, active: true, durationMs: null, icons: null,
    ready: () => nounReady,
    setActive(value) { noun.active = value; },
    resumeSegment() { noun.resumes += 1; },
    setDurationMs(value) { noun.durationMs = value; },
    setIconsVisible(value) { noun.icons = value; },
    next() { noun.nexts += 1; },
    destroy() { noun.destroys += 1; } };
  const controls = { options: null, destroys: 0 };
  const frames = new Map();
  const errors = [];
  let frameId = 0;
  let now = 0;
  let finishPhrase;
  const content = await json(new URL(`../../languages/${language}/static/data/games/grammar-gravity/challenges.json`, import.meta.url));
  const nounContent = await json(new URL(`../../languages/${language}/static/data/games/grammar-gravity/nouns.json`, import.meta.url));
  noun.snapshot = () => nounReady ? { lanes: nounContent.lanes } : null;
  if (distinctAudit && !Array.isArray(content)) {
    course.id = "fr-es";
    course.routePrefix = "/fr-es";
    course.sourceLanguage = { id: "fr", locale: "fr-FR" };
    content.courseId = course.id;
    content.contentId = "fr-es.adjective-flight.fixture";
    content.learnerBaseLanguage = "fr-FR";
    for (const challenge of content.challenges) {
      for (const form of Object.values(challenge.forms)) {
        form.examples.forEach((example) => {
          example.learnerBaseText = "sens français " + example.id;
          example.englishAuditText = "Audit-only marker " + example.id;
          if (example.anchor) {
            example.anchor.learnerBaseText = "nom français " + example.id;
            example.anchor.englishAuditText = "Audit-only noun " + example.id;
          }
        });
      }
    }
  }
  if (invalidContent) delete content.gameplay;
  Object.assign(browser.context, {
    parent: shell,
    addEventListener: browser.window.addEventListener,
    removeEventListener: browser.window.removeEventListener,
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    buildGrammarGravityRounds, validateGrammarGravityCategories, normalizeGrammarGravityPack, mountGrammarFlight, mountRobotLoadingScreen,
    readEmbeddedCourseProfile: () => course,
    fetchDeclaredCourseGameJson: async () => {
      if (deferPhrase) await new Promise((resolve) => { finishPhrase = resolve; });
      if (phraseFails) throw new Error("phrase unavailable");
      return { document: content };
    },
    mountNounLanding: async (options) => { noun.options = options; return noun; },
    mountEmbeddedGameControls: (options) => { controls.options = options; return { destroy() { controls.destroys += 1; } }; },
    console: { error: (...args) => errors.push(args) }
  });
  const source = (await readFile(new URL("../static/source/games/grammar-gravity/grammar-gravity-host.mjs", import.meta.url), "utf8"))
    .replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["'];\r?\n/gmu, "")
    .replace(/\bexport /gu, "")
    .replace(/\nif \(typeof document !== "undefined"\) \{[\s\S]*$/u, "");
  vm.runInContext(source, browser.context);
  const mounting = vm.runInContext("mountGrammarGravity()", browser.context);
  let controller;
  if (deferPhrase) { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
  else controller = await mounting;
  const state = vm.runInContext("state", browser.context);
  const element = (id) => browser.document.getElementById(id);
  const timingChoice = (value = 10000) => element("gravityFallDurationChoices").querySelectorAll("input")
    .find((input) => input.value === String(value));
  function frame(time) {
    assert.equal(frames.size, 1);
    now = time;
    const [id, callback] = [...frames][0];
    frames.delete(id);
    callback(time);
  }
  function advance(milliseconds) {
    frame(now);
    for (let remaining = milliseconds; remaining > 0;) {
      const delta = Math.min(remaining, 1000);
      frame(now + delta);
      remaining -= delta;
    }
  }
  function chooseMode(value) {
    const input=element("gravityPracticeModeChoices").querySelectorAll("input").find(input=>input.value===value);
    input.checked=true; input.dispatchEvent({type:"change"});
  }
  function answerStage(correct = true) {
    const snapshot=state.adjectiveGame.snapshot(), flight=snapshot.current;
    if(snapshot.phase === "preview") advance(4000);
    const field=snapshot.step === "meaning" ? "nounMeaning" : snapshot.step === "category" ? "grammarCategory" : "grammarForm";
    const answer=snapshot.step === "meaning" ? flight.anchorMeaning : snapshot.step === "category" ? flight.categoryId : flight.answer;
    const button=element("gravityAdjectiveChoices").querySelectorAll("button").find(button=>(button.dataset[field]===answer)===correct);
    assert.ok(button); assert.equal(button.disabled,false); button.focus(); button.click();
    advance(180); advance(correct ? 900 : 3600);
  }
  function completeRound() {
    for(const step of [...state.adjectiveGame.snapshot().steps]) { assert.equal(state.adjectiveGame.snapshot().step,step); answerStage(); }
    if (state.practiceMode === "meaning") return;
    assert.equal(state.adjectiveGame.snapshot().phase,"recap");
    element("gravityAdjectiveNext").click();
  }
  return { ...browser, get controller() { return controller; }, state, shell, noun, controls, records, messages, errors,
    frames, frame, advance, answerStage, completeRound, chooseMode, element, timingChoice,
    setDifficulty(value) {
      difficulty = value;
      shell.dispatchEvent({ type: "caatuu:learning-change", detail: { reason: "difficulty" } });
    },
    async finishPhrase() { finishPhrase?.(); controller = await mounting; } };
}


for (const language of ["czech","spanish","english-from-spanish"]) {
  test(`${language} renders all three modern stages and reports stable evidence`,async()=>{
    const game=await mountSequence({language});
    assert.deepEqual(game.errors,[]);
    assert.equal(game.controller.ready(),true);
    assert.equal(game.state.mode,"phrases");
    assert.equal(game.noun.active,false);
    assert.deepEqual(game.state.adjectiveGame.snapshot().steps,["meaning","category","form"]);
    for(const id of ["grammarGravityBoard","grammarGravityLearnerBaseOptions","grammarGravityTargetOptions","grammarGravityFooter"])assert.equal(game.element(id),null);
    const first=game.state.rounds[0];
    game.completeRound();
    assert.equal(game.state.index,1);
    assert.equal(game.messages.length,1);
    assert.equal(game.messages[0].evidence.challengeId,first.challengeId);
    assert.deepEqual(Array.from(game.messages[0].evidence.exampleIds),[first.id]);
    assert.equal(game.records.filter(record=>record.attempts===1).length,1);
    assert.equal(game.records.filter(record=>record.rounds===1).length,1);
    assert.equal(game.state.adjectiveGame.snapshot().step,"meaning");
    game.controller.destroy();
    assert.equal(game.frames.size,0);
    assert.equal(game.noun.destroys,1);
    assert.equal(game.controls.destroys,1);
  });
}

test("Spanish interface loads before deferred content and no substitute game starts",async()=>{
  const game=await mountSequence({language:"english-from-spanish",deferPhrase:true});
  assert.equal(game.document.documentElement.lang,"es-ES");
  for(const region of game.document.querySelectorAll('[data-i18n-aria-label="games.grammargravity.title"]'))assert.equal(region.getAttribute("aria-label"),"Gravedad gramatical");
  assert.equal(game.noun.active,false);
  assert.equal(game.element("grammarGravityNounMode").hidden,true);
  await game.finishPhrase();
  assert.equal(game.controller.ready(),true);
  assert.equal(game.state.adjectiveGame.snapshot().step,"meaning");
  game.controller.destroy();
});

for(const failure of [{phraseFails:true},{invalidContent:true},{nounReady:false},{requestedPractice:"legacy"},{requestedPractice:"adjectives"}]) {
  test(`invalid sequence stays visibly unavailable: ${JSON.stringify(failure)}`,async()=>{
    const game=await mountSequence(failure);
    assert.equal(game.controller.ready(),false);
    assert.equal(game.state.mode,"phrases");
    assert.equal(game.element("grammarGravityError").hidden,false);
    assert.ok(game.element("grammarGravityErrorCopy").textContent.trim());
    assert.equal(game.noun.active,false);
    assert.equal(game.element("gravityAdjectiveMode").hidden,true);
    assert.equal(game.errors.length,1);
    game.controller.destroy();
  });
}

test("explicit noun practice continues independently and its controls affect both renderers",async()=>{
  const game=await mountSequence({requestedPractice:"nouns"});
  assert.equal(game.state.mode,"nouns");
  assert.equal(game.noun.active,true);
  game.noun.options.onComplete();
  assert.equal(game.noun.resumes,2);
  game.controller.next();
  assert.equal(game.noun.nexts,1);
  game.controls.options.illustrations.onChange(false);
  assert.equal(game.noun.icons,false);
  const infinite=game.timingChoice(0); infinite.checked=true; infinite.dispatchEvent({type:"change"});
  assert.equal(game.noun.durationMs,0);
  assert.equal(game.state.adjectiveGame.snapshot().durationMs,0);
  game.chooseMode("forms"); game.advance(900);
  assert.equal(game.state.mode,"phrases");
  assert.deepEqual(game.state.adjectiveGame.snapshot().steps,["form"]);
  assert.equal(game.state.adjectiveGame.snapshot().phase,"preview");
  game.completeRound();
  game.chooseMode("meaning");
  assert.deepEqual(game.state.adjectiveGame.snapshot().steps,["meaning"]);
  game.completeRound();
  game.controller.destroy();
});

test("an explicit noun choice remains available after a sequence error",async()=>{
  const game=await mountSequence({phraseFails:true});
  assert.equal(game.controller.ready(),false);
  game.chooseMode("nouns"); game.advance(900);
  assert.equal(game.controller.ready(),true);
  assert.equal(game.noun.active,true);
  game.noun.options.onComplete();
  assert.equal(game.noun.resumes,2);
  game.controller.destroy();
});

test("explicit noun startup remains playable when phrase loading fails",async()=>{
  const game=await mountSequence({phraseFails:true,requestedPractice:"nouns"});
  assert.equal(game.controller.ready(),true);
  assert.equal(game.state.mode,"nouns");
  assert.equal(game.noun.active,true);
  assert.equal(game.errors.length,1);
  game.noun.options.onComplete();
  assert.equal(game.noun.resumes,2);
  game.controller.destroy();
});

test("finishing a bank can reorder immutable core rounds without stopping the game",async()=>{
  const game=await mountSequence();
  const repeated=game.state.rounds.at(-1);
  game.state.index=game.state.rounds.length-1;
  vm.runInContext('enterMode("phrases")',game.context);
  game.context.buildGrammarGravityRounds=()=>Object.freeze([repeated,...game.state.rounds.filter(round=>round.id!==repeated.id)]);
  game.completeRound();
  assert.equal(game.state.index,0);
  assert.notEqual(game.state.rounds[0].id,repeated.id);
  assert.equal(game.state.adjectiveGame.snapshot().step,"meaning");
  game.controller.destroy();
});

test("mode transitions pause while inactive and changing the destination preserves menu focus",async()=>{
  const game=await mountSequence();
  game.chooseMode("nouns");
  game.advance(300);
  game.window.dispatchEvent({type:"message",origin:game.context.location.origin,source:game.shell,data:{source:"caatuu-app-shell",type:"visibility",active:false}});
  assert.equal(game.frames.size,0);
  const remaining=game.state.transitionRemaining;
  game.window.dispatchEvent({type:"message",origin:game.context.location.origin,source:game.shell,data:{source:"caatuu-app-shell",type:"visibility",active:true}});
  assert.equal(game.state.transitionRemaining,remaining);
  game.timingChoice().focus(); game.chooseMode("forms"); game.advance(900);
  assert.equal(game.state.mode,"phrases");
  assert.equal(game.state.adjectiveGame.snapshot().practiceMode,"forms");
  assert.equal(game.document.activeElement,game.timingChoice());
  game.controller.destroy();
});

test("difficulty changes replace the current modern round without skipped challenge kinds",async()=>{
  const game=await mountSequence();
  game.setDifficulty(3);
  assert.equal(new Set(game.state.rounds.map(round=>round.challengeId)).size,8);
  assert.equal(game.state.rounds.length,64);
  const determiner=game.state.rounds.findIndex(round=>round.focus.kind==="determiner");
  game.state.index=determiner;
  vm.runInContext('enterMode("phrases")',game.context);
  game.completeRound();
  assert.equal(game.errors.length,0);
  game.setDifficulty(1);
  assert.ok(game.state.rounds.every(round=>round.difficulty===1));
  assert.equal(game.state.adjectiveGame.snapshot().step,"meaning");
  game.controller.destroy();
});

test("learner meaning and English visual audit remain separate in the rendered sequence",async()=>{
  const game=await mountSequence({distinctAudit:true});
  const flight=game.state.adjectiveGame.snapshot().current;
  assert.match(flight.anchorEnglishAuditText,/Audit-only noun/u);
  assert.match(flight.anchorMeaning,/nom français/u);
  const labels=game.element("gravityAdjectiveChoices").textContent;
  assert.doesNotMatch(labels,/Audit-only/u);
  assert.ok(labels.includes(flight.anchorMeaning));
  game.controller.destroy();
});

test("destroying a deferred mount cannot revive gameplay or loading timers",async()=>{
  const game=await mountSequence({deferPhrase:true});
  game.window.dispatchEvent({type:"pagehide",persisted:false});
  await game.finishPhrase();
  assert.equal(game.controller.ready(),false);
  assert.equal(game.frames.size,0);
  assert.equal(game.noun.active,false);
  assert.equal(game.noun.destroys,1);
});
