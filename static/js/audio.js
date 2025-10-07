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
// Kept minimal; you can call this on specific UI events if desired.
export const clickBeep = ()=> tone({freq:520, type:'sine', dur:0.05, gain:0.02});
