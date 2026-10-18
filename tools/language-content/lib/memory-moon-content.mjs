import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMoonTargetReading } from '../../../apps/language-runtime/static/source/games/memory-moon/memory-moon-reading.mjs';

export const MEMORY_MOON_SCHEMA = 'caatuu-memory-moon-content-v1';
export const MEMORY_MOON_CONTRAST_KINDS = Object.freeze([
  'action', 'object', 'subject', 'number', 'time', 'location', 'polarity',
  'quantity', 'possession', 'comparison', 'reason', 'condition', 'sequence',
  'purpose', 'manner', 'state'
]);
const rootDefault = fileURLToPath(new URL('../../../', import.meta.url));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const normalized = value => String(value ?? '').normalize('NFC').toLocaleLowerCase('en')
  .replace(/[\p{P}\p{Z}\s]+/gu, ' ').trim();
const englishBase = locale => /^en(?:-|$)/u.test(locale || '');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const kindSet = new Set(MEMORY_MOON_CONTRAST_KINDS);
const english = value => nonempty(value) && !/[\p{Script=Arabic}\p{Script=Han}\p{Script=Georgian}\p{Script=Cyrillic}\p{Script=Devanagari}]/u.test(value);

/** Structural and language-role checks; linguistic equivalence still needs review. */
export function validateMemoryMoonContent(document, { course } = {}) {
  const issues = [];
  const check = (condition, where, message) => { if (!condition) issues.push(`${where}: ${message}`); };
  const text = (value, where) => check(nonempty(value), where, 'must be nonempty authored text');
  check(document && typeof document === 'object' && !Array.isArray(document), 'content', 'must be an object');
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error(issues.join('\n'));
  check(document.schemaVersion === MEMORY_MOON_SCHEMA, 'schemaVersion', `must be ${MEMORY_MOON_SCHEMA}`);
  check(document.gameId === 'memory-moon', 'gameId', 'must be memory-moon');
  check(idPattern.test(document.courseId || ''), 'courseId', 'must be a course ID');
  text(document.contentId, 'contentId');
  check(Number.isSafeInteger(document.contentRevision) && document.contentRevision > 0, 'contentRevision', 'must be a positive integer');
  for (const key of ['learnerBaseLanguage', 'targetLanguage']) text(document[key], key);
  check(document.englishAuditLanguage === 'en', 'englishAuditLanguage', 'must remain en');
  check(document.embeddingPolicy?.inputLanguage === 'en' && document.embeddingPolicy?.inputField === 'embeddingText',
    'embeddingPolicy', 'must use English embeddingText');
  check(document.status === 'machine-assisted-preview', 'status', 'v1 authoring must disclose its preview status');
  check(document.review?.status === 'native-review-required' && document.review?.humanApproved === false,
    'review', 'must preserve outstanding independent native review');
  text(document.review?.reviewer, 'review.reviewer');
  text(document.review?.notes, 'review.notes');
  check(/^\d{4}-\d{2}-\d{2}$/u.test(document.review?.reviewedAt || ''), 'review.reviewedAt', 'must be an ISO author-review date');
  check(document.license?.origin === 'caatuu-first-party-authored' && document.license?.spdxExpression === 'AGPL-3.0-only',
    'license', 'must retain the first-party origin and project license');
  if (course) {
    check(document.courseId === course.id, 'courseId', 'does not match its owning course');
    check(document.learnerBaseLanguage === course.sourceLanguage.locale, 'learnerBaseLanguage', 'does not match the course learner base');
    check(document.targetLanguage === course.targetLanguage.locale, 'targetLanguage', 'does not match the course target');
  }
  const challenges = Array.isArray(document.challenges) ? document.challenges : [];
  check(challenges.length > 0, 'challenges', 'must contain authored questions');
  const ids = new Set(), prompts = new Set(), meanings = new Set();
  const levels = new Map([[1, 0], [2, 0], [3, 0]]);
  for (const [index, item] of challenges.entries()) {
    const where = `challenges[${index}] (${item?.id || 'missing ID'})`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) { check(false, where, 'must be an object'); continue; }
    const mandarin = /^zh(?:-|$)/u.test(document.targetLanguage);
    check(item.targetReading === undefined || mandarin, `${where}.targetReading`, 'pinyin belongs only to Mandarin content');
    try { validateMoonTargetReading(item.targetReading, item.targetText, { required: mandarin }); }
    catch (failure) { check(false, `${where}.targetReading`, failure.message); }
    check(idPattern.test(item.id || '') && item.id.startsWith(`mm-${document.courseId}-`) && !ids.has(item.id), `${where}.id`, 'must be a unique course-scoped stable ID');
    ids.add(item.id);
    check(Number.isSafeInteger(item.revision) && item.revision > 0, `${where}.revision`, 'must be a positive integer');
    check(levels.has(item.difficulty), `${where}.difficulty`, 'must be one of 1, 2, 3');
    if (levels.has(item.difficulty)) levels.set(item.difficulty, levels.get(item.difficulty) + 1);
    for (const key of ['usefulness', 'complexity']) check(Number.isInteger(item[key]) && item[key] >= 1 && item[key] <= 100,
      `${where}.${key}`, 'must be an authored integer from 1 through 100');
    for (const key of ['targetText', 'learnerBaseText', 'englishText', 'embeddingText', 'topic']) text(item[key], `${where}.${key}`);
    check(idPattern.test(item.familyId || '') && item.familyId.startsWith(`mm-${document.courseId}-`), `${where}.familyId`, 'must name a course-scoped semantic family');
    check(english(item.englishText) && english(item.embeddingText), `${where}.englishText`, 'must contain English audit/retrieval text');
    check(item.embeddingText === item.englishText, `${where}.embeddingText`, 'must equal the authored English meaning, never target or learner-base text');
    check(!prompts.has(normalized(item.targetText)), `${where}.targetText`, 'duplicates an existing prompt');
    check(!meanings.has(normalized(item.englishText)), `${where}.englishText`, 'duplicates an existing meaning');
    prompts.add(normalized(item.targetText)); meanings.add(normalized(item.englishText));
    const script = { ar: /\p{Script=Arabic}/u, zh: /\p{Script=Han}/u, ka: /\p{Script=Georgian}/u }[document.targetLanguage?.split('-')[0]];
    if (script) check(script.test(item.targetText), `${where}.targetText`, 'must contain the target writing system');
    check(kindSet.has(item.focus?.kind), `${where}.focus.kind`, 'must declare a supported contrast');
    check(Array.isArray(item.focus?.englishConcepts) && item.focus.englishConcepts.length > 0
      && item.focus.englishConcepts.every(english), `${where}.focus.englishConcepts`, 'must contain English retrieval concepts');
    const choices = Array.isArray(item.choices) ? item.choices : [];
    check(choices.length === 3, `${where}.choices`, 'must contain exactly three authored alternatives');
    const choiceIds = new Set(), visible = new Set(), audit = new Set();
    for (const [choiceIndex, choice] of choices.entries()) {
      const at = `${where}.choices[${choiceIndex}]`;
      if (!choice || typeof choice !== 'object') { check(false, at, 'must be an object'); continue; }
      check(idPattern.test(choice.id || '') && !choiceIds.has(choice.id), `${at}.id`, 'must be a unique choice ID');
      choiceIds.add(choice.id);
      text(choice.text, `${at}.text`);
      check(english(choice.englishAuditText), `${at}.englishAuditText`, 'must retain an English meaning');
      check(!visible.has(normalized(choice.text)), `${at}.text`, 'duplicates another visible choice');
      check(!audit.has(normalized(choice.englishAuditText)), `${at}.englishAuditText`, 'duplicates another choice meaning');
      visible.add(normalized(choice.text)); audit.add(normalized(choice.englishAuditText));
      if (englishBase(document.learnerBaseLanguage)) check(choice.text === choice.englishAuditText, `${at}.text`, 'must use the declared English learner base');
      else check(normalized(choice.text) !== normalized(choice.englishAuditText), `${at}.text`, 'must retain its non-English learner-base realization');
      if (choice.id !== item.correctChoiceId) {
        check(kindSet.has(choice.contrast?.kind), `${at}.contrast.kind`, 'must declare the changed meaning');
        check(english(choice.contrast?.explanation), `${at}.contrast.explanation`, 'must explain why this is not the translation');
      }
    }
    const correct = choices.find(choice => choice?.id === item.correctChoiceId);
    check(correct && correct.text === item.learnerBaseText && correct.englishAuditText === item.englishText,
      `${where}.correctChoiceId`, 'must select the authored learner-base translation and English meaning');
    if (englishBase(document.learnerBaseLanguage)) check(item.learnerBaseText === item.englishText, `${where}.learnerBaseText`, 'must equal the English translation');
    else check(normalized(item.learnerBaseText) !== normalized(item.englishText), `${where}.learnerBaseText`, 'must retain the non-English learner-base realization');
    if (englishBase(document.targetLanguage)) check(item.targetText === item.englishText, `${where}.targetText`, 'must equal the English target meaning');
    check(!Object.hasOwn(item, 'sourceReference'), where, 'must own its learning content rather than depend on another game');
  }
  for (const [level, count] of levels) check(count >= 6, `difficulty ${level}`, 'needs at least six distinct questions to fill a moon');
  if (issues.length) throw new Error(`Invalid Memory Moon content:\n${issues.join('\n')}`);
  return document;
}

export function memoryMoonContentSummary(document) {
  validateMemoryMoonContent(document);
  return { courseId: document.courseId, challenges: document.challenges.length,
    choices: document.challenges.reduce((sum, item) => sum + item.choices.length, 0),
    difficulty: Object.fromEntries([1, 2, 3].map(level => [level, document.challenges.filter(item => item.difficulty === level).length])),
    topics: [...new Set(document.challenges.map(item => item.topic))].sort(),
    families: new Set(document.challenges.map(item => item.familyId)).size,
    contrasts: [...new Set(document.challenges.map(item => item.focus.kind))].sort(),
    review: document.review.status };
}

export async function loadMemoryMoonCatalogs({ repositoryRoot = rootDefault, courseId = null } = {}) {
  const root = await realpath(path.resolve(repositoryRoot));
  const read = async relative => {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.posix.isAbsolute(relative)
      || relative.split('/').some(part => !part || part === '.' || part === '..') || path.posix.normalize(relative) !== relative) {
      throw new Error('Memory Moon catalog paths must be confined repository-relative paths.');
    }
    const lexical = path.resolve(root, ...relative.split('/'));
    const inside = path.relative(root, lexical);
    if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
      throw new Error(`${relative} escapes the canonical repository.`);
    }
    const real = await realpath(lexical);
    if (real !== lexical) throw new Error(`${relative} is not at its canonical repository location.`);
    return JSON.parse(await readFile(real, 'utf8'));
  };
  const catalog = await read('apps/languages/catalog.json');
  if (!Array.isArray(catalog.courses)) throw new Error('The registered course catalog needs a courses array.');
  const seen = new Set();
  for (const entry of catalog.courses) {
    if (!entry || typeof entry.id !== 'string' || !idPattern.test(entry.id) || seen.has(entry.id)) {
      throw new Error('Memory Moon needs unique registered course IDs.');
    }
    seen.add(entry.id);
  }
  const selected = catalog.courses.filter(entry => !courseId || entry.id === courseId);
  if (!selected.length) throw new Error(`Unknown Memory Moon course ${courseId}.`);
  const result = [];
  for (const entry of selected) {
    const course = await read(entry.manifest);
    if (course.id !== entry.id || typeof course.directoryName !== 'string' || !idPattern.test(course.directoryName)
      || entry.manifest !== `apps/languages/${course.directoryName}/course.json`) {
      throw new Error(`${entry.id}: the manifest must match its canonical course identity and directory.`);
    }
    const expected = `apps/languages/${course.directoryName}/static/data/games/memory-moon/content.json`;
    const resource = course.resources?.memoryMoonCatalog;
    if (resource?.path !== expected || resource?.kind !== 'file' || resource?.scope !== 'course' || resource?.state !== 'present') {
      throw new Error(`${course.id}.resources.memoryMoonCatalog must declare the present course-owned ${expected}.`);
    }
    const document = validateMemoryMoonContent(await read(expected), { course });
    result.push({ course, path: expected, document });
  }
  return result;
}
