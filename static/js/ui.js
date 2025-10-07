import { $, $$, debounce, logInfo, logSuccess, logError } from './utils.js';
import { LSK, ls, current, liveSuggestion } from './state.js';
import { renderZh, alignPinyinToText } from './zh.js';
import { okBeep, badBeep } from './audio.js';
import { wsSend } from './socket.js';

/* ---------- Loading helper ---------- */
function setLoading(panelSelector, flag){
  const el = $(panelSelector.startsWith('#') ? panelSelector : ('#'+panelSelector));
  if(!el) return;
  el.setAttribute('data-loading', flag ? 'true' : 'false');
}

/* ---------- Parse en → gloss + challenge/glue ---------- */
function parseChallengeFromEn(en){
  const out = { gloss:'', glue:null, line:null };
  if (!en){ return out; }
  const parts = String(en).split(/\r?\n/);
  out.gloss = (parts[0] || '').trim();

  const rest = parts.slice(1).join('\n');
  if (!rest) return out;

  // Match: Challenge: add 计划 (jì huà, plan).
  const m = rest.match(/Challenge:\s*add\s+([^\s(（]+)\s*[\(（]\s*([^,，)）]+)\s*,\s*([^)）]+)[\)）]\.?/i);
  if (m){
    out.glue = { zh: m[1], py: m[2].trim(), en: m[3].trim() };
    out.line = m[0];
    return out;
  }
  // Fallback: Challenge: add 计划
  const m2 = rest.match(/Challenge:\s*add\s+([^\s.]+)/i);
  if (m2){
    out.glue = { zh: m2[1], py:'', en:'' };
    out.line = m2[0];
  }
  return out;
}

/* ---------- Rendering helpers ---------- */
function renderAllZh(){
  const toneOn = ls.getBool(LSK.tone, false);
  const pinOn  = ls.getBool(LSK.pinyin, false);
  $$('[data-zh-text]').forEach(el=>{
    const zh = el.getAttribute('data-zh-text') || '';
    const pyFull = el.getAttribute('data-zh-pinyin') || '';
    const arr = alignPinyinToText(zh, pyFull);
    el.innerHTML = renderZh(zh, arr, pinOn, toneOn);
  });
}
function renderNextChar(){
  const el = $('#liveNextChar');
  if (!ls.getBool('next_char_suggest', true)) { el.textContent=''; return; }
  const {char, pinyin} = liveSuggestion;
  el.textContent = char ? `${char}  (${pinyin||'?'})` : '';
}

/* ---------- Show/hide artifacts per toggles ---------- */
function applyArtifactsVisibility(){
  const showRTpy = ls.getBool('realtime_pinyin', true);
  const showRTen = ls.getBool('realtime_translation', true);
  const showNext = ls.getBool('next_char_suggest', true);
  const showEn   = ls.getBool(LSK.chEn, false);

  const rowPy = $('#rtRowPinyin'); if (rowPy) rowPy.classList.toggle('hidden', !showRTpy);
  const rowEn = $('#rtRowTrans'); if (rowEn) rowEn.classList.toggle('hidden', !showRTen);
  const rowNx = $('#rtRowNextChar'); if (rowNx) rowNx.classList.toggle('hidden', !showNext);

  const assistCard = $('#assistCard');
  const allHidden = (!showRTpy && !showRTen && !showNext);
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
  setLoading('#challengePanel', false);

  // zh + py (respect pinyin/tone toggles)
  $('#challengeZh').setAttribute('data-zh-text', c.zh||'');
  $('#challengeZh').setAttribute('data-zh-pinyin', c.py||'');
  renderAllZh();

  // en → gloss + challenge pill
  const parsed = parseChallengeFromEn(c.en || '');
  $('#challengeEn').textContent = ls.getBool(LSK.chEn, false) ? (parsed.gloss || '') : '';
  applyArtifactsVisibility();

  const badge = $('#challengeBadge');
  if (parsed.glue && parsed.glue.zh){
    const text = ` ${parsed.glue.zh} (${parsed.glue.py || '…'}${parsed.glue.en ? ', ' + parsed.glue.en : ''})`;
    badge.textContent = text;
    badge.title = parsed.line || '';
    badge.style.display = '';
    logInfo(`Target glue: ${parsed.glue.zh}${parsed.glue.en ? ' ('+parsed.glue.en+')' : ''}`);
  } else {
    badge.style.display = 'none';
  }

  // reset input & hints
  $('#answerInput').value = '';
  $('#hintsList').innerHTML = '';
  liveSuggestion.char = ''; liveSuggestion.pinyin='';
  renderNextChar();

  logInfo(`New challenge: ${c.id}`);
  if (ls.getBool('agent_reset_on_new', false)) {
    $('#agentHistory').innerHTML='';
    logInfo('Agent history reset (setting on).');
  }
}

function addHint(text){
  const p = document.createElement('div');
  p.textContent = '• '+ text;
  $('#hintsList').appendChild(p);
  logInfo(`Hint: ${text}`);
}

function addAgentMsg(who, text){
  const div = document.createElement('div');
  div.className = 'msg '+(who==='user'?'user':'agent');
  div.textContent = text;
  $('#agentHistory').appendChild(div);
  div.scrollIntoView({behavior:'smooth', block:'end'});
}

/* ---------- Feedback banner ---------- */
let feedbackTimer=null;
function showFeedback(msg, ok){
  const el = $('#answerFeedback');
  if (!el) return;
  el.textContent = msg || (ok ? 'Correct.' : 'Please try again.');
  el.className = ok ? 'ok' : 'err';
  el.style.opacity = '1';
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(()=>{ el.style.opacity='0'; }, 3500);
}

function onAnswerResult(res){
  setLoading('#challengePanel', false);
  const ok = !!res.correct;
  const exp = (res.explanation || '').trim();
  if (ok) { okBeep(); logSuccess(`Answer correct${exp ? ` — ${exp}` : ''}`); }
  else   { badBeep(); logError(`Answer incorrect${exp ? ` — ${exp}` : ''}`); }

  showFeedback(exp || (ok ? 'Great job!' : 'Check word order or tones.'), ok);

  const el = $('#answerInput');
  el.style.outline = ok ? '2px solid #35d07f' : '2px solid #ff6b6b';
  setTimeout(()=>{ el.style.outline=''; }, 450);
}

/* ---------- Assist: on-demand translate & pinyin ---------- */
function runAssist(){
  const txt = $('#answerInput').value;
  if (!txt) return;
  const needPy = ls.getBool('realtime_pinyin', true);
  const needEn = ls.getBool('realtime_translation', true);
  if (needEn) wsSend({type:'translate_input', text:txt});
  if (needPy) wsSend({type:'pinyin_input', text:txt});
}

/* ---------- Exports: bindings & settings ---------- */
export function bindEvents(){
  // New challenge (unified)
  $('#newChallengeBtn').addEventListener('click', ()=> requestNewChallenge());
  document.addEventListener('keydown', (e)=>{ if (e.key==='Escape'){ requestNewChallenge(); } });

  // Submit answer
  $('#answerForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    if(!current.challenge) return;
    const answer = $('#answerInput').value.trim();
    if(!answer) return;
    setLoading('#challengePanel', true);
    wsSend({type:'submit_answer', challengeId: current.challenge.id, answer});
  });

  // Assist button + shortcuts (Alt+A preferred; Ctrl+T also, but might be browser-reserved)
  $('#assistBtn').addEventListener('click', runAssist);
  document.addEventListener('keydown', (e)=>{
    if ((e.altKey  && (e.key==='a' || e.key==='A')) ||
        (e.ctrlKey && (e.key==='t' || e.key==='T'))){
      e.preventDefault();
      runAssist();
    }
  });

  // Keep next-char suggestion reactive as you type
  const probeNext = ()=>{
    if (!ls.getBool('next_char_suggest', true)) return;
    const txt = $('#answerInput').value;
    wsSend({type:'next_char', current:txt, challengeId: current.challenge?.id});
  };
  $('#answerInput').addEventListener('input', debounce(probeNext, 120));

  // Insert suggestion with Tab
  $('#answerInput').addEventListener('keydown', (e)=>{
    if (e.key==='Tab' && ls.getBool('next_char_suggest', true)){
      e.preventDefault();
      const {char} = liveSuggestion;
      if(char){
        const inp=$('#answerInput');
        const start=inp.selectionStart, end=inp.selectionEnd, val=inp.value;
        inp.value = val.slice(0,start)+char+val.slice(end);
        inp.selectionStart=inp.selectionEnd=start+char.length;
      }
    }
    if (e.key==='Enter' && !e.shiftKey){
      e.preventDefault();
      $('#answerForm').requestSubmit();
    }
  });

  // Manual hint
  $('#getHintBtn').addEventListener('click', ()=>{
    if(!current.challenge) return;
    wsSend({type:'hint', challengeId: current.challenge.id});
  });

  // Agent
  $('#agentForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    const text = $('#agentInput').value.trim();
    if(!text) return;
    $('#agentInput').value='';
    addAgentMsg('user', text);
    wsSend({type:'agent_message', text, challengeId: current.challenge?.id});
  });

  // Settings (visibility + rendering)
  $('#tglTone').addEventListener('change', (e)=>{ ls.setBool(LSK.tone, e.target.checked); renderAllZh(); });
  $('#tglPinyin').addEventListener('change', (e)=>{ ls.setBool(LSK.pinyin, e.target.checked); renderAllZh(); });

  $('#tglRTTrans').addEventListener('change', (e)=>{ ls.setBool('realtime_translation', e.target.checked); applyArtifactsVisibility(); });
  $('#tglRTPinyin').addEventListener('change', (e)=>{ ls.setBool('realtime_pinyin', e.target.checked); applyArtifactsVisibility(); });

  $('#tglNextChar').addEventListener('change', (e)=>{ ls.setBool('next_char_suggest', e.target.checked); applyArtifactsVisibility(); renderNextChar(); });
  $('#tglAgentReset').addEventListener('change', (e)=> ls.setBool('agent_reset_on_new', e.target.checked));
  $('#tglShowEn').addEventListener('change', (e)=>{ 
    ls.setBool(LSK.chEn, e.target.checked);
    const c = current.challenge;
    if (c){
      const parsed = parseChallengeFromEn(c.en || '');
      $('#challengeEn').textContent = e.target.checked ? (parsed.gloss || '') : '';
    }
    applyArtifactsVisibility();
  });

  $('#difficultySel').addEventListener('change', (e)=> localStorage.setItem('difficulty', e.target.value));
}

export function syncSettingsUI(){
  // Initial toggle states (reusing prior keys, semantics now "Assist shows X")
  $('#tglTone').checked       = ls.getBool(LSK.tone, false);
  $('#tglPinyin').checked     = ls.getBool(LSK.pinyin, false);
  $('#tglRTTrans').checked    = ls.getBool('realtime_translation', true);
  $('#tglRTPinyin').checked   = ls.getBool('realtime_pinyin', true);
  $('#tglNextChar').checked   = ls.getBool('next_char_suggest', true);
  $('#tglAgentReset').checked = ls.getBool('agent_reset_on_new', false);
  $('#tglShowEn').checked     = ls.getBool(LSK.chEn, false);
  $('#difficultySel').value   = localStorage.getItem('difficulty') || 'auto';

  // Apply current rendering and visibility
  renderAllZh();
  const c = current.challenge;
  if (c){
    const parsed = parseChallengeFromEn(c.en || '');
    $('#challengeEn').textContent = ls.getBool(LSK.chEn,false) ? (parsed.gloss || '') : '';
  }
  applyArtifactsVisibility();
}

/* ---------- WS message handling ---------- */
export function handleMessage(msg){
  switch(msg.type){
    case 'challenge': setChallenge(msg.challenge); break;
    case 'hint': addHint(msg.text); break;
    case 'translate': $('#liveTranslation').textContent = msg.translation || ''; break;
    case 'pinyin': $('#livePinyin').textContent = msg.pinyin || ''; break;
    case 'next_char':
      liveSuggestion.char = msg.char||'';
      liveSuggestion.pinyin = msg.pinyin||'';
      renderNextChar();
      break;
    case 'agent_reply':
      addAgentMsg('agent', msg.text||'');
      logInfo(`Agent reply: ${msg.text||''}`);
      break;
    case 'answer_result': onAnswerResult(msg); break;
  }
}

/* ---------- Actions ---------- */
export function requestNewChallenge(){
  setLoading('#challengePanel', true);
  wsSend({type:'new_challenge', difficulty: localStorage.getItem('difficulty')||'auto'});
}
