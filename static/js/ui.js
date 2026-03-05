import { $, $$, debounce, logInfo, logSuccess, logError, logWarn, getLogsText, clearLogs, copyText } from './utils.js';
import { LSK, ls, current, liveSuggestion } from './state.js';
import { renderZh, alignPinyinToText, esc as escHtml } from './zh.js';
import { okBeep, badBeep, speakText, ttsVoices, ttsSupported, onTTSVoicesChanged } from './audio.js';
import { wsSend } from './socket.js';


const AGENT_MODE_KEY = 'agent_mode_v1';
const SHOW_SETTINGS_KEY = 'show_settings_panel_v1';
const THEME_KEY = 'ui_theme_v1';
const WRITING_GUIDE_KEY = LSK.writingGuide;
const WRITING_GUIDE_AUTO_KEY = LSK.writingGuideAuto;
const WRITING_HINTS_AUTO_KEY = LSK.writingHintsAuto;
const WRITING_GUIDE_BOUNDARY_AUTO_KEY = LSK.writingGuideBoundaryAuto;
const WRITING_DRAFT_AUTO_KEY = LSK.writingDraftAuto;
const WRITING_DRAFT_KEY = LSK.writingDraft;
const AgentMode = { tutor:'tutor', translate:'translate' };
let allowUnloadOnce = false;
const STT_MAX_RECORD_MS = 25000;
const STT_SILENCE_STOP_MS = 2400;
const STT_VAD_THRESHOLD = 0.02;
const WRITING_CONNECTORS = [
  '因为', '所以', '由于', '因此', '既然', '就', '正因为', '是因为', '之所以', '原因在于',
  '导致', '使得', '因而', '于是', '结果', '结果是', '从而', '进而', '以至于',
  '如果', '要是', '假如', '只要', '只有', '才', '除非', '否则', '的话', '在', '情况下',
  '虽然', '但是', '但', '尽管', '仍然', '不过', '可是', '然而', '却', '反而',
  '表面上', '其实', '一方面', '另一方面', '当', '的时候', '以后', '之后', '之前',
  '从', '开始', '自从', '随着', '每当', '为了', '以便', '好让', '为的是', '免得', '以免',
  '起见', '不但', '而且', '不仅', '还', '并且', '同时', '也', '除了', '以外', '要么',
  '或者', '不是', '就是', '与其', '不如', '宁可', '也不',
];
const WRITING_CONNECTOR_PAIRS = [
  { triggers:['因为', '由于', '正因为', '是因为', '之所以', '原因在于'], suggestions:['所以', '因此'], reason:'Close the cause with a result connector.' },
  { triggers:['如果', '要是', '假如', '只要'], suggestions:['就'], reason:'Complete the condition with 就.' },
  { triggers:['只有'], suggestions:['才'], reason:'只有 usually pairs with 才.' },
  { triggers:['除非'], suggestions:['否则'], reason:'除非 often pairs with 否则.' },
  { triggers:['虽然', '尽管'], suggestions:['但是', '却'], reason:'Use a contrast connector after 虽然/尽管.' },
  { triggers:['不但', '不仅'], suggestions:['而且', '还'], reason:'Pair additive structure with 而且/还.' },
  { triggers:['一方面'], suggestions:['另一方面'], reason:'Balance 一方面 with 另一方面.' },
  { triggers:['与其'], suggestions:['不如'], reason:'与其 usually leads to 不如.' },
  { triggers:['宁可'], suggestions:['也不'], reason:'宁可 can pair with 也不.' },
];
const WRITING_CONNECTOR_FALLBACKS = ['因此', '所以', '但是', '然后', '同时', '另外', '为了', '以便'];
const WRITING_CONNECTORS_SORTED = WRITING_CONNECTORS.slice().sort((a, b)=> b.length - a.length);
const HSK_LEVELS = ['hsk1', 'hsk2', 'hsk3', 'hsk4', 'hsk5', 'hsk6'];
const ANSWER_PINYIN_DEBOUNCE_MS = 180;
const WRITING_HINTS_AUTO_DEBOUNCE_MS = 260;
const WRITING_GUIDE_BOUNDARY_DEBOUNCE_MS = 120;
let sttRecorder = null;
let sttStream = null;
let sttChunks = [];
let sttStopTimer = null;
let sttRecording = false;
let sttInFlight = false;
let sttAudioCtx = null;
let sttAnalyser = null;
let sttSource = null;
let sttVadRaf = 0;
let sttSilenceSince = 0;
let sttSawSpeech = false;
let answerPinyinTimer = 0;
let answerPinyinLastRequested = '';
let answerPinyinLastMatchedText = '';
let answerPinyinLastMatchedValue = '';
const pendingAnswerPy = new Map(); // text -> requested_at_ms
let writingAutoHintTimer = 0;
let writingAutoGuideBoundaryTimer = 0;
let writingLastAutoHintInput = '';
let writingLastHintText = '';
let writingInputSnapshot = '';

function inWritingMode(){
  return !!document.body?.classList.contains('mode-writing');
}

function normalizeDifficulty(value){
  const v = String(value || '').trim().toLowerCase();
  return HSK_LEVELS.includes(v) ? v : 'hsk3';
}

function focusWritingInputDefault(){
  if (!inWritingMode()) return;
  const input = $('#answerInput');
  if (!input) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  requestAnimationFrame(()=>{
    const nowActive = document.activeElement;
    if (nowActive && nowActive !== document.body && nowActive !== document.documentElement) return;
    try { input.focus({ preventScroll:true }); } catch { input.focus(); }
  });
}

function writingGuideEnabled(){
  return ls.getBool(WRITING_GUIDE_KEY, true);
}

function writingGuideAutoEnabled(){
  return ls.getBool(WRITING_GUIDE_AUTO_KEY, true);
}

function writingHintsAutoEnabled(){
  return ls.getBool(WRITING_HINTS_AUTO_KEY, false);
}

function writingGuideBoundaryAutoEnabled(){
  return ls.getBool(WRITING_GUIDE_BOUNDARY_AUTO_KEY, true);
}

function writingDraftAutosaveEnabled(){
  return ls.getBool(WRITING_DRAFT_AUTO_KEY, true);
}

function draftTextNow(){
  return String($('#answerInput')?.value || '');
}

function persistWritingDraft({ force = false } = {}){
  if (!inWritingMode()) return;
  if (!force && !writingDraftAutosaveEnabled()) return;
  ls.setStr(WRITING_DRAFT_KEY, draftTextNow());
}

function restoreWritingDraft(){
  if (!inWritingMode()) return;
  const input = $('#answerInput');
  if (!input) return;
  if (input.value && input.value.trim()) return;
  const saved = ls.getStr(WRITING_DRAFT_KEY, '');
  if (!saved) return;
  input.value = saved;
  autoResizeAnswerInput();
  renderWritingStats(saved);
  renderConnectorHints();
  renderAnswerColorLayer({ text: saved, pinyin: '' });
  scheduleAnswerInputPinyin();
  logInfo('Writing draft restored from local storage.');
}

function clearWritingDraft(){
  if (!inWritingMode()) return;
  ls.setStr(WRITING_DRAFT_KEY, '');
  const input = $('#answerInput');
  if (input) {
    input.value = '';
    autoResizeAnswerInput();
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles:true }));
  }
  const feedback = $('#answerFeedback');
  if (feedback) {
    feedback.className = 'show ok';
    feedback.innerHTML = '<strong>Saved</strong> Draft cleared.';
    setTimeout(()=>{
      feedback.className = '';
      feedback.innerHTML = '';
    }, 1800);
  }
}

function extractUsedConnectors(text){
  const out = new Set();
  const raw = String(text || '');
  for (const connector of WRITING_CONNECTORS_SORTED) {
    if (raw.includes(connector)) out.add(connector);
  }
  return out;
}

function pushConnectorSuggestion(list, seen, used, connector, reason){
  const tok = String(connector || '').trim();
  if (!tok || seen.has(tok) || used.has(tok)) return;
  list.push({ connector: tok, reason: String(reason || '').trim() });
  seen.add(tok);
}

function suggestConnectorsForText(text){
  const raw = String(text || '').trim();
  if (!raw) return [];

  const used = extractUsedConnectors(raw);
  const seen = new Set();
  const out = [];

  for (const pair of WRITING_CONNECTOR_PAIRS) {
    if (!pair.triggers.some(t => raw.includes(t))) continue;
    for (const connector of pair.suggestions) {
      pushConnectorSuggestion(out, seen, used, connector, pair.reason);
      if (out.length >= 2) return out;
    }
  }

  const sentenceDone = /[。！？?!]$/.test(raw);
  const fallbackReason = sentenceDone
    ? 'Good option to start the next sentence.'
    : 'Good option to continue this sentence.';

  for (const connector of WRITING_CONNECTOR_FALLBACKS) {
    pushConnectorSuggestion(out, seen, used, connector, fallbackReason);
    if (out.length >= 2) break;
  }
  return out;
}

function normalizeTheme(v){
  return v === 'light' ? 'light' : 'dark';
}
function applyTheme(v){
  const theme = normalizeTheme(v);
  document.body.setAttribute('data-theme', theme);
  return theme;
}

function getAgentMode(){
  const v = ls.getStr(AGENT_MODE_KEY, AgentMode.tutor);
  return (v === AgentMode.translate) ? AgentMode.translate : AgentMode.tutor;
}
function applyAgentModeUI(mode){
  const tutorBtn = $('#agentModeTutorBtn');
  const transBtn = $('#agentModeTranslateBtn');
  const isTutor = mode === AgentMode.tutor;

  if (tutorBtn){
    tutorBtn.classList.toggle('active', isTutor);
    tutorBtn.setAttribute('aria-pressed', isTutor ? 'true' : 'false');
  }
  if (transBtn){
    transBtn.classList.toggle('active', !isTutor);
    transBtn.setAttribute('aria-pressed', !isTutor ? 'true' : 'false');
  }

  const inp = $('#agentInput');
  const sendBtn = $('#agentSendBtn');
  if (inp){
    inp.placeholder = isTutor
      ? 'Ask...'
      : 'Translate...';
  }
  if (sendBtn){
    sendBtn.textContent = '➤';
    sendBtn.setAttribute('title', isTutor ? 'Ask tutor' : 'Translate');
  }
}
function setAgentMode(mode){
  const m = (mode === AgentMode.translate) ? AgentMode.translate : AgentMode.tutor;
  ls.setStr(AGENT_MODE_KEY, m);
  applyAgentModeUI(m);
}

function setSttButtonState(){
  const btn = $('#speechToTextBtn');
  if (!btn) return;
  const sttSupported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  btn.setAttribute('data-recording', sttRecording ? 'true' : 'false');
  btn.setAttribute('data-busy', sttInFlight ? 'true' : 'false');
  btn.disabled = !sttSupported || (sttInFlight || (!inWritingMode() && !!current.loading.challenge));

  if (!sttSupported) {
    btn.textContent = '🎙 STT';
    btn.title = 'Speech-to-text is unavailable in this browser.';
    return;
  }

  if (sttInFlight) {
    btn.textContent = '⏳ STT';
    btn.title = 'Transcribing speech...';
    return;
  }
  if (sttRecording) {
    btn.textContent = '⏹ Stop';
    btn.title = 'Stop recording';
    return;
  }
  btn.textContent = '🎙 STT';
  btn.title = 'Speech to text (Chinese)';
}

function clearSttTimer(){
  if (sttStopTimer) {
    clearTimeout(sttStopTimer);
    sttStopTimer = null;
  }
}

function stopSttStream(){
  stopSttVad();
  if (!sttStream) return;
  try { sttStream.getTracks().forEach(t => t.stop()); } catch {}
  sttStream = null;
}

function stopSttVad(){
  if (sttVadRaf) {
    cancelAnimationFrame(sttVadRaf);
    sttVadRaf = 0;
  }
  try { sttSource?.disconnect(); } catch {}
  try { sttAnalyser?.disconnect(); } catch {}
  sttSource = null;
  sttAnalyser = null;
  sttSilenceSince = 0;
  sttSawSpeech = false;
  const ctx = sttAudioCtx;
  sttAudioCtx = null;
  if (ctx && ctx.state !== 'closed') {
    try { ctx.close(); } catch {}
  }
}

function startSttVad(stream){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !stream) return;
  stopSttVad();

  try {
    sttAudioCtx = new Ctx();
    sttAnalyser = sttAudioCtx.createAnalyser();
    sttAnalyser.fftSize = 2048;
    sttSource = sttAudioCtx.createMediaStreamSource(stream);
    sttSource.connect(sttAnalyser);
    const data = new Uint8Array(sttAnalyser.fftSize);

    const loop = ()=>{
      if (!sttAnalyser || !sttRecorder || sttRecorder.state === 'inactive') return;
      sttAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();

      if (rms >= STT_VAD_THRESHOLD) {
        sttSawSpeech = true;
        sttSilenceSince = 0;
      } else if (sttSawSpeech) {
        if (!sttSilenceSince) sttSilenceSince = now;
        if (now - sttSilenceSince >= STT_SILENCE_STOP_MS) {
          logInfo('Detected silence; auto-stopping recording.');
          try { sttRecorder.stop(); } catch {}
          return;
        }
      }
      sttVadRaf = requestAnimationFrame(loop);
    };

    sttVadRaf = requestAnimationFrame(loop);
  } catch {
    stopSttVad();
  }
}

function pickSttMimeType(){
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function blobToBase64(blob){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onerror = ()=> reject(fr.error || new Error('FileReader error'));
    fr.onload = ()=>{
      const out = String(fr.result || '');
      const i = out.indexOf(',');
      resolve(i >= 0 ? out.slice(i + 1) : out);
    };
    fr.readAsDataURL(blob);
  });
}

async function finishSpeechCapture(){
  clearSttTimer();
  const recorder = sttRecorder;
  sttRecorder = null;
  sttRecording = false;
  const chunks = sttChunks.slice();
  sttChunks = [];
  const mime = recorder?.mimeType || pickSttMimeType() || 'audio/webm';
  stopSttStream();

  if (!chunks.length) {
    logWarn('No audio captured.');
    sttInFlight = false;
    setSttButtonState();
    return;
  }

  try {
    sttInFlight = true;
    setSttButtonState();
    const blob = new Blob(chunks, { type: mime });
    const audioBase64 = await blobToBase64(blob);
    if (!audioBase64) {
      throw new Error('Encoded audio is empty.');
    }
    wsSend({ type:'speech_to_text_input', audioBase64, mime: blob.type || mime });
  } catch (e) {
    sttInFlight = false;
    setSttButtonState();
    logError(`Speech-to-text capture failed: ${e?.message || e}`);
  }
}

function stopSpeechCapture(){
  if (sttRecorder && sttRecorder.state !== 'inactive') {
    try { sttRecorder.stop(); } catch {}
  } else {
    clearSttTimer();
    stopSttStream();
    sttRecording = false;
    sttInFlight = false;
    setSttButtonState();
  }
}

async function startSpeechCapture(){
  if (sttRecording || sttInFlight || (!inWritingMode() && current.loading.challenge)) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    logError('Speech-to-text is not available in this browser.');
    return;
  }

  try {
    sttStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }
    });
    const mimeType = pickSttMimeType();
    sttChunks = [];
    sttRecorder = mimeType ? new MediaRecorder(sttStream, { mimeType }) : new MediaRecorder(sttStream);
    sttRecording = true;
    setSttButtonState();

    sttRecorder.addEventListener('dataavailable', (e)=>{
      if (e.data && e.data.size > 0) sttChunks.push(e.data);
    });
    sttRecorder.addEventListener('stop', ()=>{ finishSpeechCapture(); });
    sttRecorder.start(250);
    startSttVad(sttStream);
    logInfo('Recording speech... tap STT again to stop.');

    clearSttTimer();
    sttStopTimer = setTimeout(()=>{
      if (sttRecorder && sttRecorder.state !== 'inactive') {
        logInfo('Auto-stopping speech capture.');
        sttRecorder.stop();
      }
    }, STT_MAX_RECORD_MS);
  } catch (e) {
    stopSttStream();
    sttRecording = false;
    sttInFlight = false;
    setSttButtonState();
    logError(`Microphone access failed: ${e?.message || e}`);
  }
}

async function toggleSpeechToText(){
  if ((!inWritingMode() && current.loading.challenge) || sttInFlight) return;
  if (sttRecording) {
    stopSpeechCapture();
    return;
  }
  await startSpeechCapture();
}

/* ---------- Loading helper ---------- */
function setLoading(panelSelector, flag, opts = {}){
  const el = $(panelSelector.startsWith('#') ? panelSelector : ('#'+panelSelector));
  if(!el) return;
  el.setAttribute('data-loading', flag ? 'true' : 'false');

  if (el.id === 'challengePanel') {
    const challengeFetch = !!opts.challengeFetch;
    const loadingEl = $('#challengeLoading');
    const taskGrid = $('#taskGrid');
    const answerBar = $('#answerBar');
    const feedback = $('#answerFeedback');
    const panelControls = $$('#challengePanel button, #challengePanel textarea, #challengePanel input, #challengePanel select');

    if (challengeFetch) {
      if (loadingEl) {
        if (inWritingMode()) {
          // Writing mode uses subtle in-button state instead of a full loading panel.
          loadingEl.hidden = true;
          loadingEl.style.display = 'none';
        } else {
          loadingEl.hidden = !flag;
          loadingEl.style.display = flag ? 'flex' : 'none';
        }
      }
      if (inWritingMode()) {
        // Keep writing flow uninterrupted; only show subtle guide refresh affordance.
        if (taskGrid && writingGuideEnabled()) taskGrid.style.display = '';
        const guideBtn = $('#newChallengeBtn');
        if (guideBtn) {
          guideBtn.setAttribute('data-loading', flag ? 'true' : 'false');
          guideBtn.textContent = flag ? '⋯ Guide' : '🎲 Guide';
          guideBtn.title = flag ? 'Refreshing guide seed…' : 'New guide seed (Esc / Alt+N)';
        }
      } else {
        if (taskGrid) taskGrid.style.display = flag ? 'none' : '';
        if (feedback) feedback.style.display = flag ? 'none' : '';
        if (answerBar) answerBar.style.display = flag ? 'none' : '';
        panelControls.forEach(node => { node.disabled = !!flag; });
      }
    }
  }
}

/* ---------- Challenge English helpers ---------- */
const CHINESE_SEG_RE = /[\u3400-\u9fff]+/g;
const challengeTokenTranslationCache = new Map();
const challengeTokenTranslationInFlight = new Set();

function requestChallengeTokenTranslation(token){
  if (!token || challengeTokenTranslationCache.has(token) || challengeTokenTranslationInFlight.has(token)) return;
  challengeTokenTranslationInFlight.add(token);
  enqueuePending(pendingTranslate, token, { type:'challenge_en_token', token });
  wsSend({type:'translate_input', text: token});
}

function enrichChineseTokens(text, { html=false } = {}){
  const raw = String(text || '');
  if (!raw) return '';

  let out = '';
  let last = 0;
  let m;
  CHINESE_SEG_RE.lastIndex = 0;
  while ((m = CHINESE_SEG_RE.exec(raw)) !== null) {
    const idx = m.index;
    const token = m[0];
    const before = raw.slice(last, idx);
    const tr = (challengeTokenTranslationCache.get(token) || '').trim();
    const after = tr ? ` (${tr})` : ' (...)';

    if (html) {
      out += escHtml(before);
      out += `${escHtml(token)}${escHtml(after)}`;
      if (!tr) requestChallengeTokenTranslation(token);
    } else {
      out += before + token + after;
      if (!tr) requestChallengeTokenTranslation(token);
    }
    last = idx + token.length;
  }
  const tail = raw.slice(last);
  out += html ? escHtml(tail) : tail;
  return out;
}

function seedTranslationText(c){
  const seedLiteral = (c.seed_en || '').trim();
  if (seedLiteral) {
    const hasAscii = /[A-Za-z]/.test(seedLiteral);
    const chars = seedLiteral.replace(/\s+/g, '');
    const cjkCount = (chars.match(/[\u3400-\u9fff]/g) || []).length;
    const cjkRatio = chars.length ? (cjkCount / chars.length) : 0;
    if (hasAscii && cjkRatio <= 0.3) {
      return seedLiteral;
    }
  }
  return '(English translation unavailable)';
}
function enSummary(c){
  const out = [];
  out.push(`Seed: ${seedTranslationText(c)}`);
  if (!inWritingMode() && c.challenge_en) out.push(`Challenge: ${enrichChineseTokens(c.challenge_en)}`);
  if (out.length) return out.join('\n');
  return (c.summary_en || '') || '';
}
function enSummaryHtml(c){
  const seed = escHtml(seedTranslationText(c));
  const lines = [`<div class="en-line"><span class="en-label">Seed:</span> ${seed}</div>`];
  if (!inWritingMode()) {
    const challenge = enrichChineseTokens((c.challenge_en || '').trim(), { html:true });
    if (challenge) lines.push(`<div class="en-line"><span class="en-label">Challenge:</span> ${challenge}</div>`);
  }
  return lines.join('');
}
function enTooltip(c){
  const out = [];
  if (c.summary_en) out.push(`Summary: ${c.summary_en}`);
  out.push(`Seed: ${seedTranslationText(c)}`);
  if (!inWritingMode() && c.challenge_en) out.push(`Challenge: ${enrichChineseTokens(c.challenge_en)}`);
  return out.join('\n');
}

function renderChallengeEn(c){
  const el = $('#challengeEn');
  if (!el) return;
  if (!ls.getBool(LSK.chEn, true)) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = enSummaryHtml(c);
}

function applySettingsVisibility(){
  const visible = ls.getBool(SHOW_SETTINGS_KEY, true);
  const section = $('#settingsGrid');
  const btn = $('#toggleSettingsBtn');
  if (section) section.style.display = visible ? 'grid' : 'none';
  if (btn){
    btn.textContent = visible ? '▾' : '▸';
    btn.setAttribute('title', visible ? 'Hide settings' : 'Show settings');
    btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
  }
}

function hasUnsavedAnswerInput(){
  const v = $('#answerInput')?.value || '';
  return v.trim().length > 0;
}

function showReloadConfirm(onLeave){
  const modal = $('#reloadConfirmModal');
  const stay = $('#reloadStayBtn');
  const leave = $('#reloadLeaveBtn');
  if (!modal || !stay || !leave) {
    onLeave();
    return;
  }

  const close = ()=> modal.classList.add('hidden');
  const onStay = ()=>{
    close();
    stay.removeEventListener('click', onStay);
    leave.removeEventListener('click', onLeaveClick);
    document.removeEventListener('keydown', onKey);
  };
  const onLeaveClick = ()=>{
    allowUnloadOnce = true;
    onStay();
    onLeave();
  };
  const onKey = (e)=>{
    if (e.key === 'Escape') onStay();
  };

  modal.classList.remove('hidden');
  stay.addEventListener('click', onStay);
  leave.addEventListener('click', onLeaveClick);
  document.addEventListener('keydown', onKey);
}

function guardedReload(action){
  if (!hasUnsavedAnswerInput()) {
    allowUnloadOnce = true;
    action();
    return;
  }
  showReloadConfirm(action);
}

/* ---------- Rendering helpers ---------- */
function renderAllZh(){
  const toneOn = ls.getBool(LSK.tone, true);
  const pinOn  = ls.getBool(LSK.pinyin, true);
  $$('[data-zh-text]').forEach(el=>{
    const zh = el.getAttribute('data-zh-text') || '';
    const pyFull = el.getAttribute('data-zh-pinyin') || '';
    const arr = alignPinyinToText(zh, pyFull);
    el.innerHTML = renderZh(zh, arr, pinOn, toneOn);
  });
}

function syncAnswerColorLayerScroll(){
  const input = $('#answerInput');
  const layer = $('#answerColorLayer');
  if (!input || !layer) return;
  layer.scrollTop = input.scrollTop;
  layer.scrollLeft = input.scrollLeft;
}

function autoResizeAnswerInput(){
  const input = $('#answerInput');
  if (!input) return;
  const minHeight = parseFloat(window.getComputedStyle(input).minHeight) || 0;
  input.style.height = '0px';
  const nextHeight = Math.max(minHeight, input.scrollHeight);
  input.style.height = `${Math.ceil(nextHeight)}px`;
  syncAnswerColorLayerScroll();
}

function writingAnswerToneEnabled(){
  // Writing editor keeps live tone coloring on for immediate feedback.
  return inWritingMode() ? true : ls.getBool(LSK.tone, true);
}

function normalizeForPinyinMatch(v){
  return String(v || '')
    .normalize('NFC')
    .replace(/\s+/g, '');
}

function renderPendingAnswerText(text){
  return `<span class="answer-color-pending">${escHtml(String(text || ''))}</span>`;
}

function renderAnswerUsingBestPinyin(raw){
  const text = String(raw || '');
  if (!text) return '';

  const cachedText = String(answerPinyinLastMatchedText || '');
  const cachedPinyin = String(answerPinyinLastMatchedValue || '');
  if (!cachedText || !cachedPinyin) return renderPendingAnswerText(text);

  if (text === cachedText) {
    const arr = alignPinyinToText(text, cachedPinyin);
    return renderZh(text, arr, false, true);
  }

  if (text.startsWith(cachedText)) {
    const prefixArr = alignPinyinToText(cachedText, cachedPinyin);
    const coloredPrefix = renderZh(cachedText, prefixArr, false, true);
    const pendingTail = text.slice(cachedText.length);
    return `${coloredPrefix}${renderPendingAnswerText(pendingTail)}`;
  }

  if (cachedText.startsWith(text)) {
    const arr = alignPinyinToText(text, cachedPinyin);
    return renderZh(text, arr, false, true);
  }

  let i = 0;
  const max = Math.min(text.length, cachedText.length);
  while (i < max && text[i] === cachedText[i]) i++;
  if (i > 0) {
    const prefix = text.slice(0, i);
    const pending = text.slice(i);
    const prefixArr = alignPinyinToText(prefix, cachedPinyin);
    const coloredPrefix = renderZh(prefix, prefixArr, false, true);
    return `${coloredPrefix}${renderPendingAnswerText(pending)}`;
  }

  return renderPendingAnswerText(text);
}

function renderAnswerColorLayer({ text = null, pinyin = null } = {}){
  const input = $('#answerInput');
  const layer = $('#answerColorLayer');
  if (!input || !layer) return;

  const raw = (text === null || text === undefined) ? String(input.value || '') : String(text);
  const toneOn = writingAnswerToneEnabled();
  let py = (pinyin === null || pinyin === undefined)
    ? ''
    : String(pinyin || '');

  if ((pinyin === null || pinyin === undefined) && raw && raw === answerPinyinLastMatchedText) {
    py = answerPinyinLastMatchedValue;
  }

  if (!raw) {
    layer.innerHTML = '<span class="answer-color-placeholder">字</span>';
    syncAnswerColorLayerScroll();
    return;
  }

  if (toneOn && py) {
    const arr = alignPinyinToText(raw, py);
    layer.innerHTML = renderZh(raw, arr, false, true);
  } else if (toneOn) {
    layer.innerHTML = renderAnswerUsingBestPinyin(raw);
  } else {
    layer.textContent = raw;
  }
  syncAnswerColorLayerScroll();
}

function clearAnswerPinyinTimer(){
  if (!answerPinyinTimer) return;
  clearTimeout(answerPinyinTimer);
  answerPinyinTimer = 0;
}

function scheduleAnswerInputPinyin(){
  const input = $('#answerInput');
  const layer = $('#answerColorLayer');
  if (!input || !layer) return;

  const txt = String(input.value || '');
  if (!txt.trim() || !writingAnswerToneEnabled()) {
    clearAnswerPinyinTimer();
    answerPinyinLastRequested = '';
    pendingAnswerPy.clear();
    if (!txt.trim()) {
      answerPinyinLastMatchedText = '';
      answerPinyinLastMatchedValue = '';
    }
    renderAnswerColorLayer({ text: txt, pinyin: '' });
    return;
  }

  clearAnswerPinyinTimer();
  answerPinyinTimer = setTimeout(()=>{
    const nowTxt = String($('#answerInput')?.value || '');
    if (!nowTxt.trim()) return;

    // Drop stuck pending requests so coloring can recover automatically.
    const nowMs = Date.now();
    for (const [k, ts] of pendingAnswerPy) {
      if (nowMs - ts > 4500) pendingAnswerPy.delete(k);
    }

    if (nowTxt === answerPinyinLastRequested && pendingAnswerPy.has(nowTxt)) return;
    answerPinyinLastRequested = nowTxt;
    pendingAnswerPy.set(nowTxt, nowMs);
    wsSend({ type:'pinyin_input', text: nowTxt });
  }, ANSWER_PINYIN_DEBOUNCE_MS);
}

function renderNextChar(){
  const el = $('#liveNextChar');
  if (!ls.getBool('next_char_suggest', true)) { el.textContent=''; return; }
  const {char, pinyin} = liveSuggestion;
  el.textContent = char ? `${char}  (${pinyin||'?'})` : '';
}

function renderWritingStats(text = null){
  if (!inWritingMode()) return;
  const el = $('#writingStats');
  if (!el) return;
  const src = (text === null || text === undefined) ? draftTextNow() : String(text);
  const trimmed = src.trim();
  const chars = Array.from(trimmed).filter(ch => /\S/.test(ch)).length;
  const sentences = (trimmed.match(/[。！？!?]/g) || []).length;
  el.textContent = `Chars: ${chars} · Sentences: ${sentences}`;
}

function syncWritingInputSnapshot(value = null){
  writingInputSnapshot = String(
    value === null || value === undefined
      ? ($('#answerInput')?.value || '')
      : value
  );
}

function clearWritingAutoHintTimer(){
  if (!writingAutoHintTimer) return;
  clearTimeout(writingAutoHintTimer);
  writingAutoHintTimer = 0;
}

function clearWritingAutoGuideBoundaryTimer(){
  if (!writingAutoGuideBoundaryTimer) return;
  clearTimeout(writingAutoGuideBoundaryTimer);
  writingAutoGuideBoundaryTimer = 0;
}

function countGuideBoundaries(text){
  // Includes common Chinese and full-width period variants.
  return (String(text || '').match(/[。｡．.!?！？\n]/g) || []).length;
}

function scheduleAutoHintFromInput(text){
  if (!inWritingMode() || !writingHintsAutoEnabled()) {
    clearWritingAutoHintTimer();
    return;
  }
  if (!writingGuideEnabled() || !current.challenge?.id) return;
  const snapshot = String(text || '');
  if (!snapshot.trim()) return;
  if (snapshot === writingLastAutoHintInput) return;

  clearWritingAutoHintTimer();
  writingAutoHintTimer = setTimeout(()=>{
    const now = String($('#answerInput')?.value || '');
    if (now !== snapshot) return;
    if (!writingHintsAutoEnabled()) return;
    if (!writingGuideEnabled() || !current.challenge?.id) return;
    writingLastAutoHintInput = snapshot;
    wsSend({type:'hint', challengeId: current.challenge.id, fastOnly: inWritingMode()});
  }, WRITING_HINTS_AUTO_DEBOUNCE_MS);
}

function scheduleGuideRefreshFromBoundary(){
  if (!inWritingMode() || !writingGuideBoundaryAutoEnabled()) {
    clearWritingAutoGuideBoundaryTimer();
    return;
  }
  if (!writingGuideEnabled()) return;
  clearWritingAutoGuideBoundaryTimer();
  writingAutoGuideBoundaryTimer = setTimeout(()=>{
    if (!inWritingMode() || !writingGuideBoundaryAutoEnabled()) return;
    if (!writingGuideEnabled()) return;
    requestNewChallenge();
  }, WRITING_GUIDE_BOUNDARY_DEBOUNCE_MS);
}

function maybeRunWritingInputAutomation(prevText, nextText, { isComposing = false } = {}){
  if (!inWritingMode() || isComposing) return;
  const prev = String(prevText || '');
  const next = String(nextText || '');
  if (next.length <= prev.length) return;

  if (countGuideBoundaries(next) > countGuideBoundaries(prev)) {
    clearWritingAutoHintTimer();
    scheduleGuideRefreshFromBoundary();
    return;
  }

  scheduleAutoHintFromInput(next);
}

function applyWritingGuideVisibility(){
  if (!inWritingMode()) return;
  const show = writingGuideEnabled();
  const guideIntro = $('#writingGuideIntro');
  const guideGrid = $('#taskGrid');
  const loading = $('#challengeLoading');
  const infoBtn = $('#challengeInfoBtn');
  const badge = $('#challengeBadge');
  const hintBtn = $('#getHintBtn');
  if (guideIntro) guideIntro.style.display = show ? '' : 'none';
  if (guideGrid) guideGrid.style.display = show ? '' : 'none';
  if (loading && !show) {
    loading.hidden = true;
    loading.style.display = 'none';
  }
  if (infoBtn) infoBtn.style.display = show ? '' : 'none';
  if (badge && !show) badge.style.display = 'none';
  if (hintBtn) hintBtn.disabled = !show;
  if (!show) {
    liveSuggestion.char = '';
    liveSuggestion.pinyin = '';
    renderNextChar();
  }
}

function renderConnectorHints(){
  const box = $('#liveConnectorHints');
  if (!box) return;
  if (!inWritingMode()) {
    box.innerHTML = '';
    return;
  }

  const txt = String($('#answerInput')?.value || '').trim();
  if (!txt) {
    box.innerHTML = '<span class="subtle">Type to see connector ideas.</span>';
    return;
  }

  const suggestions = suggestConnectorsForText(txt);
  if (!suggestions.length) {
    box.innerHTML = '<span class="subtle">No connector suggestion yet. Keep writing a bit more.</span>';
    return;
  }

  const chips = suggestions
    .map(({ connector })=> `<button class="connector-hint-btn" type="button" data-connector="${escHtml(connector)}">${escHtml(connector)}</button>`)
    .join('');
  const reason = escHtml(suggestions[0]?.reason || 'Try one to link your next idea.');
  box.innerHTML = `${chips}<div class="connector-hint-reason">${reason}</div>`;
}

function insertConnectorAtCursor(connector){
  const input = $('#answerInput');
  if (!input) return;
  const token = String(connector || '').trim();
  if (!token) return;

  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const needsComma = !!before && !/[，。！？；、,\s]$/.test(before);
  const inserted = `${needsComma ? '，' : ''}${token}`;

  input.value = `${before}${inserted}${after}`;
  const pos = before.length + inserted.length;
  input.focus();
  input.selectionStart = pos;
  input.selectionEnd = pos;
  input.dispatchEvent(new Event('input', { bubbles:true }));
}

/* ---------- Pinyin request routing for challenge texts ---------- */
const pendingChallengePy = new Map(); // text -> [ 'seedZh' | 'challengeZh' ]

/* ---------- Translate request routing (Assist vs Agent) ---------- */
// key: original request text, val: queue of origins: 'assist' | 'agent'
const pendingTranslate = new Map();
function enqueuePending(map, key, val){
  if (!key) return;
  const q = map.get(key) || [];
  q.push(val);
  map.set(key, q);
}
function dequeuePending(map, key){
  const q = map.get(key);
  if (!q || !q.length) return null;
  const v = q.shift();
  if (!q.length) map.delete(key);
  return v;
}
function needPinyinData(){ return ls.getBool(LSK.pinyin, true) || ls.getBool(LSK.tone, true); }
function requestPinyinFor(elId, zhText){
  if (!zhText) return;
  const el = $('#'+elId); if (!el) return;
  if (!needPinyinData()) return;
  const existing = (el.getAttribute('data-zh-pinyin') || '').trim();
  if (existing) return;
  const list = pendingChallengePy.get(zhText) || [];
  if (!list.includes(elId)) pendingChallengePy.set(zhText, list.concat(elId));
  wsSend({ type:'pinyin_input', text: zhText });
}
function ensureChallengePinyin(){
  const c = current.challenge; if (!c) return;
  requestPinyinFor('seedZh', c.seed_zh || '');
  requestPinyinFor('challengeZh', c.challenge_zh || '');
}

/* ---------- Show/hide artifacts per toggles ---------- */
function applyArtifactsVisibility(){
  const showRTpy = ls.getBool('realtime_pinyin', true);
  const showRTen = ls.getBool('realtime_translation', true);
  const showNext = ls.getBool('next_char_suggest', true);
  const showEn   = ls.getBool(LSK.chEn, true);

  const rowPy = $('#rtRowPinyin'); if (rowPy) rowPy.classList.toggle('hidden', !showRTpy);
  const rowEn = $('#rtRowTrans'); if (rowEn) rowEn.classList.toggle('hidden', !showRTen);
  const rowNx = $('#rtRowNextChar'); if (rowNx) rowNx.classList.toggle('hidden', !showNext);

  const assistCard = $('#assistCard');
  const hasConnectorHints = !!$('#rtRowConnectorHint');
  const allHidden = (!showRTpy && !showRTen && !showNext && !hasConnectorHints);
  if (assistCard) assistCard.style.display = allHidden ? 'none' : '';

  const enEl = $('#challengeEn');
  if (enEl) {
    const hasText = (enEl.textContent || '').trim().length > 0;
    enEl.style.display = (showEn && hasText) ? '' : 'none';
  }
}

/* ---------- Challenge/Agent UI ---------- */
export function setChallenge(c){
  current.challenge = c;
  current.loading.challenge = false;
  setLoading('#challengePanel', false, { challengeFetch:true });
  if (sttRecording) stopSpeechCapture();
  sttInFlight = false;
  setSttButtonState();

  // Seed + Challenge text blocks (pinyin fetched on-demand)
  const seedEl = $('#seedZh');
  const chalEl = $('#challengeZh');
  if (seedEl){ seedEl.setAttribute('data-zh-text', c.seed_zh || ''); seedEl.setAttribute('data-zh-pinyin', ''); }
  if (chalEl){ chalEl.setAttribute('data-zh-text', c.challenge_zh || ''); chalEl.setAttribute('data-zh-pinyin', ''); }
  ensureChallengePinyin();
  renderAllZh();

  // English: summary (fallbacks)
  renderChallengeEn(c);
  applyArtifactsVisibility();
  // Writing guides may have empty seed_en; fetch fast translation in background.
  const seedZhForFallback = String(c.seed_zh || '').trim();
  const seedEnCurrent = String(c.seed_en || '').trim();
  if (seedZhForFallback && !seedEnCurrent){
    enqueuePending(pendingTranslate, seedZhForFallback, { type:'seed_en', challenge_id: c.id });
    wsSend({type:'translate_input', text: seedZhForFallback, fastOnly: true});
  }
  // Apply saved agent mode UI
  // (don’t re-save; just render)
  applyAgentModeUI(getAgentMode());

  const badge = $('#challengeBadge');
  const meta = [];
  if (c.difficulty) meta.push(c.difficulty);
  if (c.source) meta.push(c.source);
  if (badge){
    if (meta.length){ badge.textContent = meta.join(' · '); badge.style.display=''; }
    else { badge.style.display='none'; }
  }
  const infoBtn = $('#challengeInfoBtn');
  if (infoBtn) {
    const tip = enTooltip(c);
    infoBtn.title = tip || 'No English info available for this challenge.';
    infoBtn.disabled = !tip;
  }

  const answerEl = $('#answerInput');
  if (answerEl) {
    const isCorePlusCore = (c.challenge_zh || '').includes('只写两句');
    answerEl.placeholder = (!inWritingMode() && isCorePlusCore)
      ? '只写两句，用题目里的两个连接词。'
      : (inWritingMode() ? '字' : 'Type your answer in Chinese');
  }

  // reset input & hints
  if (!inWritingMode() && $('#answerInput')) $('#answerInput').value = '';
  const hintsEl = $('#hintsList');
  if (hintsEl) hintsEl.innerHTML = '';
  writingLastHintText = '';
  writingLastAutoHintInput = '';
  clearWritingAutoHintTimer();
  clearWritingAutoGuideBoundaryTimer();
  pendingAnswerPy.clear();
  answerPinyinLastRequested = '';
  liveSuggestion.char = ''; liveSuggestion.pinyin='';
  renderNextChar();
  renderConnectorHints();
  renderWritingStats();
  autoResizeAnswerInput();
  renderAnswerColorLayer();
  scheduleAnswerInputPinyin();
  syncWritingInputSnapshot();
  applyWritingGuideVisibility();
  focusWritingInputDefault();

  // reset grammar box (keep visible with a placeholder)
  const gr = $('#liveGrammar');
  if (gr) gr.innerHTML = '<span class="subtle">Use Assist for corrections.</span>';

  if (inWritingMode()) {
    logInfo(`Guide seed loaded (${c.difficulty||'hsk3'} · ${c.source||'seed'}).`);
  } else {
    logInfo(`New challenge: ${c.id} (${c.difficulty||'hsk3'} · ${c.source||'seed'})`);
  }
  if (ls.getBool('agent_reset_on_new', false)) {
    $('#agentHistory').innerHTML='';
    logInfo('Agent history reset (setting on).');
  }
}

function addHint(text){
  const clean = String(text || '').trim();
  if (!clean) return;
  if (clean === writingLastHintText) return;
  writingLastHintText = clean;
  const li = document.createElement('li');
  li.className = 'hint-item';
  li.textContent = clean;
  const list = $('#hintsList');
  if (!list) return;
  list.appendChild(li);
  while (list.children.length > 8) {
    list.removeChild(list.firstElementChild);
  }
  logInfo(`Hint: ${clean}`);
}

function addAgentMsg(who, text, {label=null} = {}){
  const div = document.createElement('div');
  div.className = 'msg '+(who==='user'?'user':'agent');
  div.setAttribute('data-label', label || (who==='user' ? 'You' : 'Agent'));
  div.textContent = text;
  $('#agentHistory').appendChild(div);
  div.scrollIntoView({behavior:'smooth', block:'end'});
}

/* ---------- Feedback banner (now shows score) ---------- */
let feedbackTimer=null;
function showFeedback({message, ok, score}){
  const el = $('#answerFeedback');
  if (!el) return;
  const msgSafe = escHtml(message || (ok ? 'Correct.' : 'Please try again.'));
  const scoreHtml = (typeof score === 'number' && Number.isFinite(score))
    ? `<strong>${ok ? '✅' : '❌'} Score: ${Math.round(score)}</strong>`
    : `<strong>${ok ? '✅' : '❌'}</strong>`;
  el.innerHTML = `${scoreHtml}${msgSafe ? ' ' + msgSafe : ''}`;
  el.className = (ok ? 'ok' : 'err') + ' show';
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(()=>{
    el.className = '';
    el.innerHTML = '';
  }, 25000);
}

function extractReasonKeywords(challenge){
  const out = [];
  const push = (v)=>{
    const t = String(v || '').trim();
    if (!t) return;
    if (out.includes(t)) return;
    out.push(t);
  };
  const extractMarker = (txt, prefix)=>{
    const i = txt.indexOf(prefix);
    if (i < 0) return '';
    const rest = txt.slice(i + prefix.length);
    const j = rest.indexOf('」');
    return (j < 0 ? '' : rest.slice(0, j)).trim();
  };

  const challengeZh = (challenge?.challenge_zh || '').trim();
  const seedZh = (challenge?.seed_zh || '').trim();
  push(extractMarker(challengeZh, '立场动词「'));
  push(extractMarker(challengeZh, '地点「'));

  ['去','到','往','因为','所以','如果','就','但是','却','然后','想','觉得','希望','打算','计划']
    .forEach(tok=>{
      if (challengeZh.includes(tok) || seedZh.includes(tok)) push(tok);
    });

  if (!out.length) {
    push('语义');
    push('创意');
  }
  return out.slice(0, 6);
}

function normalizeAnswerExplanation(explanation, {ok=false, challenge=null} = {}){
  const raw = String(explanation || '').trim();
  const hasEnglish = /[A-Za-z]/.test(raw);
  const hasCjk = /[\u3400-\u9FFF]/.test(raw);
  const keywords = extractReasonKeywords(challenge);

  let english = raw;
  if (!english) {
    english = ok
      ? 'Pass: your attempt matches the challenge intent and creativity is encouraged.'
      : 'Close: your intent is understandable; add one clearer challenge cue and try again.';
  } else if (!hasEnglish) {
    english = ok
      ? 'Pass: your attempt is contextually acceptable and creative.'
      : 'Close: your attempt has understandable intent; add one clearer challenge cue.';
    if (hasCjk) english += ` Original(中文): ${raw}`;
  }

  if (!/Keywords\(中文\):|关键词/.test(english)) {
    if (!/[.!?。]$/.test(english)) english += '.';
    english += ` Keywords(中文): ${keywords.join(' / ')}`;
  }
  return english;
}

function onAnswerResult(res){
  setLoading('#challengePanel', false);
  const ok = !!res.correct;
  const exp = normalizeAnswerExplanation(res.explanation, { ok, challenge: current.challenge });
  const score = (typeof res.score === 'number') ? res.score : null;

  if (ok) { okBeep(); logSuccess(`Answer correct${score!=null?` · Score ${Math.round(score)}`:''}${exp ? ` — ${exp}` : ''}`); }
  else   { badBeep(); logError(`Answer incorrect${score!=null?` · Score ${Math.round(score)}`:''}${exp ? ` — ${exp}` : ''}`); }

  showFeedback({ message: exp || (ok ? 'Great job!' : 'Check word order or tones.'), ok, score });

  const el = $('#answerInput');
  el.style.outline = ok ? '2px solid #35d07f' : '2px solid #ff6b6b';
  setTimeout(()=>{ el.style.outline=''; }, 25450);
}

/* ---------- LCS-based char diff for grammar ---------- */
function diffSegments(aStr, bStr){
  const A = Array.from(aStr || '');
  const B = Array.from(bStr || '');
  const n = A.length, m = B.length;
  const L = Array.from({length:n+1}, ()=> new Array(m+1).fill(0));
  for (let i=1;i<=n;i++){
    for (let j=1;j<=m;j++){
      L[i][j] = (A[i-1]===B[j-1]) ? L[i-1][j-1]+1 : Math.max(L[i-1][j], L[i][j-1]);
    }
  }
  const outRev = [];
  let i=n, j=m;
  while(i>0 || j>0){
    if (i>0 && j>0 && A[i-1]===B[j-1]){
      outRev.push({t:'eq', ch:A[i-1]}); i--; j--;
    } else if (j>0 && (i===0 || L[i][j-1] >= L[i-1]?.[j] || i===0)){
      outRev.push({t:'ins', ch:B[j-1]}); j--;
    } else if (i>0){
      outRev.push({t:'del', ch:A[i-1]}); i--;
    }
  }
  const seq = outRev.reverse();
  // group consecutive
  const grouped = [];
  let cur = null;
  for (const s of seq){
    if (!cur || cur.t !== s.t){ cur = {t:s.t, text:s.ch}; grouped.push(cur); }
    else { cur.text += s.ch; }
  }
  return grouped;
}

function renderGrammarDiff(original, corrected){
  const segs = diffSegments(original, corrected);
  let origHtml = '', corrHtml = '';
  for (const seg of segs){
    const safe = escHtml(seg.text);
    if (seg.t === 'eq'){ origHtml += safe; corrHtml += safe; }
    else if (seg.t === 'del'){ origHtml += `<span class="gc-del">${safe}</span>`; }
    else if (seg.t === 'ins'){ corrHtml += `<span class="gc-ins">${safe}</span>`; }
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

/* ---------- Assist: on-demand translate, pinyin, grammar ---------- */
function runAssist(){
  if (current.loading.challenge && !inWritingMode()) return;
  const txt = $('#answerInput').value;
  if (!txt) return;
  const needPy = ls.getBool('realtime_pinyin', true);
  const needEn = ls.getBool('realtime_translation', true);
  if (needEn){
    enqueuePending(pendingTranslate, txt, 'assist');
    wsSend({type:'translate_input', text:txt, fastOnly: inWritingMode()});
  }
  if (needPy) wsSend({type:'pinyin_input', text:txt});
  // Always ask for grammar correction on Assist
  wsSend({type:'grammar_input', text:txt, fastOnly: inWritingMode()});
  if (inWritingMode() && writingGuideEnabled() && current.challenge?.id) {
    wsSend({type:'hint', challengeId: current.challenge.id, fastOnly: true});
  }
  renderConnectorHints();
}

/* ---------- TTS init & bindings ---------- */
export function initTTS(){
  const voiceSel = $('#ttsVoiceSel');
  const rateInput = $('#ttsRate');
  const rateVal = $('#ttsRateVal');

  const applyRateLabel = (r)=>{ if (rateVal) rateVal.textContent = `${(r||1).toFixed(2)}x`; };

  const fillVoices = ()=>{
    if (!voiceSel) return;
    const voices = ttsVoices();
    voiceSel.innerHTML = '';

    if (!voices || voices.length===0){
      const opt = document.createElement('option');
      opt.value=''; opt.textContent='(no voices available yet)';
      voiceSel.appendChild(opt);
      return;
    }

    const savedKey = ls.getStr(LSK.ttsVoice, '');
    const zh = voices.filter(v => (v.lang||'').toLowerCase().startsWith('zh'));
    const other = voices.filter(v => !(v.lang||'').toLowerCase().startsWith('zh'));

    const appendList = (list)=>{
      const frag = document.createDocumentFragment();
      list.forEach(v=>{
        const opt = document.createElement('option');
        const key = v.voiceURI || v.name;
        opt.value = key;
        opt.textContent = `${v.name} — ${v.lang}${v.localService ? ' · local' : ''}`;
        if (key === savedKey) opt.selected = true;
        frag.appendChild(opt);
      });
      voiceSel.appendChild(frag);
    };

    if (zh.length) appendList(zh);
    if (other.length) appendList(other);

    if (!voiceSel.value){
      const prefer = (zh[0] || voices[0]);
      if (prefer){
        voiceSel.value = prefer.voiceURI || prefer.name;
        ls.setStr(LSK.ttsVoice, voiceSel.value);
      }
    }
  };

  if (ttsSupported()){
    fillVoices();               // may be empty at first
    onTTSVoicesChanged(fillVoices);
  } else {
    if (voiceSel){
      voiceSel.innerHTML = '<option value="">(TTS unsupported)</option>';
      voiceSel.disabled = true;
    }
    if (rateInput) rateInput.disabled = true;
  }

  // Init rate from storage
  const rate = ls.getNum(LSK.ttsRate, 1.0);
  if (rateInput){
    rateInput.value = String(rate);
    applyRateLabel(rate);
    rateInput.addEventListener('input', (e)=>{
      const r = parseFloat(e.target.value);
      ls.setNum(LSK.ttsRate, r);
      applyRateLabel(r);
    });
  }
  if (voiceSel){
    voiceSel.addEventListener('change', (e)=>{
      ls.setStr(LSK.ttsVoice, e.target.value || '');
    });
  }

  // Speak handlers
  const voiceKey = ()=> ls.getStr(LSK.ttsVoice,'');
  const rateNow  = ()=> ls.getNum(LSK.ttsRate, 1.0);

  const speakSeed = ()=>{
    const t = $('#seedZh')?.getAttribute('data-zh-text') || '';
    if (!t) return;
    const ok = speakText(t, { voiceKey: voiceKey(), rate: rateNow(), lang:'zh-CN' });
    if (!ok) logWarn('TTS unavailable.'); else logInfo('Speaking Seed…');
  };
  const speakChallenge = ()=>{
    const t = $('#challengeZh')?.getAttribute('data-zh-text') || '';
    if (!t) return;
    const ok = speakText(t, { voiceKey: voiceKey(), rate: rateNow(), lang:'zh-CN' });
    if (!ok) logWarn('TTS unavailable.'); else logInfo('Speaking Challenge…');
  };
  const speakInput = ()=>{
    const t = $('#answerInput')?.value || '';
    if (!t) return;
    const ok = speakText(t, { voiceKey: voiceKey(), rate: rateNow(), lang:'zh-CN' });
    if (!ok) logWarn('TTS unavailable.'); else logInfo('Speaking your input…');
  };

  $('#speakSeedBtn')?.addEventListener('click', speakSeed);
  $('#speakChallengeBtn')?.addEventListener('click', speakChallenge);
  $('#speakInputBtn')?.addEventListener('click', speakInput);
}

/* ---------- Exports: bindings & settings ---------- */
export function bindEvents(){
  // New challenge (unified)
  $('#newChallengeBtn').addEventListener('click', ()=>{
    if (inWritingMode() && !writingGuideEnabled()) {
      ls.setBool(WRITING_GUIDE_KEY, true);
      const t = $('#tglGuideSeed');
      if (t) t.checked = true;
      applyWritingGuideVisibility();
    }
    requestNewChallenge();
  });
  document.addEventListener('keydown', (e)=>{
    if (e.key==='Escape' || (e.altKey && (e.key==='n' || e.key==='N'))){
      e.preventDefault();
      if (inWritingMode() && !writingGuideEnabled()) {
        ls.setBool(WRITING_GUIDE_KEY, true);
        const t = $('#tglGuideSeed');
        if (t) t.checked = true;
        applyWritingGuideVisibility();
      }
      requestNewChallenge();
    }
  });

  // Submit answer
  $('#answerForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    const answer = $('#answerInput').value.trim();
    if(!answer) return;
    if (inWritingMode()) {
      persistWritingDraft({ force:true });
      renderWritingStats(answer);
      showFeedback({
        message: 'Draft saved locally. Writing mode does not evaluate your text.',
        ok: true,
        score: null,
      });
      logSuccess('Draft saved (not evaluated).');
      return;
    }
    if (current.loading.challenge) return;
    if(!current.challenge) return;
    setLoading('#challengePanel', true);
    wsSend({type:'submit_answer', challengeId: current.challenge.id, answer});
  });

  // Assist button + shortcuts (Alt+A preferred; Ctrl+T also, but might be browser-reserved)
  $('#assistBtn').addEventListener('click', runAssist);
  $('#speechToTextBtn')?.addEventListener('click', ()=>{ toggleSpeechToText(); });
  document.addEventListener('keydown', (e)=>{
    if ((e.altKey  && (e.key==='a' || e.key==='A')) ||
        (e.ctrlKey && (e.key==='t' || e.key==='T'))){
      e.preventDefault();
      runAssist();
    }
  });

  // Toggle Show Pinyin (ALL) with Alt+P
  document.addEventListener('keydown', (e)=>{
    if (e.altKey && (e.key==='p' || e.key==='P')){
      e.preventDefault();
      const t = $('#tglPinyin');
      if (t){
        t.checked = !t.checked;
        ls.setBool(LSK.pinyin, t.checked);
        ensureChallengePinyin();
        renderAllZh();
        logInfo(`Show Pinyin (ALL): ${t.checked ? 'on' : 'off'} (Alt+P)`);
      }
    }
  });

  // Keep next-char suggestion reactive as you type
  const probeNext = ()=>{
    if (!ls.getBool('next_char_suggest', true)) return;
    if (inWritingMode() && (!writingGuideEnabled() || !current.challenge?.id)) {
      liveSuggestion.char = '';
      liveSuggestion.pinyin = '';
      renderNextChar();
      return;
    }
    const txt = $('#answerInput').value;
    wsSend({type:'next_char', current:txt, challengeId: current.challenge?.id});
  };
  $('#answerInput').addEventListener('input', debounce(probeNext, 120));
  $('#answerInput').addEventListener('input', debounce(renderConnectorHints, 120));
  $('#answerInput').addEventListener('input', (e)=>{
    const nowText = String($('#answerInput')?.value || '');
    const prevText = writingInputSnapshot;
    const composing = !!e?.isComposing;
    if (!composing) syncWritingInputSnapshot(nowText);
    if (!nowText.trim()) writingLastAutoHintInput = '';
    renderWritingStats();
    persistWritingDraft();
    autoResizeAnswerInput();
    renderAnswerColorLayer();
    scheduleAnswerInputPinyin();
    maybeRunWritingInputAutomation(prevText, nowText, { isComposing: composing });
  });
  $('#answerInput').addEventListener('compositionend', ()=>{
    const nowText = String($('#answerInput')?.value || '');
    const prevText = writingInputSnapshot;
    syncWritingInputSnapshot(nowText);
    maybeRunWritingInputAutomation(prevText, nowText, { isComposing:false });
  });
  $('#answerInput').addEventListener('scroll', syncAnswerColorLayerScroll);

  $('#liveConnectorHints')?.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-connector]');
    if (!btn) return;
    e.preventDefault();
    insertConnectorAtCursor(btn.getAttribute('data-connector') || '');
  });

  // Writing mode: Tab swaps focus with Agent. Other modes: Tab inserts next-char suggestion.
  $('#answerInput').addEventListener('keydown', (e)=>{
    if (inWritingMode() && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey){
      e.preventDefault();
      $('#agentInput')?.focus();
      return;
    }
    if (!inWritingMode() && e.key==='Tab' && ls.getBool('next_char_suggest', true)){
      e.preventDefault();
      const {char} = liveSuggestion;
      if(char){
        const inp=$('#answerInput');
        const start=inp.selectionStart, end=inp.selectionEnd, val=inp.value;
        inp.value = val.slice(0,start)+char+val.slice(end);
        inp.selectionStart=inp.selectionEnd=start+char.length;
      }
    }
    if (inWritingMode()) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        $('#answerForm').requestSubmit();
      }
      return;
    }
    if (e.key==='Enter' && !e.shiftKey){
      e.preventDefault();
      $('#answerForm').requestSubmit();
    }
  });

  // Manual hint
  $('#getHintBtn').addEventListener('click', ()=>{
    if (current.loading.challenge && !inWritingMode()) return;
    if (inWritingMode() && !writingGuideEnabled()) {
      logInfo('Enable guide seed to request contextual hints.');
      return;
    }
    if (!current.challenge) {
      if (inWritingMode()) logInfo('Load a guide seed first to get contextual hints.');
      return;
    }
    wsSend({type:'hint', challengeId: current.challenge.id, fastOnly: inWritingMode()});
  });
  document.addEventListener('keydown', (e)=>{
    if (e.altKey && (e.key==='h' || e.key==='H')){
      e.preventDefault();
      if (current.loading.challenge && !inWritingMode()) return;
      if (inWritingMode() && !writingGuideEnabled()) {
        logInfo('Enable guide seed to request contextual hints.');
        return;
      }
      if (!current.challenge) {
        if (inWritingMode()) logInfo('Load a guide seed first to get contextual hints.');
        return;
      }
      wsSend({type:'hint', challengeId: current.challenge.id, fastOnly: inWritingMode()});
    }
  });

  // Agent: Enter sends; Shift+Enter inserts newline
  $('#agentForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    const text = $('#agentInput').value.trim();
    if(!text) return;
    $('#agentInput').value='';
    addAgentMsg('user', text, {label:'You'});
    setLoading('#agentPanel', true);
    const mode = getAgentMode();
    if (mode === AgentMode.translate){
      enqueuePending(pendingTranslate, text, 'agent');
      wsSend({type:'translate_input', text, fastOnly: inWritingMode()});
    } else {
      wsSend({type:'agent_message', text, challengeId: current.challenge?.id || '', fastOnly: inWritingMode()});
    }
  });
  $('#agentInput').addEventListener('keydown', (e)=>{
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      $('#answerInput')?.focus();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      $('#agentForm').requestSubmit();
    }
  });

  // Agent Reset button (fix)
  $('#agentResetBtn')?.addEventListener('click', ()=>{
    $('#agentHistory').innerHTML = '';
    wsSend({type:'agent_reset'});
    logInfo('Agent history reset.');
  });

  // Event log controls
  $('#copyLogBtn')?.addEventListener('click', async ()=>{
    const ok = await copyText(getLogsText());
    if (ok) logSuccess('Event log copied.');
    else logError('Failed to copy event log.');
  });
  $('#clearLogBtn')?.addEventListener('click', ()=>{
    clearLogs();
    logInfo('Event log cleared.');
  });

  // Mobile-accessible challenge English details (title tooltips don't work on touch).
  $('#challengeInfoBtn')?.addEventListener('click', ()=>{
    const btn = $('#challengeInfoBtn');
    const text = (btn?.title || '').trim();
    if (!text || text === 'No English info available for this challenge.') {
      logInfo('No English info available for this challenge.');
      return;
    }
    window.alert(text);
  });

  // Agent mode segmented control
  $('#agentModeTutorBtn')?.addEventListener('click', ()=>{
    setAgentMode(AgentMode.tutor);
    logInfo('Agent mode: tutor');
  });
  $('#agentModeTranslateBtn')?.addEventListener('click', ()=>{
    setAgentMode(AgentMode.translate);
    logInfo('Agent mode: translate');
  });

  // Settings (visibility + rendering)
  $('#tglTone').addEventListener('change', (e)=>{
    ls.setBool(LSK.tone, e.target.checked);
    ensureChallengePinyin();
    renderAllZh();
    renderAnswerColorLayer();
    scheduleAnswerInputPinyin();
  });
  $('#tglPinyin').addEventListener('change', (e)=>{ ls.setBool(LSK.pinyin, e.target.checked); ensureChallengePinyin(); renderAllZh(); });

  $('#tglRTTrans').addEventListener('change', (e)=>{ ls.setBool('realtime_translation', e.target.checked); applyArtifactsVisibility(); });
  $('#tglRTPinyin').addEventListener('change', (e)=>{ ls.setBool('realtime_pinyin', e.target.checked); applyArtifactsVisibility(); });

  $('#tglNextChar').addEventListener('change', (e)=>{ ls.setBool('next_char_suggest', e.target.checked); applyArtifactsVisibility(); renderNextChar(); });
  $('#tglAgentReset').addEventListener('change', (e)=> ls.setBool('agent_reset_on_new', e.target.checked));
  $('#tglShowEn').addEventListener('change', (e)=>{
    ls.setBool(LSK.chEn, e.target.checked);
    const c = current.challenge;
    if (c){
      renderChallengeEn(c);
    }
    applyArtifactsVisibility();
  });
  $('#tglGuideSeed')?.addEventListener('change', (e)=>{
    ls.setBool(WRITING_GUIDE_KEY, e.target.checked);
    writingLastAutoHintInput = '';
    clearWritingAutoHintTimer();
    clearWritingAutoGuideBoundaryTimer();
    applyWritingGuideVisibility();
    if (e.target.checked && !current.challenge) requestNewChallenge();
  });
  $('#tglGuideAuto')?.addEventListener('change', (e)=>{
    ls.setBool(WRITING_GUIDE_AUTO_KEY, e.target.checked);
  });
  $('#tglHintsAuto')?.addEventListener('change', (e)=>{
    ls.setBool(WRITING_HINTS_AUTO_KEY, e.target.checked);
    writingLastAutoHintInput = '';
    if (!e.target.checked) clearWritingAutoHintTimer();
  });
  $('#tglGuideBoundaryAuto')?.addEventListener('change', (e)=>{
    ls.setBool(WRITING_GUIDE_BOUNDARY_AUTO_KEY, e.target.checked);
    if (!e.target.checked) clearWritingAutoGuideBoundaryTimer();
  });
  $('#tglDraftAutosave')?.addEventListener('change', (e)=>{
    ls.setBool(WRITING_DRAFT_AUTO_KEY, e.target.checked);
    if (e.target.checked) persistWritingDraft({ force:true });
  });
  $('#writingClearDraftBtn')?.addEventListener('click', ()=>{
    clearWritingDraft();
    renderWritingStats('');
    renderConnectorHints();
    const g = $('#liveGrammar');
    if (g) g.innerHTML = '<span class="subtle">Use Assist for corrections.</span>';
  });

  $('#toggleSettingsBtn')?.addEventListener('click', ()=>{
    const currentVisible = ls.getBool(SHOW_SETTINGS_KEY, true);
    ls.setBool(SHOW_SETTINGS_KEY, !currentVisible);
    applySettingsVisibility();
  });
  $('#themeSel')?.addEventListener('change', (e)=>{
    const chosen = normalizeTheme(e.target.value);
    ls.setStr(THEME_KEY, chosen);
    applyTheme(chosen);
  });

  $('#cornerFavicon')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const href = $('#cornerFavicon')?.getAttribute('href') || '/';
    guardedReload(()=>{ window.location.href = href; });
  });
  document.addEventListener('keydown', (e)=>{
    const isReload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'));
    if (!isReload) return;
    e.preventDefault();
    guardedReload(()=> window.location.reload());
  });
  window.addEventListener('beforeunload', (e)=>{
    if (allowUnloadOnce) return;
    if (!hasUnsavedAnswerInput()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  $('#difficultySel').addEventListener('change', (e)=>{
    const next = normalizeDifficulty(e.target.value);
    localStorage.setItem('difficulty', next);
    if (e.target.value !== next) e.target.value = next;
    if (inWritingMode() && writingGuideEnabled() && writingGuideAutoEnabled()) {
      requestNewChallenge();
    }
  });
}

export function syncSettingsUI(){
  // Initial toggle states
  $('#tglTone').checked       = ls.getBool(LSK.tone, true);
  $('#tglPinyin').checked     = ls.getBool(LSK.pinyin, false);
  $('#tglRTTrans').checked    = ls.getBool('realtime_translation', true);
  $('#tglRTPinyin').checked   = ls.getBool('realtime_pinyin', true);
  $('#tglNextChar').checked   = ls.getBool('next_char_suggest', true);
  $('#tglAgentReset').checked = ls.getBool('agent_reset_on_new', true);
  $('#tglShowEn').checked     = ls.getBool(LSK.chEn, true);
  if ($('#tglGuideSeed')) $('#tglGuideSeed').checked = writingGuideEnabled();
  if ($('#tglGuideAuto')) $('#tglGuideAuto').checked = writingGuideAutoEnabled();
  if ($('#tglHintsAuto')) $('#tglHintsAuto').checked = writingHintsAutoEnabled();
  if ($('#tglGuideBoundaryAuto')) $('#tglGuideBoundaryAuto').checked = writingGuideBoundaryAutoEnabled();
  if ($('#tglDraftAutosave')) $('#tglDraftAutosave').checked = writingDraftAutosaveEnabled();
  const difficulty = normalizeDifficulty(localStorage.getItem('difficulty'));
  localStorage.setItem('difficulty', difficulty);
  $('#difficultySel').value   = difficulty;
  const theme = normalizeTheme(ls.getStr(THEME_KEY, 'dark'));
  applyTheme(theme);
  if ($('#themeSel')) $('#themeSel').value = theme;

  // Apply current rendering and visibility
  restoreWritingDraft();
  renderAllZh();
  renderWritingStats();
  autoResizeAnswerInput();
  renderAnswerColorLayer();
  scheduleAnswerInputPinyin();
  syncWritingInputSnapshot();
  const c = current.challenge;
  if (c){
    renderChallengeEn(c);
    ensureChallengePinyin();
  }
  applySettingsVisibility();
  applyArtifactsVisibility();
  applyWritingGuideVisibility();
  renderConnectorHints();
  setSttButtonState();
  focusWritingInputDefault();
}

/* ---------- WS message handling ---------- */
export function handleMessage(msg){
  switch(msg.type){
    case 'challenge': setChallenge(msg.challenge); break;
    case 'error':
      current.loading.challenge = false;
      setLoading('#challengePanel', false, { challengeFetch:true });
      if (sttInFlight) {
        sttInFlight = false;
        setSttButtonState();
      }
      logError(msg.message || 'Server error.');
      break;
    case 'hint': addHint(msg.text); break;
    case 'translate': {
      const txt = (msg.text || '');
      const origin = dequeuePending(pendingTranslate, txt);
      if (origin && typeof origin === 'object' && origin.type === 'challenge_en_token'){
        challengeTokenTranslationInFlight.delete(origin.token || txt);
        const tr = (msg.translation || '').trim();
        challengeTokenTranslationCache.set(origin.token || txt, tr || 'translation unavailable');
        const c = current.challenge;
        if (c) {
          renderChallengeEn(c);
          const infoBtn = $('#challengeInfoBtn');
          if (infoBtn) {
            const tip = enTooltip(c);
            infoBtn.title = tip || 'No English info available for this challenge.';
            infoBtn.disabled = !tip;
          }
        }
        break;
      }
      if (origin && typeof origin === 'object' && origin.type === 'seed_en'){
        const translated = (msg.translation || '').trim();
        const c = current.challenge;
        if (c && c.id === origin.challenge_id && String(c.seed_zh || '').trim() === txt.trim() && translated) {
          c.seed_en = translated;
          renderChallengeEn(c);
          applyArtifactsVisibility();
          const infoBtn = $('#challengeInfoBtn');
          if (infoBtn) {
            const tip = enTooltip(c);
            infoBtn.title = tip || 'No English info available for this challenge.';
            infoBtn.disabled = !tip;
          }
        }
        break;
      }
      if (origin === 'agent'){
        addAgentMsg('agent', msg.translation || '', {label:'Translate'});
        setLoading('#agentPanel', false);
      } else {
        // default to Assist panel
        $('#liveTranslation').textContent = msg.translation || '';
      }
      break;
    }
    case 'pinyin': {
      const txt = (msg.text || '');
      const py = msg.pinyin || '';
      const targets = pendingChallengePy.get(txt);
      const fromAnswerRequest = pendingAnswerPy.delete(txt);

      // Route to Assist if it matches current input
      const inputNow = $('#answerInput')?.value || '';
      const directMatch = txt === inputNow;
      const softMatch = normalizeForPinyinMatch(txt) === normalizeForPinyinMatch(inputNow);
      const directPrefix = !!txt && inputNow.startsWith(txt);
      if (directMatch || softMatch){
        $('#livePinyin').textContent = py;
        answerPinyinLastMatchedText = inputNow;
        answerPinyinLastMatchedValue = py;
        renderAnswerColorLayer({ text: inputNow, pinyin: py });
        if (targets && targets.length){
          targets.forEach(id=>{
            const el = $('#'+id);
            if (el) el.setAttribute('data-zh-pinyin', py);
          });
          pendingChallengePy.delete(txt);
          renderAllZh();
        }
        break;
      }
      // Writing mode: accept pinyin for a recent prefix so colors update while typing.
      if (inWritingMode() && fromAnswerRequest && directPrefix && !(targets && targets.length)){
        const cached = String(answerPinyinLastMatchedText || '');
        const hasBetterCache = !!cached && inputNow.startsWith(cached) && cached.length >= txt.length;
        if (!hasBetterCache){
          answerPinyinLastMatchedText = txt;
          answerPinyinLastMatchedValue = py;
          renderAnswerColorLayer({ text: inputNow });
        }
        break;
      }
      // Stale answer response: keep challenge routing only, ignore editor cache update.

      // Else see if it's for seed/challenge
      if (targets && targets.length){
        targets.forEach(id=>{
          const el = $('#'+id);
          if (el) el.setAttribute('data-zh-pinyin', py);
        });
        pendingChallengePy.delete(txt);
        renderAllZh();
      }
      break;
    }
    case 'grammar': {
      const original = (msg.text || '');
      const corrected = (msg.corrected || '');
      const box = $('#liveGrammar');
      if (box){
        box.innerHTML = renderGrammarDiff(original, corrected);
      }
      logInfo(`Grammar correction received.`);
      break;
    }
    case 'speech_to_text': {
      if (!sttInFlight) break;
      const text = (msg.text || '').trim();
      sttInFlight = false;
      setSttButtonState();
      if (!text) {
        logWarn('Speech recognized no text. Try speaking closer to the microphone.');
        break;
      }
      const inp = $('#answerInput');
      if (inp){
        const prefix = inp.value.trim().length ? (/\s$/.test(inp.value) ? '' : ' ') : '';
        inp.value += `${prefix}${text}`;
        inp.focus();
        inp.dispatchEvent(new Event('input', { bubbles:true }));
      }
      const preview = text.length > 96 ? `${text.slice(0, 96)}…` : text;
      logSuccess(`Speech recognized: ${preview}`);
      break;
    }
    case 'speech_to_text_error':
      if (!sttInFlight) break;
      sttInFlight = false;
      setSttButtonState();
      logError(msg.message || 'Speech-to-text failed.');
      break;
    case 'next_char':
      liveSuggestion.char = msg.char||'';
      liveSuggestion.pinyin = msg.pinyin||'';
      renderNextChar();
      break;
    case 'agent_reply':
      addAgentMsg('agent', msg.text||'', {label:'Tutor'});
      setLoading('#agentPanel', false);
      logInfo(`Agent reply: ${msg.text||''}`);
      break;
    case 'answer_result':
      if (inWritingMode()) break;
      onAnswerResult(msg);
      break;
  }
}

/* ---------- Actions ---------- */
export function requestNewChallenge(){
  if (current.loading.challenge) return;
  if (inWritingMode() && !writingGuideEnabled()) {
    current.loading.challenge = false;
    setLoading('#challengePanel', false, { challengeFetch:true });
    return;
  }
  if (inWritingMode()) {
    writingLastAutoHintInput = '';
    clearWritingAutoHintTimer();
    clearWritingAutoGuideBoundaryTimer();
  }
  if (sttRecording) stopSpeechCapture();
  current.loading.challenge = true;
  setSttButtonState();
  setLoading('#challengePanel', true, { challengeFetch:true });
  const v = normalizeDifficulty(localStorage.getItem('difficulty'));
  localStorage.setItem('difficulty', v);
  const payload = { type:'new_challenge' };
  payload.difficulty = v;
  if (inWritingMode()) {
    payload.mode = 'writing_guide';
    const full = String($('#answerInput')?.value || '').trim();
    payload.contextZh = full ? Array.from(full).slice(-220).join('') : '';
  }
  wsSend(payload);
}
