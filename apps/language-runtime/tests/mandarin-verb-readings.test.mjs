import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateVerbNebulaCatalog } from "../static/source/games/verb-nebula/verb-nebula-core.mjs";
import { appendTargetToneText, targetTextToneNumber } from "../static/source/target-text-tones.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const rows = await json("../../languages/mandarin-simplified/static/data/games/verb-nebula/content.json");
const course = await json("../../languages/mandarin-simplified/course.json");
const sounds = await json("../../languages/mandarin-simplified/static/data/games/sound-quasar/content.json");
const pairs = validateVerbNebulaCatalog(rows, { learnerBaseLanguage: course.sourceLanguage.locale });
const authoredRows = rows.filter(row => row.reviewStatus !== "untranslated");
const notation = (reading) => reading.tokens.flatMap((token) => token.units.map((unit) => unit.notation)).join(" ");

function contextualReading(target, notation) {
  const syllables = notation.split(" ");
  assert.equal(syllables.length, Array.from(target).length);
  return { system: "pinyin", status: "machine-assisted-preview", tokens: [{ surface: target,
    units: Array.from(target).map((surface, index) => ({ surface, notation: syllables[index] }))
  }] };
}

function assertRenderedTones(target, reading, expectedTones) {
  const { document } = createBrowserHarness({ course });
  const element = document.createElement("span");
  assert.equal(appendTargetToneText(document, element, target, reading), true, target);
  assert.equal(element.textContent, target);
  assert.deepEqual(element.querySelectorAll(".caatuu-target-tone").map(node => Number(node.dataset.tone)), expectedTones, target);
}

test("every playable Mandarin verb has an explicit complete contextual reading", () => {
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  assert.ok(authoredRows.length > 0);
  const bandKey = row => `${row.difficulty === 0 ? "zero:" : ""}${row.target}`;
  assert.equal(new Set(authoredRows.map(bandKey)).size, authoredRows.length);
  assert.deepEqual(new Set(pairs.map((pair) => pair.id)), new Set(authoredRows.map((row) => row.id)));
  for (const row of authoredRows) {
    const reading = row.reading;
    assert.equal(reading?.system, "pinyin", row.id);
    assert.equal(reading.status, "machine-assisted-preview", row.id);
    assert.ok(Array.isArray(reading.tokens) && reading.tokens.length, row.id);
    assert.equal(reading.tokens.map((token) => token.surface).join(""), row.target, row.id);
    for (const token of reading.tokens) {
      assert.equal(token.units.map((unit) => unit.surface).join(""), token.surface, row.id);
      assert.equal(token.units.length, Array.from(token.surface).length, row.id);
      for (const unit of token.units) {
        assert.match(unit.surface, /^\p{Script=Han}$/u, row.id);
        assert.match(unit.notation, /^[\p{Script=Latin}\p{M}]+$/u, row.id);
        assert.equal(unit.notation, unit.notation.normalize("NFC"), row.id);
      }
    }
  }
});

test("the shared renderer accepts the entire verb inventory without replacing learner text", () => {
  const { document } = createBrowserHarness({ course });
  for (const row of authoredRows) {
    const copy = document.createElement("span");
    assert.equal(appendTargetToneText(document, copy, row.target, row.reading), true, row.id);
    assert.equal(copy.textContent, row.target, row.id);
    assert.equal(copy.querySelectorAll(".caatuu-target-tone").length, Array.from(row.target).length, row.id);
  }
});

test("verb senses and explicit fixtures retain contextual polyphonic readings instead of defaults", () => {
  // Dictionary checks: zdic.net/hans/{还,系,盛,钻,播种,削,熨,拧,说服,反省}.
  // These values describe the authored verb senses, not every reading of a glyph.
  const expected = new Map([
    ["还", "huán"], ["种", "zhòng"], ["倒", "dào"], ["系", "jì"],
    ["盛", "chéng"], ["数", "shǔ"], ["弹", "tán"], ["钻", "zuān"],
    ["教", "jiāo"], ["熨", "yùn"], ["拧", "níng"], ["缝", "féng"],
    ["生长", "shēng zhǎng"], ["划船", "huá chuán"], ["削皮", "xiāo pí"],
    ["播种", "bō zhǒng"], ["下载", "xià zài"], ["说服", "shuō fú"],
    ["睡觉", "shuì jiào"], ["觉得", "jué de"], ["调解", "tiáo jiě"],
    ["调查", "diào chá"], ["调整", "tiáo zhěng"], ["反省", "fǎn xǐng"],
    ["省略", "shěng lüè"], ["测量", "cè liáng"], ["称重", "chēng zhòng"],
    ["澄清", "chéng qīng"], ["躲藏", "duǒ cáng"], ["结合", "jié hé"],
    ["结冰", "jié bīng"], ["相遇", "xiāng yù"], ["假装", "jiǎ zhuāng"]
  ]);
  for (const [target, reading] of expected) {
    const row = authoredRows.find((entry) => entry.target === target);
    if (row) assert.equal(notation(row.reading), reading, `${target}: ${row.source}`);
    // Removed catalog examples remain explicit renderer fixtures, not claimed live content.
    const guide = contextualReading(target, reading);
    assertRenderedTones(target, guide, reading.split(" ").map(targetTextToneNumber));
  }
  // The same glyph must take the supplied contextual tone, never a default.
  for (const [target, reading, tones] of [
    ["种", "zhòng", [4]], ["种", "zhǒng", [3]],
    ["倒", "dào", [4]], ["倒", "dǎo", [3]],
    ["数", "shǔ", [3]], ["数", "shù", [4]],
    ["长", "zhǎng", [3]], ["长", "cháng", [2]],
    ["觉", "jiào", [4]], ["觉", "jué", [2]]
  ]) assertRenderedTones(target, contextualReading(target, reading), tones);
});

test("neutral syllables stay neutral while other syllables preserve their own tones", () => {
  for (const [target, reading, tones] of [
    ["喜欢", "xǐ huan", [3, 5]], ["谢谢", "xiè xie", [4, 5]],
    ["告诉", "gào su", [4, 5]], ["明白", "míng bai", [2, 5]],
    ["记得", "jì de", [4, 5]], ["商量", "shāng liang", [1, 5]],
    ["收拾", "shōu shi", [1, 5]], ["拿着", "ná zhe", [2, 5]],
    ["穿衣服", "chuān yī fu", [1, 1, 5]], ["需要", "xū yào", [1, 4]]
  ]) {
    const row = authoredRows.find((row) => row.target === target);
    const guide = row?.reading ?? contextualReading(target, reading);
    assert.equal(notation(guide), reading, target);
    assert.deepEqual(guide.tokens.flatMap((token) => token.units.map((unit) => targetTextToneNumber(unit.notation))), tones, target);
    assertRenderedTones(target, guide, tones);
  }
});

test("readings linked to the same authored source verb remain consistent with listening practice", () => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let matched = 0;
  for (const item of sounds.items) {
    if (item.sourceKind === "authored-listening") continue;
    const verb = byId.get(item.sourceId);
    assert.ok(verb, item.sourceId);
    assert.notEqual(verb.reviewStatus, "untranslated", verb.id);
    assert.equal(item.target, verb.target, verb.id);
    assert.ok(item.reading, verb.id);
    assert.deepEqual(verb.reading.tokens, item.reading.tokens, verb.id);
    matched += 1;
  }
  assert.ok(matched > 0, "Existing source-linked readings remain reusable");
  assert.equal(course.capabilities.pronunciationGuides, false, "Preview metadata must not promote pronunciation review capability");
  assert.ok(authoredRows.every((row) => row.reviewStatus === "native-review-required"));
});
