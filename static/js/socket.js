import { startMock, mockHandle, setMockHandler } from './mock.js';
import { logInfo, logWarn, logError } from './utils.js';

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
    logInfo(`[WS] Reconnecting (attempt ${reconnectAttempts})…`);
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
    logInfo(`[WS] Connecting to ${WS_URL}…`);
    WS = new WebSocket(WS_URL);

    // Guard against browsers that emit 'error' but not 'close'
    let connectTimeout = setTimeout(()=>{
      if (!connected){
        try{ WS && WS.close(); }catch(_){}
        startMock(); usingMock = true;
        updateConnDot('reconnecting');
        logWarn('[WS] Connect timeout; using mock while retrying…');
        scheduleReconnect();
      }
    }, 2500);

    WS.addEventListener('open', ()=>{
      clearTimeout(connectTimeout);
      connected = true; usingMock = false;
      updateConnDot('ok');
      reconnectAttempts = 0;
      if (reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; }
      startHeartbeat();
      logSuccessSafe('[WS] Connected.');
    });

    WS.addEventListener('message', ev=>{
      let data=null;
      try{ data = JSON.parse(ev.data); }catch(e){}
      if (!data) return;

      // ignore plain pong replies
      if (data.type === 'pong') return;

      try{ onMessage(data); }catch(e){}
    });

    WS.addEventListener('close', (e)=>{
      clearTimeout(connectTimeout);
      connected = false;
      stopHeartbeat();
      logWarn(`[WS] Closed (code ${e.code}${e.reason ? `, reason: ${e.reason}` : ''}). Using mock + retry.`);
      // Continue operating in mock while we attempt to reconnect
      startMock(); usingMock = true;
      scheduleReconnect();
    });

    WS.addEventListener('error', ()=>{
      // Some browsers only fire 'error' (no 'close') when Origin is rejected or path blocked.
      clearTimeout(connectTimeout);
      if (!connected){
        logError('[WS] Error during connect; switching to mock + retry.');
        try{ WS && WS.close(); }catch(_){}
        connected = false;
        startMock(); usingMock = true;
        updateConnDot('reconnecting');
        scheduleReconnect();
      } else {
        logError('[WS] Error on open socket.');
      }
    });
  }catch(e){
    // If socket creation throws (e.g., bad URL), fall back to mock and try again later
    logError('[WS] Exception creating socket; using mock + retry.');
    startMock(); usingMock = true;
    scheduleReconnect();
  }
}

// Safe logging helper (in case UI not yet mounted)
function logSuccessSafe(msg){
  try{ logInfo(msg); }catch(_){ console.log(msg); }
}

export function wsSend(obj){
  if (connected && WS && WS.readyState === WebSocket.OPEN){
    try { WS.send(JSON.stringify(obj)); }
    catch {
      logWarn('[WS] Send failed; routing to mock.');
      mockHandle(obj);
    }
  } else {
    // While reconnecting or offline, keep app usable via mock
    logWarn('[WS] Offline/reconnecting; routing action to mock.');
    mockHandle(obj);
  }
}

/* Try again quickly when network comes back */
window.addEventListener('online', ()=>{ logInfo('[WS] Browser back online; scheduling reconnect.'); scheduleReconnect(); });
window.addEventListener('offline', ()=>{ 
  logWarn('[WS] Browser offline; switching to mock.');
  connected=false; 
  startMock(); usingMock=true; 
  updateConnDot('reconnecting'); 
});
