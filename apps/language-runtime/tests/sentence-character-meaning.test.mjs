import assert from "node:assert/strict";
import test from "node:test";
import { resolveSentenceCharacterMeaning } from "../static/source/sentence-character-meaning.mjs";

const dictionary = new Map([
  ["你", "you"],
  ["好", "good"],
  ["你好", "hello"],
  ["谢谢", "thank"],
  ["谢谢", "thank"],
  ["落在", "land on"],
  ["飘落", "float down"],
  ["说明", "explain"],
  ["明天", "tomorrow"]
]);

function meaningAt(text, tokens, surface, occurrence = 0) {
  let from = 0;
  for (let seen = 0; seen <= occurrence; seen += 1) {
    const offset = text.indexOf(surface, from);
    assert.notEqual(offset, -1, `${surface} occurs in ${text}`);
    if (seen === occurrence) {
      return resolveSentenceCharacterMeaning({ text, tokens, offset, dictionary });
    }
    from = offset + surface.length;
  }
  return null;
}

test("a character inside a word uses that word, including when the character has its own entry", () => {
  const text = "你好！";
  const tokens = [{ surface: "你好", gloss: "hello" }];
  for (const surface of ["你", "好"]) {
    const resolved = meaningAt(text, tokens, surface);
    assert.equal(resolved.surface, "你好");
    assert.equal(resolved.gloss, "hello");
    assert.deepEqual([resolved.start, resolved.end], [0, 2]);
  }
});

test("a one-character word keeps its own meaning beside a longer word", () => {
  const text = "谢谢你。";
  const tokens = [
    { surface: "谢谢", gloss: "thank" },
    { surface: "你", gloss: "you" }
  ];
  assert.equal(meaningAt(text, tokens, "谢").surface, "谢谢");
  assert.equal(meaningAt(text, tokens, "谢", 1).surface, "谢谢");
  assert.equal(meaningAt(text, tokens, "你").surface, "你");
  assert.equal(meaningAt(text, tokens, "你").gloss, "you");
});

test("the sentence word wins when both neighbors are dictionary words", () => {
  const falling = "一片羽毛轻轻飘落在草地上。";
  const fallingTokens = [
    { surface: "一片", gloss: "a" },
    { surface: "羽毛", gloss: "feather" },
    { surface: "轻轻", gloss: "gently" },
    { surface: "飘落", gloss: "float down" },
    { surface: "在", gloss: "at" },
    { surface: "草地", gloss: "grass" },
    { surface: "上", gloss: "on" }
  ];
  const landed = meaningAt(falling, fallingTokens, "落");
  assert.equal(landed.surface, "飘落");
  assert.equal(landed.gloss, "float down");

  const forecast = "天气预报说明天会晴。";
  const forecastTokens = [
    { surface: "天气预报", gloss: "weather forecast" },
    { surface: "说", gloss: "speak" },
    { surface: "明天", gloss: "tomorrow" },
    { surface: "会", gloss: "will" },
    { surface: "晴", gloss: "sunny; clear" }
  ];
  assert.equal(meaningAt(forecast, forecastTokens, "说").surface, "说");
  const tomorrow = meaningAt(forecast, forecastTokens, "明");
  assert.equal(tomorrow.surface, "明天");
  assert.equal(tomorrow.gloss, "tomorrow");
});

test("a character with no meaning grows to the next or previous character inside the sentence", () => {
  const text = "谢谢。";
  const tokens = [{ surface: "谢", gloss: "" }, { surface: "谢", gloss: "" }];
  const first = meaningAt(text, tokens, "谢");
  const second = meaningAt(text, tokens, "谢", 1);
  assert.equal(first.surface, "谢谢");
  assert.equal(first.gloss, "thank");
  assert.equal(second.surface, "谢谢");
  assert.equal(second.gloss, "thank");
});

test("growth stops at punctuation and does not search inside a spaced word", () => {
  const blocked = resolveSentenceCharacterMeaning({
    text: "你。好",
    tokens: [{ surface: "你", gloss: "" }, { surface: "好", gloss: "" }],
    offset: 0,
    dictionary
  });
  assert.equal(blocked.surface, "你");
  assert.equal(blocked.gloss, "you");

  const latin = resolveSentenceCharacterMeaning({
    text: "hello",
    tokens: [{ surface: "hello", gloss: "hello" }],
    offset: 1,
    dictionary
  });
  assert.equal(latin.surface, "hello");
  assert.equal(resolveSentenceCharacterMeaning({
    text: "hello",
    tokens: [{ surface: "hello", gloss: "" }],
    offset: 1,
    dictionary
  }), null);
});

test("the longest authored word still resolves from its first character", () => {
  const text = "图书管理员推荐一本关于太空的书。";
  const tokens = [
    { surface: "图书管理员", gloss: "librarian" },
    { surface: "推荐", gloss: "recommend" },
    { surface: "一本", gloss: "one" },
    { surface: "关于", gloss: "about" },
    { surface: "太空", gloss: "space" },
    { surface: "的", gloss: "of" },
    { surface: "书", gloss: "book" }
  ];
  const resolved = meaningAt(text, tokens, "图");
  assert.equal(resolved.surface, "图书管理员");
  assert.equal(resolved.gloss, "librarian");
  assert.equal(resolved.end - resolved.start, 5);
});
