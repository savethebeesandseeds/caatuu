import { getVar } from './utils.js';

// ---------- utils ----------
export const esc = s =>
  String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const RE_HAN = /\p{Script=Han}/u;
function isHan(ch){
  try { return RE_HAN.test(ch); }
  catch { return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(ch); }
}

function toneColor(t){
  switch (t) {
    case 1: return getVar('--tone1') || '#ff6b6b';
    case 2: return getVar('--tone2') || '#f7b731';
    case 3: return getVar('--tone3') || '#4cd137';
    case 4: return getVar('--tone4') || '#45aaf2';
    default: return getVar('--tone5') || '#a4b0be';
  }
}

// ---------- tone detection ----------
export function toneNumber(p){
  if (!p) return 5;
  const s = String(p).normalize('NFC').trim().replace(/[\p{P}\p{S}]+$/u,''); // drop trailing punct
  const m = s.match(/[0-5]$/);
  if (m) return m[0] === '0' ? 5 : parseInt(m[0],10);

  const groups = {
    1:'āēīōūǖĀĒĪŌŪǕ',
    2:'áéíóúǘÁÉÍÓÚǗ',
    3:'ǎěǐǒǔǚǍĚǏǑǓǙ',
    4:'àèìòùǜÀÈÌÒÙǛ'
  };
  for (const t of [1,2,3,4]) for (const ch of groups[t]) if (s.includes(ch)) return t;
  return 5;
}

// ---------- pinyin tokenizer (key fix) ----------
/**
 * Extracts pinyin syllables irrespective of spaces, quotes, or punctuation.
 * Matches Latin letters (incl. diacritics/ü/Ü) + optional final tone digit.
 * Apostrophe (xi'an) and hyphen split syllables, which is what we want.
 */
const SYL_RE = /[\p{Script=Latin}\p{M}]+[0-5]?/gu;
function tokenizePinyin(pinyinFull){
  const s = String(pinyinFull || '').normalize('NFC');
  return Array.from(s.matchAll(SYL_RE), m => m[0]);
}

// ---------- align + render ----------
export function alignPinyinToText(textZh, pinyinFull){
  const chars = Array.from(textZh || '');
  const toks  = tokenizePinyin(pinyinFull);
  const out = [];
  let iTok = 0;

  for (const ch of chars) {
    if (isHan(ch)) {
      out.push(toks[iTok] || '');
      if (iTok < toks.length) iTok++;
    } else {
      out.push(''); // punctuation/space/etc. doesn't consume a token
    }
  }
  return out;
}

export function renderZh(text, pinyinSyllables, showPinyin, useTone){
  const chars = Array.from(text || '');
  const pys = Array.isArray(pinyinSyllables) ? pinyinSyllables : [];
  let html = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const py = pys[i] || '';
    const style = (useTone && py) ? ` style="color:${toneColor(toneNumber(py))}"` : '';

    if (showPinyin && py) {
      html += `<ruby class="zh"><rb${style}>${esc(ch)}</rb><rt>${esc(py)}</rt></ruby>`;
    } else {
      html += `<span class="zh"${style}>${esc(ch)}</span>`;
    }
  }
  return html;
}
