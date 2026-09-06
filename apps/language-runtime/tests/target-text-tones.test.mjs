import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { appendTargetToneText, targetTextToneNumber } from "../static/source/target-text-tones.mjs";

const token = (...units) => ({
  surface: units.map(([surface]) => surface).join(""),
  units: units.map(([surface, notation]) => ({ surface, notation }))
});
const reading = (...tokens) => ({ system: "pinyin", tokens });
function render(text, guide, prefix = "") {
  const { document } = createBrowserHarness();
  const element = document.createElement("button");
  if (prefix) element.append(prefix);
  const colored = appendTargetToneText(document, element, text, guide);
  return { element, colored, tones: element.children.map((node) => [node.textContent, node.dataset.tone]) };
}

test("tone numbers match marked, numbered, decomposed, and neutral pinyin", () => {
  for (const [notation, expected] of [
    ["xū", 1], ["lái", 2], ["xiǎng", 3], ["yào", 4], ["huan", 5],
    ["lü4", 4], ["ma5", 5], ["LǙ", 3], ["n\u030c", 3], ["ḿ", 2],
    ["", 5], [null, 5], ["unknown", 5]
  ]) assert.equal(targetTextToneNumber(notation), expected, notation);
});

test("multi-character Chinese words color each supplied syllable separately", () => {
  const result = render("需要", reading(token(["需", "xū"], ["要", "yào"])));
  assert.equal(result.colored, true);
  assert.equal(result.element.textContent, "需要");
  assert.deepEqual(result.tones, [["需", "1"], ["要", "4"]]);
  assert.ok(result.element.children.every((node) => node.className === "caatuu-target-tone"));
});

test("sentence spaces, punctuation, and text without readings remain exact and plain", () => {
  const text = " 你好， 未知的 words! 谢谢。\n";
  const result = render(text, reading(
    token(["你", "nǐ"], ["好", "hǎo"]),
    token(["谢", "xiè"], ["谢", "xie"])
  ), "Prefix: ");
  assert.equal(result.element.textContent, `Prefix: ${text}`);
  assert.deepEqual(result.tones, [["你", "3"], ["好", "3"], ["谢", "4"], ["谢", "5"]]);
  assert.equal(result.element.children.length, 4);
});

test("repeated polyphonic characters use their sequential contextual readings", () => {
  const result = render("银行，行。", reading(
    token(["银", "yín"], ["行", "háng"]), token(["行", "xíng"])
  ));
  assert.equal(result.element.textContent, "银行，行。");
  assert.deepEqual(result.tones, [["银", "2"], ["行", "2"], ["行", "2"]]);
  const differentTones = render("好，好。", reading(token(["好", "hǎo"]), token(["好", "hào"])));
  assert.deepEqual(differentTones.tones, [["好", "3"], ["好", "4"]]);
});

test("missing or malformed guides fall back atomically to plain text", () => {
  const validToken = token(["你", "nǐ"], ["好", "hǎo"]);
  const cases = [
    undefined, null, {}, { system: "romaji", tokens: [validToken] }, reading(),
    reading(null), reading({ surface: "你好", units: [] }),
    reading({ surface: "你好", units: [{ surface: "你", notation: "nǐ" }] }),
    reading(token(["你好", "nǐhǎo"])), reading(token(["你", "nǐ"], ["好", ""])),
    reading(token(["你", 3], ["好", "hǎo"])), reading(token(["你", "<script>"], ["好", "hǎo"])),
    reading(validToken, token(["再", "zài"])),
    reading(token(["好", "hǎo"]), token(["你", "nǐ"]))
  ];
  for (const guide of cases) {
    const result = render("你好", guide);
    assert.equal(result.colored, false);
    assert.equal(result.element.textContent, "你好");
    assert.deepEqual(result.tones, []);
  }
});

test("literal markup is text and supplementary Unicode characters remain intact", () => {
  const result = render('<img src="x">𠮷!', reading(token(["𠮷", "jí"])));
  assert.equal(result.element.textContent, '<img src="x">𠮷!');
  assert.deepEqual(result.tones, [["𠮷", "2"]]);
  assert.ok(result.element.children.every((node) => node.tagName === "SPAN"));
});
