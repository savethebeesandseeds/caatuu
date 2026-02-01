import { $, $$, debounce, logInfo, logSuccess, logError, logWarn } from './utils.js';
import { LSK, ls, current, liveSuggestion } from './state.js';
import { renderZh, alignPinyinToText, esc as escHtml } from './zh.js';
import { okBeep, badBeep, speakText, ttsVoices, ttsSupported, onTTSVoicesChanged } from './audio.js';
import { wsSend } from './socket.js';


const AGENT_MODE_KEY = 'agent_mode_v1';
const AgentMode = { tutor:'tutor', translate:'translate' };

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
  if (inp){
    inp.placeholder = isTutor
      ? 'Tutor mode: ask about the Seed + Challenge (requirements, grammar, patterns)…'
      : 'Translate mode: paste Chinese or English to translate (ZH ⇄ EN)…';
  }

  const hint = $('#agentHint');
  if (hint){
    hint.innerHTML = isTutor
      ? '🧠 Tutor mode: ask about the current Seed + Challenge (required verb/place, word order, particles). <kbd>Enter</kbd> sends · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline.'
      : '🌐 Translate mode: paste text to translate (auto ZH ⇄ EN). <kbd>Enter</kbd> sends · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline.';
  }
}
function setAgentMode(mode){
  const m = (mode === AgentMode.translate) ? AgentMode.translate : AgentMode.tutor;
  ls.setStr(AGENT_MODE_KEY, m);
  applyAgentModeUI(m);
}

/* ---------- Loading helper ---------- */
function setLoading(panelSelector, flag){
  const el = $(panelSelector.startsWith('#') ? panelSelector : ('#'+panelSelector));
  if(!el) return;
  el.setAttribute('data-loading', flag ? 'true' : 'false');
}

/* ---------- Challenge English helpers ---------- */
function enSummary(c){
  return (c.summary_en || c.challenge_en || c.seed_en || '') || '';
}
function enTooltip(c){
  const out = [];
  if (c.summary_en) out.push(`Summary: ${c.summary_en}`);
  if (c.seed_en) out.push(`Seed: ${c.seed_en}`);
  if (c.challenge_en) out.push(`Challenge: ${c.challenge_en}`);
  return out.join('\n');
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
function renderNextChar(){
  const el = $('#liveNextChar');
  if (!ls.getBool('next_char_suggest', true)) { el.textContent=''; return; }
  const {char, pinyin} = liveSuggestion;
  el.textContent = char ? `${char}  (${pinyin||'?'})` : '';
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

  // Seed + Challenge text blocks (pinyin fetched on-demand)
  const seedEl = $('#seedZh');
  const chalEl = $('#challengeZh');
  if (seedEl){ seedEl.setAttribute('data-zh-text', c.seed_zh || ''); seedEl.setAttribute('data-zh-pinyin', ''); }
  if (chalEl){ chalEl.setAttribute('data-zh-text', c.challenge_zh || ''); chalEl.setAttribute('data-zh-pinyin', ''); }
  ensureChallengePinyin();
  renderAllZh();

  // English: summary (fallbacks)
  $('#challengeEn').textContent = ls.getBool(LSK.chEn, true) ? enSummary(c) : '';
  applyArtifactsVisibility();
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
  if (infoBtn) infoBtn.title = enTooltip(c) || '';

  // reset input & hints
  $('#answerInput').value = '';
  $('#hintsList').innerHTML = '';
  liveSuggestion.char = ''; liveSuggestion.pinyin='';
  renderNextChar();

  // reset grammar box (keep visible with a placeholder)
  const gr = $('#liveGrammar');
  if (gr) gr.innerHTML = '<span class="subtle">Press Assist to see corrections.</span>';

  logInfo(`New challenge: ${c.id} (${c.difficulty||'hsk3'} · ${c.source||'seed'})`);
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

function onAnswerResult(res){
  setLoading('#challengePanel', false);
  const ok = !!res.correct;
  const exp = (res.explanation || '').trim();
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
  const txt = $('#answerInput').value;
  if (!txt) return;
  const needPy = ls.getBool('realtime_pinyin', true);
  const needEn = ls.getBool('realtime_translation', true);
  if (needEn){
    enqueuePending(pendingTranslate, txt, 'assist');
    wsSend({type:'translate_input', text:txt});
  }
  if (needPy) wsSend({type:'pinyin_input', text:txt});
  // Always ask for grammar correction on Assist
  wsSend({type:'grammar_input', text:txt});
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
    const txt = $('#answerInput').value;
    wsSend({type:'next_char', current:txt, challengeId: current.challenge?.id});
  };
  $('#answerInput').addEventListener('input', debounce(probeNext, 120));

  // Insert suggestion with Tab; Enter submits (Shift+Enter = newline)
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
      wsSend({type:'translate_input', text});
    } else {
      wsSend({type:'agent_message', text, challengeId: current.challenge?.id});
    }
  });
  $('#agentInput').addEventListener('keydown', (e)=>{
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
  $('#tglTone').addEventListener('change', (e)=>{ ls.setBool(LSK.tone, e.target.checked); ensureChallengePinyin(); renderAllZh(); });
  $('#tglPinyin').addEventListener('change', (e)=>{ ls.setBool(LSK.pinyin, e.target.checked); ensureChallengePinyin(); renderAllZh(); });

  $('#tglRTTrans').addEventListener('change', (e)=>{ ls.setBool('realtime_translation', e.target.checked); applyArtifactsVisibility(); });
  $('#tglRTPinyin').addEventListener('change', (e)=>{ ls.setBool('realtime_pinyin', e.target.checked); applyArtifactsVisibility(); });

  $('#tglNextChar').addEventListener('change', (e)=>{ ls.setBool('next_char_suggest', e.target.checked); applyArtifactsVisibility(); renderNextChar(); });
  $('#tglAgentReset').addEventListener('change', (e)=> ls.setBool('agent_reset_on_new', e.target.checked));
  $('#tglShowEn').addEventListener('change', (e)=>{
    ls.setBool(LSK.chEn, e.target.checked);
    const c = current.challenge;
    if (c){
      $('#challengeEn').textContent = e.target.checked ? enSummary(c) : '';
    }
    applyArtifactsVisibility();
  });

  $('#difficultySel').addEventListener('change', (e)=> localStorage.setItem('difficulty', e.target.value));
}

export function syncSettingsUI(){
  // Initial toggle states
  $('#tglTone').checked       = ls.getBool(LSK.tone, true);
  $('#tglPinyin').checked     = ls.getBool(LSK.pinyin, true);
  $('#tglRTTrans').checked    = ls.getBool('realtime_translation', true);
  $('#tglRTPinyin').checked   = ls.getBool('realtime_pinyin', true);
  $('#tglNextChar').checked   = ls.getBool('next_char_suggest', true);
  $('#tglAgentReset').checked = ls.getBool('agent_reset_on_new', true);
  $('#tglShowEn').checked     = ls.getBool(LSK.chEn, true);
  $('#difficultySel').value   = localStorage.getItem('difficulty') || 'auto';

  // Apply current rendering and visibility
  renderAllZh();
  const c = current.challenge;
  if (c){
    $('#challengeEn').textContent = ls.getBool(LSK.chEn,true) ? enSummary(c) : '';
    ensureChallengePinyin();
  }
  applyArtifactsVisibility();
}

/* ---------- WS message handling ---------- */
export function handleMessage(msg){
  switch(msg.type){
    case 'challenge': setChallenge(msg.challenge); break;
    case 'hint': addHint(msg.text); break;
    case 'translate': {
      const txt = (msg.text || '');
      const origin = dequeuePending(pendingTranslate, txt);
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
      // Route to Assist if it matches current input
      const inputNow = $('#answerInput').value || '';
      if (txt === inputNow){
        $('#livePinyin').textContent = msg.pinyin || '';
        break;
      }
      // Else see if it's for seed/challenge
      const targets = pendingChallengePy.get(txt);
      if (targets && targets.length){
        targets.forEach(id=>{
          const el = $('#'+id);
          if (el) el.setAttribute('data-zh-pinyin', msg.pinyin || '');
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
    case 'next_char':
      liveSuggestion.char = msg.char||'';
      liveSuggestion.pinyin = msg.pinyin||'';
      renderNextChar();
      break;
    case 'agent_reply':
      addAgentMsg('agent', msg.text||'');
      addAgentMsg('agent', msg.text||'', {label:'Tutor'});
      setLoading('#agentPanel', false);
      logInfo(`Agent reply: ${msg.text||''}`);
      break;
    case 'answer_result': onAnswerResult(msg); break;
  }
}

/* ---------- Actions ---------- */
export function requestNewChallenge(){
  setLoading('#challengePanel', true);
  const v = localStorage.getItem('difficulty') || 'auto';
  const payload = { type:'new_challenge' };
  payload.difficulty = "HSK1";
  if (v && v !== 'auto') payload.difficulty = v;
  wsSend(payload);
}
