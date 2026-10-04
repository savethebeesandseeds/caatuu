import { defineTargetContentPolicy } from './contract.mjs';

export const GEORGIAN_CONTENT_POLICY_ID = 'georgian-v1';
export const georgianContentPolicy = defineTargetContentPolicy({
  id: GEORGIAN_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    const add = (code, message) => issues.push({code, message});
    if (catalog?.courseId !== 'ka' || catalog?.targetLanguage?.languageTag !== 'ka'
      || catalog?.targetLanguage?.speechLocale !== 'ka-GE' || catalog?.targetLanguage?.script !== 'Geor') {
      add('georgian.locale', 'Modern Georgian requires course/language ka, speech locale ka-GE and script Geor.');
    }
    if (catalog?.tokenization?.method !== 'authored-word-tokens' || catalog?.tokenization?.characterFallbackAllowed !== false) {
      add('georgian.tokenization', 'Georgian uses authored orthographic words; case endings and postpositions stay attached.');
    }
    const text = (value, label) => {
      if (typeof value !== 'string' || !value.trim()) return;
      if (/\p{Cf}/u.test(value) || !/[ა-ჰ]/u.test(value)
        || [...value].some(c => /\p{L}/u.test(c) && !/[ა-ჰ]/u.test(c))) {
        add('georgian.script', `${label} must use modern Mkhedruli without hidden controls or mixed scripts.`);
      }
    };
    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      text(realization.text, `realizations[${index}].text`);
      if (realization.pronunciation !== null) add('georgian.pronunciation', 'No approved Georgian pronunciation guide is supplied.');
      for (const token of realization.tokens ?? []) {
        text(token.surface, `realizations[${index}].token`);
        if (token.pronunciation !== null || Object.hasOwn(token, 'readingUnits')) add('georgian.pronunciation', 'Letters and orthographic words are not an approved pronunciation guide.');
      }
    }
    return issues;
  }
});
