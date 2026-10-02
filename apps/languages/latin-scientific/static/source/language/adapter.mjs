import { LANGUAGE_ADAPTER_SCHEMA_VERSION, defineLanguageAdapter } from "/language-runtime/contract.mjs";

const contentText = value => typeof value === "string" || typeof value === "number" ? String(value) : String(value?.text ?? value?.form ?? value?.surface ?? value?.answer ?? "");
const normalizeText = value => contentText(value).normalize("NFC").replace(/\p{Cf}/gu, "").trim();
// Quantity distinctions can mark case or meaning (e.g. puella / puellā).
// Search tolerates omitted macrons; grammatical assessment preserves them.
const answerKey = value => normalizeText(value).toLowerCase().replace(/\s+/gu, " ");
const searchKey = value => answerKey(value).normalize("NFD").replace(/\u0304/gu, "").normalize("NFC").replaceAll("æ", "ae").replaceAll("œ", "oe");
const dictionaryText = value => typeof value === "string" || typeof value === "number" ? normalizeText(value) : "";

export const latinScientificLanguageAdapter = defineLanguageAdapter({
  schemaVersion: LANGUAGE_ADAPTER_SCHEMA_VERSION, id: "latin-scientific", direction: "ltr",
  languageTags: { primary: "la", locale: "la", html: "la", fallbacks: ["la"] },
  normalization: { text: normalizeText, searchKey, answerKey },
  segmentation: { strategy: "computed", segment(value) {
    return [...normalizeText(value).matchAll(/[\p{L}\p{M}]+|[\p{N}]+|[^\s]/gu)].map(([text]) => ({type:/^[\p{L}\p{M}\p{N}]/u.test(text)?"word":"punctuation",text}));
  } },
  learner: { requiresAuthoredPronunciation: false,
    display(value) { return {text:normalizeText(value),languageTag:"la",direction:"ltr"}; }, pronunciation() { return null; } },
  answers: { variants(value) { return [contentText(value), ...[value?.acceptedAnswers,value?.accepted,value?.variants].flatMap(items=>Array.isArray(items)?items:[]).map(contentText)].filter(Boolean); } },
  speech: {
    input: {languageTag:"la",recognize:null,config(){return {languageTag:"la",continuous:false,interimResults:false,maxAlternatives:1};}},
    output: {languageTag:"la",speak:null,config(){return {languageTag:"la",rate:0.8,pitch:1,volume:1};},
      prepare(value){const text=normalizeText(value);if(!text)throw new TypeError("Latin text must be non-empty.");if(text.length>1000)throw new RangeError("Latin text exceeds 1,000 characters.");return text;}}
  },
  dictionary: { lookupKey(value){return searchKey(value).replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu,"");}, presentEntry(value,context={}) {
    const record=value&&typeof value==="object"?value:{};
    const base=String(context.sourceLanguageId??context.course?.sourceLanguage?.id??"");
    return {targetText:dictionaryText(record.targetText??record.target??record.text??record.surface??record.headword??record.word??value),englishAuditText:dictionaryText(record.englishAuditText??record.englishText??record.english??record.en??record.definition??(/^en(?:-|$)/u.test(base)?record.source:undefined)),pronunciation:null,category:dictionaryText(record.category),partOfSpeech:dictionaryText(record.partOfSpeech??record.kind),exampleTargetText:dictionaryText(record.exampleTargetText??record.example?.target),usageNote:dictionaryText(record.usageNote??record.note)};
  },lookup:null,search:null }
});
export default latinScientificLanguageAdapter;
