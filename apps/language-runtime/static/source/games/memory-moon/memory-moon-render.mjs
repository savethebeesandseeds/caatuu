import { createSpeechIcon } from '../embedded-game-controls.mjs';
import { renderTargetText } from '../../target-text.mjs?v=target-text-1';

const SVG_NS = 'http://www.w3.org/2000/svg';
let sequence = 0;

export function moonLabels(course, i18n) {
  const spanish = /^es(?:-|$)/i.test(course?.sourceLanguage?.locale || '');
  const labels = spanish ? {
    game: 'Memory Moon: traducciones', choices: 'Elige la traducción',
    loading: 'Preparando recuerdos…', error: 'No se pudo cargar la práctica.',
    retry: 'Volver a intentar', replay: 'Otra luna', complete: 'Has iluminado la luna.',
    restored: 'Luna completa', round: (index, total) => `Recuerdo ${index} de ${total}`,
    correct: 'Correcto. Continúa cuando quieras.', wrong: 'Prueba otra traducción.',
    play: 'Escuchar la frase', stop: 'Detener audio', word: text => `Escuchar: ${text}`,
    selectWord: text => `Ver el significado de ${text}`,
    preparing: 'Preparando audio.', playing: 'Reproduciendo audio.', audioError: 'El audio no está disponible.',
    illumination: percent => `${percent} por ciento de la luna iluminado`
  } : {
    game: 'Memory Moon translation practice', choices: 'Choose the translation',
    loading: 'Preparing memories…', error: 'Practice could not be loaded.',
    retry: 'Try again', replay: 'Another moon', complete: 'You brought the moon to light.',
    restored: 'Moon restored', round: (index, total) => `Memory ${index} of ${total}`,
    correct: 'Correct. Continue when you are ready.', wrong: 'Try another translation.',
    play: 'Play sentence audio', stop: 'Stop audio', word: text => `Play word: ${text}`,
    selectWord: text => `Show meaning: ${text}`,
    preparing: 'Preparing audio.', playing: 'Playing audio.', audioError: 'Audio is unavailable.',
    illumination: percent => `${percent} percent of the moon illuminated`
  };
  const translated = (name, fallback, parameters) => {
    const key = `games.memorymoon.${name}`;
    const value = i18n?.t?.(key, parameters);
    return typeof value === 'string' && value && value !== key ? value : fallback;
  };
  const result = {};
  for (const [name, value] of Object.entries(labels)) {
    if (typeof value === 'string') result[name] = translated({ game: 'practice',
      preparing: 'audio.preparing', playing: 'audio.playing', audioError: 'audio.error' }[name] || name, value);
  }
  result.round = (index, total) => translated('round', labels.round(index, total), { index, total });
  result.word = text => translated('word', labels.word(text), { text });
  result.selectWord = text => translated('selectword', labels.selectWord(text), { text });
  result.illumination = percent => translated('illumination', labels.illumination(percent), { percent });
  return result;
}

/** Preserve script, combining marks, whitespace and punctuation in every course. */
export function tokenizeMoonText(text, locale, Segmenter = globalThis.Intl?.Segmenter) {
  const value = String(text || '').normalize('NFC');
  if (typeof Segmenter === 'function') {
    try {
      return [...new Segmenter(locale, { granularity: 'word' }).segment(value)]
        .map(part => ({ text: part.segment, word: Boolean(part.isWordLike) }));
    } catch { /* An unsupported locale still has a script-safe fallback. */ }
  }
  return [...value.matchAll(/[\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+/gu)]
    .map(([part]) => ({ text: part, word: /^[\p{L}\p{M}\p{N}]/u.test(part) }));
}

// Reading positions belong to this occurrence in this sentence. A repeated Han
// character may have a different reading later; a surface-only lookup is unsafe.
export function moonWordReadingUnits(item, word, tokenIndex, locale) {
  const text = String(item?.targetText || '').normalize('NFC');
  const reading = item?.targetReading;
  if (reading?.system !== 'pinyin' || !Array.isArray(reading.tokens) || !reading.tokens.length) return null;
  const aligned = [];
  let cursor = 0;
  for (const token of reading.tokens) {
    if (typeof token?.surface !== 'string' || !token.surface || !Array.isArray(token.units)
        || !token.units.length || token.units.some(unit => typeof unit?.surface !== 'string'
          || Array.from(unit.surface).length !== 1 || typeof unit.notation !== 'string'
          || !unit.notation.trim())
        || token.units.map(unit => unit.surface).join('') !== token.surface) return null;
    const start = text.indexOf(token.surface, cursor);
    if (start < cursor || /\p{Script=Han}/u.test(text.slice(cursor, start))) return null;
    let offset = start;
    for (const unit of token.units) {
      aligned.push({ ...unit, start: offset, end: offset + unit.surface.length });
      offset += unit.surface.length;
    }
    cursor = offset;
  }
  if (/\p{Script=Han}/u.test(text.slice(cursor))) return null;
  let offset = 0, index = 0;
  for (const token of tokenizeMoonText(text, locale)) {
    if (token.word && index++ === tokenIndex) {
      if (token.text !== word) return null;
      const end = offset + token.text.length;
      const units = aligned.filter(unit => unit.start >= offset && unit.end <= end);
      return units.map(unit => unit.surface).join('') === token.text
        ? units.map(({ surface, notation, tone }) => ({ surface, notation, ...(tone === undefined ? {} : { tone }) })) : null;
    }
    offset += token.text.length;
  }
  return null;
}

export function createMoonRenderer({ root, course, i18n, onAnswer, onSpeak, onReplay,
  onSelectWord, readingGuide, storage } = {}) {
  const document = root?.ownerDocument;
  if (!document) throw new TypeError('Memory Moon needs a local root.');
  const labels = moonLabels(course, i18n);
  const speechAvailable = course?.capabilities?.speech === true;
  const target = course?.targetLanguage || {}, source = course?.sourceLanguage || {};
  const chinese = target.id === 'zh';
  const textPreferences = { showGuide: true, colorTones: true };
  const preferenceKey = `${course?.storage?.namespace || `caatuu.${course?.id || target.id}`}.memoryMoon.targetTextPreferences.v1`;
  if (chinese) try {
    storage ??= document.defaultView?.localStorage;
    const stored = JSON.parse(storage?.getItem(preferenceKey) || 'null');
    for (const key of Object.keys(textPreferences)) {
      if (typeof stored?.[key] === 'boolean') textPreferences[key] = stored[key];
    }
  } catch { /* Reading controls keep session defaults when storage is unavailable. */ }
  const textRuns = new Map(), preferenceListeners = [];
  let destroyed = false;
  function node(tag, className, text) {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text) value.textContent = text;
    return value;
  }
  function svg(tag, attributes = {}) {
    const value = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, entry]) => value.setAttribute(key, String(entry)));
    return value;
  }
  function paintTextRun(host, run) {
    const rendered = renderTargetText(document, host, run.word, {
      units: run.units, ...textPreferences, guideLanguage: 'zh-Latn-pinyin'
    });
    run.snapshot = host.textContent;
    return rendered;
  }
  function pruneTextRuns() {
    for (const [host, run] of textRuns) {
      if (!host.isConnected || host.textContent !== run.snapshot) textRuns.delete(host);
    }
  }
  const targetTextSettings = chinese ? (() => {
    const content = node('fieldset', 'caatuu-game-controls-setting');
    const translated = (key, fallback) => {
      const value = i18n?.t?.(key);
      return value && value !== key ? value : fallback;
    };
    content.append(node('legend', '', translated('verbnebula.targettext.title', 'Chinese text')));
    for (const [key, labelKey, fallback] of [
      ['showGuide', 'verbnebula.targettext.pinyin', 'Show pinyin'],
      ['colorTones', 'verbnebula.targettext.tones', 'Tone colors']
    ]) {
      const button = node('button', 'caatuu-romanization-setting');
      button.type = 'button';
      button.dataset.targetTextSetting = key;
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-checked', String(textPreferences[key]));
      const indicator = node('i');
      indicator.setAttribute('aria-hidden', 'true');
      button.append(node('span', '', translated(labelKey, fallback)), indicator);
      const toggle = () => {
        if (destroyed) return;
        textPreferences[key] = !textPreferences[key];
        button.setAttribute('aria-checked', String(textPreferences[key]));
        try { storage?.setItem(preferenceKey, JSON.stringify(textPreferences)); } catch { /* Session fallback. */ }
        pruneTextRuns();
        for (const [host, run] of textRuns) paintTextRun(host, run);
      };
      button.addEventListener('click', toggle);
      preferenceListeners.push(() => button.removeEventListener('click', toggle));
      content.append(button);
    }
    return { content, labelKey: 'verbnebula.targettext.title' };
  })() : null;
  const prefix = `memory-moon-${++sequence}`;
  const board = node('section', 'moon-board');
  board.setAttribute('aria-label', labels.game);
  const overview = node('header', 'moon-overview');
  const figure = node('figure', 'moon-figure');
  const globe = svg('svg', { class: 'moon-globe', viewBox: '0 0 200 200', role: 'img' });
  const defs = svg('defs'), clip = svg('clipPath', { id: `${prefix}-clip` });
  clip.append(svg('circle', { cx: 100, cy: 100, r: 98 }));
  const filter = svg('filter', { id: `${prefix}-soft`, x: '-5%', y: '-5%', width: '110%', height: '110%' });
  filter.append(svg('feGaussianBlur', { stdDeviation: .65 }));
  const gradient = svg('radialGradient', { id: `${prefix}-limb`, cx: '40%', cy: '35%', r: '65%' });
  gradient.append(svg('stop', { offset: '.65', 'stop-color': '#050a08', 'stop-opacity': 0 }),
    svg('stop', { offset: '1', 'stop-color': '#050a08', 'stop-opacity': .3 }));
  defs.append(clip, filter, gradient);
  const surface = svg('g', { 'clip-path': `url(#${prefix}-clip)` });
  const shade = svg('path', { class: 'moon-shade', filter: `url(#${prefix}-soft)` });
  surface.append(svg('image', { href: '/assets/planets/memory-moon.png', x: -62, y: -58, width: 326, height: 326 }),
    svg('circle', { cx: 100, cy: 100, r: 98, fill: `url(#${prefix}-limb)` }), shade);
  globe.append(defs, surface, svg('circle', { class: 'moon-rim', cx: 100, cy: 100, r: 98 }));
  const orbit = svg('svg', { class: 'moon-orbit', viewBox: '0 0 200 200', 'aria-hidden': 'true', focusable: 'false' });
  const ship = svg('g', { visibility: 'hidden' });
  const shipImage = svg('image', { x: -19, y: -19, width: 38, height: 38 });
  ship.append(shipImage);
  orbit.append(ship);
  figure.append(globe, orbit);
  const toolbar = node('div', 'moon-toolbar');
  const overviewSide = node('div', 'moon-overview-side');
  const dictionarySlot = node('aside', 'moon-dictionary-slot');
  dictionarySlot.hidden = true;
  overviewSide.append(toolbar, dictionarySlot);
  overview.append(figure, overviewSide);
  const challenge = node('section', 'moon-challenge');
  const sentenceRow = node('div', 'moon-sentence-row');
  const sentence = node('h1', 'moon-sentence');
  const speak = node('button', 'moon-speak');
  speak.type = 'button';
  speak.hidden = !speechAvailable;
  const audioStatus = node('p', 'moon-audio-status');
  audioStatus.setAttribute('aria-live', 'polite');
  const choices = node('div', 'moon-choices');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', labels.choices);
  choices.lang = source.locale || 'en';
  choices.dir = source.direction || 'auto';
  const status = node('p', 'moon-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const replay = node('button', 'moon-restart', labels.replay);
  replay.type = 'button';
  replay.hidden = true;
  const continueButton = node('button', 'moon-continue');
  continueButton.type = 'button';
  continueButton.hidden = true;
  sentenceRow.append(sentence, speak);
  challenge.append(sentenceRow, audioStatus, choices, status, continueButton, replay);
  const footer = node('footer', 'moon-session-status'), round = node('span', 'moon-round');
  footer.append(round);
  board.append(overview, challenge, footer);
  const brandFooter = node('footer', 'moon-brand-footer');
  const brand = node('a', 'moon-brand');
  brand.href = 'https://www.waajacu.com/';
  brand.target = '_blank';
  brand.setAttribute('rel', 'noopener');
  const logo = node('img', 'moon-brand-logo');
  logo.src = '/language-runtime/static/assets/caatuu-shell-512.png';
  logo.setAttribute('alt', '');
  const brandText = node('span', '', 'by Waajacu'), trademark = node('sup', '', '™');
  trademark.setAttribute('aria-hidden', 'true');
  brandText.append(trademark);
  brand.append(logo, brandText);
  brandFooter.append(brand);
  root.replaceChildren(board, brandFooter);
  root.classList.add('memory-moon-host');
  let session = null, busy = true, available = true, lastSentence = null, lastComplete = null;
  let lastItemId = null, lastReading = null;
  let speechState = { status: 'idle' }, failed = false, campaign = false, completedView = false;

  function renderWord(host, word, { item, tokenIndex } = {}) {
    host.lang = target.locale || 'und';
    host.dir = target.direction || 'auto';
    if (readingGuide?.supports?.(word)) return readingGuide.render(host, word);
    pruneTextRuns();
    const run = { word, units: moonWordReadingUnits(item, word, tokenIndex, target.locale) };
    const rendered = paintTextRun(host, run);
    if (chinese && rendered) textRuns.set(host, run);
    else textRuns.delete(host);
    return rendered;
  }
  function renderSentence(text, complete, item) {
    if (text === lastSentence && complete === lastComplete && item?.id === lastItemId
        && item?.targetReading === lastReading) return;
    lastSentence = text;
    lastComplete = complete;
    lastItemId = item?.id;
    lastReading = item?.targetReading;
    sentence.replaceChildren();
    sentence.lang = complete ? source.locale || 'en' : target.locale || 'und';
    sentence.dir = complete ? source.direction || 'auto' : target.direction || 'auto';
    sentence.setAttribute('aria-label', text);
    if (complete || (!speechAvailable && !onSelectWord)) { sentence.textContent = text; return; }
    let cluster, tokenIndex = 0;
    for (const token of tokenizeMoonText(text, target.locale)) {
      if (token.word) {
        cluster = node('span', 'moon-token-cluster');
        const button = node('button', 'moon-word-token');
        const index = tokenIndex++;
        button.type = 'button';
        button.dataset.spokenWord = token.text;
        button.dataset.tokenIndex = String(index);
        renderWord(button, token.text, { item, tokenIndex: index });
        button.setAttribute('aria-label', onSelectWord ? labels.selectWord(token.text) : labels.word(token.text));
        button.addEventListener('click', () => {
          if (button.disabled) return;
          if (onSelectWord) onSelectWord(token.text, { item, tokenIndex: index, button });
          else onSpeak?.(token.text);
        });
        cluster.append(button);
        sentence.append(cluster);
      } else if (/^\s+$/u.test(token.text)) { sentence.append(token.text); cluster = null; }
      else (cluster || sentence).append(node('span', 'moon-punctuation-token', token.text));
    }
  }
  function syncSpeech(state = speechState) {
    speechState = state || { status: 'idle' };
    const item = session?.currentItem || session?.items?.[session.index];
    const active = ['loading', 'playing'].includes(speechState.status);
    const whole = active && speechState.text === item?.targetText;
    const reviewable = ['question', 'answered'].includes(session?.phase)
      || (session?.phase === 'complete' && !completedView);
    speak.hidden = !speechAvailable || !item || completedView;
    speak.disabled = busy || !available || !reviewable;
    speak.setAttribute('aria-label', whole ? labels.stop : labels.play);
    speak.title = whole ? labels.stop : labels.play;
    speak.setAttribute('aria-pressed', String(whole));
    speak.setAttribute('aria-busy', String(whole && speechState.status === 'loading'));
    speak.replaceChildren(createSpeechIcon(document, { stop: whole }));
    sentence.querySelectorAll('[data-spoken-word]').forEach(button => {
      const selected = active && speechState.text === button.dataset.spokenWord;
      button.disabled = busy || !available || !reviewable;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    audioStatus.classList.toggle('is-error', speechState.status === 'error');
    audioStatus.textContent = speechState.status === 'error' ? labels.audioError
      : speechState.status === 'loading' ? labels.preparing : speechState.status === 'playing' ? labels.playing : '';
  }
  function render(snapshot, { wrongChoiceId, loading = false, error = false, interactive = true,
    campaignMode = false, completionReady = true, illumination = 0 } = {}) {
    session = snapshot;
    busy = loading;
    failed = error;
    available = interactive;
    campaign = campaignMode;
    root.setAttribute('aria-busy', String(busy));
    board.setAttribute('aria-busy', String(busy));
    const complete = session?.phase === 'complete' && completionReady;
    const answered = session?.phase === 'answered' || (session?.phase === 'complete' && !completionReady);
    completedView = complete;
    board.classList.toggle('is-complete', complete);
    globe.setAttribute('aria-label', labels.illumination(Math.round(illumination * 100)));
    round.textContent = complete ? labels.restored : session ? labels.round(session.index + 1, session.target) : '';
    const item = session?.currentItem || session?.items?.[session.index];
    renderSentence(complete ? labels.complete : loading || error ? '' : item?.targetText || '', complete, item);
    choices.replaceChildren();
    if (item && !complete && !loading && !error) for (const choice of item.choices) {
      const button = node('button', 'moon-choice', choice.text);
      const wrong = session.wrongChoiceIds?.includes(choice.id);
      button.type = 'button';
      button.dataset.choiceId = choice.id;
      button.disabled = busy || !available || wrong || session.phase !== 'question';
      button.classList.toggle('is-wrong', Boolean(wrong));
      button.classList.toggle('is-correct', answered && choice.id === item.correctChoiceId);
      button.classList.toggle('is-shaking', wrongChoiceId === choice.id);
      button.addEventListener('click', () => onAnswer?.(choice.id));
      choices.append(button);
    }
    status.classList.toggle('is-error', Boolean(error));
    status.textContent = loading ? labels.loading : error ? labels.error : complete ? labels.complete
      : answered ? labels.correct : session?.wrongChoiceIds?.length ? labels.wrong : '';
    replay.textContent = error ? labels.retry : labels.replay;
    replay.hidden = !error && (!complete || campaign);
    replay.disabled = loading || !available;
    syncSpeech();
  }
  const speakClick = () => {
    const item = session?.currentItem || session?.items?.[session.index];
    if (!speak.disabled && item) onSpeak?.(item.targetText);
  };
  const replayClick = () => { if (!replay.disabled && (failed || session?.phase === 'complete')) onReplay?.(); };
  speak.addEventListener('click', speakClick);
  replay.addEventListener('click', replayClick);
  return { board, toolbar, dictionarySlot, globe, shade, ship, shipImage, choices, sentence, replay, continueButton, targetTextSettings,
    renderDictionaryWord: renderWord,
    render, syncSpeech,
    focusChoice() { choices.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }); },
    destroy() {
      destroyed = true;
      preferenceListeners.splice(0).forEach(remove => remove());
      textRuns.clear();
      root.replaceChildren(); root.classList.remove('memory-moon-host');
    }
  };
}
