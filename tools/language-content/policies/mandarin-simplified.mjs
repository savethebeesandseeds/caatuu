import { defineTargetContentPolicy } from "./contract.mjs";

export const MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID = "mandarin-simplified-v1";

const HAN_PATTERN = /\p{Script=Han}/u;
const HAN_ONLY_PATTERN = /^\p{Script=Han}+$/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const LETTER_PATTERN = /\p{Letter}/u;
const PINYIN_NOTATION_PATTERN =
  /^[\p{Script=Latin}\p{Mark}\p{White_Space}.,!?;:'’()\-]+$/u;
const PINYIN_UNIT_PATTERN = /^[\p{Script=Latin}\p{Mark}]+$/u;
const COMMON_TRADITIONAL_ONLY_PATTERN =
  /[書貓學習說讀寫聽見門開關車魚鳥風雲電腦網絡體國語來這個們師時點萬與裡後發現愛歡東買賣錢醫藥飯館號臺灣廣樣為麼]/u;
const PINYIN_TONE_MARKS = new Set(["\u0304", "\u0301", "\u030c", "\u0300"]);
// Standard orthographic Hanyu Pinyin syllables used for curated learner
// content. Keeping the legal combinations explicit prevents an initial/final
// Cartesian product from accepting impossible forms such as `fi`, while the
// orthographic spellings reject forms such as `jü` (written `ju`). Rare
// dialectal and interjection-only spellings are intentionally outside this
// teaching-content contract.
const LEGAL_PINYIN_SYLLABLES = new Set(`
  a ai an ang ao e ei en eng er o ou
  ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
  pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu
  ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu
  fa fan fang fei fen feng fo fou fu
  da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo
  ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo
  na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nü nüe
  la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu long lou lu luan lun luo lü lüe
  ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo
  ka kai kan kang kao ke ken keng kong kou ku kua kuai kuan kuang kui kun kuo
  ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo
  ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun
  qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun
  xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun
  zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo
  cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo
  sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo
  ran rang rao re ren reng ri rong rou ru ruan rui run ruo
  za zai zan zang zao ze zei zen zeng zi zong zou zu zuan zui zun zuo
  ca cai can cang cao ce cen ceng ci cong cou cu cuan cui cun cuo
  sa sai san sang sao se sen seng si song sou su suan sui sun suo
  ya yan yang yao ye yi yin ying yo yong you
  wa wai wan wang wei wen weng wo wu
  yu yuan yue yun
  m n ng
`.trim().split(/\s+/u));

function issue(code, message) {
  return { code, message };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyPinyinCharacters(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (!PINYIN_NOTATION_PATTERN.test(value)) return false;
  if (!LATIN_LETTER_PATTERN.test(value)) return false;
  for (const character of value) {
    if (LETTER_PATTERN.test(character) && !LATIN_LETTER_PATTERN.test(character)) return false;
  }
  return true;
}

function hasDefensiblePinyinUnit(value) {
  const notation = String(value ?? "").trim();
  if (!PINYIN_UNIT_PATTERN.test(notation) || !LATIN_LETTER_PATTERN.test(notation)) return false;
  let toneMarks = 0;
  let toneBaseIndex = -1;
  const tonelessCharacters = [];
  for (const character of notation.normalize("NFD")) {
    if (PINYIN_TONE_MARKS.has(character)) {
      toneMarks += 1;
      const lastIndex = tonelessCharacters.length - 1;
      if (toneMarks > 1 || !/[aeiouü]/u.test(tonelessCharacters[lastIndex] ?? "")) return false;
      toneBaseIndex = lastIndex;
      continue;
    }
    if (character === "\u0308") {
      const lastIndex = tonelessCharacters.length - 1;
      if (tonelessCharacters[lastIndex] !== "u") return false;
      tonelessCharacters[lastIndex] = "ü";
      continue;
    }
    if (/\p{Mark}/u.test(character)) return false;
    if (!/\p{Script=Latin}/u.test(character)) return false;
    tonelessCharacters.push(character.toLocaleLowerCase("und"));
  }
  const base = tonelessCharacters.join("").normalize("NFC");
  if (!LEGAL_PINYIN_SYLLABLES.has(base)) return false;
  if (toneBaseIndex < 0) return true;

  const aIndex = tonelessCharacters.indexOf("a");
  const eIndex = tonelessCharacters.indexOf("e");
  const ouIndex = base.indexOf("ou");
  let expectedToneIndex = aIndex >= 0
    ? aIndex
    : eIndex >= 0
      ? eIndex
      : ouIndex >= 0
        ? ouIndex
        : -1;
  if (expectedToneIndex < 0) {
    for (let index = tonelessCharacters.length - 1; index >= 0; index -= 1) {
      if (/[iouü]/u.test(tonelessCharacters[index])) {
        expectedToneIndex = index;
        break;
      }
    }
  }
  return toneBaseIndex === expectedToneIndex;
}

function validatePinyin(pronunciation, label, issues) {
  if (!isObject(pronunciation)) {
    issues.push(issue("mandarin.pronunciation-missing", `${label} requires authored contextual pinyin.`));
    return;
  }
  if (pronunciation.system !== "pinyin") {
    issues.push(issue("mandarin.pronunciation-system", `${label}.pronunciation.system must be pinyin.`));
  }
  if (pronunciation.languageTag !== "zh-Latn-pinyin") {
    issues.push(issue(
      "mandarin.pronunciation-language",
      `${label}.pronunciation.languageTag must be zh-Latn-pinyin.`
    ));
  }
  if (!hasOnlyPinyinCharacters(pronunciation.notation) || HAN_PATTERN.test(pronunciation.notation ?? "")) {
    issues.push(issue(
      "mandarin.pronunciation-notation",
      `${label}.pronunciation.notation must be authored Latin-script pinyin without Han characters.`
    ));
  }
}

export const mandarinSimplifiedContentPolicy = defineTargetContentPolicy({
  id: MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID,
  validate(catalog) {
    const issues = [];
    if (catalog?.courseId !== "zh") {
      issues.push(issue("mandarin.course", "The Mandarin content policy requires courseId zh."));
    }
    if (catalog?.targetLanguage?.languageTag !== "zh-Hans"
        || catalog?.targetLanguage?.speechLocale !== "zh-CN"
        || catalog?.targetLanguage?.script !== "Hans") {
      issues.push(issue(
        "mandarin.locale",
        "The Mandarin Simplified policy requires languageTag zh-Hans, speechLocale zh-CN, and script Hans."
      ));
    }
    if (catalog?.tokenization?.method !== "authored-word-tokens"
        || catalog?.tokenization?.characterFallbackAllowed !== false
        || catalog?.tokenization?.pronunciationAuthority !== "authored-contextual-token") {
      issues.push(issue(
        "mandarin.contextual-tokenization",
        "Mandarin requires authored contextual word tokens and forbids character-level pronunciation fallback."
      ));
    }

    for (const [index, realization] of (catalog?.realizations ?? []).entries()) {
      const label = `realizations[${index}]`;
      if (typeof realization?.text === "string" && !HAN_PATTERN.test(realization.text)) {
        issues.push(issue("mandarin.script", `${label}.text must contain Simplified Chinese learner text.`));
      }
      if (COMMON_TRADITIONAL_ONLY_PATTERN.test(realization?.text ?? "")) {
        issues.push(issue(
          "mandarin.script-variant",
          `${label}.text contains a common Traditional-only form that is not valid for this curated zh-Hans catalog.`
        ));
      }
      validatePinyin(realization?.pronunciation, label, issues);
      for (const [tokenIndex, token] of (realization?.tokens ?? []).entries()) {
        const tokenLabel = `${label}.tokens[${tokenIndex}]`;
        const hasHan = typeof token?.surface === "string" && HAN_PATTERN.test(token.surface);
        if (typeof token?.surface === "string" && !HAN_ONLY_PATTERN.test(token.surface)) {
          issues.push(issue(
            "mandarin.token-script",
            `${tokenLabel}.surface must contain Han characters only.`
          ));
        }
        if (COMMON_TRADITIONAL_ONLY_PATTERN.test(token?.surface ?? "")) {
          issues.push(issue(
            "mandarin.script-variant",
            `${tokenLabel}.surface contains a common Traditional-only form that is not valid for this curated zh-Hans catalog.`
          ));
        }
        if (token?.playable === true && !hasHan) {
          issues.push(issue("mandarin.playable-script", `${tokenLabel} must contain Han text to be playable.`));
        }
        if (hasHan || token?.playable === true) validatePinyin(token?.pronunciation, tokenLabel, issues);
        if (hasHan) {
          if (!Array.isArray(token?.readingUnits) || token.readingUnits.length === 0) {
            issues.push(issue(
              "mandarin.reading-units-missing",
              `${tokenLabel} requires explicit contextual readingUnits for every Han-bearing token.`
            ));
          } else {
            const characters = [...token.surface];
            if (token.readingUnits.length !== characters.length) {
              issues.push(issue(
                "mandarin.reading-units-coverage",
                `${tokenLabel}.readingUnits must contain exactly one unit per authored Han character.`
              ));
            }
            for (const [unitIndex, unit] of token.readingUnits.entries()) {
              validatePinyin(
                unit?.pronunciation,
                `${tokenLabel}.readingUnits[${unitIndex}]`,
                issues
              );
              if (unit?.surface !== characters[unitIndex] || !HAN_PATTERN.test(unit?.surface ?? "")) {
                issues.push(issue(
                  "mandarin.reading-units-coverage",
                  `${tokenLabel}.readingUnits[${unitIndex}].surface must be the matching single Han character.`
                ));
              }
              if (!hasDefensiblePinyinUnit(unit?.pronunciation?.notation)) {
                issues.push(issue(
                  "mandarin.reading-units-notation",
                  `${tokenLabel}.readingUnits[${unitIndex}].pronunciation.notation must be one defensible Latin-script pinyin syllable with at most one correctly placed tone mark and no whitespace, digits, symbols, or emoji.`
                ));
              }
            }
            const tokenPronunciation = token?.pronunciation;
            const unitPronunciations = token.readingUnits.map((unit) => unit?.pronunciation);
            if (
              isObject(tokenPronunciation)
              && unitPronunciations.every((pronunciation) => (
                isObject(pronunciation)
                && pronunciation.system === "pinyin"
                && typeof pronunciation.notation === "string"
              ))
            ) {
              const tokenNotation = normalizePinyinComposition(tokenPronunciation.notation);
              const unitNotation = normalizePinyinComposition(
                unitPronunciations.map(({ notation }) => notation).join("")
              );
              if (tokenNotation !== unitNotation) {
                issues.push(issue(
                  "reading-units.pronunciation",
                  `${tokenLabel}.readingUnits notation must agree with contextual token pinyin after case, punctuation, whitespace, and apostrophe normalization.`
                ));
              }
            }
          }
        }
      }
      const tokenPronunciations = Array.isArray(realization?.tokens)
        ? realization.tokens.map((token) => token?.pronunciation)
        : [];
      if (
        isObject(realization?.pronunciation)
        && tokenPronunciations.length > 0
        && tokenPronunciations.every((pronunciation) => (
          isObject(pronunciation)
          && pronunciation.system === "pinyin"
          && typeof pronunciation.notation === "string"
        ))
      ) {
        const sentenceNotation = normalizePinyinComposition(realization.pronunciation.notation);
        const tokenNotation = normalizePinyinComposition(
          tokenPronunciations.map(({ notation }) => notation).join("")
        );
        if (sentenceNotation !== tokenNotation) {
          issues.push(issue(
            "mandarin.pronunciation-composition",
            `${label}.pronunciation.notation must compositionally agree with contextual token pinyin after capitalization, punctuation, whitespace, and apostrophe normalization.`
          ));
        }
      }
    }
    return issues;
  }
});

function normalizePinyinComposition(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("und")
    .replace(/[\p{White_Space}\p{Punctuation}]/gu, "");
}

export default mandarinSimplifiedContentPolicy;
