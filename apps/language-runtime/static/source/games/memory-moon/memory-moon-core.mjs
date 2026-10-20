import { normalizeSharedEnglishText } from '../../english-image-search.mjs?v=english-image-search-5';
import { learnerItemState } from '../../learner-state.mjs';
import { validateMoonTargetReading } from './memory-moon-reading.mjs';

export const MEMORY_MOON_GAME = 'memory-moon';
export const MEMORY_MOON_BANK = 'translations';
export const MEMORY_MOON_DIRECTION = 'recognize-translation';
export const MEMORY_MOON_ROUND_COUNT = 3;
const bounded = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const text = value => typeof value === 'string' && value.trim().length > 0;
const normalized = value => String(value ?? '').normalize('NFC').trim().toLocaleLowerCase('en');
const kinds = new Set(['action','object','subject','number','time','location','polarity','quantity',
  'possession','comparison','reason','condition','sequence','purpose','manner','state']);
const DAY = 86400000;
const key = identity => JSON.stringify([identity.courseId, identity.gameId, identity.bankId, identity.itemId]);
const fail = message => { throw new TypeError(`Invalid Memory Moon content: ${message}`); };

/** Runtime language roles mirror the authoring contract; no Node authoring tools ship. */
export function validateMemoryMoonCatalog(pack, { course } = {}) {
  if (pack?.schemaVersion !== 'caatuu-memory-moon-content-v1' || pack.gameId !== MEMORY_MOON_GAME
      || !text(pack.courseId) || !Array.isArray(pack.challenges) || !pack.challenges.length
      || pack.englishAuditLanguage !== 'en' || pack.embeddingPolicy?.inputLanguage !== 'en'
      || pack.embeddingPolicy?.inputField !== 'embeddingText') fail('unsupported catalog or embedding language');
  if (course && (pack.courseId !== course.id || pack.targetLanguage !== course.targetLanguage?.locale
      || pack.learnerBaseLanguage !== course.sourceLanguage?.locale)) fail('catalog belongs to another course');
  const ids = new Set();
  for (const item of pack.challenges) {
    if (!text(item?.id) || item.id.length > 256 || !item.id.startsWith(`mm-${pack.courseId}-`) || ids.has(item.id)
        || !Number.isSafeInteger(item.revision) || item.revision < 1 || ![0,1,2,3].includes(item.difficulty)
        || !text(item.targetText) || !text(item.learnerBaseText) || !text(item.familyId) || !text(item.topic)
        || !kinds.has(item.focus?.kind) || !Array.isArray(item.focus?.englishConcepts)
        || !item.focus.englishConcepts.length || item.focus.englishConcepts.some(value => !text(value))) fail(item?.id || 'question');
    if (['usefulness','complexity'].some(field => !Number.isInteger(item[field]) || item[field] < 1 || item[field] > 100)) fail(`${item.id} grades`);
    const mandarin = /^zh(?:-|$)/u.test(pack.targetLanguage);
    if (item.targetReading !== undefined && !mandarin) fail(`${item.id} reading language`);
    validateMoonTargetReading(item.targetReading, item.targetText, { required: mandarin });
    if (normalizeSharedEnglishText(item.englishText) !== item.englishText || item.embeddingText !== item.englishText) fail(`${item.id} English meaning`);
    if (!Array.isArray(item.choices) || item.choices.length !== 3
        || item.choices.some(choice => !text(choice?.id) || !text(choice.text))
        || new Set(item.choices.map(choice => choice.id)).size !== 3
        || new Set(item.choices.map(choice => normalized(choice.text))).size !== 3) fail(`${item.id} choices`);
    for (const choice of item.choices) {
      normalizeSharedEnglishText(choice.englishAuditText);
      if (choice.id !== item.correctChoiceId && (!kinds.has(choice.contrast?.kind) || !text(choice.contrast?.explanation))) fail(`${item.id} contrast`);
      if (/^en(?:-|$)/u.test(pack.learnerBaseLanguage) && choice.text !== choice.englishAuditText) fail(`${item.id} learner language`);
    }
    const correct = item.choices.find(choice => choice.id === item.correctChoiceId);
    if (!correct || correct.text !== item.learnerBaseText || correct.englishAuditText !== item.englishText) fail(`${item.id} correct meaning`);
    if (new Set(item.choices.map(choice => normalized(choice.englishAuditText))).size !== 3) fail(`${item.id} duplicate choice meanings`);
    ids.add(item.id);
  }
  return pack;
}

/** Only retained error/support evidence supplies hints; an unseen topic is unknown. */
export function memoryMoonWeaknesses(items, { courseId, now = Date.now(), limit = 16 } = {}) {
  const result = [], seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.identity?.courseId !== courseId || !item.history) continue;
    try {
      const englishText = normalizeSharedEnglishText(item.text ?? item.englishText);
      const state = learnerItemState({ ...item.identity, history: { [item.identity.itemId]: item.history }, now });
      const latest = state.evidence.latestAssessment;
      const wrong = latest?.evidence === 'independent' && latest.correct === false;
      const assistedAt = Date.parse(state.evidence.lastAssistedAt) || 0;
      const independentAt = Date.parse(state.evidence.lastIndependentAt) || 0;
      const supported = state.evidenceStatus === 'supported' || item.history.lastEvidence === 'assisted'
        || (assistedAt > 0 && assistedAt > independentAt);
      if (!wrong && !supported) continue;
      const identity = state.identity, id = key(identity);
      if (seen.has(id)) continue;
      seen.add(id);
      const evidenceAt = Math.max(wrong ? Date.parse(latest.at) || 0 : 0, assistedAt);
      const freshness = Math.max(.2, Math.exp(-Math.max(0, now - evidenceAt) / (14 * DAY)));
      result.push({ identity, englishText, evidenceAt, weight: (wrong ? 2 : 1) * freshness,
        reason: wrong ? 'independent-mistake' : 'assistance' });
    } catch { /* Unresolved English or unsupported history cannot invent weakness. */ }
  }
  // Round-robin source banks before the cap prevents one busy game erasing others.
  result.sort((a,b) => b.evidenceAt - a.evidenceAt || key(a.identity).localeCompare(key(b.identity)));
  const banks = new Map();
  for (const row of result) {
    const bank = JSON.stringify([row.identity.gameId,row.identity.bankId]);
    if (!banks.has(bank)) banks.set(bank, []);
    banks.get(bank).push(row);
  }
  const selected = [];
  while (selected.length < limit) {
    let added = false;
    for (const bank of banks.values()) if (bank.length && selected.length < limit) { selected.push(bank.shift()); added = true; }
    if (!added) break;
  }
  return selected;
}

function randomUnit(random) { return Math.min(.999999999999, bounded(Number(random()))); }
export function shuffleMoonChoices(items, random = Math.random) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(randomUnit(random) * (index + 1));
    [copy[index],copy[other]] = [copy[other],copy[index]];
  }
  return copy;
}
function weightedDraw(rows, weight, random) {
  const weights = rows.map(row => Math.max(.0001, weight(row))), sum = weights.reduce((a,b) => a+b, 0);
  let mark = randomUnit(random) * sum;
  for (let index = 0; index < rows.length; index++) { mark -= weights[index]; if (mark < 0) return rows[index]; }
  return rows.at(-1);
}
function vectorFor(vectors, englishText) { return vectors instanceof Map ? vectors.get(englishText) : vectors?.[englishText]; }
export function moonCosine(left, right) {
  if (!left?.length || left.length !== right?.length) return null;
  let dot = 0, a = 0, b = 0;
  for (let index = 0; index < left.length; index++) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) return null;
    dot += left[index]*right[index]; a += left[index]**2; b += right[index]**2;
  }
  return a > 0 && b > 0 ? Math.max(-1,Math.min(1,dot/Math.sqrt(a*b))) : null;
}
const affinity = (candidate, region, vectors) => {
  if (candidate.englishText === region.englishText) return 1;
  const cosine = moonCosine(vectorFor(vectors,candidate.englishText), vectorFor(vectors,region.englishText));
  return cosine === null ? 0 : Math.max(0,(cosine-.25)/.75)**2;
};

/** Weighted draws across separate weak regions; semantic proximity is relevance, never mastery. */
export function selectMemoryMoonChallenges(pack, { difficulty = 1, weaknesses = [], vectorsByText = new Map(),
  history = {}, recentIds = [], recentFamilies = [], random = Math.random, limit = MEMORY_MOON_ROUND_COUNT, now = Date.now() } = {}) {
  validateMemoryMoonCatalog(pack);
  if (![0,1,2,3].includes(difficulty) || !Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Invalid Moon badge or round size.');
  const eligible = pack.challenges.filter(item => item.difficulty === difficulty);
  const count = Math.min(limit,eligible.length), excluded = new Set(recentIds), families = new Set(recentFamilies);
  for (const item of eligible) if (now - Date.parse(history[item.id]?.lastSeenAt) < 300000) {
    excluded.add(item.id);families.add(item.familyId);
  }
  const recentVectors = eligible.filter(item => excluded.has(item.id)).map(item => vectorFor(vectorsByText,item.englishText)).filter(Boolean);
  let available = eligible.filter(item => !excluded.has(item.id) && !families.has(item.familyId)
    && !recentVectors.some(vector => (moonCosine(vectorFor(vectorsByText,item.englishText),vector) ?? -1) > .9));
  const cooldownRelaxed = available.length < count;
  if (available.length < count) available = eligible.filter(item => !excluded.has(item.id));
  if (available.length < count) available = eligible.slice();
  const regions = [];
  for (const weak of weaknesses) {
    if (!text(weak?.englishText) || !Number.isFinite(weak.weight) || weak.weight <= 0) continue;
    if (regions.some(region => region.englishText === weak.englishText
      || (moonCosine(vectorFor(vectorsByText,region.englishText),vectorFor(vectorsByText,weak.englishText)) ?? -1) > .82)) continue;
    regions.push({ ...weak, weight: Math.min(2,weak.weight), hits: 0 });
    if (regions.length >= 8) break;
  }
  const selected = [], topicHits = new Map();
  for (let index = 0; index < count; index++) {
    let candidates = available, region = null;
    const exploration = index % 3 === 2 || randomUnit(random) < .2;
    if (!exploration) {
      const matched = regions.filter(row => candidates.some(item => affinity(item,row,vectorsByText) >= .2));
      const unused = matched.filter(row => row.hits === 0);
      if (matched.length) {
        region = weightedDraw(unused.length ? unused : matched, row => row.weight/(1+row.hits),random);
        candidates = candidates.filter(item => affinity(item,region,vectorsByText) >= .2);
      }
    }
    const chosen = weightedDraw(candidates,item => {
      const state = learnerItemState({courseId:pack.courseId,gameId:MEMORY_MOON_GAME,bankId:MEMORY_MOON_BANK,
        itemId:item.id,assessmentDirection:MEMORY_MOON_DIRECTION,history,now});
      const base = .5 + item.usefulness/200 + Number(state.review.isDue === true)*.8
        + Number(state.evidence.latestAssessment?.correct === false)*.5;
      return (base + (region ? 4*affinity(item,region,vectorsByText) : 0))/(1+(topicHits.get(item.topic)||0));
    },random);
    if (!chosen) break;
    if (region) region.hits++;
    const choices = difficulty === 0
      ? [chosen.choices.find(choice => choice.id === chosen.correctChoiceId),
        shuffleMoonChoices(chosen.choices.filter(choice => choice.id !== chosen.correctChoiceId),random)[0]]
      : chosen.choices;
    selected.push({...chosen,choices:shuffleMoonChoices(choices,random),
      selectionReason:region ? 'related-practice' : exploration && weaknesses.length ? 'exploration' : 'balanced-practice'});
    available = available.filter(item => item.id !== chosen.id && item.familyId !== chosen.familyId);
    if (available.length < count-selected.length) {
      const chosenIds = new Set(selected.map(item => item.id)), chosenFamilies = new Set(selected.map(item=>item.familyId));
      available = eligible.filter(item => !chosenIds.has(item.id) && !chosenFamilies.has(item.familyId) && !excluded.has(item.id));
      if (available.length < count-selected.length) available = eligible.filter(item => !chosenIds.has(item.id) && !excluded.has(item.id));
      if (available.length < count-selected.length) available = eligible.filter(item => !chosenIds.has(item.id));
    }
    topicHits.set(chosen.topic,(topicHits.get(chosen.topic)||0)+1);
  }
  return {items:selected,trace:{difficulty,eligibleCount:eligible.length,weaknessCount:weaknesses.length,
    regionCount:regions.length,coveredRegions:regions.filter(row => row.hits>0).length,cooldownRelaxed,
    mode:weaknesses.length ? selected.some(item=>item.selectionReason==='related-practice') ? 'weakness-guided' : 'varied-fallback'
      : Object.keys(history).length ? 'balanced-practice' : 'no-history'}};
}

export function createMoonSession(items, { target = MEMORY_MOON_ROUND_COUNT } = {}) {
  if (!Array.isArray(items) || items.length < target || !Number.isSafeInteger(target) || target < 1) throw new TypeError('A Moon needs enough questions for its target.');
  return {items:items.slice(),index:0,target,correctCount:0,independentCorrectCount:0,mistakes:0,progress:0,
    phase:'question',attempts:0,wrongChoiceIds:[],assisted:false,lastAnswer:null};
}
export function assistMoonChallenge(state, reason = 'help') {
  if (state.phase !== 'question' || state.assisted) return state;
  return {...state,assisted:true,assistanceReason:reason};
}
export function answerMoonChallenge(state, choiceId) {
  if (state.phase !== 'question' || state.wrongChoiceIds.includes(choiceId)) return state;
  const item = state.items[state.index];
  if (!item.choices.some(choice=>choice.id===choiceId)) throw new TypeError('Unknown Moon translation choice.');
  const correct = choiceId===item.correctChoiceId, correctCount = state.correctCount+Number(correct);
  return {...state,correctCount,independentCorrectCount:state.independentCorrectCount+Number(correct&&!state.assisted),
    mistakes:state.mistakes+Number(!correct),progress:correctCount/state.target,
    phase:correct ? correctCount>=state.target ? 'complete' : 'answered' : 'question',attempts:state.attempts+1,
    wrongChoiceIds:correct ? state.wrongChoiceIds : [...state.wrongChoiceIds,choiceId],
    assisted:state.assisted||!correct,lastAnswer:{choiceId,correct,assisted:state.assisted}};
}
export function advanceMoonChallenge(state) {
  if (state.phase!=='answered') return state;
  return {...state,index:state.index+1,phase:'question',attempts:0,wrongChoiceIds:[],assisted:false,lastAnswer:null,assistanceReason:null};
}
export function moonIllumination(progress) { return (1-Math.cos(Math.PI*bounded(progress)))/2; }
export function moonShadePath(progress) {
  const fraction=bounded(progress);
  if(fraction>=1)return '';
  const terminator=Math.abs(Math.cos(Math.PI*fraction))*100;
  const boundary=terminator<.000001?'L 100 0':`A ${Number(terminator.toFixed(6))} 100 0 0 ${fraction<.5?0:1} 100 0`;
  return `M 100 0 A 100 100 0 0 0 100 200 ${boundary} Z`;
}
