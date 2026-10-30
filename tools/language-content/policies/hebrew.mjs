import { defineTargetContentPolicy } from './contract.mjs';

export const HEBREW_CONTENT_POLICY_ID = 'hebrew-v1';
const HEBREW_LETTER = /[\u05D0-\u05EA]/u;
const ALLOWED_MARK = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C7]/u;

export const hebrewContentPolicy = defineTargetContentPolicy({
  id: HEBREW_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    const add = (code, message) => issues.push({ code, message });
    if (catalog?.courseId !== 'he' || catalog?.targetLanguage?.languageTag !== 'he'
      || catalog?.targetLanguage?.speechLocale !== 'he-IL' || catalog?.targetLanguage?.script !== 'Hebr') {
      add('hebrew.locale', 'Hebrew requires course/language he, speech locale he-IL and script Hebr.');
    }
    if (catalog?.tokenization?.method !== 'authored-word-tokens' || catalog?.tokenization?.characterFallbackAllowed !== false) {
      add('hebrew.tokenization', 'Hebrew uses authored orthographic words; articles and endings stay attached.');
    }
    const text = (value, label) => {
      if (typeof value !== 'string' || !value.trim()) return;
      const normalized = value.normalize('NFC');
      if (/\p{Cf}/u.test(normalized) || !HEBREW_LETTER.test(normalized)) {
        add('hebrew.script', `${label} must use Hebrew letters without hidden controls.`);
        return;
      }
      for (const char of normalized) {
        if (HEBREW_LETTER.test(char) || ALLOWED_MARK.test(char)) continue;
        if (/\p{M}/u.test(char) || /\p{L}/u.test(char)) {
          add('hebrew.script', `${label} must use modern Hebrew and niqqud, without cantillation or another script.`);
          return;
        }
      }
    };
    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      text(realization.text, `realizations[${index}].text`);
      if (realization.pronunciation !== null) add('hebrew.pronunciation', 'No approved Hebrew pronunciation guide is supplied.');
      for (const token of realization.tokens ?? []) {
        text(token.surface, `realizations[${index}].token`);
        if (token.pronunciation !== null || Object.hasOwn(token, 'readingUnits')) add('hebrew.pronunciation', 'Letters and orthographic words are not an approved pronunciation guide.');
      }
    }
    return issues;
  }
});
