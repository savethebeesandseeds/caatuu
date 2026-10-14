import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createArabicReadingGuide } from "../static/source/arabic-reading-guide.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

function fixture(gameId = "verb-lab", browser = createBrowserHarness()) {
  const host = browser.document.createElement("button");
  const menu = browser.document.createElement("section");
  browser.document.body.append(host, menu);
  const guide = createArabicReadingGuide({ course: { id: "ar", targetLanguage: { id: "ar" } },
    gameId, document: browser.document, storage: browser.window.localStorage });
  return { ...browser, host, menu, guide };
}

test("new Arabic learners see a whole joined word with an LTR reading above it", () => {
  const { guide, host } = fixture();
  assert.equal(guide.enabled, true);
  assert.equal(guide.render(host, "كَتَبَ"), true);
  assert.equal(host.querySelectorAll("ruby").length, 1);
  assert.equal(host.querySelector(".caatuu-target-text-glyph").textContent, "كَتَبَ");
  assert.equal(host.querySelector("rt").textContent, "kataba");
  assert.equal(host.querySelector("rt").dir, "ltr");
  assert.equal(host.querySelector("rt").lang, "ar-Latn");
  assert.equal(host.querySelector("rt").getAttribute("aria-hidden"), "true");
  assert.equal(host.querySelector("[data-tone]"), null);
});

test("every game independently persists the toggle without replacing the answer button", () => {
  const f = fixture();
  f.guide.render(f.host, "كَتَبَ");
  f.host.focus();
  const toggle = f.guide.mountSetting(f.menu);
  assert.equal(f.guide.mountSetting(f.menu), toggle);
  toggle.click();
  assert.equal(f.guide.enabled, false);
  assert.equal(f.host.textContent, "كَتَبَ");
  assert.equal(f.host.querySelector("rt"), null);
  assert.equal(f.document.activeElement, f.host);
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.equal(fixture("verb-lab", f).guide.enabled, false);
  assert.equal(fixture("word-net", f).guide.enabled, true);
  toggle.click();
  assert.equal(f.host.querySelector("rt").textContent, "kataba");
});

test("sentences retain punctuation and word order; unresolved unvocalized words stay intact", () => {
  const { guide, host } = fixture();
  const text = "كَتَبَ، unknown كتاب!";
  guide.render(host, text);
  assert.equal(host.querySelectorAll("ruby").length, 1);
  guide.setEnabled(false);
  assert.equal(host.textContent, text);
});

test("colored morphology survives whole-word guides and preference changes", () => {
  const { guide, host, document } = fixture();
  const stem = document.createElement("span");
  stem.className = "stem";
  stem.textContent = "كَتَبَ";
  const ending = document.createElement("span");
  ending.className = "ending";
  ending.textContent = "تْ";
  guide.render(host, "كَتَبَتْ", { glyphs: [stem, ending] });
  assert.equal(host.querySelectorAll("ruby").length, 1);
  assert.equal(host.querySelector(".stem").textContent, "كَتَبَ");
  assert.equal(host.querySelector(".ending").textContent, "تْ");
  guide.setEnabled(false);
  assert.equal(host.textContent, "كَتَبَتْ");
  assert.equal(host.querySelector(".ending").textContent, "تْ");
  guide.setEnabled(true);
  assert.equal(host.querySelector("rt").textContent, "katabat");
});

test("unavailable storage keeps the setting usable and other courses remain untouched", () => {
  const { document, host, menu } = fixture();
  const storage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  const guide = createArabicReadingGuide({ course: { id: "ar", targetLanguage: { id: "ar" } },
    gameId: "grammar-gravity", document, storage });
  guide.render(host, "كَتَبَ");
  guide.mountSetting(menu).click();
  assert.equal(host.textContent, "كَتَبَ");
  const other = createArabicReadingGuide({ course: { id: "zh", targetLanguage: { id: "zh" } }, document });
  assert.equal(other.render(host, "كَتَبَ"), false);
  assert.equal(other.mountSetting(menu), null);
});

test("Arabic guides use the translation color and over-positioned ruby", async () => {
  const css = await readFile(new URL("../static/styles/caatuu-target-text.css", import.meta.url), "utf8");
  assert.match(css, /\.caatuu-arabic-reading-unit\s*\{[^}]*ruby-position:\s*over/u);
  assert.match(css, /\.caatuu-arabic-reading-unit > \.caatuu-target-text-notation,[^{]*\{[^}]*color:\s*var\(--theme-red/u);
});

test("changing a host's content cannot resurrect an old answer when the aid toggles", () => {
  const { guide, host } = fixture();
  guide.render(host, "كَتَبَ");
  host.textContent = "next question";
  guide.setEnabled(false);
  assert.equal(host.textContent, "next question");
  guide.render(host, "كَتَبَ");
  assert.equal(guide.render(host, ""), false);
  host.textContent = "";
  guide.setEnabled(true);
  assert.equal(host.textContent, "");
});
