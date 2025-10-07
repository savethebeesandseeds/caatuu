import { getVar } from './utils.js';

export function toneNumber(p) {
  if (!p) return 5;
  const m = p.match(/[1-4]$/); if (m) return parseInt(m[0], 10);
  const groups = {1:'āēīōūǖĀĒĪŌŪǕ',2:'áéíóúǘÁÉÍÓÚǗ',3:'ǎěǐǒǔǚǍĚǏǑǓǙ',4:'àèìòùǜÀÈÌÒÙǛ'};
  for (const t of [1,2,3,4]) for (const ch of groups[t]) if (p.includes(ch)) return t;
  return 5;
}
export const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function toneColor(t) {
  switch (t) {
    case 1: return getVar('--tone1') || '#ff6b6b';
    case 2: return getVar('--tone2') || '#f7b731';
    case 3: return getVar('--tone3') || '#4cd137';
    case 4: return getVar('--tone4') || '#45aaf2';
    default: return getVar('--tone5') || '#a4b0be';
  }
}

export function renderZh(text, pinyinSyllables, showPinyin, useTone) {
  const chars = Array.from(text || '');
  const pys = Array.isArray(pinyinSyllables) ? pinyinSyllables : [];
  let html = '';
  for (let i=0; i<chars.length; i++) {
    const ch = chars[i];
    const py = pys[i] || '';
    let style = '';
    if (useTone && py) style = ` style="color:${toneColor(toneNumber(py))}"`;
    if (showPinyin && py) {
      html += `<ruby class="zh"><rb${style}>${esc(ch)}</rb><rt>${esc(py)}</rt></ruby>`;
    } else {
      html += `<span class="zh"${style}>${esc(ch)}</span>`;
    }
  }
  return html;
}

export function alignPinyinToText(textZh, pinyinFull) {
  const chars = Array.from(textZh || '');
  const toks = String(pinyinFull || '').trim().split(/\s+/);
  const out = [];
  let iTok = 0;
  const isCJK = (ch) => /[\u3400-\u9FFF]/.test(ch);
  for (const ch of chars) {
    if (isCJK(ch)) { out.push(toks[iTok] || ''); if (iTok < toks.length) iTok++; }
    else { out.push(''); }
  }
  return out;
}
