import {
  logInfo,
  logSuccess,
  logError,
  logWarn,
  clearLogs,
  getLogsText,
  copyText,
} from './utils.js';
import { renderZh, alignPinyinToText, esc as escHtml } from './zh.js';
import { initResizers } from './resizers.js';

const THEME_KEY = 'ui_theme_v1';
const SHOW_SETTINGS_KEY = 'show_settings_panel_v1';
const DIFFICULTY_KEY = 'difficulty';
const PINYIN_KEY = 'zh_pinyin_show_v2';
const TONE_KEY = 'zh_tone_show_v2';
const SEED_TRANSLATE_KEY = 'seq_seed_translate_v1';
const RT_PINYIN_KEY = 'realtime_pinyin';
const RT_TRANSLATION_KEY = 'realtime_translation';
const NEXT_CHAR_KEY = 'next_char_suggest';
const SECUENCE_WORD_COUNT = 44;

const CONNECTORS = [
  '因为', '所以', '由于', '因此', '既然', '就', '正因为', '是因为', '之所以', '原因在于',
  '导致', '使得', '因而', '于是', '结果', '结果是', '从而', '进而', '以至于',
  '如果', '要是', '假如', '只要', '只有', '才', '除非', '否则', '的话', '在', '情况下',
  '虽然', '但是', '但', '尽管', '仍然', '不过', '可是', '然而', '却', '反而',
  '表面上', '其实', '一方面', '另一方面', '当', '的时候', '以后', '之后', '之前',
  '从', '开始', '自从', '随着', '每当', '为了', '以便', '好让', '为的是', '免得', '以免',
  '起见', '不但', '而且', '不仅', '还', '并且', '同时', '也', '除了', '以外', '要么',
  '或者', '不是', '就是', '与其', '不如', '宁可', '也不',
];
const CONNECTOR_SET = new Set(CONNECTORS);
const PUNCT = ['，', '。', '？', '！'];
const COMMON_SEED_WORDS = [
  '今天', '明天', '昨天', '早上', '中午', '晚上', '现在',
  '我们', '你们', '他们', '朋友', '老师', '学生',
  '学校', '公司', '家里', '公园', '路上', '地铁', '公交',
  '工作', '学习', '准备', '开始', '结束',
  '吃饭', '喝水', '睡觉', '回家', '回来',
  '喜欢', '需要', '觉得', '马上', '已经', '非常', '有点',
  '一起', '堵车', '计划', '安排', '完成', '继续',
];

const state = {
  challenge: null,
  selected: [],
  words: [],
  seedWordSet: new Set(),
  pinyinMap: new Map(),
  pinyinDone: new Set(),
  pinyinQueue: new Set(),
  pinyinTimer: null,
  seedTranslation: '',
  seedTranslationFor: '',
  seedTranslating: false,
  seedTranslationCache: new Map(),
  nextSuggestion: { char: '', pinyin: '', reason: '' },
  nextSuggestionReq: 0,
};

function $(sel, root = document){
  return root.querySelector(sel);
}

function getBool(key, def){
  const v = localStorage.getItem(key);
  if (v === null) {
    localStorage.setItem(key, def ? '1' : '0');
    return def;
  }
  return v === '1';
}

function setBool(key, value){
  localStorage.setItem(key, value ? '1' : '0');
}

function normalizeTheme(v){
  return v === 'light' ? 'light' : 'dark';
}

function applyTheme(v){
  const t = normalizeTheme(v);
  document.body.setAttribute('data-theme', t);
  return t;
}

function showPinyin(){
  return getBool(PINYIN_KEY, true);
}

function showTone(){
  return getBool(TONE_KEY, true);
}

function showSeedTranslation(){
  return getBool(SEED_TRANSLATE_KEY, false);
}

function showAssistPinyin(){
  return getBool(RT_PINYIN_KEY, true);
}

function showAssistTranslation(){
  return getBool(RT_TRANSLATION_KEY, true);
}

function showNextCharSuggestion(){
  return getBool(NEXT_CHAR_KEY, true);
}

function needPinyin(){
  return showPinyin() || showTone();
}

function hasCjk(s){
  return /[\u3400-\u9fff]/.test(String(s || ''));
}

function normalizeWord(word){
  return String(word || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^[，,。.;；:：!?？！…"'"'"'“”‘’()（）]+/, '')
    .replace(/[，,。.;；:：!?？！…"'"'"'“”‘’()（）]+$/, '');
}

function isConnectorWord(word){
  const t = normalizeWord(word);
  return !!t && CONNECTOR_SET.has(t);
}

function currentDifficulty(){
  const v = localStorage.getItem(DIFFICULTY_KEY) || 'auto';
  if (v !== 'auto') return v;
  const pool = ['hsk1', 'hsk2', 'hsk3', 'hsk4', 'hsk5', 'hsk6'];
  return pool[Math.floor(Math.random() * pool.length)];
}

function setLoading(flag){
  const panel = $('#secuencePanel');
  if (panel) panel.setAttribute('data-loading', flag ? 'true' : 'false');
}

function renderTokenZh(text){
  const raw = String(text || '');
  if (!raw) return '';

  if (!needPinyin()) return escHtml(raw);

  const py = state.pinyinMap.get(raw) || '';
  if (!py) {
    queuePinyin([raw]);
    return escHtml(raw);
  }
  const arr = alignPinyinToText(raw, py);
  return renderZh(raw, arr, showPinyin(), showTone());
}

function createToken(word, kindClass, onClick){
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `seq-token ${kindClass}`;
  b.innerHTML = renderTokenZh(word);
  b.addEventListener('click', onClick);
  return b;
}

function renderSeed(){
  const el = $('#sequenceSeed');
  const enEl = $('#sequenceSeedEn');
  if (!el || !enEl) return;
  const seed = state.challenge?.seed_zh || '';
  el.innerHTML = seed ? renderTokenZh(seed) : '<span class="subtle">(loading seed)</span>';

  const showEn = showSeedTranslation() && !!seed;
  if (!showEn) {
    enEl.hidden = true;
    enEl.textContent = '';
    return;
  }

  enEl.hidden = false;
  if (state.seedTranslationFor === seed && state.seedTranslating) {
    enEl.textContent = 'Translating seed...';
    return;
  }
  if (state.seedTranslationFor === seed && state.seedTranslation) {
    enEl.textContent = state.seedTranslation;
    return;
  }
  enEl.textContent = '(translation unavailable)';
}

function renderConnectorBank(){
  const el = $('#sequenceConnectors');
  if (!el) return;
  el.innerHTML = '';
  for (const word of CONNECTORS) {
    el.appendChild(createToken(word, 'seq-connector', ()=>{
      addSelected(word, 'connector');
    }));
  }
}

function renderWordBank(){
  const el = $('#sequenceWordOptions');
  if (!el) return;
  el.innerHTML = '';
  for (const word of state.words) {
    const fromSeed = state.seedWordSet.has(word);
    const klass = fromSeed ? 'seq-option seq-option-seed' : 'seq-option';
    const kind = fromSeed ? 'seed' : 'option';
    el.appendChild(createToken(word, klass, ()=>{
      addSelected(word, kind);
    }));
  }
}

function renderSelected(){
  const box = $('#sequenceBuildWords');
  if (!box) return;
  box.innerHTML = '';
  if (!state.selected.length) {
    box.innerHTML = '<span class="subtle seq-placeholder">Click connectors and words to build your sentence.</span>';
    return;
  }

  state.selected.forEach((entry, idx)=>{
    const extra = entry.kind === 'connector'
      ? 'seq-connector'
      : (entry.kind === 'seed' ? 'seq-option-seed' : 'seq-option');
    box.appendChild(createToken(entry.word, `seq-selected ${extra}`, ()=>{
      removeSelectedAt(idx);
    }));
  });
}

function renderNextCharSuggestion(){
  const el = $('#liveNextChar');
  if (!el) return;
  if (!showNextCharSuggestion()) {
    el.textContent = '';
    return;
  }
  const { char, pinyin } = state.nextSuggestion;
  el.textContent = char ? `${char}  (${pinyin || '?'})` : '';
}

function rerenderAll(){
  renderSeed();
  renderConnectorBank();
  renderWordBank();
  renderSelected();
}

function queuePinyin(words){
  if (!needPinyin()) return;
  for (const raw of words) {
    const w = String(raw || '').trim();
    if (!w || !hasCjk(w)) continue;
    if (state.pinyinDone.has(w)) continue;
    state.pinyinQueue.add(w);
  }
  if (state.pinyinTimer) return;
  state.pinyinTimer = setTimeout(()=>{
    state.pinyinTimer = null;
    flushPinyinQueue();
  }, 30);
}

async function fetchJSON(url, opts = {}){
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text().catch(()=>'');
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

async function fetchPinyinSingle(word){
  try {
    const data = await fetchJSON('/api/v1/pinyin', {
      method: 'POST',
      body: JSON.stringify({ text: word }),
    });
    const py = String(data.pinyin || '').trim();
    state.pinyinMap.set(word, py);
  } catch {
    state.pinyinMap.set(word, '');
  }
  state.pinyinDone.add(word);
}

async function flushPinyinQueue(){
  const items = Array.from(state.pinyinQueue);
  if (!items.length || !needPinyin()) return;
  state.pinyinQueue.clear();

  const text = items.join('|');
  try {
    const data = await fetchJSON('/api/v1/pinyin', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    const raw = String(data.pinyin || '');
    const parts = raw.split('|');
    if (parts.length === items.length) {
      items.forEach((w, i)=>{
        state.pinyinMap.set(w, String(parts[i] || '').trim());
        state.pinyinDone.add(w);
      });
    } else {
      for (const w of items) {
        await fetchPinyinSingle(w);
      }
    }
    rerenderAll();
  } catch {
    for (const w of items) {
      await fetchPinyinSingle(w);
    }
    rerenderAll();
  }
}

async function ensureSeedTranslation(){
  const seed = String(state.challenge?.seed_zh || '').trim();
  if (!showSeedTranslation() || !seed) {
    state.seedTranslating = false;
    renderSeed();
    return;
  }

  if (state.seedTranslationFor === seed && state.seedTranslation) {
    renderSeed();
    return;
  }
  if (state.seedTranslationCache.has(seed)) {
    state.seedTranslationFor = seed;
    state.seedTranslation = state.seedTranslationCache.get(seed) || '';
    state.seedTranslating = false;
    renderSeed();
    return;
  }
  if (state.seedTranslating && state.seedTranslationFor === seed) return;

  state.seedTranslationFor = seed;
  state.seedTranslation = '';
  state.seedTranslating = true;
  renderSeed();

  try {
    const data = await fetchJSON('/api/v1/translate', {
      method: 'POST',
      body: JSON.stringify({ text: seed, fastOnly: true }),
    });
    const translated = String(data.translation || '').trim();
    if (state.seedTranslationFor !== seed) return;
    state.seedTranslation = translated;
    if (translated) state.seedTranslationCache.set(seed, translated);
  } catch (e) {
    if (state.seedTranslationFor === seed) {
      state.seedTranslation = '';
    }
    logWarn(`Seed translation unavailable: ${e.message || e}`);
  } finally {
    if (state.seedTranslationFor === seed) {
      state.seedTranslating = false;
      renderSeed();
    }
  }
}

function currentAnswer(){
  return state.selected.map(x => x.word).join('');
}

async function updateNextCharSuggestion(){
  renderNextCharSuggestion();
  if (!showNextCharSuggestion()) return;

  const challengeId = String(state.challenge?.id || '').trim();
  const current = currentAnswer();
  if (!challengeId || !current) {
    state.nextSuggestion = { char: '', pinyin: '', reason: '' };
    renderNextCharSuggestion();
    return;
  }

  const reqId = ++state.nextSuggestionReq;
  try {
    const out = await fetchJSON('/api/v1/next_char', {
      method: 'POST',
      body: JSON.stringify({ challengeId, current }),
    });
    if (reqId !== state.nextSuggestionReq) return;
    state.nextSuggestion = {
      char: String(out.char || ''),
      pinyin: String(out.pinyin || ''),
      reason: String(out.reason || ''),
    };
    renderNextCharSuggestion();
  } catch {
    if (reqId !== state.nextSuggestionReq) return;
    state.nextSuggestion = { char: '', pinyin: '', reason: '' };
    renderNextCharSuggestion();
  }
}

function addSelected(word, kind){
  state.selected.push({ word, kind });
  renderSelected();
  updateNextCharSuggestion();
}

function removeSelectedAt(idx){
  state.selected.splice(idx, 1);
  renderSelected();
  updateNextCharSuggestion();
}

function clearSelected(){
  state.selected = [];
  renderSelected();
  updateNextCharSuggestion();
}

function resetAssistArtifacts(){
  const grammar = $('#liveGrammar');
  if (grammar) grammar.innerHTML = '<span class="subtle">Use Assist for corrections.</span>';
  const translation = $('#liveTranslation');
  if (translation) translation.textContent = '';
  const pinyin = $('#livePinyin');
  if (pinyin) pinyin.textContent = '';
  state.nextSuggestion = { char: '', pinyin: '', reason: '' };
  renderNextCharSuggestion();
}

function applyAssistVisibility(){
  const showRTpy = showAssistPinyin();
  const showRTen = showAssistTranslation();
  const showNext = showNextCharSuggestion();

  $('#rtRowPinyin')?.classList.toggle('hidden', !showRTpy);
  $('#rtRowTrans')?.classList.toggle('hidden', !showRTen);
  $('#rtRowNextChar')?.classList.toggle('hidden', !showNext);

  const assistCard = $('#assistCard');
  const allHidden = (!showRTpy && !showRTen && !showNext);
  if (assistCard) assistCard.style.display = allHidden ? 'none' : '';
}

function diffSegments(aStr, bStr){
  const A = Array.from(aStr || '');
  const B = Array.from(bStr || '');
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, ()=> new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      L[i][j] = (A[i - 1] === B[j - 1]) ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    }
  }

  const outRev = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) {
      outRev.push({ t: 'eq', ch: A[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || L[i][j - 1] >= L[i - 1]?.[j] || i === 0)) {
      outRev.push({ t: 'ins', ch: B[j - 1] });
      j--;
    } else if (i > 0) {
      outRev.push({ t: 'del', ch: A[i - 1] });
      i--;
    }
  }

  const seq = outRev.reverse();
  const grouped = [];
  let cur = null;
  for (const s of seq) {
    if (!cur || cur.t !== s.t) {
      cur = { t: s.t, text: s.ch };
      grouped.push(cur);
    } else {
      cur.text += s.ch;
    }
  }
  return grouped;
}

function renderGrammarDiff(original, corrected){
  const segs = diffSegments(original, corrected);
  let origHtml = '';
  let corrHtml = '';
  for (const seg of segs) {
    const safe = escHtml(seg.text);
    if (seg.t === 'eq') {
      origHtml += safe;
      corrHtml += safe;
    } else if (seg.t === 'del') {
      origHtml += `<span class="gc-del">${safe}</span>`;
    } else if (seg.t === 'ins') {
      corrHtml += `<span class="gc-ins">${safe}</span>`;
    }
  }

  return `
    <div class="gc-row"><div class="gc-label">You</div><div class="gc-line">${origHtml}</div></div>
    <div class="gc-row"><div class="gc-label">Corrected</div><div class="gc-line">${corrHtml}</div></div>
    <div class="gc-legend">
      <span class="sw add"></span> Added
      <span class="sw del"></span> Removed
    </div>
  `;
}

function setChallenge(ch){
  state.challenge = ch || null;
  const seed = String(ch?.seed_zh || '');
  state.seedWordSet = new Set();
  state.seedTranslationFor = seed;
  state.seedTranslation = state.seedTranslationCache.get(seed) || '';
  state.seedTranslating = false;
  clearSelected();
  resetAssistArtifacts();
  applyAssistVisibility();
  renderSeed();
}

function uniqueList(words){
  const out = [];
  const seen = new Set();
  for (const raw of words) {
    const w = normalizeWord(raw);
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function extractSeedWords(seed, extraLexicon = []){
  const lex = new Set(
    COMMON_SEED_WORDS
      .concat(CONNECTORS)
      .concat(extraLexicon || [])
      .map(normalizeWord)
      .filter(Boolean)
  );
  const text = String(seed || '').trim().replace(/\s+/g, '');
  if (!text) return [];

  const out = [];
  const parts = text.split(/[，,。.;；:：!?？！\n\r]+/).filter(Boolean);

  for (const partRaw of parts) {
    const part = normalizeWord(partRaw);
    if (!part || !hasCjk(part)) continue;

    let i = 0;
    while (i < part.length) {
      let found = '';
      // Keep seed chips strict: prefer 2-char words, otherwise single-char.
      const maxLen = Math.min(2, part.length - i);
      for (let len = maxLen; len >= 1; len--) {
        const cand = part.slice(i, i + len);
        if (lex.has(cand)) {
          found = cand;
          break;
        }
      }

      if (!found) {
        found = part.slice(i, i + 1);
      }

      if (hasCjk(found) && !isConnectorWord(found)) out.push(found);
      i += found.length;
    }
  }

  return uniqueList(out);
}

async function loadWordBank(){
  if (!state.challenge) return;
  const diff = state.challenge.difficulty || currentDifficulty();
  const seedText = state.challenge.seed_zh || '';
  const seedWordsFallback = extractSeedWords(seedText);
  let seedWords = seedWordsFallback;
  state.seedWordSet = new Set(seedWords);
  const payload = {
    difficulty: diff,
    seedZh: seedText,
    targetCount: SECUENCE_WORD_COUNT,
  };

  try {
    const data = await fetchJSON('/api/v1/secuence/words', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const raw = Array.isArray(data.words) ? data.words : [];
    seedWords = extractSeedWords(seedText, raw);
    state.seedWordSet = new Set(seedWords);
    const filtered = raw.filter(w => !isConnectorWord(w));
    const words = uniqueList(seedWords.concat(filtered).concat(PUNCT));
    state.words = words;
    renderWordBank();
    logInfo(`Word bank generated (${words.length} options).`);
    queuePinyin([state.challenge.seed_zh, ...CONNECTORS, ...state.words]);
  } catch (e) {
    state.seedWordSet = new Set(seedWordsFallback);
    state.words = uniqueList(seedWordsFallback.concat(PUNCT));
    renderWordBank();
    queuePinyin([state.challenge.seed_zh, ...CONNECTORS, ...state.words]);
    logWarn(`Word bank fallback: ${e.message || e}`);
  }
}

async function loadChallenge(){
  setLoading(true);
  const diff = currentDifficulty();
  try {
    const challenge = await fetchJSON(
      `/api/v1/challenge?difficulty=${encodeURIComponent(diff)}&_=${Date.now()}`,
      { cache: 'no-store' }
    );
    setChallenge(challenge);
    await loadWordBank();
    logSuccess(`Secuence seed loaded (${challenge.difficulty || diff}).`);
  } catch (e) {
    logError(`Failed to load seed: ${e.message || e}`);
  } finally {
    setLoading(false);
  }
}

function showSequenceFeedback(ok, score, explanation){
  const feedback = $('#sequenceFeedback');
  if (!feedback) return;
  feedback.className = ok ? 'ok show' : 'err show';
  feedback.textContent = `${ok ? 'PASS' : 'RETRY'} · Score ${Math.round(score || 0)}. ${explanation || ''}`;
}

async function submitAnswer(){
  const seed = state.challenge?.seed_zh || '';
  if (!seed) {
    logWarn('No active seed to evaluate against.');
    return;
  }
  const answer = currentAnswer().trim();
  if (!answer) {
    logWarn('Build a sentence before submit.');
    return;
  }

  setLoading(true);
  try {
    const out = await fetchJSON('/api/v1/secuence/evaluate', {
      method: 'POST',
      body: JSON.stringify({ seedZh: seed, answer }),
    });
    showSequenceFeedback(!!out.correct, out.score, out.explanation || '');
    if (out.correct) logSuccess(`Secuence answer accepted · score ${Math.round(out.score || 0)}.`);
    else logWarn(`Secuence answer needs work · score ${Math.round(out.score || 0)}.`);
  } catch (e) {
    logError(`Submit failed: ${e.message || e}`);
  } finally {
    setLoading(false);
  }
}

async function runAssist(){
  const txt = currentAnswer().trim();
  if (!txt) {
    logWarn('Build a sentence before Assist.');
    return;
  }
  const needPy = showAssistPinyin();
  const needEn = showAssistTranslation();

  setLoading(true);
  try {
    const [grammarRes, translateRes, pinyinRes] = await Promise.allSettled([
      fetchJSON('/api/v1/grammar', {
        method: 'POST',
        body: JSON.stringify({ text: txt }),
      }),
      needEn ? fetchJSON('/api/v1/translate', {
        method: 'POST',
        body: JSON.stringify({ text: txt, fastOnly: true }),
      }) : Promise.resolve(null),
      needPy ? fetchJSON('/api/v1/pinyin', {
        method: 'POST',
        body: JSON.stringify({ text: txt }),
      }) : Promise.resolve(null),
    ]);

    const grammarBox = $('#liveGrammar');
    if (grammarRes.status === 'fulfilled') {
      const corrected = String(grammarRes.value?.corrected || '').trim();
      if (grammarBox) grammarBox.innerHTML = renderGrammarDiff(txt, corrected || txt);
      logInfo('Grammar correction received.');
    } else {
      if (grammarBox) grammarBox.innerHTML = '<span class="subtle">Assist grammar unavailable right now.</span>';
      logWarn(`Assist grammar failed: ${grammarRes.reason?.message || grammarRes.reason}`);
    }

    const transBox = $('#liveTranslation');
    if (translateRes.status === 'fulfilled' && needEn) {
      const translation = String(translateRes.value?.translation || '').trim();
      if (transBox) transBox.textContent = translation;
    } else if (translateRes.status === 'rejected' && needEn) {
      logWarn(`Assist translation failed: ${translateRes.reason?.message || translateRes.reason}`);
    }

    const pinyinBox = $('#livePinyin');
    if (pinyinRes.status === 'fulfilled' && needPy) {
      const py = String(pinyinRes.value?.pinyin || '').trim();
      if (pinyinBox) pinyinBox.textContent = py;
    } else if (pinyinRes.status === 'rejected' && needPy) {
      logWarn(`Assist pinyin failed: ${pinyinRes.reason?.message || pinyinRes.reason}`);
    }

    updateNextCharSuggestion();
  } finally {
    setLoading(false);
  }
}

function applySettingsVisibility(){
  const grid = $('#settingsGrid');
  const btn = $('#toggleSettingsBtn');
  const visible = (localStorage.getItem(SHOW_SETTINGS_KEY) ?? '1') === '1';
  if (grid) grid.style.display = visible ? 'grid' : 'none';
  if (btn) {
    btn.textContent = visible ? '▾' : '▸';
    btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    btn.title = visible ? 'Hide settings' : 'Show settings';
  }
}

function syncSettingsUI(){
  const theme = applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  if ($('#themeSel')) $('#themeSel').value = theme;
  if ($('#difficultySel')) $('#difficultySel').value = localStorage.getItem(DIFFICULTY_KEY) || 'auto';

  const toneOn = getBool(TONE_KEY, true);
  const pinyinOn = getBool(PINYIN_KEY, true);
  const seedTranslateOn = getBool(SEED_TRANSLATE_KEY, false);
  const rtPinyinOn = getBool(RT_PINYIN_KEY, true);
  const rtTranslationOn = getBool(RT_TRANSLATION_KEY, true);
  const nextCharOn = getBool(NEXT_CHAR_KEY, true);
  if ($('#tglTone')) $('#tglTone').checked = toneOn;
  if ($('#tglPinyin')) $('#tglPinyin').checked = pinyinOn;
  if ($('#tglSeedTranslate')) $('#tglSeedTranslate').checked = seedTranslateOn;
  if ($('#tglRTPinyin')) $('#tglRTPinyin').checked = rtPinyinOn;
  if ($('#tglRTTrans')) $('#tglRTTrans').checked = rtTranslationOn;
  if ($('#tglNextChar')) $('#tglNextChar').checked = nextCharOn;

  applySettingsVisibility();
  applyAssistVisibility();
  renderNextCharSuggestion();
}

function bindEvents(){
  $('#sequenceClearBtn')?.addEventListener('click', clearSelected);
  $('#sequenceAssistBtn')?.addEventListener('click', ()=>{ runAssist(); });
  $('#sequenceNextBtn')?.addEventListener('click', ()=>{ loadChallenge(); });
  $('#sequenceSubmitBtn')?.addEventListener('click', ()=>{ submitAnswer(); });

  document.addEventListener('keydown', (e)=>{
    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      runAssist();
    }
  });

  $('#copyLogBtn')?.addEventListener('click', async ()=>{
    const ok = await copyText(getLogsText());
    if (ok) logSuccess('Event log copied.');
    else logError('Failed to copy event log.');
  });
  $('#clearLogBtn')?.addEventListener('click', ()=>{
    clearLogs();
    logInfo('Event log cleared.');
  });

  $('#toggleSettingsBtn')?.addEventListener('click', ()=>{
    const now = (localStorage.getItem(SHOW_SETTINGS_KEY) ?? '1') === '1';
    localStorage.setItem(SHOW_SETTINGS_KEY, now ? '0' : '1');
    applySettingsVisibility();
  });

  $('#difficultySel')?.addEventListener('change', (e)=>{
    localStorage.setItem(DIFFICULTY_KEY, e.target.value || 'auto');
    logInfo(`Difficulty set to ${e.target.value || 'auto'}.`);
  });

  $('#themeSel')?.addEventListener('change', (e)=>{
    const t = applyTheme(e.target.value);
    localStorage.setItem(THEME_KEY, t);
  });

  $('#tglTone')?.addEventListener('change', (e)=>{
    setBool(TONE_KEY, !!e.target.checked);
    rerenderAll();
  });

  $('#tglPinyin')?.addEventListener('change', (e)=>{
    setBool(PINYIN_KEY, !!e.target.checked);
    rerenderAll();
  });

  $('#tglRTPinyin')?.addEventListener('change', (e)=>{
    setBool(RT_PINYIN_KEY, !!e.target.checked);
    applyAssistVisibility();
  });

  $('#tglRTTrans')?.addEventListener('change', (e)=>{
    setBool(RT_TRANSLATION_KEY, !!e.target.checked);
    applyAssistVisibility();
  });

  $('#tglNextChar')?.addEventListener('change', (e)=>{
    setBool(NEXT_CHAR_KEY, !!e.target.checked);
    applyAssistVisibility();
    updateNextCharSuggestion();
  });

  $('#tglSeedTranslate')?.addEventListener('change', (e)=>{
    setBool(SEED_TRANSLATE_KEY, !!e.target.checked);
    if (!e.target.checked) {
      state.seedTranslating = false;
      renderSeed();
      return;
    }
    ensureSeedTranslation();
  });
}

(function init(){
  setBool(TONE_KEY, true);
  setBool(PINYIN_KEY, true);
  initResizers();
  syncSettingsUI();
  bindEvents();
  resetAssistArtifacts();
  rerenderAll();
  loadChallenge();
})();
