import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildWordWorldRuntimeProjections } from "../project-word-world-runtime.mjs";

const repositoryRoot = new URL("../../../", import.meta.url);
const paths = Object.freeze({
  verbs: "apps/languages/mandarin-simplified/static/data/games/verb-nebula/core-vocabulary.json",
  concepts: "apps/languages/shared/english-concepts/word-world-starter-v1.json",
  realizations: "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json",
  publicConcepts: "apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
  publicRealizations:
    "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.realizations.json",
  readingGuides:
    "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.reading-guides.json",
  manifest: "apps/languages/mandarin-simplified/static/data/games/word-world/manifest.json",
  nucleus:
    "apps/languages/mandarin-simplified/static/data/games/naturalization-nucleus/challenges.json"
});

const [
  verbs,
  concepts,
  realizations,
  publicConcepts,
  publicRealizations,
  readingGuides,
  manifest,
  nucleus
] = await Promise.all(Object.values(paths).map(readJson));

const EXPECTED_LEVEL_COUNTS = Object.freeze({
  verbs: Object.freeze({ 1: 60, 2: 70, 3: 50 }),
  concepts: Object.freeze({ 1: 50, 2: 150, 3: 50 }),
  nucleus: Object.freeze({ 1: 40, 2: 40, 3: 40 })
});
const HAN = /\p{Script=Han}/u;
const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9][a-z0-9-]*)+$/u;
const FORMAT_CONTROL = /\p{Cf}/u;
const NUCLEUS_SCHEMA_URL = "https://caatuu.org/schemas/development/naturalization-nucleus.preview.v1.json";
const UNSAFE_ENGLISH =
  /\b(?:alcohol|beer|wine|liquor|tobacco|cigarettes?|vape|drugs?|weapons?|guns?|rifles?|pistols?|bombs?|grenades?|kn(?:ife|ives)|swords?|war(?:s|fare)?|shoot(?:s|ing|ers?)?|shots?|poison(?:s|ed|ing|ous)?|crimes?|criminals?|fight(?:ing)?|attacks?|assault|kills?|murder|death|die|dead|harm|abuse|bully|bullying|kidnap|torture|suicide|sex|sexual|nude|porn(?:ography)?|gambl(?:e|ing)|steal|theft|rob(?:bery)?|deceive)\b/iu;
const UNSAFE_HANZI =
  /(?:暴力|武器|手枪|步枪|枪支|开枪|枪击|枪杀|大炮|炸弹|手榴弹|刀剑|持刀|战争|战斗|开战|射击|打架|打人|攻击|袭击|杀人|杀死|谋杀|死亡|伤害|虐待|欺凌|霸凌|绑架|折磨|自杀|酒吧|啤酒|葡萄酒|烈酒|饮酒|喝酒|酒精|香烟|电子烟|吸烟|抽烟|烟草|毒品|毒药|中毒|下毒|投毒|赌博|犯罪|罪犯|犯人|色情|性行为|裸体|偷窃|抢夺|抢劫|欺骗)/u;
const UNSAFE_HANZI_EXACT = new Set([
  "枪", "炮", "刀", "剑", "杀", "死", "酒", "烟", "偷",
  "毒", "赌", "抢", "骗", "打", "伤", "血", "战", "射", "罪", "盗", "贼"
]);
const NUCLEUS_ALTERNATE_READING_AUDIT = Object.freeze({
  "不": Object.freeze({ citation: "bù", observed: Object.freeze(["bu", "bú", "bù"]) }),
  "谢": Object.freeze({ citation: "xiè", observed: Object.freeze(["xie", "xiè"]) }),
  "一": Object.freeze({ citation: "yī", observed: Object.freeze(["yí", "yì", "yī"]) }),
  "上": Object.freeze({ citation: "shàng", observed: Object.freeze(["shang", "shàng"]) }),
  "奶": Object.freeze({ citation: "nǎi", observed: Object.freeze(["nai", "nǎi"]) })
});

function readJson(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), "utf8").then((source) => JSON.parse(source));
}

function normalizedKey(value) {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

function semanticKey(value) {
  return normalizedKey(value).replace(/[\p{P}\p{S}\s]+/gu, "");
}

function textCompositionKey(value) {
  return value.normalize("NFC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

function pinyinKey(value) {
  return value.normalize("NFC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

function pinyinTone(value) {
  const decomposed = value.normalize("NFD");
  if (/\u0304/u.test(decomposed)) return 1;
  if (/\u0301/u.test(decomposed)) return 2;
  if (/\u030c/u.test(decomposed)) return 3;
  if (/\u0300/u.test(decomposed)) return 4;
  return 5;
}

function assertNonemptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.equal(value, value.trim(), `${label} must not have outer whitespace`);
  assert.notEqual(value, "", `${label} must not be empty`);
  assert.equal(value, value.normalize("NFC"), `${label} must use NFC Unicode`);
}

function assertChildSafeText(value, label, { checkStandaloneHanzi = false } = {}) {
  assertNonemptyString(value, label);
  const compatibilityNormalized = value.normalize("NFKC");
  assert.doesNotMatch(value, FORMAT_CONTROL, `${label} contains a Unicode format control`);
  assert.doesNotMatch(
    compatibilityNormalized,
    FORMAT_CONTROL,
    `${label} contains a Unicode format control after NFKC normalization`
  );
  assert.doesNotMatch(
    compatibilityNormalized,
    UNSAFE_ENGLISH,
    `child-inappropriate English content in ${label}: ${value}`
  );
  assert.doesNotMatch(
    compatibilityNormalized,
    UNSAFE_HANZI,
    `child-inappropriate Mandarin content in ${label}: ${value}`
  );
  if (checkStandaloneHanzi) {
    assert.equal(
      UNSAFE_HANZI_EXACT.has(compatibilityNormalized.replace(/[\p{P}\p{S}\s]+/gu, "")),
      false,
      `child-inappropriate standalone Mandarin content in ${label}: ${value}`
    );
  }
}

function assertNfcTree(value, label) {
  if (typeof value === "string") {
    assert.equal(value, value.normalize("NFC"), `${label} must use NFC Unicode`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNfcTree(entry, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) assertNfcTree(entry, `${label}.${key}`);
  }
}

function assertUnique(rows, valueFor, label, { caseInsensitive = false } = {}) {
  const seen = new Map();
  for (const [index, row] of rows.entries()) {
    const rawValue = valueFor(row);
    assertNonemptyString(rawValue, `${label}[${index}]`);
    const key = caseInsensitive ? normalizedKey(rawValue) : rawValue.normalize("NFC");
    assert.equal(seen.has(key), false, `${label} duplicates ${JSON.stringify(rawValue)} at rows ${seen.get(key)} and ${index}`);
    seen.set(key, index);
  }
}

function assertIds(rows, valueFor, label) {
  assertUnique(rows, valueFor, `${label} IDs`);
  rows.forEach((row, index) => {
    assert.match(valueFor(row), ID_PATTERN, `${label}[${index}] has an invalid stable ID`);
  });
}

function assertLevelDistribution(rows, expected, label) {
  const actual = { 1: 0, 2: 0, 3: 0 };
  let previous = 1;
  for (const [index, row] of rows.entries()) {
    assert.equal(
      Object.hasOwn(row, "difficulty"),
      true,
      `${label}[${index}] must explicitly declare difficulty`
    );
    assert.ok([1, 2, 3].includes(row.difficulty), `${label}[${index}] has invalid difficulty`);
    assert.ok(
      row.difficulty >= previous,
      `${label} must remain ordered in contiguous difficulty blocks (row ${index})`
    );
    previous = row.difficulty;
    actual[row.difficulty] += 1;
  }
  assert.deepEqual(actual, expected, `${label} difficulty distribution drifted`);
}

function assertDraftReview(review, label) {
  assert.equal(review?.status, "native-review-required", `${label} must retain the native-review gate`);
  assert.equal(review?.reviewer, null, `${label} must not claim a reviewer before review`);
  assert.equal(review?.reviewedAt, null, `${label} must not claim a review date before review`);
}

function assertReleaseClearedLicense(license, label) {
  assert.equal(license?.origin, "caatuu-first-party-authored", `${label} must retain first-party provenance`);
  assert.equal(license?.status, "release-cleared", `${label} must remain release-cleared`);
  assert.equal(license?.spdxExpression, "AGPL-3.0-only", `${label} must retain the owner-approved SPDX expression`);
  assert.equal(
    license?.sourceReference,
    "docs/LICENSING.md#first-party-curriculum",
    `${label} must point to the scoped licensing authority`
  );
  assert.equal(license?.reviewedBy, "Caatuu project owner", `${label} must retain the owner authority`);
  assert.equal(license?.reviewedAt, "2026-09-01T08:25:35Z", `${label} must retain the clearance timestamp`);
}

function assertPinyinPronunciation(pronunciation, label) {
  assert.equal(pronunciation?.system, "pinyin", `${label} must use pinyin`);
  assert.equal(pronunciation?.languageTag, "zh-Latn-pinyin", `${label} must use the pinyin language tag`);
  assert.equal(pronunciation?.reviewed, false, `${label} must remain explicitly unreviewed`);
  assertNonemptyString(pronunciation?.notation, `${label}.notation`);
}

test("Mandarin catalogs have stable unique IDs, deterministic level order, and the complete curriculum sizes", () => {
  assert.equal(Array.isArray(verbs), true, "Verb Nebula must remain a top-level array");
  assert.equal(verbs.length, 180);
  assert.equal(concepts.concepts.length, 250);
  assert.equal(realizations.realizations.length, 250);
  assert.equal(nucleus.challenges.length, 120);
  assert.equal(nucleus.$schema, NUCLEUS_SCHEMA_URL);

  assertLevelDistribution(verbs, EXPECTED_LEVEL_COUNTS.verbs, "Verb Nebula");
  assertLevelDistribution(concepts.concepts, EXPECTED_LEVEL_COUNTS.concepts, "Word World");
  assertLevelDistribution(nucleus.challenges, EXPECTED_LEVEL_COUNTS.nucleus, "Naturalization Nucleus");

  assertIds(verbs, (row) => row.id, "Verb Nebula");
  assertIds(concepts.concepts, (row) => row.id, "Word World");
  assertIds(nucleus.challenges, (row) => row.id, "Naturalization Nucleus");
  assertUnique(verbs, (row) => row.target, "Verb Nebula targets");
  assertUnique(verbs, (row) => row.source, "Verb Nebula English cues", { caseInsensitive: true });
  assertUnique(concepts.concepts, (row) => row.englishText, "Word World English sentences", {
    caseInsensitive: true
  });
  assertUnique(concepts.concepts, (row) => row.embeddingText, "Word World embedding descriptions", {
    caseInsensitive: true
  });
  assertUnique(concepts.concepts, (row) => row.sceneQuery, "Word World scene queries", {
    caseInsensitive: true
  });
  assertUnique(realizations.realizations, (row) => row.text, "Word World Mandarin sentences");
  assertUnique(nucleus.challenges, (row) => row.hanzi, "Naturalization Nucleus Hanzi");

  const conceptIds = concepts.concepts.map((row) => row.id);
  assert.deepEqual(
    realizations.realizations.map((row) => row.conceptId),
    conceptIds,
    "authoring concepts and realizations must keep exact one-to-one ID order"
  );

  for (const [label, catalog] of Object.entries({
    verbs,
    concepts,
    realizations,
    publicConcepts,
    publicRealizations,
    readingGuides,
    manifest,
    nucleus
  })) assertNfcTree(catalog, label);
});

test("Word World retrieval and visual fields are purpose-written rather than sentence copies", () => {
  for (const concept of concepts.concepts) {
    for (const field of ["englishText", "embeddingText", "sceneQuery", "topic"]) {
      assertNonemptyString(concept[field], `${concept.id}.${field}`);
    }
    assert.notEqual(
      semanticKey(concept.embeddingText),
      semanticKey(concept.englishText),
      `${concept.id}.embeddingText must describe the concept, not repeat englishText`
    );
    assert.notEqual(
      semanticKey(concept.sceneQuery),
      semanticKey(concept.englishText),
      `${concept.id}.sceneQuery must describe a visual scene, not repeat englishText`
    );
    const englishWordCount = (concept.englishText.match(/\p{L}+/gu) ?? []).length;
    if (englishWordCount >= 2) {
      assert.equal(
        semanticKey(concept.embeddingText).includes(semanticKey(concept.englishText)),
        false,
        `${concept.id}.embeddingText must not hide a sentence copy inside boilerplate`
      );
      assert.equal(
        semanticKey(concept.sceneQuery).includes(semanticKey(concept.englishText)),
        false,
        `${concept.id}.sceneQuery must visually restage the idea instead of appending boilerplate`
      );
    }
    assert.ok(
      (concept.embeddingText.match(/\p{L}+/gu) ?? []).length >= 4,
      `${concept.id}.embeddingText is too terse to be descriptive`
    );
    assert.ok(
      (concept.sceneQuery.match(/\p{L}+/gu) ?? []).length >= 3,
      `${concept.id}.sceneQuery is too terse to specify a visual scene`
    );
    assert.doesNotMatch(concept.sceneQuery, /\?/u, `${concept.id}.sceneQuery should depict, not ask`);
    assert.doesNotMatch(
      concept.sceneQuery,
      /\b(?:means?|refers? to|translation|definition)\b/iu,
      `${concept.id}.sceneQuery is metalinguistic rather than visual`
    );
  }
});

test("all three Mandarin curricula remain child-safe with native review pending and licensing cleared", () => {
  const englishSamples = [
    ...verbs.flatMap((row) => [row.id, row.source, row.category]),
    ...concepts.concepts.flatMap((row) => [
      row.id,
      row.englishText,
      row.embeddingText,
      row.sceneQuery,
      row.topic
    ]),
    ...realizations.realizations.flatMap((row) => row.tokens.map((token) => token.gloss)),
    nucleus.title,
    nucleus.instructions,
    nucleus.status,
    nucleus.review.status,
    nucleus.review.notes,
    ...nucleus.challenges.flatMap((row) => [row.id, row.pinyin, row.translation])
  ];
  const hanziSamples = [
    ...verbs.map((row) => row.target),
    ...realizations.realizations.flatMap((row) => [row.text, ...row.tokens.map((token) => token.surface)]),
    ...nucleus.challenges.map((row) => row.hanzi)
  ];
  englishSamples.forEach((value, index) => assertChildSafeText(value, `English safety sample ${index}`));
  hanziSamples.forEach((value, index) => assertChildSafeText(
    value,
    `Mandarin safety sample ${index}`,
    { checkStandaloneHanzi: true }
  ));

  assert.equal(verbs.every((row) => row.reviewStatus === "native-review-required"), true);
  assertDraftReview(realizations.review, "Word World authoring review");
  assertReleaseClearedLicense(concepts.license, "Word World concept license");
  assertReleaseClearedLicense(realizations.license, "Word World realization license");
  assert.equal(nucleus.status, "machine-assisted-preview");
  assertDraftReview(nucleus.review, "Naturalization Nucleus review");
  assert.doesNotMatch(
    JSON.stringify({ verbs, concepts, realizations, nucleus }),
    /native-reviewed/u,
    "draft authoring data must not leak a completed native-review claim"
  );
});

test("every Mandarin sentence, token, and Han reading unit composes exactly in surface and pinyin", () => {
  for (const realization of realizations.realizations) {
    const rowLabel = realization.conceptId;
    assertPinyinPronunciation(realization.pronunciation, `${rowLabel}.pronunciation`);
    assert.equal(
      textCompositionKey(realization.text),
      textCompositionKey(realization.tokens.map((token) => token.surface).join("")),
      `${rowLabel} token surfaces do not compose to the Mandarin sentence`
    );

    const tokenPinyin = [];
    for (const [tokenIndex, token] of realization.tokens.entries()) {
      const tokenLabel = `${rowLabel}.tokens[${tokenIndex}]`;
      assertNonemptyString(token.surface, `${tokenLabel}.surface`);
      assertNonemptyString(token.gloss, `${tokenLabel}.gloss`);
      assertPinyinPronunciation(token.pronunciation, `${tokenLabel}.pronunciation`);
      tokenPinyin.push(token.pronunciation.notation);

      if (!HAN.test(token.surface)) continue;
      assert.ok(Array.isArray(token.readingUnits), `${tokenLabel} must explicitly author readingUnits`);
      assert.ok(token.readingUnits.length > 0, `${tokenLabel}.readingUnits must not be empty`);
      assert.equal(
        token.readingUnits.map((unit) => unit.surface).join(""),
        token.surface,
        `${tokenLabel}.readingUnits must exactly cover the token surface`
      );
      for (const [unitIndex, unit] of token.readingUnits.entries()) {
        const unitLabel = `${tokenLabel}.readingUnits[${unitIndex}]`;
        assert.equal(Array.from(unit.surface).length, 1, `${unitLabel}.surface must be one character`);
        assert.match(unit.surface, HAN, `${unitLabel}.surface must be Hanzi`);
        assertPinyinPronunciation(unit.pronunciation, `${unitLabel}.pronunciation`);
        assert.doesNotMatch(unit.pronunciation.notation, /\s/u, `${unitLabel} must be one pinyin unit`);
      }
      assert.equal(
        pinyinKey(token.pronunciation.notation),
        pinyinKey(token.readingUnits.map((unit) => unit.pronunciation.notation).join("")),
        `${tokenLabel} pinyin does not compose from its reading units`
      );
    }
    assert.equal(
      pinyinKey(realization.pronunciation.notation),
      pinyinKey(tokenPinyin.join("")),
      `${rowLabel} sentence pinyin does not compose from contextual token pinyin`
    );
  }
});

test("reviewed high-risk Mandarin wording and pinyin boundaries stay explicitly locked", () => {
  const conceptsById = new Map(concepts.concepts.map((concept) => [concept.id, concept]));
  const realizationsById = new Map(
    realizations.realizations.map((realization) => [realization.conceptId, realization])
  );
  const cases = [
    {
      id: "ww.problem.forgot-umbrella",
      sentence: "Wǒ wàngle dài yǔsǎn.",
      tokenNotations: { "忘了": "wàngle" }
    },
    {
      id: "ww.politeness.sorry-late",
      sentence: "Duìbuqǐ, wǒ láiwǎn le.",
      tokenNotations: { "来晚了": "láiwǎn le" }
    },
    {
      id: "ww.housing.repair-appointment",
      sentence: "Wǒ yǐjīng yuēhǎole wéixiū shíjiān.",
      tokenNotations: { "约好了": "yuēhǎole" }
    },
    {
      id: "ww.work.find-solution",
      sentence: "Wǒmen yìqǐ zhǎodàole wèntí de jiějué bànfǎ.",
      tokenNotations: { "找到了": "zhǎodàole", "解决办法": "jiějué bànfǎ" }
    },
    {
      id: "ww.travel.reserve-window",
      sentence: "Wǒ zài wǎngshàng yùdìngle kào chuāng de zuòwèi.",
      tokenNotations: { "预订了": "yùdìngle" }
    },
    {
      id: "ww.delivery.wrong-address",
      sentence: "Bāoguǒ sòngdàole cuòwù de dìzhǐ, wǒ yǐjīng liánxì qiántái.",
      tokenNotations: { "送到了": "sòngdàole" }
    },
    {
      id: "ww.experience.high-speed-train",
      sentence: "Wǒ hái méiyǒu zuòguo gāotiě.",
      tokenNotations: { "坐过": "zuòguo" }
    },
    {
      id: "ww.problem.missing-key",
      sentence: "Wǒ zhǎobudào yàoshi.",
      tokenNotations: { "找不到": "zhǎobudào" }
    },
    {
      id: "ww.environment.reusable-bag",
      sentence: "Mǎi cài shí dàishàng kěyǐ chóngfù shǐyòng de dàizi.",
      tokenNotations: { "带上": "dàishàng" }
    },
    {
      id: "ww.environment.save-water",
      english: "When you finish using water, please turn off the faucet.",
      text: "用完水以后，请关好水龙头。",
      sentence: "Yòngwán shuǐ yǐhòu, qǐng guānhǎo shuǐlóngtóu.",
      tokenNotations: { "用完": "yòngwán", "关好": "guānhǎo" }
    },
    {
      id: "ww.language.summarize",
      sentence: "Wǒ tīngwán yǐhòu, huì yòng zìjǐ de huà zǒngjié.",
      tokenNotations: { "听完": "tīngwán" }
    },
    {
      id: "ww.nature.tall-trees",
      sentence: "Shān shàng de shù hěn gāo.",
      tokenNotations: { "山上": "shān shàng" }
    },
    {
      id: "ww.location.light-switch",
      sentence: "Dēng de kāiguān zài mén biān.",
      tokenNotations: { "门边": "mén biān" }
    },
    {
      id: "ww.school.practice-characters",
      sentence: "Wǒ měi tiān liànxí hànzì.",
      tokenNotations: { "每天": "měi tiān" }
    },
    {
      id: "ww.school.open-page-ten",
      english: "Please turn to page ten.",
      text: "请翻到第十页。",
      sentence: "Qǐng fāndào dì-shí yè.",
      tokenNotations: { "翻到": "fāndào", "第十页": "dì-shí yè" }
    },
    {
      id: "ww.question.who-is-that",
      sentence: "Nà ge rén shì shéi?",
      tokenNotations: { "个": "ge" }
    },
    {
      id: "ww.possession.two-friends",
      sentence: "Wǒ yǒu liǎng ge péngyou.",
      tokenNotations: { "个": "ge" }
    },
    {
      id: "ww.banking.transfer-complete",
      english: "The bank transfer has been completed.",
      text: "银行转账已经完成了。",
      sentence: "Yínháng zhuǎnzhàng yǐjīng wánchéng le.",
      tokenGlosses: { "完成了": "has been completed; is complete" }
    },
    {
      id: "ww.work.check-schedule",
      english: "Please check the schedule.",
      text: "请查看日程。",
      sentence: "Qǐng chákàn rìchéng.",
      tokenNotations: { "查看": "chákàn" }
    },
    {
      id: "ww.digital.location-sharing",
      text: "不需要时，请关闭位置共享。",
      sentence: "Bù xūyào shí, qǐng guānbì wèizhì gòngxiǎng.",
      tokenNotations: { "共享": "gòngxiǎng" },
      tokenGlosses: { "关闭": "turn off" }
    },
    {
      id: "ww.service.identity-document",
      english: "Please bring an identity document to the service window.",
      text: "请带身份证件到服务窗口。",
      sentence: "Qǐng dài shēnfèn zhèngjiàn dào fúwù chuāngkǒu.",
      tokenNotations: { "身份证件": "shēnfèn zhèngjiàn" },
      tokenGlosses: { "到": "to" }
    },
    {
      id: "ww.work.clearer-chart",
      text: "这份报告需要一个更清晰的图表。",
      sentence: "Zhè fèn bàogào xūyào yí ge gèng qīngxī de túbiǎo.",
      tokenNotations: { "清晰": "qīngxī" }
    },
    {
      id: "ww.politeness.after-you",
      english: "After you.",
      text: "您先请。",
      sentence: "Nín xiān qǐng.",
      tokenNotations: { "您": "nín" }
    },
    {
      id: "ww.compare.tea-water",
      english: "This cup of tea is hotter than that glass of water.",
      text: "这杯茶比那杯水热。",
      sentence: "Zhè bēi chá bǐ nà bēi shuǐ rè."
    },
    {
      id: "ww.language.word-difference",
      sentence: "Nǐ kěyǐ jiěshì zhè liǎng ge cí de qūbié ma?",
      tokenNotations: { "两个": "liǎng ge" }
    },
    {
      id: "ww.culture.respect-habits",
      english: "I respect different ways of life.",
      text: "我尊重不同的生活方式。",
      sentence: "Wǒ zūnzhòng bùtóng de shēnghuó fāngshì.",
      tokenNotations: { "生活方式": "shēnghuó fāngshì" }
    },
    {
      id: "ww.social.listen-before-discussion",
      english: "In a group discussion, we first listen to other people's ideas.",
      text: "在小组讨论中，我们先听别人的想法。",
      sentence: "Zài xiǎozǔ tǎolùn zhōng, wǒmen xiān tīng biérén de xiǎngfǎ.",
      tokenNotations: { "别人的": "biérén de" },
      tokenGlosses: { "在": "in", "中": "during" }
    },
    {
      id: "ww.language.ask-meaning",
      text: "遇到不认识的词时，我会问它是什么意思。",
      sentence: "Yùdào bú rènshi de cí shí, wǒ huì wèn tā shì shénme yìsi.",
      tokenNotations: { "不认识": "bú rènshi" },
      readingUnitNotations: { "不认识": ["bú", "rèn", "shi"] }
    }
  ];

  for (const expected of cases) {
    const concept = conceptsById.get(expected.id);
    const realization = realizationsById.get(expected.id);
    assert.ok(concept, `missing locked concept ${expected.id}`);
    assert.ok(realization, `missing locked realization ${expected.id}`);
    if (expected.english) assert.equal(concept.englishText, expected.english, `${expected.id}.englishText`);
    if (expected.text) assert.equal(realization.text, expected.text, `${expected.id}.text`);
    assert.equal(realization.pronunciation.notation, expected.sentence, `${expected.id}.pronunciation`);
    for (const [surface, notation] of Object.entries(expected.tokenNotations ?? {})) {
      const token = realization.tokens.find((candidate) => candidate.surface === surface);
      assert.ok(token, `${expected.id} is missing locked token ${surface}`);
      assert.equal(token.pronunciation.notation, notation, `${expected.id}/${surface}.pronunciation`);
    }
    for (const [surface, gloss] of Object.entries(expected.tokenGlosses ?? {})) {
      const token = realization.tokens.find((candidate) => candidate.surface === surface);
      assert.ok(token, `${expected.id} is missing locked token ${surface}`);
      assert.equal(token.gloss, gloss, `${expected.id}/${surface}.gloss`);
    }
    for (const [surface, notations] of Object.entries(expected.readingUnitNotations ?? {})) {
      const token = realization.tokens.find((candidate) => candidate.surface === surface);
      assert.ok(token, `${expected.id} is missing locked token ${surface}`);
      assert.deepEqual(
        token.readingUnits.map((unit) => unit.pronunciation.notation),
        notations,
        `${expected.id}/${surface}.readingUnits`
      );
    }
  }
});

test("Word World public catalogs and preview guide are exact projections of authoring data", () => {
  const projected = buildWordWorldRuntimeProjections(
    structuredClone(concepts),
    structuredClone(realizations),
    structuredClone(manifest)
  );
  assert.deepEqual(publicConcepts, projected.englishProjection, "public English projection drifted");
  assert.deepEqual(publicRealizations, projected.targetProjection, "public Mandarin projection drifted");
  assert.deepEqual(readingGuides, projected.readingGuideProjection, "public pinyin guide drifted");
  assert.deepEqual(manifest, projected.runtimeManifest, "Word World manifest record count drifted");

  assert.equal(manifest.recordCount, 250);
  assert.equal(manifest.targetTextGuide?.file, "starter-v1.reading-guides.json");
  assert.equal(manifest.targetTextGuide?.system, "pinyin");
  assert.equal(manifest.targetTextGuide?.status, "machine-assisted-preview");
  assert.equal(manifest.review?.status, "native-review-required");
  assert.equal(manifest.review?.pronunciationApproved, false);
  assert.equal(readingGuides.status, "machine-assisted-preview");
  assertDraftReview(readingGuides.review, "Word World public reading-guide review");

  const publicTarget = JSON.stringify(publicRealizations);
  assert.doesNotMatch(publicTarget, /"pronunciation"\s*:/u);
  assert.doesNotMatch(publicTarget, /"readingUnits"\s*:/u);
});

test("Naturalization Nucleus is traceable to exact Word World Hanzi readings at every level", () => {
  const conceptsById = new Map(concepts.concepts.map((concept) => [concept.id, concept]));
  const realizationsById = new Map(
    realizations.realizations.map((realization) => [realization.conceptId, realization])
  );

  assert.deepEqual(nucleus.roundSettings?.pieceCounts, [5, 9]);
  assert.ok([5, 9].includes(nucleus.roundSettings?.defaultPieceCount));
  for (const challenge of nucleus.challenges) {
    assert.equal(Object.hasOwn(challenge, "difficulty"), true, `${challenge.id} lacks explicit difficulty`);
    assert.ok(Array.isArray(challenge.sourceConceptIds) && challenge.sourceConceptIds.length > 0);
    assert.equal(new Set(challenge.sourceConceptIds).size, challenge.sourceConceptIds.length);
    assert.equal(Array.from(challenge.hanzi).length, 1, `${challenge.id}.hanzi must be one character`);
    assert.match(challenge.hanzi, HAN, `${challenge.id}.hanzi must be Hanzi`);
    assertNonemptyString(challenge.pinyin, `${challenge.id}.pinyin`);
    assert.doesNotMatch(challenge.pinyin, /\s/u, `${challenge.id}.pinyin must be one unit`);
    assert.equal(challenge.tone, pinyinTone(challenge.pinyin), `${challenge.id}.tone disagrees with pinyin`);

    let hasDifficultyEligibleExactSource = false;
    for (const sourceConceptId of challenge.sourceConceptIds) {
      const concept = conceptsById.get(sourceConceptId);
      const realization = realizationsById.get(sourceConceptId);
      assert.ok(concept, `${challenge.id} references missing concept ${sourceConceptId}`);
      assert.ok(realization, `${challenge.id} references missing realization ${sourceConceptId}`);
      const exactMatch = realization.tokens.some((token) => token.readingUnits?.some((unit) => (
        unit.surface === challenge.hanzi
        && pinyinKey(unit.pronunciation.notation) === pinyinKey(challenge.pinyin)
      )));
      assert.equal(
        exactMatch,
        true,
        `${challenge.id} (${challenge.hanzi} ${challenge.pinyin}) has no exact reading-unit match in ${sourceConceptId}`
      );
      if (exactMatch && concept.difficulty <= challenge.difficulty) hasDifficultyEligibleExactSource = true;
    }
    assert.equal(
      hasDifficultyEligibleExactSource,
      true,
      `${challenge.id} has no exact source concept at or below Nucleus difficulty ${challenge.difficulty}`
    );
  }

  for (const level of [1, 2, 3]) {
    const eligible = nucleus.challenges.filter((challenge) => challenge.difficulty <= level);
    assert.equal(eligible.length, level * 40, `Nucleus level ${level} cumulative pool size drifted`);
    const readingKeys = new Set(eligible.map((challenge) => `${pinyinKey(challenge.pinyin)}:${challenge.tone}`));
    for (const pieceCount of nucleus.roundSettings.pieceCounts) {
      assert.ok(
        readingKeys.size >= pieceCount,
        `Nucleus level ${level} cannot form a ${pieceCount}-piece round with distinct readings`
      );
    }
  }
});

test("isolated alternate-reading Hanzi use citation forms, not context-only sandhi or neutral tones", () => {
  const readingsByHanzi = new Map();
  for (const realization of realizations.realizations) {
    for (const token of realization.tokens) {
      for (const unit of token.readingUnits ?? []) {
        if (!readingsByHanzi.has(unit.surface)) readingsByHanzi.set(unit.surface, new Set());
        readingsByHanzi.get(unit.surface).add(unit.pronunciation.notation.normalize("NFC"));
      }
    }
  }

  for (const [hanzi, audit] of Object.entries(NUCLEUS_ALTERNATE_READING_AUDIT)) {
    const challenge = nucleus.challenges.find((entry) => entry.hanzi === hanzi);
    assert.ok(challenge, `Naturalization Nucleus is missing alternate-reading audit glyph ${hanzi}`);
    assert.equal(challenge.pinyin, audit.citation, `${hanzi} must use its isolated citation reading`);
    assert.equal(challenge.tone, pinyinTone(audit.citation), `${hanzi} citation tone metadata drifted`);

    const observed = [...(readingsByHanzi.get(hanzi) ?? [])].sort((left, right) => left.localeCompare(right, "en"));
    const expected = [...audit.observed].sort((left, right) => left.localeCompare(right, "en"));
    assert.deepEqual(observed, expected, `${hanzi} contextual-reading audit changed`);
    for (const contextualReading of observed.filter((reading) => reading !== audit.citation)) {
      assert.notEqual(
        challenge.pinyin,
        contextualReading,
        `${hanzi} challenge must not derive its isolated reading from contextual ${contextualReading}`
      );
    }
  }
});
