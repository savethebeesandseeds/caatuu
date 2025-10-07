import { alignPinyinToText } from './zh.js';
import { current } from './state.js';

let usingMock=false, connected=false;
let mockIdx=0, hintCounter=0;

const mockChallenges = [
  { id:'c1', zh:'你好世界', py:'nǐ hǎo shì jiè', en:'Hello, world.' },
  { id:'c2', zh:'今天天气很好', py:'jīn tiān tiān qì hěn hǎo', en:'The weather is great today.' },
  { id:'c3', zh:'我想喝一杯咖啡', py:'wǒ xiǎng hē yì bēi kā fēi', en:'I want to drink a cup of coffee.' },
  { id:'c4', zh:'学习中文需要坚持', py:'xué xí zhōng wén xū yào jiān chí', en:'Learning Chinese requires persistence.' },
];

let handleMessageCB = ()=>{};

export function setMockHandler(cb){ handleMessageCB = cb; }

export function startMock(){ usingMock=true; connected=false; }

export function mockHandle(obj){
  setTimeout(()=>{
    switch(obj.type){
      case 'new_challenge': {
        const c = mockChallenges[mockIdx++ % mockChallenges.length];
        hintCounter=0;
        handleMessageCB({type:'challenge', challenge:c});
        break;
      }
      case 'submit_answer': {
        const {answer, challengeId} = obj;
        const c = mockChallenges.find(x=>x.id===challengeId) || mockChallenges[0];
        const correct = (answer||'').includes(c.zh[0]) || (answer||'').trim()===c.zh || (answer||'').toLowerCase().includes(c.py.split(/\s+/)[0].replace(/\d/g,''));
        handleMessageCB({type:'answer_result', correct, expected:c.zh, explanation: correct?'Great job!':'Try focusing on word order.'});
        break;
      }
      case 'hint': {
        hintCounter++;
        const hp = ['Think of a common greeting.','First word: 你 (nǐ).','Structure: [Pronoun] + [好] + [Object].'];
        handleMessageCB({type:'hint', text: hp[(hintCounter-1)%hp.length]});
        break;
      }
      case 'translate_input': {
        const text = obj.text||'';
        const fake = text ? `“${text}” ≈ (mock) translation` : '';
        handleMessageCB({type:'translate', text, translation: fake});
        break;
      }
      case 'pinyin_input': {
        const text = obj.text||'';
        const py = Array.from(text).map(ch => /[\u3400-\u9FFF]/.test(ch) ? 'x5' : ch).join(' ');
        handleMessageCB({type:'pinyin', text, pinyin: py});
        break;
      }
      case 'next_char': {
        const c = current.challenge || mockChallenges[0];
        const idx = (obj.current||'').length;
        const char = c.zh[idx] || '';
        const py = alignPinyinToText(c.zh, c.py)[idx]||'';
        handleMessageCB({type:'next_char', char, pinyin:py, reason:'Prefix match to challenge.'});
        break;
      }
      case 'agent_message': {
        handleMessageCB({type:'agent_reply', text:'(mock) Think about tones 3→4 cadence here.'});
        break;
      }
    }
  }, 220 + Math.random()*220);
}
