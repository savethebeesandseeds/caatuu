import { startMock, mockHandle, setMockHandler } from './mock.js';

let WS = null;
let connected = false;
let usingMock = false;

let onMessage = ()=>{};
let connDotEl = null;

/* --- Reconnect + heartbeat --- */
let reconnectAttempts = 0;
let reconnectTimer = null;
let heartbeatTimer = null;

const HEARTBEAT_MS = 25000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 15000;

export function setOnMessage(cb){ onMessage = cb; setMockHandler(cb); }
export function setConnDotEl(el){ connDotEl = el; }

function updateConnDot(state){
  if(!connDotEl) return;
  // state: 'ok' | 'off' | 'reconnecting'
  connDotEl.className = 'led ' + (state || 'off');
  connDotEl.title = state === 'ok' ? 'Connected'
                 : state === 'reconnecting' ? 'Reconnecting… (mock active)'
                 : 'Offline (mock)';
}

function startHeartbeat(){
  stopHeartbeat();
  heartbeatTimer = setInterval(()=>{
    if (WS && connected && WS.readyState === WebSocket.OPEN){
      try{ WS.send(JSON.stringify({type:'ping'})); }catch(e){}
    }
  }, HEARTBEAT_MS);
}
function stopHeartbeat(){
  if (heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function scheduleReconnect(){
  updateConnDot('reconnecting');
  if (reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts++), RECONNECT_MAX_MS)
              + Math.floor(Math.random()*500);
  reconnectTimer = setTimeout(()=>{
    reconnectTimer = null;
    connectWS();
  }, delay);
}

export function connectWS(){
  // Avoid opening another socket if we already have one connecting/open
  if (WS && (WS.readyState === WebSocket.OPEN || WS.readyState === WebSocket.CONNECTING)) return;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const WS_URL = `${proto}://${location.host||'localhost:8080'}/ws`;

  try{
    updateConnDot('reconnecting'); // visual cue while connecting
    WS = new WebSocket(WS_URL);

    WS.addEventListener('open', ()=>{
      connected = true; usingMock = false;
      updateConnDot('ok');
      reconnectAttempts = 0;
      if (reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; }
      startHeartbeat();
    });

    WS.addEventListener('message', ev=>{
      let data=null;
      try{ data = JSON.parse(ev.data); }catch(e){}
      if (!data) return;

      // ignore plain pong replies
      if (data.type === 'pong') return;

      try{ onMessage(data); }catch(e){}
    });

    WS.addEventListener('close', ()=>{
      connected = false;
      stopHeartbeat();
      // Continue operating in mock while we attempt to reconnect
      startMock(); usingMock = true;
      scheduleReconnect();
    });

    WS.addEventListener('error', ()=>{
      // 'close' generally follows; if not, ensure we schedule reconnect
    });
  }catch(e){
    // If socket creation throws (e.g., bad URL), fall back to mock and try again later
    startMock(); usingMock = true;
    scheduleReconnect();
  }
}

export function wsSend(obj){
  if (connected && WS && WS.readyState === WebSocket.OPEN){
    try { WS.send(JSON.stringify(obj)); }
    catch { mockHandle(obj); }
  } else {
    // While reconnecting, keep app usable via mock
    mockHandle(obj);
  }
}
