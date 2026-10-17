import { createSpeechIcon } from '../embedded-game-controls.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
let sequence = 0;

export function moonLabels(course, i18n) {
  const spanish = /^es(?:-|$)/i.test(course?.sourceLanguage?.locale || '');
  const labels = spanish ? {
    game: 'Memory Moon: traducciones', choices: 'Elige la traducción',
    loading: 'Preparando recuerdos…', error: 'No se pudo cargar la práctica.',
    retry: 'Volver a intentar', replay: 'Otra luna', complete: 'Has iluminado la luna.',
    restored: 'Luna completa', round: (index, total) => `Recuerdo ${index} de ${total}`,
    correct: 'Correcto. El siguiente recuerdo aparecerá en un momento.', wrong: 'Prueba otra traducción.',
    play: 'Escuchar la frase', stop: 'Detener audio', word: text => `Escuchar: ${text}`,
    preparing: 'Preparando audio.', playing: 'Reproduciendo audio.', audioError: 'El audio no está disponible.',
    illumination: percent => `${percent} por ciento de la luna iluminado`
  } : {
    game: 'Memory Moon translation practice', choices: 'Choose the translation',
    loading: 'Preparing memories…', error: 'Practice could not be loaded.',
    retry: 'Try again', replay: 'Another moon', complete: 'You brought the moon to light.',
    restored: 'Moon restored', round: (index, total) => `Memory ${index} of ${total}`,
    correct: 'Correct. The next memory will appear shortly.', wrong: 'Try another translation.',
    play: 'Play sentence audio', stop: 'Stop audio', word: text => `Play word: ${text}`,
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

export function createMoonRenderer({ root, course, i18n, onAnswer, onSpeak, onReplay } = {}) {
  const document = root?.ownerDocument;
  if (!document) throw new TypeError('Memory Moon needs a local root.');
  const labels = moonLabels(course, i18n);
  const speechAvailable = course?.capabilities?.speech === true;
  const target = course?.targetLanguage || {}, source = course?.sourceLanguage || {};
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
  overview.append(figure, toolbar);
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
  sentenceRow.append(sentence, speak);
  challenge.append(sentenceRow, audioStatus, choices, status, replay);
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
  let speechState = { status: 'idle' }, failed = false, campaign = false;

  function renderSentence(text, complete) {
    if (text === lastSentence && complete === lastComplete) return;
    lastSentence = text;
    lastComplete = complete;
    sentence.replaceChildren();
    sentence.lang = complete ? source.locale || 'en' : target.locale || 'und';
    sentence.dir = complete ? source.direction || 'auto' : target.direction || 'auto';
    sentence.setAttribute('aria-label', text);
    if (complete || !speechAvailable) { sentence.textContent = text; return; }
    let cluster;
    for (const token of tokenizeMoonText(text, target.locale)) {
      if (token.word) {
        cluster = node('span', 'moon-token-cluster');
        const button = node('button', 'moon-word-token', token.text);
        button.type = 'button';
        button.dataset.spokenWord = token.text;
        button.setAttribute('aria-label', labels.word(token.text));
        button.addEventListener('click', () => onSpeak?.(token.text));
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
    speak.hidden = !speechAvailable || !item || session?.phase === 'complete';
    speak.disabled = busy || !available || session?.phase !== 'question';
    speak.setAttribute('aria-label', whole ? labels.stop : labels.play);
    speak.title = whole ? labels.stop : labels.play;
    speak.setAttribute('aria-pressed', String(whole));
    speak.setAttribute('aria-busy', String(whole && speechState.status === 'loading'));
    speak.replaceChildren(createSpeechIcon(document, { stop: whole }));
    sentence.querySelectorAll('[data-spoken-word]').forEach(button => {
      const selected = active && speechState.text === button.dataset.spokenWord;
      button.disabled = busy || !available || session?.phase !== 'question';
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    audioStatus.classList.toggle('is-error', speechState.status === 'error');
    audioStatus.textContent = speechState.status === 'error' ? labels.audioError
      : speechState.status === 'loading' ? labels.preparing : speechState.status === 'playing' ? labels.playing : '';
  }
  function render(snapshot, { wrongChoiceId, loading = false, error = false, interactive = true,
    campaignMode = false, illumination = 0 } = {}) {
    session = snapshot;
    busy = loading;
    failed = error;
    available = interactive;
    campaign = campaignMode;
    root.setAttribute('aria-busy', String(busy));
    board.setAttribute('aria-busy', String(busy));
    const complete = session?.phase === 'complete';
    board.classList.toggle('is-complete', complete);
    globe.setAttribute('aria-label', labels.illumination(Math.round(illumination * 100)));
    round.textContent = complete ? labels.restored : session ? labels.round(session.index + 1, session.target) : '';
    const item = session?.currentItem || session?.items?.[session.index];
    renderSentence(complete ? labels.complete : loading || error ? '' : item?.targetText || '', complete);
    choices.replaceChildren();
    if (item && !complete && !loading && !error) for (const choice of item.choices) {
      const button = node('button', 'moon-choice', choice.text);
      const wrong = session.wrongChoiceIds?.includes(choice.id);
      button.type = 'button';
      button.dataset.choiceId = choice.id;
      button.disabled = busy || !available || wrong || session.phase !== 'question';
      button.classList.toggle('is-wrong', Boolean(wrong));
      button.classList.toggle('is-correct', session.phase === 'answered' && choice.id === item.correctChoiceId);
      button.classList.toggle('is-shaking', wrongChoiceId === choice.id);
      button.addEventListener('click', () => onAnswer?.(choice.id));
      choices.append(button);
    }
    status.classList.toggle('is-error', Boolean(error));
    status.textContent = loading ? labels.loading : error ? labels.error : complete ? labels.complete
      : session?.phase === 'answered' ? labels.correct : session?.wrongChoiceIds?.length ? labels.wrong : '';
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
  return { board, toolbar, globe, shade, ship, shipImage, choices, sentence, replay,
    render, syncSpeech,
    focusChoice() { choices.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }); },
    destroy() { root.replaceChildren(); root.classList.remove('memory-moon-host'); }
  };
}
