import { LANGUAGE_ADAPTER_SCHEMA_VERSION, defineLanguageAdapter } from '/language-runtime/contract.mjs';

const contentText = value => typeof value === 'string' || typeof value === 'number' ? String(value) : String(value?.text ?? value?.form ?? value?.surface ?? value?.answer ?? '');
const normalizeText = value => contentText(value).normalize('NFC').replace(/\p{Cf}/gu, '').trim();
// Mtavruli headings and Mkhedruli text denote the same letters. Distinct
// consonants (e.g. კ / ქ and ტ / თ) remain distinct in search and assessment.
const answerKey = value => normalizeText(value).toLocaleLowerCase('ka').replace(/\s+/gu, ' ');
const dictionaryText = value => typeof value === 'string' || typeof value === 'number' ? normalizeText(value) : '';

export const georgianLanguageAdapter = defineLanguageAdapter({
  schemaVersion: LANGUAGE_ADAPTER_SCHEMA_VERSION, id: 'georgian', direction: 'ltr',
  languageTags: {primary:'ka', locale:'ka', html:'ka', fallbacks:['ka-GE']},
  normalization: {text:normalizeText, searchKey:answerKey, answerKey},
  segmentation: {strategy:'computed', segment(value) {
    return [...normalizeText(value).matchAll(/[\p{L}\p{M}]+|[\p{N}]+|[^\s]/gu)].map(([text]) => ({type:/^[\p{L}\p{M}\p{N}]/u.test(text)?'word':'punctuation',text}));
  }},
  learner: {requiresAuthoredPronunciation:false,
    display(value) {return {text:normalizeText(value),languageTag:'ka',direction:'ltr'};}, pronunciation(){return null;}},
  answers: {variants(value) {return [contentText(value), ...[value?.acceptedAnswers,value?.accepted,value?.variants].flatMap(items=>Array.isArray(items)?items:[]).map(contentText)].filter(Boolean);}},
  speech: {
    input: {languageTag:'ka-GE',recognize:null,config(){return {languageTag:'ka-GE',continuous:false,interimResults:false,maxAlternatives:1};}},
    output: {languageTag:'ka-GE',speak:null,config(){return {languageTag:'ka-GE',rate:.8,pitch:1,volume:1};},prepare(value){const text=normalizeText(value);if(!text)throw new TypeError('Georgian text must be non-empty.');if(text.length>1000)throw new RangeError('Georgian text exceeds 1,000 characters.');return text;}}
  },
  dictionary: {lookupKey(value){return answerKey(value).replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu,'');},presentEntry(value,context={}) {
    const record=value&&typeof value==='object'?value:{};
    const base=String(context.sourceLanguageId??context.course?.sourceLanguage?.id??'');
    return {targetText:dictionaryText(record.targetText??record.target??record.text??record.surface??record.headword??record.word??value),englishAuditText:dictionaryText(record.englishAuditText??record.englishText??record.english??record.en??record.definition??(/^en(?:-|$)/u.test(base)?record.source:undefined)),pronunciation:null,category:dictionaryText(record.category),partOfSpeech:dictionaryText(record.partOfSpeech??record.kind),exampleTargetText:dictionaryText(record.exampleTargetText??record.example?.target),usageNote:dictionaryText(record.usageNote??record.note)};
  },lookup:null,search:null}
});
export default georgianLanguageAdapter;
