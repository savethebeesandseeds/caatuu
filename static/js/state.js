export const LSK = {
  hints: 'zh_hints_show_v2',
  answer: 'zh_answer_show_v2',
  pinyin: 'zh_pinyin_show_v2',
  tone: 'zh_tone_show_v2',
  chEn: 'zh_challenge_en_v3'
};

export const ls = {
  getBool: (k, def) => (localStorage.getItem(k) ?? (def ? '1' : '0')) === '1',
  setBool: (k, b) => localStorage.setItem(k, b ? '1' : '0'),
};

export const current = {
  challenge: null,
  loading: { challenge:false, hint:false, answer:false, agent:false }
};

export const liveSuggestion = { char:'', pinyin:'' };
