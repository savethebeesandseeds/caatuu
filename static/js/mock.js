import { current } from './state.js';

let usingMock=false, connected=false;
let mockIdx=0, hintCounter=0;

// New shape per ChallengeOut
const mockChallenges = [
  {
    id:'c1', difficulty:'hsk1', kind:'freeform_zh', source:'seed',
    seed_zh:'你好',
    seed_en:'Say hello.',
    challenge_zh:'用“你好”打招呼。',
    challenge_en:'Greet someone using “你好”.',
    summary_en:'Greet politely using 你好。'
  },
  {
    id:'c2', difficulty:'hsk2', kind:'freeform_zh', source:'generated',
    seed_zh:'今天天气很好。',
    seed_en:'The weather is great today.',
    challenge_zh:'扩展一句话说明你想做什么。',
    challenge_en:'Extend with one sentence about what you want to do.',
    summary_en:'Describe an action given nice weather.'
  },
  {
    id:'c3', difficulty:'hsk3', kind:'freeform_zh', source:'local_bank',
    seed_zh:'我想喝一杯咖啡。',
    seed_en:'I want to drink a cup of coffee.',
    challenge_zh:'加入时间信息（比如：上午、下午）。',
    challenge_en:'Add time info (e.g., morning/afternoon).',
    summary_en:'Add a time phrase to the desire sentence.'
  },
  {
    id:'c4', difficulty:'hsk4', kind:'freeform_zh', source:'seed',
    seed_zh:'学习中文需要坚持。',
    seed_en:'Learning Chinese requires persistence.',
    challenge_zh:'给出一个实际建议来坚持学习。',
    challenge_en:'Give a concrete tip for sticking with study.',
    summary_en:'Offer a practical study tip.'
  },
];

let handleMessageCB = ()=>{};

export function setMockHandler(cb){ handleMessageCB = cb; }

export function startMock(){ 
  usingMock=true; connected=false;
  mockIdx = Math.floor(Math.random() * mockChallenges.length);
}

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
        const target = (c.challenge_zh || c.seed_zh || '');
        const correct = (answer||'').trim()===target || (!!target && (answer||'').includes(target[0]));
        const score = correct ? 92 : Math.floor(40 + Math.random()*18); // 40-58 mock fail
        handleMessageCB({
          type:'answer_result',
          correct,
          score,
          expected:'',
          explanation: correct ? 'Great job!' : 'Try focusing on word order.'
        });
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
      case 'grammar_input': {
        const text = (obj.text||'').trim();
        let corrected = text;
        // Tiny mock "correction": ensure sentence-final punctuation, replace '的了' -> '了的' (nonsense but visually shows change)
        if (corrected && !/[。！？.!?]$/.test(corrected)) corrected += '。';
        corrected = corrected.replace(/的了/g, '了的');
        handleMessageCB({type:'grammar', text, corrected});
        break;
      }
      case 'next_char': {
        // Freeform tasks: not applicable
        handleMessageCB({type:'next_char', char:'', pinyin:'', reason:'Not applicable to freeform tasks.'});
        break;
      }
      case 'agent_message': {
        handleMessageCB({type:'agent_reply', text:'(mock) Think about tones 3→4 cadence here.'});
        break;
      }
      case 'speech_to_text_input': {
        const sample = ['我想去图书馆学习。', '今天下午我打算去公园跑步。', '我觉得这个挑战有意思。'];
        const text = sample[Math.floor(Math.random() * sample.length)];
        handleMessageCB({type:'speech_to_text', text});
        break;
      }
    }
  }, 220 + Math.random()*220);
}
