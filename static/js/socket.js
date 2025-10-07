import { startMock, mockHandle, setMockHandler } from './mock.js';

let WS=null, connected=false, usingMock=false;
let onMessage = ()=>{};
let connDotEl = null;

export function setOnMessage(cb){ onMessage = cb; setMockHandler(cb); }
export function setConnDotEl(el){ connDotEl = el; }

function updateConnDot(ok){
  if(!connDotEl) return;
  connDotEl.className='led '+(ok?'ok':'off');
  connDotEl.title = ok?'Connected':'Offline (mock)';
}

export function connectWS(){
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const WS_URL = `${proto}://${location.host||'localhost:8080'}/ws`;
  try{
    WS = new WebSocket(WS_URL);
    WS.addEventListener('open', ()=>{
      connected=true; usingMock=false; updateConnDot(true);
    });
    WS.addEventListener('message', ev=>{
      try{ onMessage(JSON.parse(ev.data)); } catch(e){}
    });
    WS.addEventListener('close', ()=>{
      connected=false; updateConnDot(false);
      startMock(); usingMock=true;
    });
    WS.addEventListener('error', ()=>{ /* ignore; close will follow */ });
  }catch(e){
    startMock(); usingMock=true; updateConnDot(false);
  }
}

export function wsSend(obj){
  if(connected && WS && WS.readyState===1){ WS.send(JSON.stringify(obj)); }
  else { mockHandle(obj); }
}
