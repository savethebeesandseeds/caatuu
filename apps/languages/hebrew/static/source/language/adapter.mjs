import { LANGUAGE_ADAPTER_SCHEMA_VERSION, defineLanguageAdapter } from '/language-runtime/contract.mjs';

const contentText = value => typeof value === 'string' || typeof value === 'number' ? String(value) : String(value?.text ?? value?.form ?? value?.surface ?? value?.answer ?? '');
const normalizeText = value => contentText(value).normalize('NFC').replace(/\p{Cf}/gu, '').trim();
// Niqqud is a reading aid. Assessment keeps every letter, including final
// letters. Search may fold a final letter onto its regular letter.
const POINTS = /[\u0591-\u05C7]/gu;
const FINALS = Object.freeze({ '\u05DA': '\u05DB', '\u05DD': '\u05DE', '\u05DF': '\u05E0', '\u05E3': '\u05E4', '\u05E5': '\u05E6' });
const answerKey = value => normalizeText(value).replace(POINTS, '').replace(/\s+/gu, ' ');
const searchKey = value => [...answerKey(value)].map(char => FINALS[char] ?? char).join('');
const dictionaryText = value => typeof value === 'string' || typeof value === 'number' ? normalizeText(value) : '';

export const hebrewLanguageAdapter = defineLanguageAdapter({
  schemaVersion: LANGUAGE_ADAPTER_SCHEMA_VERSION, id: 'hebrew', direction: 'rtl',
  languageTags: {primary:'he', locale:'he', html:'he', fallbacks:['he-IL']},
  normalization: {text:normalizeText, searchKey, answerKey},
  segmentation: {strategy:'computed', segment(value) {
    return [...normalizeText(value).matchAll(/[\p{L}\p{M}]+|[\p{N}]+|[^\s]/gu)].map(([text]) => ({type:/^[\p{L}\p{M}\p{N}]/u.test(text)?'word':'punctuation',text}));
  }},
  learner: {requiresAuthoredPronunciation:false,
    display(value) {return {text:normalizeText(value),languageTag:'he',direction:'rtl'};}, pronunciation(){return null;}},
  answers: {variants(value) {return [contentText(value), ...[value?.acceptedAnswers,value?.accepted,value?.variants].flatMap(items=>Array.isArray(items)?items:[]).map(contentText)].filter(Boolean);}},
  speech: {
    input: {languageTag:'he-IL',recognize:null,config(){return {languageTag:'he-IL',continuous:false,interimResults:false,maxAlternatives:1};}},
    output: {languageTag:'he-IL',speak:null,config(){return {languageTag:'he-IL',rate:.8,pitch:1,volume:1};},prepare(value){const text=normalizeText(value);if(!text)throw new TypeError('Hebrew text must be non-empty.');if(text.length>1000)throw new RangeError('Hebrew text exceeds 1,000 characters.');return text;}}
  },
  dictionary: {lookupKey(value){return searchKey(value).replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu,'');},presentEntry(value,context={}) {
    const record=value&&typeof value==='object'?value:{};
    const base=String(context.sourceLanguageId??context.course?.sourceLanguage?.id??'');
    return {targetText:dictionaryText(record.targetText??record.target??record.text??record.surface??record.headword??record.word??value),englishAuditText:dictionaryText(record.englishAuditText??record.englishText??record.english??record.en??record.definition??(/^en(?:-|$)/u.test(base)?record.source:undefined)),pronunciation:null,category:dictionaryText(record.category),partOfSpeech:dictionaryText(record.partOfSpeech??record.kind),exampleTargetText:dictionaryText(record.exampleTargetText??record.example?.target),usageNote:dictionaryText(record.usageNote??record.note)};
  },lookup:null,search:null}
});
export default hebrewLanguageAdapter;
