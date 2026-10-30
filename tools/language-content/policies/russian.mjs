import { defineTargetContentPolicy } from './contract.mjs';

export const RUSSIAN_CONTENT_POLICY_ID = 'russian-v1';
const CYRILLIC = /[а-яёА-ЯЁ]/u;
const VOWEL = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/u;

export const russianContentPolicy = defineTargetContentPolicy({
  id: RUSSIAN_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    const add = (code, message) => issues.push({ code, message });
    if (catalog?.courseId !== 'ru' || catalog?.targetLanguage?.languageTag !== 'ru'
      || catalog?.targetLanguage?.speechLocale !== 'ru-RU' || catalog?.targetLanguage?.script !== 'Cyrl') {
      add('russian.locale', 'Russian requires course/language ru, speech locale ru-RU and script Cyrl.');
    }
    if (catalog?.tokenization?.method !== 'authored-word-tokens' || catalog?.tokenization?.characterFallbackAllowed !== false) {
      add('russian.tokenization', 'Russian uses authored orthographic words; case endings and particles stay attached.');
    }
    const text = (value, label) => {
      if (typeof value !== 'string' || !value.trim()) return;
      const normalized = value.normalize('NFC');
      if (/\p{Cf}/u.test(normalized) || !CYRILLIC.test(normalized)) {
        add('russian.script', `${label} must use modern Cyrillic without hidden controls.`);
        return;
      }
      const chars = [...normalized];
      for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        if (char === '\u0301') {
          if (!VOWEL.test(chars[index - 1] || '')) add('russian.script', `${label} may place a stress mark only on a vowel.`);
          continue;
        }
        if (/\p{M}/u.test(char) || (/\p{L}/u.test(char) && !CYRILLIC.test(char))) {
          add('russian.script', `${label} must use modern Cyrillic without mixed scripts or extra marks.`);
          return;
        }
      }
    };
    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      text(realization.text, `realizations[${index}].text`);
      if (realization.pronunciation !== null) add('russian.pronunciation', 'No approved Russian pronunciation guide is supplied.');
      for (const token of realization.tokens ?? []) {
        text(token.surface, `realizations[${index}].token`);
        if (token.pronunciation !== null || Object.hasOwn(token, 'readingUnits')) add('russian.pronunciation', 'Letters and orthographic words are not an approved pronunciation guide.');
      }
    }
    return issues;
  }
});
