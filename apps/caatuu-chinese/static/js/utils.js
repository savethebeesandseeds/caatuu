export const $  = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

export const setVar = (name, val) => document.documentElement.style.setProperty(name, val);
export const getVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function debounce(fn, ms=150){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

/* ---------- Enhanced logging ---------- */
const LOGS = [];
const LOG_LIMIT = 500;

function addLogEl(type, message){
  const ul = $('#eventLog');
  const li = document.createElement('li');
  li.className = `log-item log-${type}`;

  const ts = new Date().toLocaleTimeString();
  const tsEl = document.createElement('span');
  tsEl.className = 'ts';
  tsEl.textContent = `[${ts}]`;

  const txtEl = document.createElement('span');
  txtEl.className = 'txt';
  txtEl.textContent = message;

  li.append(tsEl, txtEl);
  if (ul) ul.prepend(li);

  LOGS.unshift({ ts, type, message });
  if (LOGS.length > LOG_LIMIT) LOGS.length = LOG_LIMIT;
}

export function logInfo(msg){ addLogEl('info', msg); }
export function logSuccess(msg){ addLogEl('success', msg); }
export function logWarn(msg){ addLogEl('warn', msg); }
export function logError(msg){ addLogEl('error', msg); }

export function getLogsText(){
  return LOGS.map(x => `[${x.ts}] ${x.type.toUpperCase()}: ${x.message}`).join('\n');
}

export function clearLogs(){
  const ul = $('#eventLog');
  if (ul) ul.innerHTML = '';
  LOGS.length = 0;
}

export async function copyText(text){
  try{
    if (navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch(e){}
  // Fallback
  try{
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.left='-9999px';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }catch(e){ return false; }
}
