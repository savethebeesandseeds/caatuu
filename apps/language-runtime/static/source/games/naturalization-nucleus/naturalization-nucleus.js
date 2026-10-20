(function installNaturalizationNucleus(global) {
  "use strict";

  const DEFAULT_DATA_URL = "data/games/naturalization-nucleus/content.json";
  const EXPECTED_SCHEMA_URL = "https://caatuu.org/schemas/development/naturalization-nucleus.preview.v1.json";
  const WORD_SCHEMA_URL = "https://caatuu.org/schemas/development/naturalization-nucleus.preview.v2.json";
  const STORAGE_KEY_SUFFIX = "naturalizationNucleus.pieceCount.v1";
  const ROOT_KEYS = new Set([
    "$schema", "schemaVersion", "courseId", "gameId", "contentId", "title",
    "instructions", "roundSettings", "status", "derivedFrom", "review", "challenges", "notation"
  ]);
  const ROUND_SETTING_KEYS = new Set(["pieceCounts", "defaultPieceCount", "artwork"]);
  const REVIEW_KEYS = new Set(["status", "reviewer", "reviewedAt", "notes"]);
  const CHALLENGE_KEYS = new Set(["id", "hanzi", "pinyin", "tone", "translation", "englishAuditText", "context", "sourceConceptIds", "difficulty", "usefulness", "complexity", "urgency", "subdifficulty"]);
  const CONTEXT_KEYS = new Set(["text", "notation", "meaning", "sourceConceptId"]);
  const WORD_CHALLENGE_KEYS = new Set(["id", "target", "reading", "translation", "englishAuditText", "sourceItemIds", "difficulty", "usefulness", "complexity"]);
  const CONTENT_STATUSES = new Set(["machine-assisted-preview", "native-reviewed"]);
  const REVIEW_STATUSES = new Set(["native-review-required", "native-reviewed"]);
  const TONE_MARKS = Object.freeze({
    1: /[āēīōūǖ]/iu,
    2: /[áéíóúǘ]/iu,
    3: /[ǎěǐǒǔǚ]/iu,
    4: /[àèìòùǜ]/iu
  });
  const ANY_TONE_MARK = /[āēīōūǖáéíóúǘǎěǐǒǔǚàèìòùǜ]/iu;
  const FORMAT_CONTROL = /\p{Cf}/u;
  const UNSAFE_ENGLISH = /\b(?:alcohol|beer|wine|liquor|tobacco|cigarettes?|vape|drugs?|weapons?|guns?|rifles?|pistols?|bombs?|grenades?|kn(?:ife|ives)|swords?|war(?:s|fare)?|shoot(?:s|ing|ers?)?|shots?|poison(?:s|ed|ing|ous)?|crimes?|criminals?|fight(?:ing)?|attacks?|assault|kills?|murder|death|die|dead|harm|abuse|bully|bullying|kidnap|torture|suicide|sex|sexual|nude|porn(?:ography)?|gambl(?:e|ing)|steal|theft|rob(?:bery)?|deceive)\b/iu;
  const UNSAFE_HANZI = /(?:暴力|武器|手枪|步枪|枪支|开枪|枪击|枪杀|大炮|炸弹|手榴弹|刀剑|持刀|战争|战斗|开战|射击|打架|打人|攻击|袭击|杀人|杀死|谋杀|死亡|伤害|虐待|欺凌|霸凌|绑架|折磨|自杀|酒吧|啤酒|葡萄酒|烈酒|饮酒|喝酒|酒精|香烟|电子烟|吸烟|抽烟|烟草|毒品|毒药|中毒|下毒|投毒|赌博|犯罪|罪犯|犯人|色情|性行为|裸体|偷窃|抢夺|抢劫|欺骗)/u;
  const UNSAFE_HANZI_EXACT = new Set([
    "枪", "炮", "刀", "剑", "杀", "死", "酒", "烟", "偷",
    "毒", "赌", "抢", "骗", "打", "伤", "血", "战", "射", "罪", "盗", "贼"
  ]);
  const ISOLATED_CITATION_READINGS = Object.freeze({
    "不": "bù",
    "谢": "xiè",
    "一": "yī",
    "上": "shàng",
    "奶": "nǎi"
  });
  const SAFE_SHIP_PATH = /^\/assets\/ships\/[A-Za-z0-9%._()-]+\.png$/u;

  let catalogPromise = null;
  const mountedBoards = new WeakMap();
  const mountingBoards = new WeakMap();

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function assert(condition, message) {
    if (!condition) throw new TypeError(`Naturalization Nucleus: ${message}`);
  }

  function assertExactKeys(value, allowed, label) {
    Object.keys(value).forEach((key) => {
      assert(allowed.has(key), `${label} contains unsupported field "${key}".`);
    });
  }

  function requiredText(value, label, maximum = 240) {
    assert(typeof value === "string", `${label} must be a string.`);
    const normalized = value.normalize("NFC").trim();
    assert(normalized.length > 0 && normalized.length <= maximum, `${label} must contain 1-${maximum} characters.`);
    return normalized;
  }

  function optionalReviewText(value, label, maximum) {
    return value === null ? null : requiredText(value, label, maximum);
  }

  function assertLearnerSafe(value, label) {
    const compatibilityNormalized = value.normalize("NFKC");
    assert(
      !FORMAT_CONTROL.test(value) && !FORMAT_CONTROL.test(compatibilityNormalized),
      `${label} must not contain Unicode format controls.`
    );
    assert(!UNSAFE_ENGLISH.test(compatibilityNormalized), `${label} contains child-inappropriate English content.`);
    assert(!UNSAFE_HANZI.test(compatibilityNormalized), `${label} contains child-inappropriate Mandarin content.`);
    const compact = compatibilityNormalized.replace(/[\p{P}\p{S}\s]+/gu, "");
    assert(!UNSAFE_HANZI_EXACT.has(compact), `${label} contains a child-inappropriate standalone Hanzi.`);
  }

  function isIsoDateTime(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/u.exec(value);
    if (!match) return false;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return false;
    const parsed = new Date(timestamp);
    return parsed.getUTCFullYear() === Number(yearText)
      && parsed.getUTCMonth() + 1 === Number(monthText)
      && parsed.getUTCDate() === Number(dayText)
      && parsed.getUTCHours() === Number(hourText)
      && parsed.getUTCMinutes() === Number(minuteText)
      && parsed.getUTCSeconds() === Number(secondText);
  }

  function isQualifiedReviewer(value) {
    return /\p{L}/u.test(value)
      && !/^(?:ai|automated|machine|none|null|pending|tbd|unknown|n\/a|anonymous)$/iu.test(value.normalize("NFKC"));
  }

  function validateReview(value, contentStatus) {
    assert(isPlainObject(value), "review must be an object.");
    assertExactKeys(value, REVIEW_KEYS, "review");
    assert(REVIEW_STATUSES.has(value.status), "review.status is not supported.");
    const expectedStatus = contentStatus === "native-reviewed" ? "native-reviewed" : "native-review-required";
    assert(value.status === expectedStatus, `review.status must be "${expectedStatus}" for this content status.`);
    let reviewer;
    let reviewedAt;
    let notes;
    if (contentStatus === "native-reviewed") {
      reviewer = requiredText(value.reviewer, "review.reviewer", 120);
      assert(isQualifiedReviewer(reviewer), "review.reviewer must name a qualified human reviewer.");
      reviewedAt = requiredText(value.reviewedAt, "review.reviewedAt", 64);
      assert(isIsoDateTime(reviewedAt), "review.reviewedAt must be a valid ISO date-time.");
      notes = requiredText(value.notes, "review.notes", 500);
      assert(notes.normalize("NFKC").length >= 24, "review.notes must substantively describe the completed review.");
    } else {
      assert(value.reviewer === null, "review.reviewer must remain null until native review is complete.");
      assert(value.reviewedAt === null, "review.reviewedAt must remain null until native review is complete.");
      reviewer = null;
      reviewedAt = null;
      notes = optionalReviewText(value.notes, "review.notes", 500);
    }
    if (notes !== null) assertLearnerSafe(notes, "review.notes");
    return Object.freeze({
      status: value.status,
      reviewer,
      reviewedAt,
      notes
    });
  }

  function validateRoundSettings(value) {
    assert(isPlainObject(value), "roundSettings must be an object.");
    assertExactKeys(value, ROUND_SETTING_KEYS, "roundSettings");
    assert(Array.isArray(value.pieceCounts), "roundSettings.pieceCounts must be an array.");
    const pieceCounts = value.pieceCounts.map((count, index) => {
      assert(Number.isInteger(count) && count >= 3 && count <= 12, `roundSettings.pieceCounts[${index}] must be an integer from 3 to 12.`);
      return count;
    });
    assert(pieceCounts.length === 2 && pieceCounts.includes(5) && pieceCounts.includes(9), "roundSettings.pieceCounts must offer 5 and 9 pieces.");
    assert(new Set(pieceCounts).size === pieceCounts.length, "roundSettings.pieceCounts must be unique.");
    assert(pieceCounts.includes(value.defaultPieceCount), "roundSettings.defaultPieceCount must be an available piece count.");

    assert(Array.isArray(value.artwork) && value.artwork.length > 0 && value.artwork.length <= 64, "roundSettings.artwork must contain 1-64 images.");
    const artwork = value.artwork.map((src, index) => {
      const normalized = requiredText(src, `roundSettings.artwork[${index}]`, 180);
      assert(SAFE_SHIP_PATH.test(normalized), `roundSettings.artwork[${index}] must be a local PNG in /assets/ships/.`);
      return normalized;
    });
    assert(new Set(artwork).size === artwork.length, "roundSettings.artwork must be unique.");
    return Object.freeze({
      pieceCounts: Object.freeze(pieceCounts),
      defaultPieceCount: value.defaultPieceCount,
      artwork: Object.freeze(artwork)
    });
  }

  function validatePinyinTone(pinyin, tone, label) {
    assert(Number.isInteger(tone) && tone >= 1 && tone <= 5, `${label}.tone must be an integer from 1 to 5.`);
    if (tone === 5) {
      assert(!ANY_TONE_MARK.test(pinyin), `${label}.pinyin must not carry a tone mark for neutral tone.`);
      return;
    }
    assert(TONE_MARKS[tone].test(pinyin), `${label}.pinyin does not carry the declared tone ${tone}.`);
  }

  function normalizeDifficulty(value, fallback = 1) {
    const level = Number(value);
    return Number.isInteger(level) && value !== null && value !== "" && level >= 0 && level <= 3 ? level : fallback;
  }

  function englishAuditText(value, label) {
    const text = requiredText(value, label, 300);
    assert(/^[\p{Script=Latin}\p{M}\p{P}\p{N}\p{Zs}]+$/u.test(text), `${label} must contain English audit text without target-script examples.`);
    assertLearnerSafe(text, label);
    return text;
  }

  function validateContext(value, challenge, sources, label) {
    assert(isPlainObject(value), `${label} must be an object.`);
    assertExactKeys(value, CONTEXT_KEYS, label);
    const text = requiredText(value.text, `${label}.text`, 240);
    assert(/^[\p{Script=Han}\p{P}\p{Zs}]+$/u.test(text), `${label}.text must contain authored Hanzi with plain punctuation.`);
    assertLearnerSafe(text, `${label}.text`);
    const notation = requiredText(value.notation, `${label}.notation`, 1200);
    assert(/^[A-Za-z\u00c0-\u024f\p{P}\p{Zs}]+$/u.test(notation), `${label}.notation must contain authored pinyin.`);
    assertLearnerSafe(notation, `${label}.notation`);
    const glyphs = Array.from(text).filter(glyph => /\p{Script=Han}/u.test(glyph));
    const syllables = notation.toLowerCase().match(/[A-Za-z\u00c0-\u024f]+/gu) || [];
    assert(glyphs.length === syllables.length, `${label} must align each Han character with one authored pinyin syllable.`);
    assert(glyphs.some((glyph, index) => glyph === challenge.hanzi && syllables[index] === challenge.pinyin.toLowerCase()),
      `${label} must contain the challenge's exact Hanzi and contextual reading.`);
    const meaning = englishAuditText(value.meaning, `${label}.meaning`);
    const sourceConceptId = requiredText(value.sourceConceptId, `${label}.sourceConceptId`, 100);
    assert(sources.includes(sourceConceptId), `${label}.sourceConceptId must cite a declared challenge source.`);
    return Object.freeze({ text, notation, meaning, sourceConceptId });
  }

  function validateChallenge(value, index, wordNotation = false) {
    const label = `challenges[${index}]`;
    assert(isPlainObject(value), `${label} must be an object.`);
    assertExactKeys(value, wordNotation ? WORD_CHALLENGE_KEYS : CHALLENGE_KEYS, label);
    const id = requiredText(value.id, `${label}.id`, 80);
    let scriptFields;
    if (wordNotation) {
      assert(/^ar\.reading\.[a-z0-9-]+$/u.test(id), `${label}.id must use the ar.reading.* namespace.`);
      const target = requiredText(value.target, `${label}.target`, 48);
      assert(/^[\u0621-\u063a\u0641-\u0652\u0670]+$/u.test(target) && /[\u0621-\u063a\u0641-\u064a]/u.test(target) && /[\u064b-\u0652]/u.test(target), `${label}.target must be a vowel-marked Arabic word.`);
      const reading = requiredText(value.reading, `${label}.reading`, 60);
      assert(/^[a-zāīūḥṣḍṭẓʿʾ]+(?:-[a-zāīūḥṣḍṭẓʿʾ]+)*$/u.test(reading) && /[a-zāīū]/u.test(reading), `${label}.reading must use the declared Latin notation.`);
      assertLearnerSafe(target, `${label}.target`);
      assertLearnerSafe(reading, `${label}.reading`);
      const englishAuditText = requiredText(value.englishAuditText, `${label}.englishAuditText`, 80);
      assertLearnerSafe(englishAuditText, `${label}.englishAuditText`);
      scriptFields = { target, reading, englishAuditText };
    } else {
      assert(/^zh\.hanzi\.[a-z0-9-]+$/u.test(id), `${label}.id must use the zh.hanzi.* namespace.`);
      const hanzi = requiredText(value.hanzi, `${label}.hanzi`, 1);
      assert(/^[\u3400-\u9fff\uf900-\ufaff]$/u.test(hanzi), `${label}.hanzi must be one Han character.`);
      assertLearnerSafe(hanzi, `${label}.hanzi`);
      const pinyin = requiredText(value.pinyin, `${label}.pinyin`, 24);
      assert(/^[A-Za-z\u00c0-\u024f]+$/u.test(pinyin), `${label}.pinyin must contain one Latin-script syllable.`);
      assertLearnerSafe(pinyin, `${label}.pinyin`);
      validatePinyinTone(pinyin, value.tone, label);
      const citationReading = ISOLATED_CITATION_READINGS[hanzi];
      if (citationReading) {
        assert(
          pinyin.toLocaleLowerCase("en-US") === citationReading,
          `${label}.pinyin must use the citation reading ${citationReading} for isolated ${hanzi}.`
        );
      }
      scriptFields = { hanzi, pinyin, tone: value.tone };
    }
    const translation = requiredText(value.translation, `${label}.translation`, 80);
    assertLearnerSafe(translation, `${label}.translation`);
    assert(Object.hasOwn(value, "difficulty"), `${label}.difficulty is required.`);
    const difficulty = value.difficulty;
    assert(Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= 3, `${label}.difficulty must be an integer from 0 to 3.`);
    const progression = {};
    for (const [key, legacyKey] of [["usefulness", "urgency"], ["complexity", "subdifficulty"]]) {
      let grade = value[key];
      if (grade === undefined && value[legacyKey] !== undefined) {
        const legacy = value[legacyKey];
        assert(Number.isInteger(legacy) && legacy >= 1 && legacy <= 5, `${label}.${legacyKey} must be an integer from 1 to 5.`);
        grade = [1, 25, 50, 75, 100][legacy - 1];
      }
      if (grade === undefined) grade = 50;
      assert(Number.isInteger(grade) && grade >= 1 && grade <= 100, `${label}.${key} must be an integer from 1 to 100.`);
      progression[key] = grade;
    }
    const sourceField = wordNotation ? "sourceItemIds" : "sourceConceptIds";
    assert(Array.isArray(value[sourceField]) && value[sourceField].length > 0, `${label}.${sourceField} must be a non-empty array.`);
    const sources = value[sourceField].map((conceptId, conceptIndex) => (
      requiredText(conceptId, `${label}.${sourceField}[${conceptIndex}]`, 100)
    ));
    assert(new Set(sources).size === sources.length, `${label}.${sourceField} must be unique.`);
    const audit = !wordNotation && value.englishAuditText !== undefined
      ? englishAuditText(value.englishAuditText, `${label}.englishAuditText`) : null;
    const context = !wordNotation && value.context !== undefined
      ? validateContext(value.context, scriptFields, sources, `${label}.context`) : null;
    return Object.freeze({
      id,
      ...scriptFields,
      translation,
      ...(audit ? { englishAuditText: audit } : {}),
      ...(context ? { context } : {}),
      difficulty,
      ...progression,
      [sourceField]: Object.freeze(sources)
    });
  }

  function readingKey(challenge) {
    return `${(challenge.reading ?? challenge.pinyin).normalize("NFC").toLowerCase()}:${challenge.tone ?? "word"}`;
  }

  function targetText(challenge) { return challenge.target ?? challenge.hanzi; }
  function readingText(challenge) { return challenge.reading ?? challenge.pinyin; }

  function validateNotation(value) {
    assert(isPlainObject(value), "notation must be an object.");
    assertExactKeys(value, new Set(["system", "help"]), "notation");
    assert(value.system === "arabic-learning-romanization-v1", "notation.system must declare the Arabic learning notation.");
    const help = requiredText(value.help, "notation.help", 700);
    assertLearnerSafe(help, "notation.help");
    return Object.freeze({ system: value.system, help });
  }

  function filterChallengesForDifficulty(challenges, difficulty) {
    const selectedDifficulty = normalizeDifficulty(difficulty, 1);
    return challenges.filter((challenge) => normalizeDifficulty(challenge?.difficulty, 1) === selectedDifficulty);
  }

  function validateCatalog(value) {
    assert(isPlainObject(value), "catalog root must be an object.");
    assertExactKeys(value, ROOT_KEYS, "catalog root");
    assert(Object.hasOwn(value, "$schema"), "catalog root.$schema is required.");
    const wordNotation = value.schemaVersion === 2;
    const schemaUrl = wordNotation ? WORD_SCHEMA_URL : EXPECTED_SCHEMA_URL;
    assert(value.$schema === schemaUrl, `catalog root.$schema must be ${schemaUrl}.`);
    assert(value.schemaVersion === 1 || wordNotation, "schemaVersion must be 1 or 2.");
    assert(value.courseId === (wordNotation ? "ar" : "zh"), `courseId must be ${wordNotation ? "ar" : "zh"}.`);
    const notation = wordNotation ? validateNotation(value.notation) : null;
    if (!wordNotation) assert(!Object.hasOwn(value, "notation"), "Mandarin v1 cannot declare word notation.");
    assert(value.gameId === "naturalization-nucleus", "gameId must be naturalization-nucleus.");
    assert(CONTENT_STATUSES.has(value.status), "status is not supported.");
    assertLearnerSafe(value.status, "status");
    const contentId = requiredText(value.contentId, "contentId", 100);
    assert(/^naturalization-nucleus\.[a-z0-9-]+$/u.test(contentId), "contentId must use the naturalization-nucleus.* namespace.");
    const title = requiredText(value.title, "title", 100);
    const instructions = requiredText(value.instructions, "instructions", 240);
    assertLearnerSafe(title, "title");
    assertLearnerSafe(instructions, "instructions");
    const roundSettings = validateRoundSettings(value.roundSettings);
    const derivedFrom = requiredText(value.derivedFrom, "derivedFrom", 240);
    const review = validateReview(value.review, value.status);
    assert(Array.isArray(value.challenges), "challenges must be an array.");
    const requiredCount = Math.max(...roundSettings.pieceCounts);
    assert(value.challenges.length >= requiredCount, `challenges must contain at least ${requiredCount} entries.`);
    const challenges = value.challenges.map((challenge, index) => validateChallenge(challenge, index, wordNotation));
    assert(new Set(challenges.map(({ id }) => id)).size === challenges.length, "challenge ids must be unique.");
    assert(new Set(challenges.map(challenge => `${challenge.difficulty === 0 ? "zero:" : ""}${targetText(challenge)}`)).size === challenges.length, wordNotation ? "challenge target words must be unique." : "challenge Hanzi must be unique.");
    assert(new Set(challenges.map(readingKey)).size >= requiredCount, `challenges must provide at least ${requiredCount} distinct pinyin readings.`);
    for (let difficulty = challenges.some(challenge => challenge.difficulty === 0) ? 0 : 1; difficulty <= 3; difficulty += 1) {
      const eligible = filterChallengesForDifficulty(challenges, difficulty);
      assert(
        new Set(eligible.map(readingKey)).size >= (difficulty === 0 ? 3 : requiredCount),
        `Level ${difficulty} must provide at least ${difficulty === 0 ? 3 : requiredCount} distinct pinyin readings.`
      );
    }
    return Object.freeze({
      $schema: value.$schema,
      schemaVersion: value.schemaVersion,
      courseId: value.courseId,
      gameId: value.gameId,
      contentId,
      title,
      instructions,
      roundSettings,
      status: value.status,
      derivedFrom,
      review,
      ...(notation ? { notation } : {}),
      challenges: Object.freeze(challenges)
    });
  }

  async function loadCatalog(dataUrl, forceReload) {
    if (forceReload) catalogPromise = null;
    if (!catalogPromise) {
      catalogPromise = global.fetch(dataUrl, { cache: "no-cache", credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error(`Could not load challenges.json (${response.status}).`);
          return response.json();
        })
        .then(validateCatalog)
        .catch((error) => {
          catalogPromise = null;
          throw error;
        });
    }
    return catalogPromise;
  }

  function randomIndex(length, random) {
    assert(Number.isInteger(length) && length > 0, "random selection requires a non-empty collection.");
    const value = Number(random());
    assert(Number.isFinite(value) && value >= 0 && value < 1, "random source must return a number from 0 up to, but not including, 1.");
    return Math.floor(value * length);
  }

  function shuffled(values, random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = randomIndex(index + 1, random);
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function selectChallenges(challenges, pieceCount, random, difficulty = 3, progression = {}) {
    if (progression.policy?.identity && progression.policy.id !== 'existing' && progression.selectContentItems) {
      // One policy decision owns the board's pacing and conditional draws.
      // Distinct readings are part of selection, never discarded afterward.
      const result = progression.selectContentItems(filterChallengesForDifficulty(challenges, difficulty), {
        difficulty, history: progression.history || {}, minimumPool: pieceCount,
        limit: pieceCount, getGroupKey: readingKey, random, policy: progression.policy
      });
      assert(result.length === pieceCount && new Set(result.map(readingKey)).size === pieceCount,
        `cannot create a ${pieceCount}-piece round from the available distinct readings.`);
      return result;
    }
    const selected = [];
    const readings = new Set();
    const eligible = filterChallengesForDifficulty(challenges, difficulty);
    let remaining = eligible;
    while (selected.length < pieceCount && remaining.length) {
      // Select by actual practice evidence before excluding homophones. Each
      // board stays unambiguous without hiding a due or useful reading peer.
      const ordered = progression.selectContentItems
        ? progression.selectContentItems(remaining, { difficulty, history: progression.history || {}, minimumPool: pieceCount, random, policy: progression.policy })
        : shuffled(remaining, random);
      if (!ordered.length) break;
      for (const challenge of ordered) {
        const key = readingKey(challenge);
        if (readings.has(key)) continue;
        readings.add(key);
        selected.push(challenge);
        if (selected.length === pieceCount) break;
      }
      remaining = remaining.filter(challenge => !readings.has(readingKey(challenge)));
    }
    assert(selected.length === pieceCount, `cannot create a ${pieceCount}-piece round from the available distinct readings.`);
    return selected;
  }

  function countConnections(pieces) {
    if (!Array.isArray(pieces) || pieces.length === 0) return 0;
    return pieces.reduce((total, piece, index) => {
      const nextPiece = pieces[(index + 1) % pieces.length];
      return total + (readingKey(piece.right) === readingKey(nextPiece.left) ? 1 : 0);
    }, 0);
  }

  function sameOrder(left, right) {
    return left.length === right.length && left.every((piece, index) => piece.id === right[index].id);
  }

  function chooseArtwork(artwork, random, previousArtworkSrc) {
    const available = artwork.length > 1 ? artwork.filter((src) => src !== previousArtworkSrc) : artwork;
    return available[randomIndex(available.length, random)];
  }

  function createRound(catalog, pieceCount, random = global.Math.random, previousArtworkSrc = "", difficulty = 3, progression = {}) {
    const normalizedDifficulty = normalizeDifficulty(difficulty, 1);
    if (normalizedDifficulty === 0) pieceCount = 3;
    assert((normalizedDifficulty === 0 && pieceCount === 3) || catalog?.roundSettings?.pieceCounts?.includes(pieceCount), `piece count ${pieceCount} is not available.`);
    const selected = selectChallenges(catalog.challenges, pieceCount, random, normalizedDifficulty, progression);
    const solution = selected.map((left, index) => {
      const right = selected[(index + 1) % selected.length];
      return Object.freeze({ id: `${left.id}--${right.id}`, left, right });
    });
    const maximumStartingConnections = Math.floor(pieceCount / 3);
    let pieces = shuffled(solution, random);
    for (let attempt = 0; countConnections(pieces) > maximumStartingConnections && attempt < 12; attempt += 1) {
      pieces = shuffled(solution, random);
    }
    if (countConnections(pieces) > maximumStartingConnections || sameOrder(pieces, solution)) pieces = [...solution].reverse();
    return {
      pieceCount,
      difficulty: normalizedDifficulty,
      artworkSrc: chooseArtwork(catalog.roundSettings.artwork, random, previousArtworkSrc),
      solution: Object.freeze([...solution]),
      pieces: [...pieces]
    };
  }

  function placeHanzi(placements, candidate, targets, socketIndex) {
    if (!Array.isArray(placements) || !Array.isArray(targets) || placements.length !== targets.length) return null;
    if (!candidate?.left || !Number.isInteger(socketIndex) || socketIndex < 0 || socketIndex >= targets.length) return null;
    if (placements[socketIndex] || placements.includes(candidate.id)) return null;
    const target = targets[socketIndex];
    if (!target || readingKey(candidate.left) !== readingKey(target)) return null;
    const nextPlacements = [...placements];
    nextPlacements[socketIndex] = candidate.id;
    return Object.freeze({
      placements: Object.freeze(nextPlacements),
      matches: Object.freeze([target]),
      matchSlots: Object.freeze([socketIndex]),
      solved: nextPlacements.every(Boolean)
    });
  }

  function storageFor(root) {
    try {
      return root.defaultView?.localStorage || root.ownerDocument?.defaultView?.localStorage || global.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function storedPieceCount(root, catalog) {
    const key = `caatuu.${catalog.courseId}.${STORAGE_KEY_SUFFIX}`;
    const value = Number.parseInt(storageFor(root)?.getItem(key) || "", 10);
    return catalog.roundSettings.pieceCounts.includes(value) ? value : catalog.roundSettings.defaultPieceCount;
  }

  function savePieceCount(root, catalog, pieceCount) {
    try {
      storageFor(root)?.setItem(`caatuu.${catalog.courseId}.${STORAGE_KEY_SUFFIX}`, String(pieceCount));
    } catch (_error) {
      // Storage is optional; the active round still changes immediately.
    }
  }

  function currentLearningDifficulty() {
    return normalizeDifficulty(global.CaatuuLearning?.difficulty?.(), 1);
  }

  function toneClass(tone) {
    return `naturalization-nucleus-tone-${tone}`;
  }

  function slotIndex(index, pieceCount) {
    return ((index % pieceCount) + pieceCount) % pieceCount;
  }

  function seedChain(first, second, headSlot = 0) {
    if (!first || !second || first.id === second.id) return null;
    if (readingKey(first.right) === readingKey(second.left)) {
      return {
        chain: Object.freeze([first, second]),
        headSlot,
        closed: false,
        side: "seed",
        matches: Object.freeze([second.left]),
        matchSlots: Object.freeze([headSlot])
      };
    }
    if (readingKey(second.right) === readingKey(first.left)) {
      return {
        chain: Object.freeze([second, first]),
        headSlot,
        closed: false,
        side: "seed",
        matches: Object.freeze([first.left]),
        matchSlots: Object.freeze([headSlot])
      };
    }
    return null;
  }

  function attachPiece(chain, candidate, pieceCount, headSlot = 0) {
    if (!Array.isArray(chain) || chain.length < 2 || chain.length >= pieceCount || !candidate) return null;
    if (chain.some(({ id }) => id === candidate.id)) return null;
    const prepend = readingKey(candidate.right) === readingKey(chain[0].left);
    const append = readingKey(chain.at(-1).right) === readingKey(candidate.left);
    const closesCycle = chain.length === pieceCount - 1;
    if (closesCycle) {
      if (!prepend || !append) return null;
      return {
        chain: Object.freeze([...chain, candidate]),
        headSlot,
        closed: true,
        side: "close",
        matches: Object.freeze([candidate.left, chain[0].left]),
        matchSlots: Object.freeze([
          slotIndex(headSlot + chain.length - 1, pieceCount),
          slotIndex(headSlot - 1, pieceCount)
        ])
      };
    }
    if (prepend && append) return null;
    if (append) {
      return {
        chain: Object.freeze([...chain, candidate]),
        headSlot,
        closed: false,
        side: "append",
        matches: Object.freeze([candidate.left]),
        matchSlots: Object.freeze([slotIndex(headSlot + chain.length - 1, pieceCount)])
      };
    }
    if (prepend) {
      const nextHeadSlot = slotIndex(headSlot - 1, pieceCount);
      return {
        chain: Object.freeze([candidate, ...chain]),
        headSlot: nextHeadSlot,
        closed: false,
        side: "prepend",
        matches: Object.freeze([chain[0].left]),
        matchSlots: Object.freeze([nextHeadSlot])
      };
    }
    return null;
  }

  function describeChain(chain, pieceCount, headSlot = 0, closed = false) {
    const matches = [];
    if (Array.isArray(chain)) {
      for (let index = 0; index < chain.length - 1; index += 1) {
        matches.push(Object.freeze({
          slot: slotIndex(headSlot + index, pieceCount),
          challenge: chain[index + 1].left
        }));
      }
      if (closed && chain.length === pieceCount) {
        matches.push(Object.freeze({
          slot: slotIndex(headSlot + chain.length - 1, pieceCount),
          challenge: chain[0].left
        }));
      }
    }
    const hasOpenEnds = Array.isArray(chain) && chain.length >= 2 && !closed;
    return Object.freeze({
      matches: Object.freeze(matches),
      leftEnd: hasOpenEnds ? Object.freeze({
        slot: slotIndex(headSlot - 1, pieceCount),
        challenge: chain[0].left
      }) : null,
      rightEnd: hasOpenEnds ? Object.freeze({
        slot: slotIndex(headSlot + chain.length - 1, pieceCount),
        challenge: chain.at(-1).right
      }) : null,
      solved: Boolean(closed && chain.length === pieceCount)
    });
  }

  function makeText(documentRef, className, text, lang = "", direction = "ltr", readingGuide = null, reading = "") {
    const node = documentRef.createElement("span");
    node.className = className;
    if (lang) node.lang = lang;
    node.dir = direction;
    if (lang === "ar" && [...text.replace(/\p{M}/gu, "")].length > 6) node.classList.add("naturalization-nucleus-word-long");
    node.textContent = text;
    if (lang === "ar") readingGuide?.render(node, text, { reading });
    return node;
  }

  function roundPresentation(roundIndex, catalog) {
    const reversed = roundIndex % 2 === 1;
    if (catalog?.notation) return {
      deck: reversed ? "reading" : "target",
      ring: reversed ? "target" : "reading",
      deckLabel: reversed ? "Latin reading" : "Arabic word",
      ringLabel: reversed ? "Arabic word" : "Latin reading",
      wordNotation: true
    };
    return {
      deck: reversed ? "pinyin" : "hanzi",
      ring: reversed ? "hanzi" : "pinyin",
      deckLabel: reversed ? "Pinyin" : "Hanzi",
      ringLabel: reversed ? "Hanzi" : "pinyin"
    };
  }

  function scriptLanguage(script) {
    if (script === "target") return "ar";
    if (script === "reading") return "ar-Latn";
    return script === "hanzi" ? "zh-Hans" : "zh-Latn-pinyin";
  }

  function scriptDirection(script) { return script === "target" ? "rtl" : "ltr"; }

  function deckHanziTile(documentRef, piece, index, selected, dragging, invalid, presentation) {
    const item = documentRef.createElement("div");
    item.className = "naturalization-nucleus-deck-item";
    item.dataset.state = "available";
    item.setAttribute("role", "listitem");

    const tile = documentRef.createElement("button");
    tile.type = "button";
    tile.className = "naturalization-nucleus-domino";
    tile.draggable = true;
    tile.dataset.naturalizationPieceId = piece.id;
    tile.dataset.invalid = String(invalid);
    tile.dataset.dragging = String(dragging);
    tile.setAttribute("aria-pressed", String(selected));
    tile.setAttribute("aria-label", `${presentation.deckLabel} tile ${index + 1}: ${piece.left[presentation.deck]}. Choose its matching ${presentation.ringLabel}.`);
    tile.append(makeText(
      documentRef,
      `naturalization-nucleus-domino-hanzi naturalization-nucleus-script-${presentation.deck}`,
      piece.left[presentation.deck],
      scriptLanguage(presentation.deck), scriptDirection(presentation.deck), presentation.readingGuide, readingText(piece.left)
    ));
    item.append(tile);
    return item;
  }

  function placedDeckWell(documentRef, piece, index) {
    const item = documentRef.createElement("div");
    item.className = "naturalization-nucleus-deck-item";
    item.dataset.state = "placed";
    item.setAttribute("role", "listitem");
    item.setAttribute("aria-label", `Tile ${index + 1} has been matched.`);
    item.dataset.naturalizationPlacedPieceId = piece.id;
    return item;
  }

  function pinyinSocketTarget(documentRef, index, challenge, presentation) {
    const target = documentRef.createElement("button");
    target.type = "button";
    target.className = "naturalization-nucleus-socket-target";
    target.dataset.naturalizationSocketIndex = String(index);
    target.dataset.naturalizationChallengeId = challenge.id;
    target.setAttribute("aria-label", `${presentation.ringLabel} ${challenge[presentation.ring]}. Choose the matching ${presentation.deckLabel}.`);
    target.append(makeText(documentRef, `naturalization-nucleus-socket-pinyin naturalization-nucleus-script-${presentation.ring}`, challenge[presentation.ring], scriptLanguage(presentation.ring), scriptDirection(presentation.ring), presentation.readingGuide, readingText(challenge)));
    return target;
  }

  function fusedWord(documentRef, challenge, isNew, readingGuide) {
    const wordNotation = Boolean(challenge.target);
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "naturalization-nucleus-fused-word";
    button.dataset.naturalizationReviewId = challenge.id;
    button.dataset.new = String(isNew);
    button.setAttribute("aria-label", `${targetText(challenge)}, ${readingText(challenge)}, ${challenge.translation}. Play again.`);
    if (!wordNotation) button.append(makeText(documentRef, "naturalization-nucleus-fused-pinyin", readingText(challenge), "zh-Latn-pinyin"));
    button.append(makeText(documentRef, `naturalization-nucleus-fused-hanzi ${wordNotation ? "" : toneClass(challenge.tone)}`, targetText(challenge), wordNotation ? "ar" : "zh-Hans", wordNotation ? "rtl" : "ltr", readingGuide, readingText(challenge)));
    return button;
  }

  function orbitSocket(documentRef, index, challenge, placedPiece, newMatchSlots, errorSlot, presentation) {
    const item = documentRef.createElement("li");
    item.className = "naturalization-nucleus-socket";
    item.dataset.socketIndex = String(index);
    item.dataset.invalid = String(errorSlot === index);
    if (placedPiece) {
      item.dataset.socketState = "matched";
      item.append(fusedWord(documentRef, challenge, newMatchSlots.includes(index), presentation.readingGuide));
    } else {
      item.dataset.socketState = "empty";
      item.append(pinyinSocketTarget(documentRef, index, challenge, presentation));
    }
    return item;
  }

  function createGame(root, catalog, { loadingScreen, isActive, disposeLoading, progression, createReadingGuide }) {
    const stage = root.querySelector(".naturalization-nucleus-stage");
    const game = root.querySelector("#naturalizationNucleusGame");
    const interstitial = root.querySelector("#naturalizationNucleusInterstitial");
    const interstitialRobot = root.querySelector("#naturalizationNucleusInterstitialRobot");
    const board = root.querySelector("#naturalizationNucleusBoard");
    board.dataset.notation = catalog.notation?.system || "hanzi-pinyin";
    game.dataset.notation = board.dataset.notation;
    game.setAttribute("aria-label", catalog.instructions);
    const notationHelp = root.querySelector("#naturalizationNucleusNotationHelp");
    if (notationHelp) {
      notationHelp.hidden = !catalog.notation;
      notationHelp.textContent = catalog.notation?.help || "";
    }
    const ring = root.querySelector("#naturalizationNucleusRing");
    const deck = root.querySelector("#naturalizationNucleusDeck");
    const artwork = root.querySelector("#naturalizationNucleusArtwork");
    const imageToggle = root.querySelector("#naturalizationNucleusImageToggle");
    const core = root.querySelector("#naturalizationNucleusCore");
    const status = root.querySelector("#naturalizationNucleusStatus");
    const pieceCount = root.querySelector("#naturalizationNucleusPieceCount");
    const displayToggle = root.querySelector("#naturalizationNucleusDisplayToggle");
    const displayMenu = root.querySelector("#naturalizationNucleusDisplayMenu");
    const readingGuide = createReadingGuide?.({ course: global.CaatuuCourse, gameId: "naturalization-nucleus",
      document: board.ownerDocument || global.document, storage: global.localStorage,
      onChange: () => { markReadingAssistance(); renderFeedback(); } });
    readingGuide?.mountSetting(displayMenu);
    const audioToggle = root.querySelector("#naturalizationNucleusSound");
    const audioMenu = root.querySelector("#naturalizationNucleusAudioMenu");
    const optionsToggle = root.querySelector("#naturalizationNucleusOptionsToggle");
    const optionsMenu = root.querySelector("#naturalizationNucleusOptionsMenu");
    const audioSpeed = root.querySelector("#naturalizationNucleusAudioSpeed");
    const feedback = root.querySelector("#naturalizationNucleusFeedback");
    const feedbackPinyin = root.querySelector("#naturalizationNucleusFeedbackPinyin");
    const feedbackHanzi = root.querySelector("#naturalizationNucleusFeedbackHanzi");
    const feedbackReading = root.querySelector("#naturalizationNucleusFeedbackReading");
    const feedbackGlyph = feedbackHanzi?.querySelector(".word-net-target-text-glyph");
    const feedbackMeaning = root.querySelector("#naturalizationNucleusFeedbackMeaning");
    const feedbackSound = root.querySelector("#naturalizationNucleusFeedbackSound");
    const feedbackContext = catalog.notation ? null : (() => {
      const documentRef = feedback.ownerDocument || global.document;
      const section = feedback.querySelector(".naturalization-nucleus-context") || documentRef.createElement("section");
      section.className = "naturalization-nucleus-context";
      section.hidden = true;
      section.setAttribute("aria-label", "Mandarin example in context");
      const label = makeText(documentRef, "naturalization-nucleus-context-label", "In a word or sentence", "en");
      const text = makeText(documentRef, "naturalization-nucleus-context-text", "", "zh-Hans");
      const notation = makeText(documentRef, "naturalization-nucleus-context-notation", "", "zh-Latn-pinyin");
      const meaning = makeText(documentRef, "naturalization-nucleus-context-meaning", "", "en");
      const play = documentRef.createElement("button");
      play.type = "button";
      play.className = "naturalization-nucleus-context-play";
      play.textContent = "Play example";
      play.setAttribute("aria-label", "Play contextual Mandarin example");
      play.title = "Play contextual Mandarin example";
      play.disabled = true;
      section.replaceChildren(label, text, notation, meaning, play);
      feedback.append(section);
      feedbackSound?.setAttribute("aria-label", "Play isolated Mandarin character");
      if (feedbackSound) feedbackSound.title = "Play isolated Mandarin character";
      return { section, text, notation, meaning, play };
    })();
    const countButtons = [...root.querySelectorAll("[data-naturalization-piece-count]")];
    assert(
      stage && game && interstitial && interstitialRobot && board && ring && deck && artwork && status && pieceCount
      && displayToggle && displayMenu && audioToggle && audioMenu && optionsToggle && optionsMenu && imageToggle && core
      && audioSpeed
      && feedback && feedbackPinyin && feedbackHanzi && feedbackReading && feedbackGlyph && feedbackMeaning && feedbackSound,
      "the game shell is incomplete."
    );
    assert(countButtons.length === catalog.roundSettings.pieceCounts.length, "the piece-count controls do not match the catalog.");

    mountedBoards.get(board)?.destroy();
    const listeners = [];
    let transitionId = 0;
    let transitioning = false;
    let waitingCampaign = false;
    let destroyed = false;
    let active = isActive();
    let speechRequest = null;
    let cancelMatchAnnouncement = () => {};
    let cancelArtworkLoad = () => {};
    const roundTimers = new Set();
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler);
      listeners.push(() => target.removeEventListener(type, handler));
    };
    const audioSpeedOptions = Object.freeze([
      Object.freeze({ key: "slower", label: "Slower", rate: 0.5 }),
      Object.freeze({ key: "slow", label: "Slow", rate: 0.6 }),
      Object.freeze({ key: "normal", label: "Normal", rate: 1 })
    ]);
    const toolbarMenus = Object.freeze([
      Object.freeze({ toggle: displayToggle, menu: displayMenu }),
      Object.freeze({ toggle: audioToggle, menu: audioMenu }),
      Object.freeze({ toggle: optionsToggle, menu: optionsMenu })
    ]);
    const continueButton = board.ownerDocument.createElement("button");
    continueButton.id = "naturalizationNucleusContinue";
    continueButton.className = "naturalization-nucleus-continue";
    deck.parentElement.append(continueButton);
    const continuation = global.CaatuuPracticePacing.createReviewContinuation({
      button: continueButton, i18n: global.CaatuuI18n,
      canContinue: () => active && isActive() && !destroyed
        && !toolbarMenus.some(({ menu }) => !menu.hidden),
      onContinue() {
        cancelSpeech();
        if (inCampaign()) {
          waitingCampaign = true;
          global.postMessage({ source: "caatuu-game", type: "round-success",
            gameId: "naturalization-nucleus" }, global.location.origin);
        } else prepareRound();
      }
    });
    const state = {
      pieceCount: storedPieceCount(root, catalog),
      difficulty: currentLearningDifficulty(),
      round: null,
      roundIndex: -1,
      imagesEnabled: true,
      placements: [],
      selectedPieceId: "",
      selectedSocketIndex: -1,
      draggingPieceId: "",
      suppressClick: false,
      feedbackChallenge: null,
      feedbackRevealed: false,
      newMatchSlots: [],
      errorPieceId: "",
      errorSlot: -1,
      errorMessage: "",
      feedbackSequence: 0
    };
    let renderedRound = null;
    let renderedSockets = [];
    let renderedDeckItems = [];

    function syncImageControl() {
      core.hidden = !state.imagesEnabled;
      const label = state.imagesEnabled ? "Hide picture clues" : "Show picture clues";
      imageToggle.setAttribute("aria-pressed", String(state.imagesEnabled));
      imageToggle.setAttribute("aria-label", label);
      imageToggle.title = label;
      imageToggle.classList.toggle("is-active", state.imagesEnabled);
    }

    function toggleImage() {
      state.imagesEnabled = !state.imagesEnabled;
      syncImageControl();
    }

    function syncDisplayControls() {
      const documentElement = board.ownerDocument?.documentElement;
      const theme = documentElement?.dataset.theme === "dark" ? "dark" : "light";
      const fontSize = documentElement?.dataset.fontSize || "largest";
      const themeLabel = theme === "dark" ? "Dark" : "Light";
      const fontSizeLabel = { largest: "Standard", large: "Small", standard: "Smaller" }[fontSize] || "Standard";
      displayToggle.setAttribute("aria-label", `Display settings. Current: ${themeLabel} theme, ${fontSizeLabel} text.`);
      displayToggle.title = displayToggle.getAttribute("aria-label");
      displayMenu.querySelectorAll("[data-theme-option]").forEach((button) => {
        const selected = button.dataset.themeOption === theme;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      displayMenu.querySelectorAll("[data-font-size-option]").forEach((button) => {
        const selected = button.dataset.fontSizeOption === fontSize;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    }

    function syncAudioControls() {
      const pace = global.CaatuuChrome?.resolveSpeechPace?.() || audioSpeedOptions[0];
      const paceIndex = Math.max(0, audioSpeedOptions.findIndex(({ key }) => key === pace.key));
      const option = audioSpeedOptions[paceIndex];
      audioSpeed.value = String(paceIndex);
      audioSpeed.dataset.paceIndex = String(paceIndex);
      audioSpeed.setAttribute("aria-valuetext", `${option.label}, ${option.rate} times`);
      const label = `${catalog.notation ? "Arabic" : "Mandarin"} audio settings. Current: ${option.label} speed.`;
      audioToggle.setAttribute("aria-label", label);
      audioToggle.title = label;
    }

    function closeToolbarMenu(entry, { restoreFocus = false } = {}) {
      global.CaatuuChrome?.releaseToolbarPopover?.(entry.menu);
      entry.menu.hidden = true;
      entry.toggle.setAttribute("aria-expanded", "false");
      syncRoundTasks();
      if (restoreFocus) entry.toggle.focus({ preventScroll: true });
    }

    function closeToolbarMenus(exceptMenu = null) {
      toolbarMenus.forEach((entry) => {
        if (entry.menu !== exceptMenu) closeToolbarMenu(entry);
      });
    }

    function openToolbarMenu(entry) {
      if (!active || !isActive() || destroyed) return;
      cancelDrag();
      closeToolbarMenus(entry.menu);
      if (entry.menu === displayMenu) syncDisplayControls();
      if (entry.menu === audioMenu) {
        syncAudioControls();
      }
      entry.menu.hidden = false;
      entry.toggle.setAttribute("aria-expanded", "true");
      syncRoundTasks();
      global.CaatuuChrome?.constrainToolbarPopover?.(entry.menu);
    }

    function toggleToolbarMenu(entry) {
      if (entry.menu.hidden) openToolbarMenu(entry);
      else closeToolbarMenu(entry, { restoreFocus: true });
    }

    function deckPieces() {
      const placed = new Set(state.placements.filter(Boolean));
      return state.round.pieces.filter(({ id }) => !placed.has(id));
    }

    function pieceForId(pieceId) {
      return state.round.pieces.find(({ id }) => id === pieceId) || null;
    }

    function socketTargets() {
      return state.round.solution.map(({ left }) => left);
    }

    function solved() {
      return state.placements.length === state.pieceCount && state.placements.every(Boolean);
    }

    function canUseBoard() {
      return active && isActive() && !destroyed && !transitioning
        && !toolbarMenus.some(({ menu }) => !menu.hidden);
    }

    function cancelDrag() {
      state.draggingPieceId = "";
      ring.querySelectorAll("[data-drop-target]").forEach((node) => node.removeAttribute("data-drop-target"));
      deck.querySelectorAll("[data-dragging]").forEach((node) => node.removeAttribute("data-dragging"));
      board.dataset.tileSelected = String(Boolean(state.selectedPieceId));
    }

    function ignoresBoardKey(event) {
      return event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], dialog, [role="dialog"]');
    }

    function clearRoundTimers() {
      [...roundTimers].forEach(cancelRoundTask);
    }

    const now = () => global.performance?.now?.() ?? Date.now();
    function roundTasksCanRun() {
      return active && isActive() && !destroyed && !speechRequest
        && !toolbarMenus.some(({ menu }) => !menu.hidden);
    }

    function pauseRoundTask(task) {
      if (!task || !roundTimers.has(task)) return;
      global.clearTimeout(task.timer);
      task.timer = null;
      task.token += 1;
      if (task.startedAt !== null) task.remaining = Math.max(0, task.remaining - (now() - task.startedAt));
      task.startedAt = null;
    }

    function cancelRoundTask(task) {
      pauseRoundTask(task);
      roundTimers.delete(task);
    }

    function syncRoundTasks() {
      continuation.sync();
      roundTimers.forEach(roundTasksCanRun() ? armRoundTask : pauseRoundTask);
    }

    function armRoundTask(task) {
      if (!roundTasksCanRun() || task.timer !== null) return;
      task.startedAt = now();
      const token = ++task.token;
      task.timer = global.setTimeout(() => {
        if (token !== task.token || destroyed || !roundTimers.has(task)) return;
        pauseRoundTask(task);
        if (!roundTasksCanRun()) return;
        roundTimers.delete(task);
        task.callback();
      }, task.remaining);
    }

    function scheduleRoundTask(callback, delay) {
      const task = { callback, remaining: delay, startedAt: null, timer: null, token: 0 };
      roundTimers.add(task);
      armRoundTask(task);
      return task;
    }

    function setActive(value) {
      if (!destroyed && value && waitingCampaign && !inCampaign()) prepareRound();
      if (destroyed || active === Boolean(value)) return;
      active = Boolean(value);
      loadingScreen.setActive(active);
      if (!active) {
        cancelDrag();
        state.feedbackSequence += 1;
        cancelSpeech();
        closeToolbarMenus();
      }
      syncRoundTasks();
    }

    function setRoundLoading(active) {
      if (active) loadingScreen.show();
      else loadingScreen.hide();
      stage.setAttribute("aria-busy", String(active));
      game.toggleAttribute("inert", active);
      game.setAttribute("aria-hidden", String(active));
      status.parentElement.hidden = active;
    }

    function focusDeckPiece(pieceId) {
      if (!pieceId || solved()) return;
      global.requestAnimationFrame?.(() => {
        if (destroyed || !isActive()) return;
        [...deck.querySelectorAll("[data-naturalization-piece-id]")]
          .find((button) => button.dataset.naturalizationPieceId === pieceId)?.focus({ preventScroll: true });
      });
    }

    function renderFeedback() {
      const challenge = state.feedbackChallenge;
      feedback.hidden = !challenge;
      if (feedbackContext) {
        // Clear previous content as well as hiding it: selecting a new tile must
        // not expose its pronunciation or carry the prior example into the DOM.
        feedbackContext.section.hidden = true;
        feedbackContext.text.textContent = "";
        feedbackContext.notation.textContent = "";
        feedbackContext.meaning.textContent = "";
        feedbackContext.play.disabled = true;
        feedback.classList.remove("has-context");
      }
      if (!challenge) return;
      const revealed = state.feedbackRevealed;
      if (feedbackContext && revealed && challenge.context) {
        feedbackContext.text.textContent = challenge.context.text;
        feedbackContext.notation.textContent = challenge.context.notation;
        feedbackContext.meaning.textContent = challenge.context.meaning;
        feedbackContext.section.hidden = false;
        feedbackContext.play.disabled = global.CaatuuCourse?.capabilities?.speech === false
          || typeof global.CaatuuChrome?.speakText !== "function";
        feedback.classList.add("has-context");
      }
      const script = roundPresentation(state.roundIndex, catalog).deck;
      const targetScript = catalog.notation ? "target" : "hanzi";
      const label = revealed ? `${targetText(challenge)}, ${readingText(challenge)}` : challenge[script];
      const showReading = catalog.notation
        ? readingGuide?.enabled && (revealed || script === targetScript)
        : revealed;
      // Arabic reading help follows the learner's setting. Matching labels and
      // speech continue to use the original target, independently of the aid.
      feedbackPinyin.textContent = showReading ? readingText(challenge) : "";
      feedbackPinyin.lang = scriptLanguage(catalog.notation ? "reading" : "pinyin");
      feedbackPinyin.dir = "ltr";
      feedbackPinyin.hidden = !showReading;
      feedbackGlyph.textContent = revealed || script === targetScript ? targetText(challenge) : readingText(challenge);
      feedbackHanzi.lang = scriptLanguage(revealed ? targetScript : script);
      feedbackHanzi.dir = scriptDirection(revealed ? targetScript : script);
      feedbackHanzi.classList.toggle("has-target-text-guide", Boolean(showReading));
      feedbackHanzi.classList.toggle("has-target-text-colors", revealed && !catalog.notation);
      if (revealed && !catalog.notation) feedbackReading.dataset.tone = String(challenge.tone);
      else feedbackReading.removeAttribute("data-tone");
      feedbackHanzi.setAttribute("aria-label", label);
      feedback.dataset.state = revealed ? "matched" : "preview";
      feedback.setAttribute("aria-label", `${revealed ? "Matched" : "Selected"} ${catalog.notation ? "Arabic" : "Mandarin"} word`);
      feedbackMeaning.textContent = challenge.translation;
      const playLabel = catalog.notation ? `Play ${label}.` : `Play isolated character ${label}.`;
      feedbackSound.setAttribute("aria-label", playLabel);
      feedbackSound.title = playLabel;
    }

    function render(focusPieceId = "") {
      const documentRef = board.ownerDocument || global.document;
      const presentation = roundPresentation(state.roundIndex, catalog);
      presentation.readingGuide = readingGuide;
      markReadingAssistance();
      deck.setAttribute("aria-label", `${presentation.deckLabel} tiles waiting to be placed`);
      deck.parentElement.setAttribute("aria-label", `${presentation.deckLabel} tiles waiting to be placed`);
      ring.setAttribute("aria-label", `${presentation.ringLabel} matching positions`);
      const targets = socketTargets();
      const isSolved = solved();
      deck.hidden = isSolved;
      if (isSolved) deck.parentElement.removeAttribute("aria-label");
      // Selection changes only attributes. Keep untouched controls connected so
      // rapid taps retain their targets and previous matches do not animate again.
      if (renderedRound !== state.round) {
        renderedRound = state.round;
        renderedSockets = targets.map((challenge, index) => orbitSocket(
          documentRef, index, challenge, null, [], -1, presentation
        ));
        renderedDeckItems = state.round.pieces.map((piece, index) => deckHanziTile(
          documentRef, piece, index, false, false, false, presentation
        ));
        ring.replaceChildren(...renderedSockets);
        deck.replaceChildren(...renderedDeckItems);
      }
      renderedSockets.forEach((socket, index) => {
        socket.dataset.invalid = String(state.errorSlot === index);
        if (state.placements[index] && socket.dataset.socketState !== "matched") {
          socket.dataset.socketState = "matched";
          socket.replaceChildren(fusedWord(documentRef, targets[index], true, readingGuide));
        }
        const target = socket.querySelector("[data-naturalization-socket-index]");
        target?.setAttribute("aria-pressed", String(index === state.selectedSocketIndex));
        const matched = socket.querySelector("[data-naturalization-review-id]");
        if (matched) matched.dataset.new = String(state.newMatchSlots.includes(index));
      });
      const placedIds = new Set(state.placements.filter(Boolean));
      state.round.pieces.forEach((piece, index) => {
        const item = renderedDeckItems[index];
        if (placedIds.has(piece.id)) {
          if (item.dataset.state !== "placed") {
            const well = placedDeckWell(documentRef, piece, index);
            item.replaceWith(well);
            renderedDeckItems[index] = well;
          }
          return;
        }
        const tile = item.querySelector("[data-naturalization-piece-id]");
        tile.setAttribute("aria-pressed", String(state.selectedPieceId === piece.id));
        tile.dataset.invalid = String(state.errorPieceId === piece.id);
        tile.dataset.dragging = String(state.draggingPieceId === piece.id);
      });
      board.dataset.pieceCount = String(state.pieceCount);
      board.dataset.difficulty = String(state.difficulty);
      board.dataset.solved = String(isSolved);
      board.dataset.chainStarted = String(state.placements.some(Boolean));
      board.dataset.tileSelected = String(Boolean(state.selectedPieceId || state.draggingPieceId));
      if (artwork.getAttribute("src") !== state.round.artworkSrc) artwork.src = state.round.artworkSrc;
      if (state.errorMessage) {
        status.textContent = state.errorMessage;
        status.dataset.state = "error";
      } else if (isSolved) {
        status.textContent = catalog.notation ? "Orbit complete — every Arabic word has found its Latin reading." : "Orbit complete — every Hanzi has found its pinyin.";
        status.dataset.state = "solved";
      } else if (state.selectedSocketIndex >= 0) {
        status.textContent = `Selected ${targets[state.selectedSocketIndex][presentation.ring]}. Choose its matching ${presentation.deckLabel} tile.`;
        status.dataset.state = "ready";
      } else if (state.selectedPieceId) {
        const piece = pieceForId(state.selectedPieceId);
        status.textContent = `Selected ${piece.left[presentation.deck]}. Choose its matching ${presentation.ringLabel} on the orbit.`;
        status.dataset.state = "ready";
      } else if (state.placements.some(Boolean)) {
        status.textContent = `${state.placements.filter(Boolean).length} of ${state.pieceCount} matches complete. Choose another ${presentation.deckLabel} tile.`;
        status.dataset.state = "ready";
      } else {
        status.textContent = catalog.notation ? "Match each Arabic word with its Latin reading. Choose either side first." : "Match each Hanzi with its pinyin. Choose either side first.";
        status.dataset.state = "ready";
      }
      pieceCount.textContent = String(state.pieceCount);
      optionsToggle.setAttribute("aria-label", `Tile settings. Current: ${state.pieceCount} tiles.`);
      optionsToggle.title = "Tile settings";
      optionsMenu.setAttribute("aria-label", "Tile settings");
      countButtons.forEach((button) => {
        button.disabled = state.difficulty === 0;
        const selected = Number.parseInt(button.dataset.naturalizationPieceCount || "", 10) === state.pieceCount;
        button.setAttribute("aria-checked", String(selected));
      });
      renderFeedback();
      focusDeckPiece(focusPieceId);
    }

    function markReadingAssistance() {
      if (!catalog.notation || !readingGuide?.enabled || !state.round) return;
      for (const piece of state.round.solution) {
        if (!state.placements.includes(piece.id)) state.assistedIds.add(piece.left.id);
      }
    }

    function cancelSpeech() {
      cancelMatchAnnouncement();
      cancelMatchAnnouncement = () => {};
      if (!speechRequest) return;
      speechRequest = null;
      try {
        Promise.resolve(global.CaatuuChrome?.stopSpeech?.()).catch(() => {});
      } catch (_error) {
        // A retired request must not keep the next visible round paused.
      }
    }

    function trackSpeech(play) {
      cancelMatchAnnouncement();
      cancelMatchAnnouncement = () => {};
      const request = {};
      speechRequest = request;
      syncRoundTasks();
      let result;
      try {
        result = play();
      } catch (_error) {
        result = undefined;
      }
      return Promise.resolve(result).catch(() => {
        // Visual feedback remains useful when speech is unavailable.
      }).finally(() => {
        if (speechRequest !== request) return;
        speechRequest = null;
        syncRoundTasks();
      });
    }

    function speak(challenge) {
      if (!challenge || !active || !isActive() || destroyed) return Promise.resolve();
      const speakText = global.CaatuuChrome?.speakText;
      if (typeof speakText !== "function") return Promise.resolve();
      const piece = state.round?.solution.find(item => item.left.id === challenge.id);
      if (piece && !state.placements.includes(piece.id)) state.assistedIds.add(challenge.id);
      return trackSpeech(() => speakText(targetText(challenge)));
    }

    function previewAudio() {
      if (state.feedbackChallenge) return speak(state.feedbackChallenge);
      if (!active || !isActive() || destroyed) return Promise.resolve();
      return trackSpeech(() => global.CaatuuChrome?.previewSpeech?.());
    }

    function playContext() {
      const challenge = state.feedbackChallenge;
      if (!active || !isActive() || destroyed || !state.feedbackRevealed || !challenge?.context
        || global.CaatuuCourse?.capabilities?.speech === false) return Promise.resolve();
      const speakText = global.CaatuuChrome?.speakText;
      if (typeof speakText !== "function") return Promise.resolve();
      return trackSpeech(() => speakText(challenge.context.text));
    }

    function announceMatches(matches) {
      const sequence = state.feedbackSequence + 1;
      state.feedbackSequence = sequence;
      cancelMatchAnnouncement();
      cancelMatchAnnouncement = global.CaatuuPracticePacing.afterInteractionPaint(global, async () => {
        cancelMatchAnnouncement = () => {};
        for (const challenge of matches) {
          if (state.feedbackSequence !== sequence || !active || !isActive() || destroyed) return;
          state.feedbackChallenge = challenge;
          state.feedbackRevealed = true;
          renderFeedback();
          await speak(challenge);
        }
      });
    }

    function recordPractice(challenge, correct, evidence) {
      const shared = { itemId: challenge.id, encounterId: state.encounterId, generation: state.contentGeneration };
      const previousExposureAt = global.CaatuuLearning?.contentHistory?.("naturalization-nucleus")?.[challenge.id]?.lastSeenAt;
      global.CaatuuLearning?.recordExposure?.("naturalization-nucleus", { ...shared, correct: null, evidence: "exposure" });
      global.CaatuuLearning?.recordExposure?.("naturalization-nucleus", {
        ...shared, bankId: state.practiceBank, correct, evidence, previousExposureAt
      });
    }

    function practiceHistory(bankId) {
      const exposure = global.CaatuuLearning?.contentHistory?.("naturalization-nucleus") || {};
      const evidence = global.CaatuuLearning?.contentHistory?.("naturalization-nucleus", bankId) || {};
      return Object.fromEntries([...new Set([...Object.keys(exposure), ...Object.keys(evidence)])].map(id => [id, {
        firstSeenAt: exposure[id]?.firstSeenAt, lastSeenAt: exposure[id]?.lastSeenAt,
        practiceDays: exposure[id]?.practiceDays || 0, lastPracticeDayAt: exposure[id]?.lastPracticeDayAt,
        ...evidence[id], exposures: Math.max(exposure[id]?.exposures || 0, evidence[id]?.exposures || 0)
      }]));
    }

    function acceptPlacement(transition) {
      state.placements = [...transition.placements];
      state.selectedPieceId = "";
      state.selectedSocketIndex = -1;
      state.errorPieceId = "";
      state.errorSlot = -1;
      state.errorMessage = "";
      state.newMatchSlots = [...transition.matchSlots];
      state.feedbackChallenge = transition.matches[0] || null;
      state.feedbackRevealed = true;
      const nextPieceId = deckPieces()[0]?.id || "";
      render(nextPieceId);
      void announceMatches(transition.matches);
      if (transition.solved) {
        for (const piece of state.round.solution) recordPractice(piece.left, true,
          state.mistakeIds.has(piece.left.id) || state.assistedIds.has(piece.left.id) ? "assisted" : "independent");
        global.CaatuuLearning?.record?.("naturalization-nucleus", {
          activities: 1,
          attempts: 1,
          successes: 1,
          xp: 1,
          rounds: 1
        });
        continuation.show();
      }
    }

    function rejectPlacement(pieceId, socketIndex, message) {
      state.errorPieceId = pieceId;
      state.errorSlot = socketIndex;
      state.errorMessage = message;
      state.newMatchSlots = [];
      render(pieceId);
    }

    function selectPiece(pieceId) {
      const piece = pieceForId(pieceId);
      if (!canUseBoard() || !piece || solved() || state.placements.includes(piece.id)) return;
      state.feedbackChallenge = piece.left;
      state.feedbackRevealed = false;
      if (state.selectedSocketIndex >= 0) {
        tryPlacement(pieceId, state.selectedSocketIndex);
        return;
      }
      state.selectedPieceId = state.selectedPieceId === piece.id ? "" : piece.id;
      state.feedbackSequence += 1;
      if (!state.selectedPieceId) state.feedbackChallenge = null;
      state.errorPieceId = "";
      state.errorSlot = -1;
      state.errorMessage = "";
      state.newMatchSlots = [];
      render(piece.id);
    }

    function tryPlacement(pieceId, socketIndex) {
      const piece = pieceForId(pieceId);
      if (!canUseBoard() || !piece || solved() || state.placements.includes(piece.id)) return;
      if (!Number.isInteger(socketIndex) || socketIndex < 0 || socketIndex >= state.pieceCount) return;
      if (state.errorPieceId === pieceId && state.errorSlot === socketIndex) return;
      if (state.placements[socketIndex]) {
        rejectPlacement(piece.id, socketIndex, "That position is already matched. Choose another position.");
        return;
      }
      const transition = placeHanzi(state.placements, piece, socketTargets(), socketIndex);
      if (transition) {
        acceptPlacement(transition);
      } else {
        const target = socketTargets()[socketIndex];
        const evidence = state.mistakeIds.has(piece.left.id) || state.assistedIds.has(piece.left.id) ? "assisted" : "independent";
        state.mistakeIds.add(piece.left.id);
        state.mistakeIds.add(target.id);
        rejectPlacement(piece.id, socketIndex, "That tile does not match this position. Try another position.");
        recordPractice(piece.left, false, evidence);
      }
    }

    function startRound(pieceCount = state.pieceCount) {
      if (state.difficulty === 0) pieceCount = 3;
      else if (!catalog.roundSettings.pieceCounts.includes(pieceCount)) pieceCount = storedPieceCount(root, catalog);
      const previousArtworkSrc = state.round?.artworkSrc || "";
      state.pieceCount = pieceCount;
      const presentation = roundPresentation(state.roundIndex + 1, catalog);
      state.practiceBank = `recognize-${presentation.deck}-${presentation.ring}`;
      state.round = createRound(catalog, pieceCount, global.Math.random, previousArtworkSrc, state.difficulty, {
        ...progression,
        history: practiceHistory(state.practiceBank),
        policy: global.CaatuuLearning?.samplingContext?.("naturalization-nucleus", state.practiceBank)
      });
      state.encounterId = progression.newContentEncounterId();
      state.contentGeneration = global.CaatuuLearning?.contentGeneration?.() ?? null;
      state.mistakeIds = new Set();
      state.assistedIds = new Set();
      state.roundIndex += 1;
      state.placements = Array.from({ length: pieceCount }, () => "");
      state.selectedPieceId = "";
      state.selectedSocketIndex = -1;
      state.draggingPieceId = "";
      state.feedbackChallenge = null;
      state.feedbackRevealed = false;
      state.newMatchSlots = [];
      state.errorPieceId = "";
      state.errorSlot = -1;
      state.errorMessage = "";
      state.feedbackSequence += 1;
      render(deckPieces()[0]?.id || "");
    }

    function prepareRound(pieceCount = state.pieceCount) {
      cancelDrag();
      continuation.clear();
      cancelSpeech();
      waitingCampaign = false;
      transitionId += 1;
      const activeTransition = transitionId;
      clearRoundTimers();
      cancelArtworkLoad();
      transitioning = true;
      setRoundLoading(true);
      const begin = () => {
        if (activeTransition !== transitionId) return;
        startRound(pieceCount);
        waitForArtwork(() => {
          if (activeTransition !== transitionId || destroyed) return;
          transitioning = false;
          setRoundLoading(false);
          focusDeckPiece(deckPieces()[0]?.id || "");
        });
      };
      if (roundTasksCanRun()) begin();
      else scheduleRoundTask(begin, 0);
    }

    function waitForArtwork(ready) {
      let finished = false;
      let timeout;
      const cleanup = () => {
        cancelRoundTask(timeout);
        artwork.removeEventListener("load", loaded);
        artwork.removeEventListener("error", failed);
      };
      const finish = (visible) => {
        if (finished) return;
        finished = true;
        cleanup();
        const reveal = () => {
          artwork.hidden = !visible;
          ready();
        };
        if (roundTasksCanRun()) reveal();
        else scheduleRoundTask(reveal, 0);
      };
      const failed = () => finish(false);
      const loaded = () => {
        if (typeof artwork.decode === "function") artwork.decode().then(() => finish(true), failed);
        else finish(true);
      };
      cancelArtworkLoad = () => { finished = true; cleanup(); };
      artwork.hidden = false;
      artwork.addEventListener("load", loaded);
      artwork.addEventListener("error", failed);
      timeout = scheduleRoundTask(failed, 8000);
      if (!state.imagesEnabled) finish(true);
      else if (artwork.complete) {
        if (artwork.naturalWidth > 0) loaded();
        else failed();
      }
    }

    function eventDeckDomino(event) {
      return event.target.closest?.("[data-naturalization-piece-id]") || null;
    }

    listen(deck, "click", (event) => {
      const domino = eventDeckDomino(event);
      if (event.defaultPrevented || !domino || state.suppressClick) return;
      selectPiece(domino.dataset.naturalizationPieceId || "");
    });

    listen(deck, "keydown", (event) => {
      if (!canUseBoard() || ignoresBoardKey(event)) return;
      const domino = eventDeckDomino(event);
      if (!domino) return;
      if (event.key === "Escape" && (state.selectedPieceId || state.selectedSocketIndex >= 0)) {
        event.preventDefault();
        state.selectedPieceId = "";
        state.selectedSocketIndex = -1;
        state.feedbackSequence += 1;
        state.feedbackChallenge = null;
        render(domino.dataset.naturalizationPieceId || "");
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const buttons = [...deck.querySelectorAll("[data-naturalization-piece-id]")];
      const index = buttons.indexOf(domino);
      if (index < 0 || buttons.length < 2) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      buttons[(index + direction + buttons.length) % buttons.length].focus();
    });

    listen(deck, "dragstart", (event) => {
      const domino = eventDeckDomino(event);
      if (!canUseBoard() || !domino || solved()) { event.preventDefault(); return; }
      state.draggingPieceId = domino.dataset.naturalizationPieceId || "";
      domino.dataset.dragging = "true";
      board.dataset.tileSelected = "true";
      event.dataTransfer?.setData("text/plain", state.draggingPieceId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

    function eventSocketTarget(event) {
      return event.target.closest?.("[data-naturalization-socket-index]") || null;
    }

    listen(ring, "dragover", (event) => {
      const target = eventSocketTarget(event);
      if (!canUseBoard() || !target || !state.draggingPieceId || solved()) return;
      event.preventDefault();
      ring.querySelectorAll('[data-drop-target="true"]').forEach((node) => { node.dataset.dropTarget = "false"; });
      target.dataset.dropTarget = "true";
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });

    listen(ring, "dragleave", (event) => {
      const target = eventSocketTarget(event);
      if (!target || (event.relatedTarget && target.contains(event.relatedTarget))) return;
      target.dataset.dropTarget = "false";
    });

    listen(ring, "drop", (event) => {
      const target = eventSocketTarget(event);
      if (!canUseBoard() || !target || !state.draggingPieceId || solved()) { cancelDrag(); return; }
      event.preventDefault();
      const pieceId = state.draggingPieceId;
      const socketIndex = Number.parseInt(target.dataset.naturalizationSocketIndex || "", 10);
      state.suppressClick = true;
      state.draggingPieceId = "";
      target.dataset.dropTarget = "false";
      tryPlacement(pieceId, socketIndex);
      global.setTimeout(() => { state.suppressClick = false; }, 0);
    });

    listen(deck, "dragend", cancelDrag);
    listen(global, "blur", cancelDrag);

    listen(ring, "click", (event) => {
      if (event.defaultPrevented || !canUseBoard() || state.suppressClick) return;
      const review = event.target.closest?.("[data-naturalization-review-id]");
      if (review) {
        const challenge = catalog.challenges.find(({ id }) => id === review.dataset.naturalizationReviewId);
        if (!challenge) return;
        state.feedbackChallenge = challenge;
        state.feedbackRevealed = true;
        renderFeedback();
        speak(challenge);
        return;
      }
      const target = eventSocketTarget(event);
      if (!target) return;
      const socketIndex = Number.parseInt(target.dataset.naturalizationSocketIndex || "", 10);
      if (!state.selectedPieceId) {
        if (transitioning || solved() || state.placements[socketIndex]) return;
        state.selectedSocketIndex = state.selectedSocketIndex === socketIndex ? -1 : socketIndex;
        state.feedbackSequence += 1;
        state.feedbackChallenge = null;
        state.errorPieceId = "";
        state.errorSlot = -1;
        state.errorMessage = "";
        render();
        ring.querySelector(`[data-naturalization-socket-index="${socketIndex}"]`)?.focus();
        return;
      }
      tryPlacement(state.selectedPieceId, socketIndex);
    });

    listen(ring, "keydown", (event) => {
      if (!canUseBoard() || ignoresBoardKey(event)) return;
      if (event.key !== "Escape" || state.selectedSocketIndex < 0) return;
      event.preventDefault();
      const socketIndex = state.selectedSocketIndex;
      state.selectedSocketIndex = -1;
      state.feedbackSequence += 1;
      state.feedbackChallenge = null;
      render();
      ring.querySelector(`[data-naturalization-socket-index="${socketIndex}"]`)?.focus();
    });

    listen(feedbackSound, "click", () => speak(state.feedbackChallenge));
    listen(imageToggle, "click", toggleImage);
    syncImageControl();
    toolbarMenus.forEach((entry) => {
      listen(entry.toggle, "click", () => toggleToolbarMenu(entry));
      listen(entry.toggle, "keydown", (event) => {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        openToolbarMenu(entry);
        global.requestAnimationFrame?.(() => {
          entry.menu.querySelector("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus({ preventScroll: true });
        });
      });
      listen(entry.menu, "keydown", (event) => {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        if (event.key !== "Escape") return;
        event.preventDefault();
        closeToolbarMenu(entry, { restoreFocus: true });
      });
    });
    listen(audioSpeed, "input", (event) => {
      const option = audioSpeedOptions[Number(event.currentTarget.value)] || audioSpeedOptions[0];
      global.CaatuuChrome?.setSpeechPacePreference?.(option.key);
      syncAudioControls();
    });
    listen(audioSpeed, "change", () => {
      void previewAudio();
    });
    if (feedbackContext) listen(feedbackContext.play, "click", () => { void playContext(); });
    listen(displayMenu, "click", () => global.requestAnimationFrame?.(syncDisplayControls));
    listen(board.ownerDocument || global.document, "click", (event) => {
      if (!event.target.closest?.(".naturalization-nucleus-toolbar")) closeToolbarMenus();
    });
    countButtons.forEach((button) => {
      listen(button, "click", () => {
        const pieceCount = Number.parseInt(button.dataset.naturalizationPieceCount || "", 10);
        if (state.difficulty === 0 || !catalog.roundSettings.pieceCounts.includes(pieceCount)) return;
        closeToolbarMenu({ toggle: optionsToggle, menu: optionsMenu }, { restoreFocus: true });
        if (pieceCount === state.pieceCount) return;
        savePieceCount(root, catalog, pieceCount);
        prepareRound(pieceCount);
      });
    });
    if (typeof global.addEventListener === "function") {
      listen(global, "caatuu:learning-change", (event) => {
        if (event.detail?.reason !== "difficulty") return;
        const difficulty = currentLearningDifficulty();
        if (difficulty === state.difficulty) return;
        state.difficulty = difficulty;
        closeToolbarMenus();
        prepareRound(state.pieceCount);
      });
    }

    function inCampaign() {
      return global.document.body.dataset.campaignActive === "true";
    }
    prepareRound();
    const session = Object.freeze({
      catalog,
      setActive,
      advanceCampaignRound() {
        if (destroyed || !waitingCampaign || !solved()) return false;
        prepareRound();
        return true;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        continuation.destroy();
        continueButton.remove();
        cancelSpeech();
        transitionId += 1;
        clearRoundTimers();
        cancelArtworkLoad();
        transitioning = false;
        setRoundLoading(false);
        disposeLoading();
        closeToolbarMenus();
        listeners.splice(0).forEach((remove) => remove());
        if (mountedBoards.get(board) === session) mountedBoards.delete(board);
      }
    });
    mountedBoards.set(board, session);
    return session;
  }

  async function mount({ dataUrl = DEFAULT_DATA_URL, root = global.document, forceReload = false } = {}) {
    assert(root && typeof root.querySelector === "function", "mount root must support querySelector().");
    const status = root.querySelector("#naturalizationNucleusStatus");
    const ring = root.querySelector("#naturalizationNucleusRing");
    const deck = root.querySelector("#naturalizationNucleusDeck");
    const board = root.querySelector("#naturalizationNucleusBoard");
    assert(status, "#naturalizationNucleusStatus is required.");
    assert(ring, "#naturalizationNucleusRing is required.");
    assert(deck, "#naturalizationNucleusDeck is required.");
    assert(board, "#naturalizationNucleusBoard is required.");
    const existing = mountedBoards.get(board);
    if (existing && !forceReload) return existing.catalog;
    const pending = mountingBoards.get(board);
    if (pending && !forceReload) return pending;
    if (pending) {
      try {
        await pending;
      } catch (_error) {
        // A forced retry replaces a failed or completed pending mount below.
      }
    }
    const latest = mountedBoards.get(board);
    if (latest) {
      latest.destroy();
      mountedBoards.delete(board);
    }
    status.textContent = "";
    status.dataset.state = "loading";
    status.parentElement.hidden = true;
    ring.replaceChildren();
    deck.replaceChildren();
    const stage = root.querySelector(".naturalization-nucleus-stage");
    const interstitial = root.querySelector("#naturalizationNucleusInterstitial");
    const game = root.querySelector("#naturalizationNucleusGame");
    assert(stage && interstitial && game, "the loading shell is incomplete.");
    const documentRef = board.ownerDocument || global.document;
    stage.setAttribute("aria-busy", "true");
    interstitial.hidden = false;
    game.toggleAttribute("inert", true);
    game.setAttribute("aria-hidden", "true");
    let loadingScreen = null;
    let session = null;
    let disposed = false;
    let pageHidden = false;
    const listeners = [];
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler);
      listeners.push(() => target.removeEventListener(type, handler));
    };
    function isActive() {
      if (disposed || pageHidden || documentRef.visibilityState === "hidden" || !board.isConnected) return false;
      if (documentRef.body.hasAttribute("data-caatuu-practice-paused") || global.CaatuuGameDynamics?.active) return false;
      for (let ancestor = stage; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.hidden) return false;
      }
      return true;
    }
    function syncActivity() {
      const active = isActive();
      interstitial.dataset.active = String(active);
      loadingScreen?.setActive(active);
      session?.setActive(active);
    }
    const observer = typeof global.MutationObserver === "function" ? new global.MutationObserver(syncActivity) : null;
    for (let ancestor = stage; ancestor; ancestor = ancestor.parentElement) {
      observer?.observe(ancestor, { attributes: true, attributeFilter: ["hidden", "data-caatuu-practice-paused"] });
    }
    function disposeLoading() {
      if (disposed) return;
      disposed = true;
      syncActivity();
      loadingScreen?.destroy();
      interstitial.hidden = true;
      observer?.disconnect();
      listeners.splice(0).forEach((remove) => remove());
    }
    listen(documentRef, "visibilitychange", syncActivity);
    listen(global, "caatuu:game-dynamics-change", syncActivity);
    listen(global, "pagehide", (event) => {
      pageHidden = true;
      if (event.persisted) syncActivity();
      else if (session) session.destroy();
      else disposeLoading();
    });
    listen(global, "pageshow", () => { pageHidden = false; syncActivity(); });
    syncActivity();
    const mounting = (async () => {
      const { mountRobotLoadingScreen } = await import("/language-runtime/static/source/games/embedded-game-controls.mjs?v=embedded-game-controls-10");
      if (disposed) return null;
      loadingScreen = mountRobotLoadingScreen({ container: interstitial,
        label: global.CaatuuI18n?.t?.("verbnebula.round.preparing") || "Preparing a Naturalization Nucleus round",
        active: isActive() });
      loadingScreen.show();
      const catalog = await loadCatalog(requiredText(dataUrl, "mount.dataUrl", 500), Boolean(forceReload));
      const progression = await import("/language-runtime/static/source/games/adaptive-practice.mjs");
      const { createArabicReadingGuide: createReadingGuide } = catalog.notation
        ? await import("/language-runtime/static/source/arabic-reading-guide.mjs?v=arabic-reading-guide-2") : {};
      if (disposed) return null;
      session = createGame(root, catalog, { loadingScreen, isActive, disposeLoading, progression, createReadingGuide });
      return catalog;
    })();
    mountingBoards.set(board, mounting);
    try {
      return await mounting;
    } catch (error) {
      if (disposed) return null;
      disposeLoading();
      ring.replaceChildren();
      deck.replaceChildren();
      status.textContent = "The domino puzzle could not be loaded.";
      status.dataset.state = "error";
      status.parentElement.hidden = false;
      stage.setAttribute("aria-busy", "false");
      game.removeAttribute("inert");
      game.setAttribute("aria-hidden", "false");
      throw error;
    } finally {
      if (mountingBoards.get(board) === mounting) mountingBoards.delete(board);
    }
  }

  global.CaatuuNaturalizationNucleus = Object.freeze({
    mount,
    advanceCampaignRound({ root = global.document } = {}) {
      return mountedBoards.get(root.querySelector("#naturalizationNucleusBoard"))?.advanceCampaignRound() ?? false;
    },
    validateCatalog,
    createRound,
    filterChallengesForDifficulty,
    placeHanzi,
    countConnections,
    readingKey,
    seedChain,
    attachPiece,
    describeChain
  });
})(window);
