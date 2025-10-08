let AC;
function ctx(){ if(!AC){ AC = new (window.AudioContext||window.webkitAudioContext)(); } return AC; }

function tone({freq=660, dur=0.12, type='sine', gain=0.035}={}){
  try{
    const ac = ctx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 4000;

    o.type = type; o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(f).connect(g).connect(ac.destination);

    const now = ac.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    o.start(now);
    o.stop(now + dur + 0.01);
  }catch(e){}
}

export const okBeep  = ()=>{ tone({freq:620, type:'sine', dur:0.11, gain:0.03}); setTimeout(()=>tone({freq:740, type:'triangle', dur:0.09, gain:0.028}), 70); };
export const badBeep = ()=>{ tone({freq:320, type:'sine', dur:0.12, gain:0.03}); setTimeout(()=>tone({freq:260, type:'sine', dur:0.11, gain:0.028}), 80); };
export const clickBeep = ()=> tone({freq:520, type:'sine', dur:0.05, gain:0.02});

/* -------------------- Text-to-Speech helpers -------------------- */
export function ttsSupported(){
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}
export function ttsVoices(){
  try{ return window.speechSynthesis.getVoices() || []; }
  catch(e){ return []; }
}
export function onTTSVoicesChanged(cb){
  if (!ttsSupported() || !cb) return;
  try{
    window.speechSynthesis.addEventListener('voiceschanged', cb, { once:false });
  }catch(e){
    // Fallback property assignment
    window.speechSynthesis.onvoiceschanged = cb;
  }
}

/**
 * Speak arbitrary text.
 * @param {string} text
 * @param {{voiceKey?:string, rate?:number, lang?:string}} opts
 * @returns {boolean} success
 */
export function speakText(text, {voiceKey=null, rate=1.0, lang='zh-CN'}={}){
  try{
    if (!ttsSupported() || !text) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;

    const list = ttsVoices();
    if (list.length){
      let v = null;
      if (voiceKey){
        v = list.find(vo => vo.voiceURI === voiceKey || vo.name === voiceKey) || null;
      }
      if (!v){
        // Prefer zh voice if available, else browser default
        v = list.find(vo => (vo.lang||'').toLowerCase().startsWith('zh')) || null;
      }
      if (v) u.voice = v;
    }

    // Avoid overlapping with previous utterances
    try { window.speechSynthesis.cancel(); } catch(e){}
    window.speechSynthesis.speak(u);
    return true;
  }catch(e){
    return false;
  }
}
