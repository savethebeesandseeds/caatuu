(function installNaturalizationNucleus(global) {
  "use strict";

  const DEFAULT_DATA_URL = "data/games/naturalization-nucleus/challenges.json";
  const EXPECTED_SCHEMA_URL = "https://caatuu.org/schemas/development/naturalization-nucleus.preview.v1.json";
  const STORAGE_KEY_SUFFIX = "naturalizationNucleus.pieceCount.v1";
  const SOLVED_HOLD_MILLIS = 420;
  const ROUND_LOADING_MILLIS = 1600;
  const ROBOT_KEYMAP_URL = "/assets/robots/keymap.json";
  const ROBOT_FALLBACK_URL = "/assets/robots/robot%20(1).png";
  const ROOT_KEYS = new Set([
    "$schema", "schemaVersion", "courseId", "gameId", "contentId", "title",
    "instructions", "roundSettings", "status", "derivedFrom", "review", "challenges"
  ]);
  const ROUND_SETTING_KEYS = new Set(["pieceCounts", "defaultPieceCount", "artwork"]);
  const REVIEW_KEYS = new Set(["status", "reviewer", "reviewedAt", "notes"]);
  const CHALLENGE_KEYS = new Set(["id", "hanzi", "pinyin", "tone", "translation", "sourceConceptIds", "difficulty"]);
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
  const SAFE_ROBOT_PATH = /^\/assets\/robots\/robot%20\(\d+\)\.png$/u;

  let catalogPromise = null;
  let robotPathsPromise = null;
  let robotCursor = -1;
  const mountedBoards = new WeakMap();
  const mountingBoards = new WeakMap();

  async function loadRobotPaths() {
    if (typeof global.fetch !== "function") return [];
    if (!robotPathsPromise) {
      robotPathsPromise = global.fetch(ROBOT_KEYMAP_URL, { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`Could not load robot keymap (${response.status}).`);
          return response.json();
        })
        .then((raw) => Object.keys(raw || {}).filter((path) => SAFE_ROBOT_PATH.test(path)))
        .catch(() => []);
    }
    return robotPathsPromise;
  }

  async function nextInterstitialRobot() {
    const paths = await loadRobotPaths();
    if (!paths.length) return ROBOT_FALLBACK_URL;
    let index = Math.floor(global.Math.random() * paths.length);
    if (paths.length > 1 && index === robotCursor) index = (index + 1) % paths.length;
    robotCursor = index;
    return paths[index];
  }

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
    return Number.isInteger(level) && level >= 1 && level <= 3 ? level : fallback;
  }

  function validateChallenge(value, index) {
    const label = `challenges[${index}]`;
    assert(isPlainObject(value), `${label} must be an object.`);
    assertExactKeys(value, CHALLENGE_KEYS, label);
    const id = requiredText(value.id, `${label}.id`, 80);
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
    const translation = requiredText(value.translation, `${label}.translation`, 80);
    assertLearnerSafe(translation, `${label}.translation`);
    assert(Object.hasOwn(value, "difficulty"), `${label}.difficulty is required.`);
    const difficulty = value.difficulty;
    assert(Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 3, `${label}.difficulty must be an integer from 1 to 3.`);
    assert(Array.isArray(value.sourceConceptIds) && value.sourceConceptIds.length > 0, `${label}.sourceConceptIds must be a non-empty array.`);
    const sourceConceptIds = value.sourceConceptIds.map((conceptId, conceptIndex) => (
      requiredText(conceptId, `${label}.sourceConceptIds[${conceptIndex}]`, 100)
    ));
    assert(new Set(sourceConceptIds).size === sourceConceptIds.length, `${label}.sourceConceptIds must be unique.`);
    return Object.freeze({
      id,
      hanzi,
      pinyin,
      tone: value.tone,
      translation,
      difficulty,
      sourceConceptIds: Object.freeze(sourceConceptIds)
    });
  }

  function readingKey(challenge) {
    return `${challenge.pinyin.normalize("NFC").toLowerCase()}:${challenge.tone}`;
  }

  function filterChallengesForDifficulty(challenges, difficulty) {
    const maximumDifficulty = normalizeDifficulty(difficulty, 1);
    return challenges.filter((challenge) => normalizeDifficulty(challenge?.difficulty, 1) <= maximumDifficulty);
  }

  function validateCatalog(value) {
    assert(isPlainObject(value), "catalog root must be an object.");
    assertExactKeys(value, ROOT_KEYS, "catalog root");
    assert(Object.hasOwn(value, "$schema"), "catalog root.$schema is required.");
    assert(value.$schema === EXPECTED_SCHEMA_URL, `catalog root.$schema must be ${EXPECTED_SCHEMA_URL}.`);
    assert(value.schemaVersion === 1, "schemaVersion must be 1.");
    assert(value.courseId === "zh", "courseId must be zh.");
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
    assert(value.challenges.length >= requiredCount && value.challenges.length <= 128, `challenges must contain ${requiredCount}-128 entries.`);
    const challenges = value.challenges.map(validateChallenge);
    assert(new Set(challenges.map(({ id }) => id)).size === challenges.length, "challenge ids must be unique.");
    assert(new Set(challenges.map(({ hanzi }) => hanzi)).size === challenges.length, "challenge Hanzi must be unique.");
    assert(new Set(challenges.map(readingKey)).size >= requiredCount, `challenges must provide at least ${requiredCount} distinct pinyin readings.`);
    for (let difficulty = 1; difficulty <= 3; difficulty += 1) {
      const eligible = filterChallengesForDifficulty(challenges, difficulty);
      assert(
        new Set(eligible.map(readingKey)).size >= requiredCount,
        `Level ${difficulty} must provide at least ${requiredCount} distinct pinyin readings.`
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

  function selectChallenges(challenges, pieceCount, random, difficulty = 3) {
    const selected = [];
    const readings = new Set();
    const eligible = filterChallengesForDifficulty(challenges, difficulty);
    for (const challenge of shuffled(eligible, random)) {
      const key = readingKey(challenge);
      if (readings.has(key)) continue;
      readings.add(key);
      selected.push(challenge);
      if (selected.length === pieceCount) break;
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

  function createRound(catalog, pieceCount, random = global.Math.random, previousArtworkSrc = "", difficulty = 3) {
    assert(catalog?.roundSettings?.pieceCounts?.includes(pieceCount), `piece count ${pieceCount} is not available.`);
    const normalizedDifficulty = normalizeDifficulty(difficulty, 1);
    const selected = selectChallenges(catalog.challenges, pieceCount, random, normalizedDifficulty);
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

  function makeText(documentRef, className, text, lang = "") {
    const node = documentRef.createElement("span");
    node.className = className;
    if (lang) node.lang = lang;
    node.textContent = text;
    return node;
  }

  function deckHanziTile(documentRef, piece, index, selected, dragging, invalid) {
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
    tile.setAttribute("aria-label", `Hanzi tile ${index + 1}: ${piece.left.hanzi}. Choose its matching pinyin.`);
    tile.append(makeText(
      documentRef,
      `naturalization-nucleus-domino-hanzi ${toneClass(piece.left.tone)}`,
      piece.left.hanzi,
      "zh-Hans"
    ));
    item.append(tile);
    return item;
  }

  function placedDeckWell(documentRef, piece, index) {
    const item = documentRef.createElement("div");
    item.className = "naturalization-nucleus-deck-item";
    item.dataset.state = "placed";
    item.setAttribute("role", "listitem");
    item.setAttribute("aria-label", `Hanzi tile ${index + 1} has been matched.`);
    item.dataset.naturalizationPlacedPieceId = piece.id;
    return item;
  }

  function pinyinSocketTarget(documentRef, index, challenge) {
    const target = documentRef.createElement("button");
    target.type = "button";
    target.className = "naturalization-nucleus-socket-target";
    target.dataset.naturalizationSocketIndex = String(index);
    target.dataset.naturalizationChallengeId = challenge.id;
    target.setAttribute("aria-label", `Pinyin ${challenge.pinyin}. Choose the matching Hanzi.`);
    target.append(makeText(documentRef, "naturalization-nucleus-socket-pinyin", challenge.pinyin, "zh-Latn-pinyin"));
    return target;
  }

  function fusedWord(documentRef, challenge, isNew) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "naturalization-nucleus-fused-word";
    button.dataset.naturalizationReviewId = challenge.id;
    button.dataset.new = String(isNew);
    button.setAttribute("aria-label", `${challenge.hanzi}, ${challenge.pinyin}, ${challenge.translation}. Play again.`);
    button.append(
      makeText(documentRef, "naturalization-nucleus-fused-pinyin", challenge.pinyin, "zh-Latn-pinyin"),
      makeText(documentRef, `naturalization-nucleus-fused-hanzi ${toneClass(challenge.tone)}`, challenge.hanzi, "zh-Hans")
    );
    return button;
  }

  function orbitSocket(documentRef, index, challenge, placedPiece, newMatchSlots, errorSlot) {
    const item = documentRef.createElement("li");
    item.className = "naturalization-nucleus-socket";
    item.dataset.socketIndex = String(index);
    item.dataset.invalid = String(errorSlot === index);
    if (placedPiece) {
      item.dataset.socketState = "matched";
      item.append(fusedWord(documentRef, challenge, newMatchSlots.includes(index)));
    } else {
      item.dataset.socketState = "empty";
      item.append(pinyinSocketTarget(documentRef, index, challenge));
    }
    return item;
  }

  function createGame(root, catalog) {
    const stage = root.querySelector(".naturalization-nucleus-stage");
    const game = root.querySelector("#naturalizationNucleusGame");
    const interstitial = root.querySelector("#naturalizationNucleusInterstitial");
    const interstitialRobot = root.querySelector("#naturalizationNucleusInterstitialRobot");
    const board = root.querySelector("#naturalizationNucleusBoard");
    const ring = root.querySelector("#naturalizationNucleusRing");
    const deck = root.querySelector("#naturalizationNucleusDeck");
    const artwork = root.querySelector("#naturalizationNucleusArtwork");
    const status = root.querySelector("#naturalizationNucleusStatus");
    const newRound = root.querySelector("#naturalizationNucleusNewRound");
    const pieceCount = root.querySelector("#naturalizationNucleusPieceCount");
    const displayToggle = root.querySelector("#naturalizationNucleusDisplayToggle");
    const displayMenu = root.querySelector("#naturalizationNucleusDisplayMenu");
    const audioToggle = root.querySelector("#naturalizationNucleusSound");
    const audioMenu = root.querySelector("#naturalizationNucleusAudioMenu");
    const optionsToggle = root.querySelector("#naturalizationNucleusOptionsToggle");
    const optionsMenu = root.querySelector("#naturalizationNucleusOptionsMenu");
    const audioSpeed = root.querySelector("#naturalizationNucleusAudioSpeed");
    const audioVoice = root.querySelector("#naturalizationNucleusAudioVoice");
    const audioVoiceStatus = root.querySelector("#naturalizationNucleusAudioVoiceStatus");
    const feedback = root.querySelector("#naturalizationNucleusFeedback");
    const feedbackPinyin = root.querySelector("#naturalizationNucleusFeedbackPinyin");
    const feedbackHanzi = root.querySelector("#naturalizationNucleusFeedbackHanzi");
    const feedbackReading = root.querySelector("#naturalizationNucleusFeedbackReading");
    const feedbackGlyph = feedbackHanzi?.querySelector(".word-net-target-text-glyph");
    const feedbackMeaning = root.querySelector("#naturalizationNucleusFeedbackMeaning");
    const feedbackSound = root.querySelector("#naturalizationNucleusFeedbackSound");
    const countButtons = [...root.querySelectorAll("[data-naturalization-piece-count]")];
    assert(
      stage && game && interstitial && interstitialRobot && board && ring && deck && artwork && status && newRound && pieceCount
      && displayToggle && displayMenu && audioToggle && audioMenu && optionsToggle && optionsMenu
      && audioSpeed && audioVoice && audioVoiceStatus
      && feedback && feedbackPinyin && feedbackHanzi && feedbackReading && feedbackGlyph && feedbackMeaning && feedbackSound,
      "the game shell is incomplete."
    );
    assert(countButtons.length === catalog.roundSettings.pieceCounts.length, "the piece-count controls do not match the catalog.");

    mountedBoards.get(board)?.destroy();
    const listeners = [];
    let errorTimer = 0;
    let transitionId = 0;
    let transitioning = false;
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
    const state = {
      pieceCount: storedPieceCount(root, catalog),
      difficulty: currentLearningDifficulty(),
      round: null,
      placements: [],
      selectedPieceId: "",
      draggingPieceId: "",
      suppressClick: false,
      feedbackChallenge: null,
      newMatchSlots: [],
      errorPieceId: "",
      errorSlot: -1,
      errorMessage: "",
      feedbackSequence: 0
    };

    listen(interstitialRobot, "error", () => {
      if (interstitialRobot.getAttribute("src") !== ROBOT_FALLBACK_URL) interstitialRobot.src = ROBOT_FALLBACK_URL;
    });

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
      const label = `Mandarin audio settings. Current: ${option.label} speed.`;
      audioToggle.setAttribute("aria-label", label);
      audioToggle.title = label;
    }

    async function refreshAudioVoiceOptions() {
      const api = global.CaatuuChrome;
      if (!api?.listSpeechVoiceOptions) return;
      audioVoice.disabled = true;
      audioVoiceStatus.textContent = "Checking Mandarin voices...";
      try {
        const result = api.getSpeechVoiceControlState
          ? await api.getSpeechVoiceControlState()
          : await api.listSpeechVoiceOptions();
        const documentRef = board.ownerDocument || global.document;
        const automatic = documentRef.createElement("option");
        automatic.value = "";
        automatic.textContent = "Automatic (recommended)";
        const options = [automatic];
        for (const voice of result?.voices || []) {
          const option = documentRef.createElement("option");
          option.value = voice.value || "";
          option.textContent = `${voice.name}${voice.locale ? ` · ${voice.locale}` : ""}`;
          options.push(option);
        }
        audioVoice.replaceChildren(...options);
        const preferred = api.getSpeechVoicePreference?.() || "";
        const matching = [...audioVoice.options].find((option) => (
          option.value === preferred || option.value.endsWith(`:${preferred}`)
        ));
        audioVoice.value = matching?.value || "";
        audioVoice.disabled = result?.available === false && !(result?.voices || []).length;
        audioVoiceStatus.textContent = api.describeSpeechVoiceState
          ? api.describeSpeechVoiceState(result)
          : (result?.available ? "Mandarin voice ready." : "Mandarin voice unavailable.");
      } catch (_error) {
        audioVoice.disabled = true;
        audioVoiceStatus.textContent = "Unable to check Mandarin voices.";
      }
    }

    function closeToolbarMenu(entry, { restoreFocus = false } = {}) {
      global.CaatuuChrome?.releaseToolbarPopover?.(entry.menu);
      entry.menu.hidden = true;
      entry.toggle.setAttribute("aria-expanded", "false");
      if (restoreFocus) entry.toggle.focus({ preventScroll: true });
    }

    function closeToolbarMenus(exceptMenu = null) {
      toolbarMenus.forEach((entry) => {
        if (entry.menu !== exceptMenu) closeToolbarMenu(entry);
      });
    }

    function openToolbarMenu(entry) {
      closeToolbarMenus(entry.menu);
      if (entry.menu === displayMenu) syncDisplayControls();
      if (entry.menu === audioMenu) {
        syncAudioControls();
        void refreshAudioVoiceOptions();
      }
      entry.menu.hidden = false;
      entry.toggle.setAttribute("aria-expanded", "true");
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

    function clearRoundTimers() {
      roundTimers.forEach((timer) => global.clearTimeout(timer));
      roundTimers.clear();
    }

    function scheduleRoundTask(callback, delay) {
      const timer = global.setTimeout(() => {
        roundTimers.delete(timer);
        callback();
      }, delay);
      roundTimers.add(timer);
      return timer;
    }

    function setRoundLoading(active) {
      interstitial.hidden = !active;
      stage.setAttribute("aria-busy", String(active));
      game.toggleAttribute("inert", active);
      game.setAttribute("aria-hidden", String(active));
    }

    function focusDeckPiece(pieceId) {
      if (!pieceId || solved()) return;
      global.requestAnimationFrame?.(() => {
        [...deck.querySelectorAll("[data-naturalization-piece-id]")]
          .find((button) => button.dataset.naturalizationPieceId === pieceId)?.focus();
      });
    }

    function renderFeedback() {
      const challenge = state.feedbackChallenge;
      feedback.hidden = !challenge;
      if (!challenge) return;
      feedbackPinyin.textContent = challenge.pinyin;
      feedbackGlyph.textContent = challenge.hanzi;
      feedbackReading.dataset.tone = String(challenge.tone);
      feedbackHanzi.setAttribute("aria-label", `${challenge.hanzi}, ${challenge.pinyin}`);
      feedbackMeaning.textContent = challenge.translation;
      const playLabel = `Play ${challenge.hanzi}, ${challenge.pinyin}.`;
      feedbackSound.setAttribute("aria-label", playLabel);
      feedbackSound.title = playLabel;
    }

    function render(focusPieceId = "") {
      const documentRef = board.ownerDocument || global.document;
      const targets = socketTargets();
      const isSolved = solved();
      const available = deckPieces();
      ring.replaceChildren(...targets.map((challenge, index) => (
        orbitSocket(
          documentRef,
          index,
          challenge,
          pieceForId(state.placements[index]),
          state.newMatchSlots,
          state.errorSlot
        )
      )));
      const availableIds = new Set(available.map(({ id }) => id));
      deck.replaceChildren(...state.round.pieces.map((piece, index) => (
        availableIds.has(piece.id)
          ? deckHanziTile(
            documentRef,
            piece,
            index,
            state.selectedPieceId === piece.id,
            state.draggingPieceId === piece.id,
            state.errorPieceId === piece.id
          )
          : placedDeckWell(documentRef, piece, index)
      )));
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
        status.textContent = "Orbit complete — every Hanzi has found its pinyin.";
        status.dataset.state = "solved";
      } else if (state.selectedPieceId) {
        const piece = pieceForId(state.selectedPieceId);
        status.textContent = `Selected ${piece.left.hanzi}. Choose its matching pinyin on the orbit.`;
        status.dataset.state = "ready";
      } else if (state.placements.some(Boolean)) {
        status.textContent = `${state.placements.filter(Boolean).length} of ${state.pieceCount} matches complete. Choose another Hanzi.`;
        status.dataset.state = "ready";
      } else {
        status.textContent = "Choose a Hanzi, then choose its matching pinyin.";
        status.dataset.state = "ready";
      }
      pieceCount.textContent = String(state.pieceCount);
      optionsToggle.setAttribute("aria-label", `Hanzi tile settings. Current: ${state.pieceCount} tiles.`);
      countButtons.forEach((button) => {
        const selected = Number.parseInt(button.dataset.naturalizationPieceCount || "", 10) === state.pieceCount;
        button.setAttribute("aria-checked", String(selected));
      });
      renderFeedback();
      focusDeckPiece(focusPieceId);
    }

    function speak(challenge) {
      if (!challenge) return Promise.resolve();
      const speakText = global.CaatuuChrome?.speakText;
      if (typeof speakText !== "function") return Promise.resolve();
      return Promise.resolve(speakText(challenge.hanzi)).catch(() => {
        // Visual feedback remains useful when speech is unavailable.
      });
    }

    function previewAudio() {
      if (state.feedbackChallenge) return speak(state.feedbackChallenge);
      return Promise.resolve(global.CaatuuChrome?.previewSpeech?.()).catch(() => {
        // The controls remain usable when this device has no Mandarin voice.
      });
    }

    async function announceMatches(matches) {
      const sequence = state.feedbackSequence + 1;
      state.feedbackSequence = sequence;
      for (const challenge of matches) {
        if (state.feedbackSequence !== sequence) return;
        state.feedbackChallenge = challenge;
        renderFeedback();
        await speak(challenge);
      }
    }

    function acceptPlacement(transition) {
      global.clearTimeout(errorTimer);
      state.placements = [...transition.placements];
      state.selectedPieceId = "";
      state.errorPieceId = "";
      state.errorSlot = -1;
      state.errorMessage = "";
      state.newMatchSlots = [...transition.matchSlots];
      state.feedbackChallenge = transition.matches[0] || null;
      const nextPieceId = deckPieces()[0]?.id || "";
      render(nextPieceId);
      void announceMatches(transition.matches);
      if (transition.solved) {
        global.CaatuuLearning?.record?.("naturalization-nucleus", {
          activities: 1,
          attempts: 1,
          successes: 1,
          xp: 1,
          rounds: 1
        });
        prepareRound(state.pieceCount, { holdMillis: SOLVED_HOLD_MILLIS });
      }
    }

    function rejectPlacement(pieceId, socketIndex, message) {
      global.clearTimeout(errorTimer);
      state.errorPieceId = pieceId;
      state.errorSlot = socketIndex;
      state.errorMessage = message;
      state.newMatchSlots = [];
      render(pieceId);
      errorTimer = global.setTimeout(() => {
        state.errorPieceId = "";
        state.errorSlot = -1;
        state.errorMessage = "";
        render(pieceId);
      }, 900);
    }

    function selectPiece(pieceId) {
      const piece = pieceForId(pieceId);
      if (!piece || transitioning || solved() || state.placements.includes(piece.id)) return;
      global.clearTimeout(errorTimer);
      state.selectedPieceId = state.selectedPieceId === piece.id ? "" : piece.id;
      state.errorPieceId = "";
      state.errorSlot = -1;
      state.errorMessage = "";
      state.newMatchSlots = [];
      render(piece.id);
    }

    function tryPlacement(pieceId, socketIndex) {
      const piece = pieceForId(pieceId);
      if (!piece || transitioning || solved() || state.placements.includes(piece.id)) return;
      if (!Number.isInteger(socketIndex) || socketIndex < 0 || socketIndex >= state.pieceCount) return;
      if (state.placements[socketIndex]) {
        rejectPlacement(piece.id, socketIndex, "That pinyin already has its Hanzi. Choose another position.");
        return;
      }
      const transition = placeHanzi(state.placements, piece, socketTargets(), socketIndex);
      if (transition) {
        acceptPlacement(transition);
      } else {
        rejectPlacement(piece.id, socketIndex, "That Hanzi does not match this pinyin. Try another position.");
      }
    }

    function startRound(pieceCount = state.pieceCount) {
      global.clearTimeout(errorTimer);
      const previousArtworkSrc = state.round?.artworkSrc || "";
      state.pieceCount = pieceCount;
      state.round = createRound(catalog, pieceCount, global.Math.random, previousArtworkSrc, state.difficulty);
      state.placements = Array.from({ length: pieceCount }, () => "");
      state.selectedPieceId = "";
      state.draggingPieceId = "";
      state.feedbackChallenge = null;
      state.newMatchSlots = [];
      state.errorPieceId = "";
      state.errorSlot = -1;
      state.errorMessage = "";
      state.feedbackSequence += 1;
      render(deckPieces()[0]?.id || "");
    }

    function prepareRound(pieceCount = state.pieceCount, { holdMillis = 0 } = {}) {
      transitionId += 1;
      const activeTransition = transitionId;
      clearRoundTimers();
      transitioning = true;
      const showInterstitial = () => {
        if (activeTransition !== transitionId) return;
        interstitialRobot.src = ROBOT_FALLBACK_URL;
        setRoundLoading(true);
        void nextInterstitialRobot().then((path) => {
          if (activeTransition !== transitionId || interstitial.hidden) return;
          if (interstitialRobot.getAttribute("src") !== path) interstitialRobot.src = path;
        });
        scheduleRoundTask(() => {
          if (activeTransition !== transitionId) return;
          startRound(pieceCount);
          transitioning = false;
          setRoundLoading(false);
        }, ROUND_LOADING_MILLIS);
      };
      if (holdMillis > 0) scheduleRoundTask(showInterstitial, holdMillis);
      else showInterstitial();
    }

    function eventDeckDomino(event) {
      return event.target.closest?.("[data-naturalization-piece-id]") || null;
    }

    listen(deck, "click", (event) => {
      const domino = eventDeckDomino(event);
      if (!domino || state.suppressClick) return;
      selectPiece(domino.dataset.naturalizationPieceId || "");
    });

    listen(deck, "keydown", (event) => {
      const domino = eventDeckDomino(event);
      if (!domino) return;
      if (event.key === "Escape" && state.selectedPieceId) {
        event.preventDefault();
        state.selectedPieceId = "";
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
      if (!domino) return;
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
      if (!target || !state.draggingPieceId || solved()) return;
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
      if (!target || !state.draggingPieceId || solved()) return;
      event.preventDefault();
      const pieceId = state.draggingPieceId;
      const socketIndex = Number.parseInt(target.dataset.naturalizationSocketIndex || "", 10);
      state.suppressClick = true;
      state.draggingPieceId = "";
      target.dataset.dropTarget = "false";
      tryPlacement(pieceId, socketIndex);
      global.setTimeout(() => { state.suppressClick = false; }, 0);
    });

    listen(deck, "dragend", () => {
      state.draggingPieceId = "";
      ring.querySelectorAll("[data-drop-target]").forEach((node) => node.removeAttribute("data-drop-target"));
      deck.querySelectorAll("[data-dragging]").forEach((node) => node.removeAttribute("data-dragging"));
      board.dataset.tileSelected = String(Boolean(state.selectedPieceId));
    });

    listen(ring, "click", (event) => {
      const review = event.target.closest?.("[data-naturalization-review-id]");
      if (review) {
        const challenge = catalog.challenges.find(({ id }) => id === review.dataset.naturalizationReviewId);
        if (!challenge) return;
        state.feedbackChallenge = challenge;
        renderFeedback();
        speak(challenge);
        return;
      }
      const target = eventSocketTarget(event);
      if (!target) return;
      const socketIndex = Number.parseInt(target.dataset.naturalizationSocketIndex || "", 10);
      if (!state.selectedPieceId) {
        rejectPlacement("", socketIndex, "Choose a Hanzi tile first, then choose its pinyin.");
        return;
      }
      tryPlacement(state.selectedPieceId, socketIndex);
    });

    listen(feedbackSound, "click", () => speak(state.feedbackChallenge));
    listen(newRound, "click", () => {
      closeToolbarMenus();
      prepareRound();
    });
    toolbarMenus.forEach((entry) => {
      listen(entry.toggle, "click", () => toggleToolbarMenu(entry));
      listen(entry.toggle, "keydown", (event) => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        openToolbarMenu(entry);
        global.requestAnimationFrame?.(() => {
          entry.menu.querySelector("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus({ preventScroll: true });
        });
      });
      listen(entry.menu, "keydown", (event) => {
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
    listen(audioVoice, "change", () => {
      global.CaatuuChrome?.setSpeechVoicePreference?.(audioVoice.value);
      void previewAudio();
    });
    listen(displayMenu, "click", () => global.requestAnimationFrame?.(syncDisplayControls));
    listen(board.ownerDocument || global.document, "click", (event) => {
      if (!event.target.closest?.(".naturalization-nucleus-toolbar")) closeToolbarMenus();
    });
    countButtons.forEach((button) => {
      listen(button, "click", () => {
        const pieceCount = Number.parseInt(button.dataset.naturalizationPieceCount || "", 10);
        if (!catalog.roundSettings.pieceCounts.includes(pieceCount)) return;
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

    prepareRound();
    const session = Object.freeze({
      catalog,
      destroy() {
        global.clearTimeout(errorTimer);
        transitionId += 1;
        clearRoundTimers();
        transitioning = false;
        setRoundLoading(false);
        closeToolbarMenus();
        listeners.splice(0).forEach((remove) => remove());
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
    status.textContent = "Preparing the Hanzi and pinyin puzzle…";
    status.dataset.state = "loading";
    ring.replaceChildren();
    deck.replaceChildren();
    root.querySelector(".naturalization-nucleus-stage")?.setAttribute("aria-busy", "true");
    const mounting = (async () => {
      const catalog = await loadCatalog(requiredText(dataUrl, "mount.dataUrl", 500), Boolean(forceReload));
      createGame(root, catalog);
      return catalog;
    })();
    mountingBoards.set(board, mounting);
    try {
      return await mounting;
    } catch (error) {
      ring.replaceChildren();
      deck.replaceChildren();
      status.textContent = "The domino puzzle could not be loaded.";
      status.dataset.state = "error";
      root.querySelector(".naturalization-nucleus-stage")?.setAttribute("aria-busy", "false");
      const interstitial = root.querySelector("#naturalizationNucleusInterstitial");
      const game = root.querySelector("#naturalizationNucleusGame");
      if (interstitial) interstitial.hidden = true;
      if (game) {
        game.removeAttribute("inert");
        game.setAttribute("aria-hidden", "false");
      }
      throw error;
    } finally {
      if (mountingBoards.get(board) === mounting) mountingBoards.delete(board);
    }
  }

  global.CaatuuNaturalizationNucleus = Object.freeze({
    mount,
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
