import { normalizeWord, selectDictionaryMeaning } from '../../word-net-core.mjs';
import { learnerTokenMeanings } from '../../learner-base-token-meanings.mjs';
import { declaredCourseGameResource } from '../course-game-content.mjs';
import { createSpeechIcon } from '../embedded-game-controls.mjs';
import { assertLanguageAdapterMatchesTarget } from '../../../../contract.mjs';

const clean = value => String(value || '').normalize('NFC').trim();
const primary = value => clean(value).toLowerCase().split('-')[0];
const abortError = () => Object.assign(new Error('Dictionary lookup cancelled.'), { name: 'AbortError' });

/** Optional help reuses authored word meanings, never another game's challenges. */
export function createMoonAuthoredWordLookup({ course, targetCatalog, learnerBaseCatalog, adapter } = {}) {
  const locale = course?.targetLanguage?.locale || 'und';
  const lookupKey = adapter?.dictionary?.lookupKey || adapter?.normalization?.searchKey;
  const key = value => clean(lookupKey ? lookupKey(value) : value).toLocaleLowerCase(locale);
  const sourceLocale = course?.sourceLanguage?.locale || 'en';
  const englishBase = primary(sourceLocale) === 'en';
  if (targetCatalog?.courseId !== course?.id || !Array.isArray(targetCatalog?.realizations)) {
    throw new TypeError('Word meanings require the current course target catalog.');
  }
  if (!englishBase && learnerBaseCatalog?.baseLanguage?.languageTag !== sourceLocale) {
    throw new TypeError('Word meanings require the exact learner-base language.');
  }
  const bases = new Map((learnerBaseCatalog?.realizations || []).map(record => [record.conceptId, record]));
  const surfaces = new Map(), exactSurfaces = new Map(), sentences = new Map();
  function append(map, value, entry) {
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(entry);
  }
  for (const record of targetCatalog.realizations) {
    const tokens = Array.isArray(record.tokens) ? record.tokens : [];
    const meanings = englishBase ? null : learnerTokenMeanings(bases.get(record.conceptId) || {}, {
      targetLanguage: course?.targetLanguage?.locale, targetTokens: tokens
    });
    const occurrences = [];
    tokens.forEach((token, tokenIndex) => {
      const surface = clean(token?.surface);
      const meaning = englishBase ? clean(token?.gloss) : clean(meanings?.find(entry => (
        entry.tokenIndex === tokenIndex && entry.surface.normalize('NFC') === surface
      ))?.text);
      if (!surface || !meaning) return;
      const entry = { surface, tokenIndex, meaning, languageTag: sourceLocale,
        lemma: surface, pos: '', formTags: [], senseTags: [], synonyms: [] };
      occurrences.push(entry);
      append(surfaces, key(surface), entry);
      append(exactSurfaces, surface.toLocaleLowerCase(locale), entry);
    });
    append(sentences, clean(record.text), occurrences);
  }
  const senses = (values, word) => {
    const unique = new Map((values || []).map(entry => [clean(entry.meaning), entry]));
    if (!unique.size) return null;
    const selected = [...unique.values()].slice(0, 3);
    return { ...selected[0], lemma: selected.length === 1 ? selected[0].lemma : clean(word),
      glosses: selected.map(entry => entry.meaning), meaning: selected.map(entry => entry.meaning).join('; ') };
  };
  return (word, { item, tokenIndex } = {}) => {
    const wordKey = key(word);
    if (!wordKey) return null;
    const exact = sentences.get(clean(item?.targetText));
    if (exact) {
      const matches = exact.flatMap(tokens => tokens.filter(entry => key(entry.surface) === wordKey));
      // Token segmentation can differ between games. Use a position only when
      // its exact surface agrees. Otherwise show the authored senses without
      // claiming to know which unrelated context the learner intends.
      const positioned = matches.filter(entry => entry.tokenIndex === tokenIndex);
      return senses(positioned.length ? positioned : matches, word);
    }
    return senses(exactSurfaces.get(clean(word).toLocaleLowerCase(locale)) || surfaces.get(wordKey), word);
  };
}

function confinedWordWorldUrl(path, base, courseBase) {
  const value = clean(path);
  const [pathname, query = ''] = value.split('?');
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('#')
      || value.split('?').length > 2 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/u.test(pathname)
      || pathname.split('/').some(part => !part || part === '.' || part === '..')
      || (query && (!/^[A-Za-z0-9._~=&%-]+$/u.test(query) || /%(?:2f|5c|00)/iu.test(query)))) {
    throw new TypeError('Word meaning resources must be confined course JSON files.');
  }
  const url = new URL(value, base);
  const folder = new URL('data/games/word-world/', courseBase);
  if (url.origin !== folder.origin || !url.pathname.startsWith(folder.pathname)
      || url.username || url.password) throw new TypeError('Word meaning resource escaped its course.');
  return url.href;
}

/** Lazy and abortable: mounting a round never loads a dictionary or word bank. */
export function createMoonWordLookup({ course, runtime, fetchImpl = globalThis.fetch,
  runtimeHref = globalThis.location?.href, adapter, importModule = specifier => import(specifier) } = {}) {
  let authored = null;
  async function json(url, signal) {
    const response = await fetchImpl(url, { credentials: 'same-origin', signal,
      headers: { Accept: 'application/json' } });
    if (!response?.ok) throw new Error('Word meanings could not be loaded.');
    return response.json();
  }
  async function loadAuthored(signal) {
    if (authored) return authored;
    const route = clean(course?.routePrefix);
    if (!/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(route)) throw new TypeError('A confined course route is required.');
    const courseBase = new URL(`${route}/`, new URL(runtimeHref).origin);
    const declaration = declaredCourseGameResource(course, 'word-net', 'wordWorldManifest');
    const url = confinedWordWorldUrl(declaration, courseBase, courseBase);
    const manifest = await json(url, signal);
    if (manifest?.courseId !== course.id
        || manifest?.sessionProvider?.kind !== 'authored-realizations') return null;
    const target = await json(confinedWordWorldUrl(manifest.realizationFile, url, courseBase), signal);
    let base = null;
    if (primary(course.sourceLanguage?.locale) !== 'en') {
      if (manifest.learnerBaseLanguage !== course.sourceLanguage?.locale) {
        throw new TypeError('Word meanings must match the learner language.');
      }
      base = await json(confinedWordWorldUrl(manifest.learnerBaseFile, url, courseBase), signal);
    }
    // Use the course's search normalization for help, while assessments retain
    // the original vowel marks, macrons and other meaningful distinctions.
    let languageAdapter = adapter;
    if (!languageAdapter && course?.languageAdapter?.module) {
      const module = clean(course.languageAdapter.module);
      if (!/^source\/language\/[A-Za-z0-9._/-]+\.mjs$/u.test(module)
          || module.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new TypeError('Dictionary normalization needs a confined course language adapter.');
      }
      const moduleUrl = new URL(module, courseBase);
      if (moduleUrl.origin !== courseBase.origin || !moduleUrl.pathname.startsWith(`${courseBase.pathname}source/language/`)) {
        throw new TypeError('Dictionary normalization adapter escaped its course.');
      }
      languageAdapter = (await importModule(moduleUrl.href)).default;
    }
    if (languageAdapter) assertLanguageAdapterMatchesTarget(languageAdapter, course.targetLanguage);
    if (signal?.aborted) throw abortError();
    authored = createMoonAuthoredWordLookup({ course, targetCatalog: target, learnerBaseCatalog: base,
      adapter: languageAdapter });
    return authored;
  }
  return async (word, { signal, ...context } = {}) => {
    if (signal?.aborted) throw abortError();
    if (course?.capabilities?.dictionary === true && typeof runtime?.dictionary?.search === 'function') {
      const payload = await runtime.dictionary.search(word, { limit: 8, signal });
      if (signal?.aborted) throw abortError();
      const result = selectDictionaryMeaning(payload, word, { maxGlosses: 2 });
      return result ? { ...result, languageTag: course.sourceLanguage?.locale || 'en' } : null;
    }
    const lookup = await loadAuthored(signal);
    if (signal?.aborted) throw abortError();
    return lookup?.(word, context) || null;
  };
}

/** Owns only the shared word card and its request lifecycle. The host owns help evidence. */
export function createMemoryMoonDictionary({ slot, course, runtime, i18n,
  fetchImpl, runtimeHref, resolveWord, renderWord, onSpeak, onMeaningShown, onOpenChange } = {}) {
  const document = slot?.ownerDocument;
  if (!document) throw new TypeError('A local dictionary slot is required.');
  const spanish = primary(course?.sourceLanguage?.locale) === 'es';
  const t = (id, fallback, parameters = {}) => {
    const text = i18n?.t?.(id, parameters);
    return typeof text === 'string' && text && text !== id ? text : fallback;
  };
  const lookup = resolveWord || createMoonWordLookup({ course, runtime, fetchImpl, runtimeHref });
  const node = (tag, className) => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  };
  const card = node('aside', 'moon-dictionary-card dictionary-word-card');
  card.setAttribute('aria-label', t('wordworld.word.meaning', spanish ? 'Significado de la palabra' : 'Selected word meaning'));
  const copy = node('div', 'dictionary-word-card__copy');
  copy.setAttribute('role', 'status');
  copy.setAttribute('aria-live', 'polite');
  copy.setAttribute('aria-atomic', 'true');
  const heading = node('div', 'dictionary-word-card__heading');
  const wordNode = node('strong', 'dictionary-word-card__word');
  const pos = node('span', 'dictionary-word-card__pos');
  const meaning = node('span', 'dictionary-word-card__meaning');
  const meta = node('span', 'dictionary-word-card__meta');
  heading.append(wordNode, pos);
  copy.append(heading, meaning, meta);
  const speak = node('button', 'dictionary-word-card__pronounce');
  speak.type = 'button';
  speak.hidden = course?.capabilities?.speech !== true;
  speak.setAttribute('aria-label', t('wordworld.word.play', spanish ? 'Escuchar la palabra' : 'Play selected word aloud'));
  speak.setAttribute('aria-pressed', 'false');
  speak.append(createSpeechIcon(document));
  const close = node('button', 'moon-dictionary-close');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', t('common.close', spanish ? 'Cerrar' : 'Close'));
  card.append(copy, speak, close);
  slot.replaceChildren(card);
  let active = true, destroyed = false, generation = 0, controller = null, selected = null, opened = false;
  function setOpen(value) {
    if (opened === value) return;
    opened = value;
    onOpenChange?.(opened);
  }
  function reset({ replacing = false } = {}) {
    generation += 1;
    controller?.abort();
    controller = null;
    selected?.button?.classList?.remove('is-dictionary-selected');
    selected = null;
    slot.hidden = true;
    card.setAttribute('aria-hidden', 'true');
    wordNode.textContent = meaning.textContent = pos.textContent = meta.textContent = '';
    card.classList.remove('is-loading');
    speak.classList.remove('is-speaking');
    speak.setAttribute('aria-pressed', 'false');
    speak.disabled = true;
    if (!replacing) setOpen(false);
  }
  reset();
  async function open(word, context = {}) {
    if (!active || destroyed) return false;
    const surface = normalizeWord(word);
    if (!surface) return false;
    reset({ replacing: true });
    const request = generation;
    controller = new AbortController();
    const signal = controller.signal;
    selected = { ...context, word: surface };
    selected.button?.classList?.add('is-dictionary-selected');
    slot.hidden = false;
    setOpen(true);
    card.setAttribute('aria-hidden', 'false');
    card.classList.add('is-loading');
    wordNode.lang = course?.targetLanguage?.locale || 'und';
    wordNode.dir = course?.targetLanguage?.direction || 'auto';
    wordNode.textContent = surface;
    renderWord?.(wordNode, surface, context);
    meaning.lang = course?.sourceLanguage?.locale || 'en';
    meaning.dir = course?.sourceLanguage?.direction || 'auto';
    meaning.textContent = t('wordworld.dictionary.loading', spanish ? 'Consultando…' : 'Looking up…');
    meta.hidden = true;
    speak.disabled = !onSpeak;
    const current = () => active && !destroyed && generation === request && !signal.aborted;
    try {
      const details = await lookup(surface, { ...context, signal });
      if (!current()) return false;
      const text = clean(details?.meaning);
      meaning.textContent = text || t('wordworld.dictionary.unavailable', spanish ? 'Significado no disponible.' : 'Meaning unavailable.');
      meaning.lang = details?.languageTag || course?.sourceLanguage?.locale || 'en';
      pos.textContent = text && details?.pos !== 'word' ? clean(details?.pos) : '';
      const metadata = [];
      if (text && clean(details?.lemma) && clean(details.lemma) !== surface) {
        metadata.push(t('wordworld.dictionary.lemma', `${spanish ? 'lema' : 'lemma'} ${details.lemma}`, { lemma: details.lemma }));
      }
      if (text && details?.formTags?.length) metadata.push(details.formTags.slice(0, 3).join(' ').replaceAll('-', ' '));
      meta.textContent = metadata.join(' · ');
      meta.hidden = !meta.textContent;
      card.classList.remove('is-loading');
      if (text) onMeaningShown?.({ word: surface, ...context, details });
      return Boolean(text);
    } catch (error) {
      if (!current()) return false;
      card.classList.remove('is-loading');
      meaning.textContent = t('wordworld.dictionary.unavailable', spanish ? 'Significado no disponible.' : 'Meaning unavailable.');
      return false;
    } finally { if (generation === request) controller = null; }
  }
  function play() { if (active && selected && !destroyed) onSpeak?.(selected.word); }
  function closeCard() { const button = selected?.button; reset(); button?.focus?.(); }
  function escape(event) {
    if (event.key === 'Escape' && !slot.hidden) { event.preventDefault(); closeCard(); }
  }
  speak.addEventListener('click', play);
  close.addEventListener('click', closeCard);
  card.addEventListener('keydown', escape);
  return Object.freeze({
    open, reset,
    setActive(value) { active = Boolean(value); if (!active) reset(); },
    syncSpeech(state = {}) {
      const playing = Boolean(selected) && state.status !== 'idle' && state.status !== 'error'
        && state.text === selected.word;
      speak.classList.toggle('is-speaking', playing);
      speak.setAttribute('aria-pressed', String(playing));
    },
    destroy() {
      if (destroyed) return;
      reset(); destroyed = true;
      speak.removeEventListener('click', play);
      close.removeEventListener('click', closeCard);
      card.removeEventListener('keydown', escape);
      slot.replaceChildren();
    }
  });
}
