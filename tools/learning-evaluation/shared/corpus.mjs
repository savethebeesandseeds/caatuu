import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { loadProgressionCatalogs, progressionRecords } from '../../language-content/quality/content-progression-catalogs.mjs';
import { extractCoreVerbPairs } from '../../../apps/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';
import { validateConjugationCometCatalog, buildConjugationHelixRound } from '../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import { buildRounds, buildQuestions } from '../../../apps/languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs';
import { buildGrammarGravityRounds } from '../../../apps/language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import { normalizeNounLandingPack } from '../../../apps/language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs';
import { validateSoundQuasarCatalog } from '../../../apps/language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs';
import { StandardWordWorldProvider } from '../../../apps/languages/czech/static/source/games/word-world/word-net-standard.mjs';
import { joinConceptCatalogs } from '../../../apps/language-runtime/static/source/catalog-runtime.mjs';
import { canonicalEnglishInput } from './semantic-cache.mjs';

export const CORPUS_SCHEMA_VERSION = 1;
export const CORPUS_ADAPTER_VERSION = 'english-authority-and-static-assessment-units-v1';
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const NATURALIZATION_SOURCE = 'apps/languages/mandarin-simplified/static/source/games/naturalization-nucleus/naturalization-nucleus.js';
const IMPLEMENTATION_SOURCES = [
  'tools/learning-evaluation/shared/corpus.mjs',
  'tools/learning-evaluation/shared/semantic-cache.mjs',
  'tools/language-content/quality/content-progression-catalogs.mjs',
  'tools/language-content/lib/word-world-course-content.mjs',
  'apps/language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs',
  'apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs',
  'apps/languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs',
  'apps/language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs',
  'apps/language-runtime/static/source/games/grammar-gravity/adjective-flight-core.mjs',
  'apps/language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs',
  'apps/language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs',
  'apps/languages/czech/static/source/games/word-world/word-net-standard.mjs',
  'apps/language-runtime/static/source/catalog-runtime.mjs',
  'apps/language-runtime/static/source/games/content-progression.mjs',
  'apps/language-runtime/static/source/games/curriculum-progression.mjs'
];
const gameIdFor = game => ({ 'verb-nebula': 'verb-lab', 'word-world': 'word-net', 'grammar-gravity-nouns': 'grammar-gravity' })[game] || game;
const text = value => typeof value === 'string' && value.trim() ? value : null;
const digest = value => createHash('sha256').update(value).digest('hex');
const englishBase = course => /^en(?:-|$)/u.test(course.sourceLanguage?.locale || course.sourceLanguage?.id || '');
const metadata = item => Object.fromEntries(['difficulty', 'usefulness', 'complexity'].map(key => [key, item?.[key] ?? null]));
const identityKey = identity => JSON.stringify([identity.courseId, identity.gameId, identity.bankId, identity.itemId]);
const recordKey = (catalog, location) => JSON.stringify([catalog.course.id, gameIdFor(catalog.game), catalog.resource, location]);

/** Explicit English authorities, never language detection or translated/invented parent labels. */
export function englishAuthority(catalog, row) {
  const { item, kind } = row;
  let fields;
  switch (catalog.game) {
    case 'verb-nebula': fields = ['englishAuditText', 'english', 'en', ...(englishBase(catalog.course) ? ['source'] : [])]; break;
    case 'word-world': fields = ['englishText']; break;
    case 'conjugation-comet': fields = ['englishAuditText', ...(catalog.document.schemaVersion === undefined && catalog.course.id === 'cz' && englishBase(catalog.course) ? [kind === 'conjugation-form' ? 'cue' : 'meaning'] : [])]; break;
    case 'case-cosmos': fields = kind === 'case-context' ? ['english'] : []; break;
    case 'grammar-gravity': fields = kind === 'agreement-example' ? ['englishAuditText'] : []; break;
    case 'grammar-gravity-nouns': fields = ['english']; break;
    case 'sound-quasar': fields = ['englishAuditText']; break;
    case 'naturalization-nucleus': fields = catalog.course.id === 'zh' && englishBase(catalog.course) ? ['translation'] : []; break;
    default: throw new Error(`No English authority adapter for ${catalog.game}`);
  }
  const field = fields.find(key => text(item[key]));
  return field ? { text: item[field], field, reason: null }
    : { text: null, field: null, reason: fields.length ? 'missing-authored-English' : 'structural-record-without-independent-English' };
}

function translations(catalog, row, english) {
  const { item, kind } = row;
  let targetText = null, learnerBaseText = null;
  switch (catalog.game) {
    case 'verb-nebula': targetText = text(item.target) || text(item.cs); learnerBaseText = text(item.source) || (englishBase(catalog.course) ? text(item.en) : null); break;
    case 'word-world': targetText = text(item.targetText); learnerBaseText = englishBase(catalog.course) ? english.text : text(item.learnerBase?.text); break;
    case 'conjugation-comet': targetText = text(item.targetText) || text(item.form) || text(item.verb); learnerBaseText = text(item.learnerBaseCueText) || text(item.learnerBaseText) || (englishBase(catalog.course) ? english.text : null); break;
    case 'case-cosmos': targetText = text(item.czech) || text(item.noun); learnerBaseText = kind === 'case-context' ? english.text : null; break;
    case 'grammar-gravity': targetText = text(item.targetText) || text(item.displayForm) || text(item.focus?.targetText); learnerBaseText = text(item.learnerBaseText); break;
    case 'grammar-gravity-nouns': targetText = text(item.targetText); learnerBaseText = text(item.learnerBaseText); break;
    case 'sound-quasar': targetText = text(item.target); learnerBaseText = text(item.meaning); break;
    case 'naturalization-nucleus': targetText = text(item.hanzi); learnerBaseText = englishBase(catalog.course) ? text(item.translation) : null; break;
  }
  const structural = english.reason === 'structural-record-without-independent-English';
  return { targetText, learnerBaseText, missingTarget: !targetText && !structural, missingLearnerBase: !learnerBaseText && !structural };
}

function categoriesFor(row, catalog) {
  const categories = {};
  const categoryProvenance = {};
  const put = (key, value, source = `item.${key}`, inherited = false) => {
    const values = (Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string' && value.trim() || typeof value === 'number').map(String);
    if (values.length) {
      categories[key] = [...new Set(values)];
      categoryProvenance[key] = { source, inherited };
    }
  };
  for (const key of ['topic', 'category', 'categories', 'tags', 'family', 'lessonId', 'laneId', 'case', 'number', 'gender', 'phase', 'objectiveId', 'tone', 'kind']) put(key, row.item[key]);
  put('focus.kind', row.item.focus?.kind || row.parent?.focus?.kind, row.item.focus?.kind ? 'item.focus.kind' : 'parent.focus.kind', !row.item.focus?.kind);
  put('grammar.tags', row.item.annotations?.grammar?.tags, 'item.annotations.grammar.tags');
  put('cefr', row.item.annotations?.cefr || row.item.cefr, row.item.annotations?.cefr ? 'item.annotations.cefr' : 'item.cefr');
  if (row.detail && ['agreement-form', 'agreement-example', 'case-context'].includes(row.kind)) put('axisOrCase', row.detail, 'progressionRecords.detail', true);
  if (catalog.game === 'grammar-gravity') {
    const axes = row.parent?.axes || catalog.document.axes || [];
    const axis = axes.find(axis => axis.id === row.detail);
    for (const [key, value] of Object.entries(axis?.features || {})) put(`axis.${key}`, value, `${row.parent?.axes ? 'parent' : 'catalog'}.axes[${row.detail}].features.${key}`, true);
  }
  return { categories, categoryProvenance };
}

function verifyWordWorldProjection(row, item, targetText, englishText) {
  if (!row) throw new Error(`Runtime Word World item ${item.id || item.conceptId} has no authored record.`);
  const normalize = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (normalize(row.item.targetText) !== normalize(targetText) || normalize(row.item.englishText) !== normalize(englishText)
      || ['difficulty', 'usefulness', 'complexity'].some(key => row.item[key] !== item[key])) {
    throw new Error(`Runtime Word World item ${row.item.id} differs from its authoring text or grades.`);
  }
}

function actualPlayableUnits(catalog, rows, { naturalizationValidator } = {}) {
  const { course, game } = catalog;
  // Some runtime validators freeze their input. Keep authoring inputs untouched.
  const document = structuredClone(catalog.document);
  const output = [];
  const byItemId = new Map(rows.filter(row => row.item.id).map(row => [row.item.id, row]));
  const byLocation = new Map(rows.map(row => [row.location, row]));
  const add = (item, kind, sourceRows, normalizer, itemId = item.id, extra = {}) => {
    if (!sourceRows.length || sourceRows.some(row => !row)) throw new Error(`Runtime unit ${itemId} has no exact authoring record match.`);
    const learnerIdentity = { courseId: course.id, gameId: gameIdFor(game), bankId: catalog.resource, itemId: String(itemId) };
    output.push({ ...learnerIdentity, id: identityKey(learnerIdentity), learnerIdentity, kind,
      recordIds: sourceRows.map(row => recordKey(catalog, row.location)), metadata: metadata(item), normalizer, ...extra });
  };
  let normalizer;
  if (game === 'verb-nebula') {
    normalizer = 'extractCoreVerbPairs';
    for (const pair of extractCoreVerbPairs(document, { learnerBaseLanguage: course.sourceLanguage.locale })) {
      add(pair, 'verb-match', [rows[pair.sourceIndex]], normalizer, pair.id,
        { identityStability: text(document[pair.sourceIndex].id) ? 'authored-id' : 'runtime-positional-id-source-hash-required' });
    }
  } else if (game === 'word-world') {
    if (!catalog.runtime) throw new Error('Word World runtime projection was not supplied; authoring sentences are not assumed playable.');
    if (catalog.runtime.kind === 'standard') {
      normalizer = 'StandardWordWorldProvider';
      const provider = new StandardWordWorldProvider({ manifest: catalog.runtime.manifest, pack: catalog.runtime.document, random: () => 0.5 });
      for (const item of provider.records) {
        const row = byItemId.get(item.id);
        verifyWordWorldProjection(row, item, item.cs, item.en);
        add(item, 'sentence', [row], normalizer, item.id, { playableTargetCount: item.targets.filter(target => target.playable).length });
      }
    } else if (catalog.runtime.kind === 'concept-realization') {
      normalizer = 'joinConceptCatalogs';
      for (const item of joinConceptCatalogs(catalog.runtime.concepts, catalog.runtime.realizations)) {
        const row = byItemId.get(item.conceptId);
        verifyWordWorldProjection(row, item, item.target.text, item.englishText);
        add(item, 'sentence', [row], normalizer, item.conceptId, { playableTargetCount: item.target.tokens.filter(target => target.playable).length });
      }
    } else throw new Error(`Unsupported Word World runtime kind ${catalog.runtime.kind}`);
  } else if (game === 'conjugation-comet') {
    normalizer = 'validateConjugationCometCatalog + buildConjugationHelixRound';
    const pack = validateConjugationCometCatalog(document, { expectedCourseId: course.id, expectedTargetLanguageId: course.targetLanguage.id,
      expectedLearnerBaseLanguageId: course.sourceLanguage.id, expectedTargetLocale: course.targetLanguage.locale });
    pack.verbs.forEach((verb, index) => {
      const round = buildConjugationHelixRound(pack, verb.id, { rng: () => 0.5 });
      for (const subject of round.subjects) {
        const formIndex = verb.forms.findIndex(form => form.id === subject.id);
        add({ ...verb, ...subject }, 'conjugation-form', [byLocation.get(`verbs[${index}].forms[${formIndex}]`)], normalizer, `${verb.id}/${subject.id}`,
          { parentItemId: verb.id, assessmentGroup: 'helix-paradigm' });
      }
    });
  } else if (game === 'case-cosmos') {
    normalizer = 'buildRounds + buildQuestions';
    for (const round of buildRounds(document, 3)) for (const question of buildQuestions(round, () => 0.5)) {
      const row = question.id ? byItemId.get(question.id) : rows.find(row => row.kind === 'case-context' && row.parent?.noun === round.noun && row.detail === question.case);
      const nounKey = Array.from(round.noun).map(char => char.codePointAt(0).toString(16)).join('-');
      add({ ...round, ...question }, 'case-context', [row], normalizer, question.id || `legacy-${nounKey}-${question.case.toLowerCase()}`);
    }
  } else if (game === 'grammar-gravity') {
    normalizer = 'buildGrammarGravityRounds';
    for (const item of buildGrammarGravityRounds(document, 3, () => 0.5)) add(item, 'agreement-example', [byItemId.get(item.id)], normalizer);
  } else if (game === 'grammar-gravity-nouns') {
    normalizer = 'normalizeNounLandingPack';
    const pack = normalizeNounLandingPack(document, { courseId: course.id, targetLanguage: course.targetLanguage.locale, learnerBaseLanguage: course.sourceLanguage.locale });
    for (const item of pack.items) add(item, 'noun-category', [byItemId.get(item.id)], normalizer);
  } else if (game === 'sound-quasar') {
    normalizer = 'validateSoundQuasarCatalog';
    const pack = validateSoundQuasarCatalog(document, { courseId: course.id, targetLanguageId: course.targetLanguage.id, learnerBaseLanguage: course.sourceLanguage.locale });
    for (const [kind, items] of [['listening-word', pack.items], ['listening-sentence', pack.sentences]]) for (const item of items) add(item, kind, [byItemId.get(item.id)], normalizer);
  } else if (game === 'naturalization-nucleus') {
    normalizer = 'CaatuuNaturalizationNucleus.validateCatalog';
    if (typeof naturalizationValidator !== 'function') throw new Error('The existing Naturalization Nucleus validator must be supplied.');
    for (const item of naturalizationValidator(document).challenges) add(item, 'character-puzzle', [byItemId.get(item.id)], normalizer);
  } else throw new Error(`Unmapped game ${game}`);
  return { units: output, normalizer };
}

/** Pure fixture-friendly traversal. Failed runtime adapters do not suppress authoring findings. */
export function buildEvaluationCorpus(catalogs, { sources = [], naturalizationValidator, courses: requestedCourses = null } = {}) {
  if (requestedCourses !== null) {
    if (!Array.isArray(requestedCourses)) throw new TypeError('courses must be an array of course IDs.');
    const known = new Set(catalogs.map(catalog => catalog.course.id));
    for (const id of requestedCourses) if (!known.has(id)) throw new Error(`Unknown course ${id}`);
    if (requestedCourses.length) {
      const wanted = new Set(requestedCourses);
      catalogs = catalogs.filter(catalog => wanted.has(catalog.course.id));
    }
  }
  const records = [], playableUnits = [], findings = [], adapters = [], documentsByText = new Map();
  const courses = [...new Map(catalogs.map(({ course }) => [course.id, { id: course.id, sourceLanguage: course.sourceLanguage, targetLanguage: course.targetLanguage }])).values()];
  for (const catalog of catalogs) {
    const { course, game } = catalog;
    const scope = { courseId: course.id, gameId: gameIdFor(game), bankId: catalog.resource };
    const rows = progressionRecords(game, catalog.document);
    const rowByObject = new Map(rows.map(row => [row.item, row]));
    const parentItems = new Set(rows.map(row => row.parent).filter(Boolean));
    const addFinding = (code, message, recordId, severity = 'warning') => findings.push({ ...scope, code, severity, ...(recordId ? { recordId } : {}), message });
    for (const row of rows) {
      const id = recordKey(catalog, row.location);
      // Grammar forms are structural containers even though progressionRecords points examples to the challenge.
      const recordRole = parentItems.has(row.item) || row.kind === 'agreement-form' || (row.kind === 'case-paradigm') ? 'parent' : row.parent ? 'nested' : 'leaf';
      const english = englishAuthority(catalog, row);
      const translation = translations(catalog, row, english);
      const record = { id, ...scope, itemId: String(row.item.id || row.location), kind: row.kind, recordRole,
        parentId: row.parent ? recordKey(catalog, rowByObject.get(row.parent).location) : null,
        source: { path: catalog.path, location: row.location }, metadata: metadata(row.item), ...categoriesFor(row, catalog),
        english, translation, semanticDocumentId: null };
      if (!english.text) addFinding(english.reason, english.reason === 'structural-record-without-independent-English'
        ? 'Structural record has no independent English text; child text is not substituted.' : 'Expected explicit authored English authority is missing.', id,
      english.reason === 'structural-record-without-independent-English' ? 'info' : 'warning');
      else {
        try {
          const canonical = canonicalEnglishInput(english.text);
          if (!documentsByText.has(canonical)) documentsByText.set(canonical, { id: `english:${digest(canonical)}`, englishText: canonical, recordIds: [] });
          const document = documentsByText.get(canonical);
          document.recordIds.push(id);
          record.semanticDocumentId = document.id;
        } catch (error) { addFinding('semantic-input-rejected', error.message, id); }
      }
      for (const key of ['usefulness', 'complexity']) if (!Number.isInteger(row.item[key]) || row.item[key] < 1 || row.item[key] > 100) addFinding('missing-or-invalid-metadata', `${key} must be an authored integer 1–100.`, id);
      if (row.item.difficulty !== undefined && (![1, 2, 3].includes(row.item.difficulty))) addFinding('invalid-difficulty', 'Authored difficulty badge must be 1, 2 or 3.', id);
      if (translation.missingTarget) addFinding('missing-target-translation', 'Authored target-language text is missing.', id);
      if (translation.missingLearnerBase) addFinding('missing-learner-base-translation', 'Authored learner-base text is missing.', id);
      if (Object.hasOwn(row.item, 'urgency') || Object.hasOwn(row.item, 'subdifficulty')) addFinding('legacy-metadata', 'Legacy compatibility fields are present; they are not counted as authored usefulness/complexity.', id);
      records.push(record);
    }
    try {
      const { units, normalizer } = actualPlayableUnits(catalog, rows, { naturalizationValidator });
      const ids = units.map(unit => unit.id);
      if (new Set(ids).size !== ids.length) throw new Error('Runtime adapter produced duplicate learner identities.');
      playableUnits.push(...units);
      adapters.push({ ...scope, normalizer, status: 'ok', playableCountAvailable: true, authoredRecords: rows.length, playableUnits: units.length });
      const represented = new Set(units.flatMap(unit => unit.recordIds));
      const unrepresented = rows.filter(row => !represented.has(recordKey(catalog, row.location))).length;
      if (unrepresented) addFinding('authoring-records-not-independent-units', `${unrepresented} authoring records are structural, filtered, or otherwise not independent runtime assessment units.`, null, 'info');
    } catch (error) {
      adapters.push({ ...scope, normalizer: null, status: 'failed', playableCountAvailable: false, authoredRecords: rows.length, playableUnits: null, reason: error.message });
      addFinding('runtime-adapter-failed', `Playable count unavailable for this bank: ${error.message}`, null, 'error');
    }
  }
  return { schemaVersion: CORPUS_SCHEMA_VERSION, adapterVersion: CORPUS_ADAPTER_VERSION, courses, records, playableUnits,
    documents: [...documentsByText.values()], findings, sources, adapters };
}

/** Manifest-driven repository loader; importing this module does not run an evaluator or load a model. */
export async function loadEvaluationCorpus({ root = repositoryRoot, courses: requestedCourses = null } = {}) {
  if (requestedCourses !== null && !Array.isArray(requestedCourses)) throw new TypeError('courses must be an array of course IDs.');
  const sources = new Map();
  const read = async relative => {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/u).some(part => part === '..')) throw new Error(`Unconfined corpus source ${relative}`);
    const bytes = await readFile(path.join(root, relative));
    sources.set(relative, { path: relative, sha256: digest(bytes) });
    return bytes;
  };
  const readJson = async relative => JSON.parse(await read(relative));
  const index = await readJson('apps/languages/catalog.json');
  const manifests = new Map();
  for (const entry of index.courses) manifests.set(entry.id, await readJson(entry.manifest));
  const wanted = requestedCourses?.length ? new Set(requestedCourses) : null;
  if (wanted) for (const id of wanted) if (!manifests.has(id)) throw new Error(`Unknown course ${id}`);
  const allCatalogs = await loadProgressionCatalogs(root);
  const catalogs = allCatalogs.filter(catalog => !wanted || wanted.has(catalog.course.id));
  for (const catalog of catalogs) {
    if (JSON.stringify(manifests.get(catalog.course.id)) !== JSON.stringify(catalog.course)) throw new Error(`Course changed during corpus capture: ${catalog.course.id}`);
    const captured = await readJson(catalog.path);
    if (JSON.stringify(captured) !== JSON.stringify(catalog.document)) throw new Error(`Source changed during corpus capture: ${catalog.path}`);
    if (catalog.game !== 'word-world') continue;
    const manifestPath = catalog.course.resources.wordWorldManifest.path;
    const manifest = await readJson(manifestPath);
    if (manifest.runtimeFile) {
      const runtimePath = path.posix.join(path.posix.dirname(manifestPath), manifest.runtimeFile.split('?')[0]);
      catalog.runtime = { kind: 'standard', manifest, document: await readJson(runtimePath) };
    } else {
      const projection = catalog.course.publication.runtimeProjection;
      catalog.runtime = { kind: 'concept-realization', concepts: await readJson(projection.conceptsRuntime), realizations: await readJson(projection.targetRealizationsRuntime) };
      if (projection.learnerBaseRuntime) await readJson(projection.learnerBaseRuntime);
    }
  }
  let naturalizationValidator;
  if (catalogs.some(catalog => catalog.game === 'naturalization-nucleus')) {
    // The existing classic host only installs its API at load time. No mount, DOM,
    // fetch, timers, or dynamic import is called by this validation-only adapter.
    const sandbox = { window: {} };
    new Script((await read(NATURALIZATION_SOURCE)).toString('utf8'), { filename: NATURALIZATION_SOURCE }).runInNewContext(sandbox, { timeout: 1000 });
    naturalizationValidator = sandbox.window.CaatuuNaturalizationNucleus.validateCatalog;
  }
  for (const source of IMPLEMENTATION_SOURCES) await read(source);
  return buildEvaluationCorpus(catalogs, { sources: [...sources.values()].sort((a, b) => a.path.localeCompare(b.path)), naturalizationValidator });
}
