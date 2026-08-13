import fs from "node:fs/promises";
import path from "node:path";

export const LEARNER_CONTENT_SAFETY_POLICY_VERSION = "caatuu-child-content-safety-v2";

export const SHIPPED_LEARNER_CONTENT_SOURCES = Object.freeze([
  Object.freeze({
    id: "agreement-aurora",
    file: "apps/languages/czech/static/data/games/agreement-aurora/challenges.json",
  }),
  Object.freeze({
    id: "case-cosmos",
    file: "apps/languages/czech/static/data/games/case-cosmos/challenges.json",
  }),
  Object.freeze({
    id: "conjugation-comet",
    file: "apps/languages/czech/static/data/games/conjugation-comet/verbs.json",
  }),
  Object.freeze({
    id: "verb-nebula",
    file: "apps/languages/czech/static/data/games/verb-nebula/core-vocabulary.json",
  }),
  Object.freeze({
    id: "word-world",
    file: "apps/languages/czech/static/data/games/word-world/standard-v0.1/records.json",
  }),
  Object.freeze({
    id: "language-scripts",
    file: "apps/languages/czech/static/data/language/scripts.json",
  }),
]);

export const SHIPPED_NON_LEARNER_GAME_JSON = Object.freeze([
  "apps/languages/czech/static/data/games/word-world/manifest.json",
]);

const TOKEN_RULES = Object.freeze([
  Object.freeze({
    id: "blocked.adult-substances.alcohol",
    severity: "block",
    category: "adult-substances",
    message: "Alcohol-related learner content is not allowed for the child release.",
    patterns: Object.freeze({
      en: /^(?:alcohol|beer|champagne|cocktail|gin|rum|tequila|vodka|whisk(?:e)?y|wine)$/u,
      cs: /^(?:alkohol|alkoholem|alkoholu|gin|ginu|koktejl|koktejlu|piva|pivem|pivo|pivu|pivě|rum|rumu|tequila|tequilu|tequily|vína|vínem|víno|vínu|víně|vodka|vodkou|vodku|vodky|whisky|šampaňské)$/u,
    }),
  }),
  Object.freeze({
    id: "blocked.adult-substances.tobacco",
    severity: "block",
    category: "adult-substances",
    message: "Tobacco and vaping learner content is not allowed for the child release.",
    patterns: Object.freeze({
      en: /^(?:cigar|cigarette|smoking|tobacco|vape|vaping)$/u,
      cs: /^(?:cigaret|cigareta|cigaretu|cigarety|doutník|doutníku|kouření|tabák|tabáku|vapování)$/u,
    }),
  }),
  Object.freeze({
    id: "blocked.adult-substances.illicit-drugs",
    severity: "block",
    category: "adult-substances",
    message: "Illicit-drug learner content is not allowed for the child release.",
    patterns: Object.freeze({
      en: /^(?:cannabis|cocaine|drugs?|ecstasy|heroin|marijuana|meth|methamphetamine)$/u,
      cs: /^(?:droga|drogami|drogy|drogách|extáze|heroin|heroinu|kokain|kokainu|konopí|marihuana|marihuany|metamfetamin|pervitin|pervitinu)$/u,
    }),
  }),
  Object.freeze({
    id: "blocked.sexual-content",
    severity: "block",
    category: "sexual-content",
    message: "Explicit sexual learner content is not allowed for the child release.",
    patterns: Object.freeze({
      en: /^(?:condom|genitals?|naked|nude|orgasm|penis|porn|pornographic|pornography|rape|raped|rapist|sex|sexual|vagina)$/u,
      cs: /^(?:kondom|kondomu|nahá|nahé|nahý|orgasmus|orgasmu|penis|penisu|porno|pornografie|sex|sexuální|vagína|vagíny|znásilnění)$/u,
    }),
  }),
  Object.freeze({
    id: "blocked.profanity",
    severity: "block",
    category: "profanity",
    message: "Profanity or degrading insults are not allowed in learner content.",
    patterns: Object.freeze({
      en: /^(?:asshole|assholes|bastard|bastards|bitch|bitches|bullshit|fuck|fucked|fucker|fuckers|fucking|fucks|motherfucker|motherfuckers|shit|shitty)$/u,
      cs: /^(?:hajzl|hajzla|hajzle|kokot|kokota|kokote|kurva|kurvy|kurvo|píča|píči|píčo|prdel|sračka|sračky|zmrd|zmrda|zmrde)$/u,
    }),
  }),
  Object.freeze({
    id: "blocked.self-harm",
    severity: "block",
    category: "self-harm",
    message: "Self-harm or suicide learner content is not allowed for the child release.",
    patterns: Object.freeze({
      en: /^(?:suicidal|suicide)$/u,
      cs: /^(?:sebevražda|sebevraždy|sebevraždě|sebevražedný|sebevražedná|sebevražedné)$/u,
    }),
  }),
  Object.freeze({
    id: "blocked.graphic-hazard",
    severity: "block",
    category: "graphic-hazard",
    message: "Graphic violence or fatal-harm learner content is not allowed for the child release.",
    patterns: Object.freeze({
      en: /^(?:behead|beheaded|corpse|corpses|gore|kill|killed|killing|kills|murder|murdered|murderer|slaughter|slaughtered)$/u,
      cs: /^(?:bezhlavý|bezhlavá|mrtvola|mrtvolu|mrtvoly|vražda|vraždil|vraždila|vraždy|vrah|vraha|zabije|zabijí|zabíjet|zabíjí|zabil|zabila|zabili|zabít)$/u,
    }),
  }),
  Object.freeze({
    id: "blocked.weapon-hazard",
    severity: "block",
    category: "graphic-hazard",
    message: "Weapon learner content requires removal from the child release.",
    patterns: Object.freeze({
      en: /^(?:bomb|firearm|grenade|gun|pistol|rifle)$/u,
      cs: /^(?:bomba|bombu|bomby|granát|granátu|pistole|pistoli|puška|pušku|pušky|střelná|zbraň|zbraně|zbraní)$/u,
    }),
  }),
  Object.freeze({
    id: "review.medical-blood",
    severity: "review",
    category: "potentially-distressing",
    message: "Blood-related content needs an explicit age-appropriateness decision.",
    patterns: Object.freeze({
      en: /^(?:blood|bloody)$/u,
      cs: /^(?:krev|krve|krví|krvavá|krvavé|krvavý)$/u,
    }),
  }),
  Object.freeze({
    id: "review.graphic-medical-detail",
    severity: "review",
    category: "potentially-distressing",
    message: "Graphic or intimate medical detail needs an explicit age-appropriateness decision.",
    patterns: Object.freeze({
      en: /^(?:diarrhea|fracture|injuries|injury|vomit|vomiting|wound|wounds)$/u,
      cs: /^(?:průjem|průjmu|rána|ránu|rány|zlomenina|zlomeninu|zlomeniny|zranění|zvracení|zvracím)$/u,
    }),
  }),
  Object.freeze({
    id: "review.accident",
    severity: "review",
    category: "potentially-distressing",
    message: "Accident-related content needs an explicit age-appropriateness decision.",
    patterns: Object.freeze({
      en: /^(?:accident|accidents)$/u,
      cs: /^(?:nehoda|nehodou|nehodu|nehody|nehodě)$/u,
    }),
  }),
]);

const PHRASE_RULES = Object.freeze([
  Object.freeze({
    id: "blocked.self-harm.intent",
    severity: "block",
    category: "self-harm",
    message: "A self-harm intent phrase is not allowed for the child release.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? includesAnySequence(tokens, [
        ["zabiju", "se"],
        ["zabít", "se"],
        ["ublížím", "si"],
        ["ublížit", "si"],
      ])
      : includesAnySequence(tokens, [
        ["kill", "myself"],
        ["hurt", "myself"],
        ["harm", "myself"],
        ["self", "harm"],
      ]),
  }),
  Object.freeze({
    id: "blocked.edged-weapon-violence",
    severity: "block",
    category: "graphic-hazard",
    message: "Edged-weapon violence is not allowed for the child release.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? edgedWeaponViolenceCs(tokens)
      : edgedWeaponViolenceEn(tokens),
  }),
  Object.freeze({
    id: "review.edged-weapon-reference",
    severity: "review",
    category: "potentially-distressing",
    message: "A knife or medically ambiguous stabbing reference needs an explicit age-appropriateness decision.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? edgedWeaponNeedsReviewCs(tokens)
      : edgedWeaponNeedsReviewEn(tokens),
  }),
  Object.freeze({
    id: "blocked.shooting-violence",
    severity: "block",
    category: "graphic-hazard",
    message: "Shooting violence is not allowed for the child release.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? shootingViolenceCs(tokens)
      : shootingViolenceEn(tokens),
  }),
  Object.freeze({
    id: "review.ambiguous-shooting",
    severity: "review",
    category: "potentially-distressing",
    message: "An ambiguous shoot or shot reference needs an explicit age-appropriateness decision.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? shootingReferenceNeedsReviewCs(tokens)
      : shootingReferenceNeedsReviewEn(tokens),
  }),
  Object.freeze({
    id: "blocked.severe-death-reference",
    severity: "block",
    category: "graphic-hazard",
    message: "A violent or graphic death reference is not allowed for the child release.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? severeDeathReferenceCs(tokens)
      : severeDeathReferenceEn(tokens),
  }),
  Object.freeze({
    id: "review.death-reference",
    severity: "review",
    category: "potentially-distressing",
    message: "A death reference needs an explicit age-appropriateness decision.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? deathReferenceNeedsReviewCs(tokens)
      : deathReferenceNeedsReviewEn(tokens),
  }),
  Object.freeze({
    id: "blocked.credential-solicitation",
    severity: "block",
    category: "credential-solicitation",
    message: "Direct requests for a learner's password, passcode, or PIN are not allowed.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? credentialSolicitationCs(tokens)
      : credentialSolicitationEn(tokens),
  }),
  Object.freeze({
    id: "blocked.personal-data-solicitation",
    severity: "block",
    category: "personal-data-solicitation",
    message: "Direct requests for a learner's identifying or contact information are not allowed.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? personalDataSolicitationCs(tokens)
      : personalDataSolicitationEn(tokens),
  }),
  Object.freeze({
    id: "review.ambiguous-first-person-balls",
    severity: "review",
    category: "ambiguous-wording",
    message: "This isolated first-person possession phrase has an avoidable sexual double meaning.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? ambiguousFirstPersonBallsCs(tokens)
      : ambiguousFirstPersonBallsEn(tokens),
  }),
  Object.freeze({
    id: "review.adult-venue-bar",
    severity: "review",
    category: "adult-venue",
    message: "An adult bar setting needs an explicit age-appropriateness decision.",
    locales: Object.freeze(["en", "cs"]),
    matches: ({ locale, tokens }) => locale === "cs"
      ? includesAnySequence(tokens, [["jsem", "v", "baru"], ["jdeme", "do", "baru"], ["jdu", "do", "baru"]])
      : includesAnySequence(tokens, [["i", "am", "in", "a", "bar"], ["i", "am", "at", "a", "bar"], ["we", "are", "at", "a", "bar"]]),
  }),
]);

export function normalizeSafetyText(value, locale = "und") {
  const language = locale === "cs" ? "cs-CZ" : locale === "en" ? "en-US" : "und";
  return String(value ?? "")
    .normalize("NFC")
    .toLocaleLowerCase(language)
    .replace(/[’‘`´]/gu, "'")
    .replace(/[^\p{L}\p{M}\p{N}']+/gu, " ")
    .replace(/^'+|'+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function safetyTokens(value, locale = "und") {
  return normalizeSafetyText(value, locale)
    .match(/[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu) || [];
}

export function inspectLearnerField(field) {
  const normalized = normalizeSafetyText(field?.text, field?.locale);
  const tokens = safetyTokens(normalized, field?.locale);
  if (!normalized) return [];
  const findings = [];
  for (const rule of TOKEN_RULES) {
    const patterns = relevantPatterns(rule.patterns, field?.locale);
    if (!tokens.some((token) => patterns.some((pattern) => pattern.test(token)))) continue;
    findings.push(toFinding(field, rule, normalized));
  }
  for (const rule of PHRASE_RULES) {
    const locales = field?.locale === "und" ? rule.locales : [field?.locale];
    if (!locales.some((locale) => rule.locales.includes(locale) && rule.matches({ locale, normalized, tokens }))) continue;
    findings.push(toFinding(field, rule, normalized));
  }
  return findings;
}

export function inspectLearnerFields(fields) {
  return fields
    .flatMap(inspectLearnerField)
    .sort((left, right) => (
      left.file.localeCompare(right.file)
      || left.contentId.localeCompare(right.contentId)
      || left.field.localeCompare(right.field)
      || left.ruleId.localeCompare(right.ruleId)
    ));
}

export function extractLearnerContent(sourceId, value, file = sourceForId(sourceId).file) {
  switch (sourceId) {
    case "agreement-aurora": return extractAgreement(value, file);
    case "case-cosmos": return extractCases(value, file);
    case "conjugation-comet": return extractConjugation(value, file);
    case "verb-nebula": return extractVocabulary(value, file);
    case "word-world": return extractWordWorld(value, file);
    case "language-scripts": return extractScripts(value, file);
    default: throw new Error(`Unsupported learner-content source: ${sourceId}`);
  }
}

export async function assertRegisteredGameJsonCoverage(repoRoot) {
  const gamesRoot = path.join(repoRoot, "apps", "languages", "czech", "static", "data", "games");
  const discovered = (await findJsonFiles(gamesRoot))
    .map((file) => slash(path.relative(repoRoot, file)))
    .sort();
  const registered = SHIPPED_LEARNER_CONTENT_SOURCES
    .filter((source) => source.file.includes("/data/games/"))
    .map((source) => source.file);
  const accountedFor = new Set([...registered, ...SHIPPED_NON_LEARNER_GAME_JSON]);
  const unregistered = discovered.filter((file) => !accountedFor.has(file));
  const missing = [...accountedFor].filter((file) => !discovered.includes(file));
  if (unregistered.length || missing.length) {
    throw new Error([
      ...unregistered.map((file) => `Unregistered shipped game JSON: ${file}`),
      ...missing.map((file) => `Registered shipped game JSON is missing: ${file}`),
    ].join("\n"));
  }
  return { discovered, registered: [...registered].sort(), nonLearner: [...SHIPPED_NON_LEARNER_GAME_JSON] };
}

export async function scanShippedLearnerContent(repoRoot) {
  await assertRegisteredGameJsonCoverage(repoRoot);
  const files = [];
  const allFields = [];
  for (const source of SHIPPED_LEARNER_CONTENT_SOURCES) {
    const absoluteFile = path.join(repoRoot, ...source.file.split("/"));
    const value = await readJson(absoluteFile, source.file);
    const extracted = extractLearnerContent(source.id, value, source.file);
    files.push({
      sourceId: source.id,
      file: source.file,
      recordCount: extracted.recordCount,
      fieldCount: extracted.fields.length,
    });
    allFields.push(...extracted.fields);
  }
  const findings = inspectLearnerFields(allFields);
  return {
    schemaVersion: "caatuu-learner-content-safety-report-v1",
    policyVersion: LEARNER_CONTENT_SAFETY_POLICY_VERSION,
    valid: findings.length === 0,
    files,
    scannedRecords: files.reduce((total, file) => total + file.recordCount, 0),
    scannedFields: allFields.length,
    findingCounts: {
      block: findings.filter((finding) => finding.severity === "block").length,
      review: findings.filter((finding) => finding.severity === "review").length,
    },
    findings,
    limitation: "Passing means no deterministic policy finding. It does not replace bilingual human child-safety and pedagogical review.",
  };
}

function extractAgreement(value, file) {
  const rows = expectArray(value, file);
  const fields = [];
  const genders = ["masculine", "feminine", "neuter"];
  rows.forEach((row, rowIndex) => {
    expectObject(row, `${file}/${rowIndex}`);
    const contentId = `agreement:${requiredText(row.adjective, `${file}/${rowIndex}/adjective`)}`;
    addField(fields, { file, contentId, field: pointer(rowIndex, "adjective"), locale: "cs", text: row.adjective });
    expectObject(row.forms, `${file}/${rowIndex}/forms`);
    for (const gender of genders) {
      const form = expectObject(row.forms[gender], `${file}/${rowIndex}/forms/${gender}`);
      addField(fields, { file, contentId, field: pointer(rowIndex, "forms", gender, "form"), locale: "cs", text: form.form });
      expectArray(form.examples, `${file}/${rowIndex}/forms/${gender}/examples`).forEach((example, exampleIndex) => {
        expectObject(example, `${file}/${rowIndex}/forms/${gender}/examples/${exampleIndex}`);
        addField(fields, { file, contentId, field: pointer(rowIndex, "forms", gender, "examples", exampleIndex, "english"), locale: "en", text: example.english });
        addField(fields, { file, contentId, field: pointer(rowIndex, "forms", gender, "examples", exampleIndex, "czech"), locale: "cs", text: example.czech });
      });
    }
  });
  return { fields, recordCount: rows.length };
}

function extractCases(value, file) {
  const rows = expectArray(value, file);
  const fields = [];
  const cases = ["Nominative", "Genitive", "Dative", "Accusative", "Vocative", "Locative", "Instrumental"];
  rows.forEach((row, rowIndex) => {
    expectObject(row, `${file}/${rowIndex}`);
    const contentId = `case:${requiredText(row.noun, `${file}/${rowIndex}/noun`)}`;
    addField(fields, { file, contentId, field: pointer(rowIndex, "noun"), locale: "cs", text: row.noun });
    expectObject(row.cases, `${file}/${rowIndex}/cases`);
    for (const caseName of cases) {
      const example = expectObject(row.cases[caseName], `${file}/${rowIndex}/cases/${caseName}`);
      for (const [name, locale] of [["form", "cs"], ["english", "en"], ["czech", "cs"]]) {
        addField(fields, { file, contentId, field: pointer(rowIndex, "cases", caseName, name), locale, text: example[name] });
      }
    }
  });
  return { fields, recordCount: rows.length };
}

function extractConjugation(value, file) {
  const pack = expectObject(value, file);
  const rows = expectArray(pack.verbs, `${file}/verbs`);
  const fields = [];
  rows.forEach((row, rowIndex) => {
    expectObject(row, `${file}/verbs/${rowIndex}`);
    const contentId = `conjugation:${requiredText(row.verb, `${file}/verbs/${rowIndex}/verb`)}`;
    for (const [name, locale] of [["verb", "cs"], ["meaning", "en"], ["hint", "en"]]) {
      addField(fields, { file, contentId, field: pointer("verbs", rowIndex, name), locale, text: row[name] });
    }
    expectArray(row.forms, `${file}/verbs/${rowIndex}/forms`).forEach((form, formIndex) => {
      expectObject(form, `${file}/verbs/${rowIndex}/forms/${formIndex}`);
      addField(fields, { file, contentId, field: pointer("verbs", rowIndex, "forms", formIndex, "form"), locale: "cs", text: form.form });
      addField(fields, { file, contentId, field: pointer("verbs", rowIndex, "forms", formIndex, "cue"), locale: "en", text: form.cue });
      if (form.accepted !== undefined) {
        expectArray(form.accepted, `${file}/verbs/${rowIndex}/forms/${formIndex}/accepted`).forEach((accepted, acceptedIndex) => {
          addField(fields, { file, contentId, field: pointer("verbs", rowIndex, "forms", formIndex, "accepted", acceptedIndex), locale: "cs", text: accepted });
        });
      }
    });
  });
  return { fields, recordCount: rows.length };
}

function extractVocabulary(value, file) {
  const rows = expectArray(value, file);
  const fields = [];
  rows.forEach((row, rowIndex) => {
    expectObject(row, `${file}/${rowIndex}`);
    const label = typeof row.cs === "string" && row.cs.trim() ? row.cs.trim() : `row-${rowIndex + 1}`;
    const contentId = `vocabulary:${rowIndex + 1}:${label}`;
    for (const [name, locale] of [["cat", "en"], ["cs", "cs"], ["en", "en"], ["kind", "und"], ["cue", "und"], ["use", "cs"]]) {
      if (row[name] !== undefined) addField(fields, { file, contentId, field: pointer(rowIndex, name), locale, text: row[name] });
    }
  });
  return { fields, recordCount: rows.length };
}

function extractWordWorld(value, file) {
  const pack = expectObject(value, file);
  const rows = expectArray(pack.records, `${file}/records`);
  const fields = [];
  rows.forEach((row, rowIndex) => {
    expectObject(row, `${file}/records/${rowIndex}`);
    const contentId = requiredText(row.id, `${file}/records/${rowIndex}/id`);
    for (const [name, locale] of [["cs", "cs"], ["en", "en"], ["sceneQuery", "en"]]) {
      addField(fields, { file, contentId, field: pointer("records", rowIndex, name), locale, text: row[name] });
    }
    expectArray(row.enAlternates, `${file}/records/${rowIndex}/enAlternates`).forEach((alternate, alternateIndex) => {
      addField(fields, { file, contentId, field: pointer("records", rowIndex, "enAlternates", alternateIndex), locale: "en", text: alternate });
    });
  });
  return { fields, recordCount: rows.length };
}

function extractScripts(value, file) {
  const rows = expectArray(value, file);
  const fields = [];
  rows.forEach((row, rowIndex) => {
    expectObject(row, `${file}/${rowIndex}`);
    const contentId = `script:${rowIndex + 1}:${requiredText(row.title, `${file}/${rowIndex}/title`)}`;
    addField(fields, { file, contentId, field: pointer(rowIndex, "title"), locale: "en", text: row.title });
    addField(fields, { file, contentId, field: pointer(rowIndex, "goal"), locale: "en", text: row.goal });
    expectArray(row.lines, `${file}/${rowIndex}/lines`).forEach((line, lineIndex) => {
      expectObject(line, `${file}/${rowIndex}/lines/${lineIndex}`);
      addField(fields, { file, contentId, field: pointer(rowIndex, "lines", lineIndex, "cs"), locale: "cs", text: line.cs });
      addField(fields, { file, contentId, field: pointer(rowIndex, "lines", lineIndex, "en"), locale: "en", text: line.en });
    });
  });
  return { fields, recordCount: rows.length };
}

function relevantPatterns(patterns, locale) {
  if (locale === "en" || locale === "cs") return patterns[locale] ? [patterns[locale]] : [];
  return Object.values(patterns);
}

function toFinding(field, rule, normalized) {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    category: rule.category,
    file: String(field.file || ""),
    contentId: String(field.contentId || ""),
    field: String(field.field || ""),
    locale: field.locale === "cs" || field.locale === "en" ? field.locale : "und",
    text: String(field.text || "").normalize("NFC"),
    normalized,
    message: rule.message,
  };
}

function edgedWeaponViolenceEn(tokens) {
  if (hasAnyToken(tokens, ["sword", "swords"])) return true;

  const stabWords = new Set(["stab", "stabbed", "stabbing", "stabs"]);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!stabWords.has(tokens[index])) continue;
    if (isStabIdiomEn(tokens, index) || isMedicalStabbingEn(tokens, index)) continue;
    return true;
  }

  if (!hasAnyToken(tokens, ["knife", "knives"])) return false;
  if (hasAnyToken(tokens, ["attack", "attacked", "attacking", "harm", "harmed", "hurt", "kill", "killed", "murder", "murdered", "slash", "slashed", "threaten", "threatened", "threatening", "wound", "wounded"])) return true;
  return hasAnyToken(tokens, ["cut", "cuts", "cutting"])
    && hasAnyToken(tokens, ["animal", "animals", "boy", "boys", "cat", "cats", "child", "children", "dog", "dogs", "girl", "girls", "her", "him", "me", "people", "person", "them", "us", "woman", "women", "you"]);
}

function edgedWeaponNeedsReviewEn(tokens) {
  if (edgedWeaponViolenceEn(tokens)) return false;
  const stabWords = new Set(["stab", "stabbed", "stabbing", "stabs"]);
  for (let index = 0; index < tokens.length; index += 1) {
    if (stabWords.has(tokens[index]) && isMedicalStabbingEn(tokens, index)) return true;
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (!["knife", "knives"].includes(tokens[index])) continue;
    if (!hasNearbyToken(tokens, index, 3, ["butter", "cutlery", "fork", "plastic", "table", "utensil", "utensils"])) return true;
  }
  return false;
}

function edgedWeaponViolenceCs(tokens) {
  if (hasAnyToken(tokens, ["me\u010d", "me\u010de", "me\u010dem", "me\u010di"])) return true;
  if (hasAnyToken(tokens, ["bodl", "bodla", "bodli", "bodnout", "bodnut\u00ed", "probodl", "probodla", "probodli", "probodnout"])) return true;
  if (!hasAnyToken(tokens, ["n\u016f\u017e", "no\u017ee", "no\u017eem", "no\u017ei"])) return false;
  if (hasAnyToken(tokens, ["napadl", "napadla", "ubl\u00ed\u017eil", "ubl\u00ed\u017eila", "zabil", "zabila", "zab\u00edt", "zranil", "zranila", "vyhro\u017eoval", "vyhro\u017eovala"])) return true;
  return hasAnyToken(tokens, ["\u0159\u00edzl", "\u0159\u00edzla", "\u0159\u00edznout"])
    && hasAnyToken(tokens, ["chlapce", "chlapci", "d\u00edvku", "d\u00edvce", "d\u00edt\u011b", "d\u011bti", "ho", "ji", "ko\u010dku", "mu\u017ee", "osobu", "psa", "tebe", "\u017eenu"]);
}

function edgedWeaponNeedsReviewCs(tokens) {
  if (edgedWeaponViolenceCs(tokens)) return false;
  for (let index = 0; index < tokens.length; index += 1) {
    if (!["n\u016f\u017e", "no\u017ee", "no\u017eem", "no\u017ei"].includes(tokens[index])) continue;
    if (!hasNearbyToken(tokens, index, 3, ["j\u00eddeln\u00ed", "m\u00e1slov\u00fd", "plastov\u00fd", "p\u0159\u00edbor", "p\u0159\u00edborov\u00fd", "vidli\u010dka", "vidli\u010dku", "vidli\u010dkou"])) return true;
  }
  return false;
}

function isStabIdiomEn(tokens, index) {
  if (tokens[index] !== "stab" || tokens[index + 1] !== "at") return false;
  return ["take", "takes", "taking", "took"].includes(tokens[index - 2]) && tokens[index - 1] === "a";
}

function isMedicalStabbingEn(tokens, index) {
  return tokens[index] === "stabbing" && ["ache", "pain", "pains", "sensation"].includes(tokens[index + 1]);
}

function shootingViolenceEn(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isShootWordEn(tokens[index])) continue;
    if (isDirectShootingViolenceEn(tokens, index)) return true;
  }
  return false;
}

function shootingReferenceNeedsReviewEn(tokens) {
  if (shootingViolenceEn(tokens)) return false;
  for (let index = 0; index < tokens.length; index += 1) {
    if (isShootWordEn(tokens[index]) && !isBenignShootSenseEn(tokens, index)) return true;
  }
  return false;
}

function isDirectShootingViolenceEn(tokens, index) {
  const targets = [
    "animal", "animals", "bear", "bears", "bird", "birds", "boy", "boys", "cat", "cats", "child", "children", "cow", "cows", "deer", "dog", "dogs", "duck", "ducks", "girl", "girls", "her", "herself", "him", "himself", "horse", "horses", "man", "me", "myself", "ourselves", "people", "person", "rabbit", "rabbits", "them", "themselves", "us", "woman", "women", "you", "yourself",
  ];
  if (hasNearbyToken(tokens, index, 4, ["death", "dead", "firearm", "gun", "kill", "killed", "pistol", "rifle"])) return true;
  if (hasDirectTargetAfter(tokens, index, targets)) {
    return !hasNearbyToken(tokens, index, 4, ["camera", "film", "photo", "photograph", "picture", "portrait", "video"]);
  }
  return ["was", "were", "got", "gets", "been"].includes(tokens[index - 1])
    && !hasBackwardToken(tokens, index, 4, ["film", "movie", "photo", "scene", "video"]);
}

function isBenignShootSenseEn(tokens, index) {
  if (includesAnySequence(tokens, [
    ["give", "it", "a", "shot"],
    ["gave", "it", "a", "shot"],
    ["giving", "it", "a", "shot"],
    ["worth", "a", "shot"],
    ["shoot", "the", "breeze"],
  ])) return true;
  if (tokens[index] === "shooting" && ["star", "stars"].includes(tokens[index + 1])) return true;
  if (["shoot", "shoots"].includes(tokens[index]) && tokens[index - 1] === "bamboo") return true;
  return hasNearbyToken(tokens, index, 4, [
    "ball", "basket", "basketball", "camera", "court", "field", "film", "football", "goal", "hockey", "hoop", "movie", "net", "photo", "photograph", "picture", "portrait", "puck", "scene", "soccer", "sport", "sports", "video",
  ]);
}

function isShootWordEn(token) {
  return ["shoot", "shooting", "shoots", "shot", "shots"].includes(token);
}

function shootingViolenceCs(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isShootWordCs(tokens[index])) continue;
    if (hasNearbyToken(tokens, index, 4, ["pistole", "pu\u0161ka", "pu\u0161kou", "smrt", "smrti", "zabil", "zabila", "zab\u00edt", "zbra\u0148", "zbran\u00ed"])) return true;
    if (hasDirectTargetAfter(tokens, index, ["chlapce", "d\u00edvku", "d\u00edt\u011b", "ho", "ji", "jelena", "kachnu", "ko\u010dku", "kon\u011b", "kr\u00e1l\u00edka", "lidech", "mu\u017ee", "n\u00e1s", "osobu", "psa", "pt\u00e1ka", "se", "tebe", "zv\u00ed\u0159ata", "zv\u00ed\u0159e", "\u017eenu"])) return true;
  }
  return false;
}

function shootingReferenceNeedsReviewCs(tokens) {
  if (shootingViolenceCs(tokens)) return false;
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isShootWordCs(tokens[index])) continue;
    if (!hasNearbyToken(tokens, index, 4, ["basketbal", "branka", "branku", "fotbal", "g\u00f3l", "hokej", "ko\u0161", "m\u00ed\u010d", "sport"])) return true;
  }
  return false;
}

function isShootWordCs(token) {
  return [
    "st\u0159elba", "st\u0159elby", "st\u0159elil", "st\u0159elila", "st\u0159elili", "st\u0159elit", "st\u0159elen\u00e1", "st\u0159elen\u00e9", "st\u0159elen\u00fd", "st\u0159\u00edlel", "st\u0159\u00edlela", "st\u0159\u00edleli", "st\u0159\u00edlet", "st\u0159\u00edl\u00ed",
  ].includes(token);
}

function severeDeathReferenceEn(tokens) {
  return includesAnySequence(tokens, [
    ["dead", "body"],
    ["dead", "bodies"],
    ["death", "threat"],
    ["death", "threats"],
    ["found", "dead"],
    ["shot", "dead"],
    ["to", "death"],
  ]);
}

function deathReferenceNeedsReviewEn(tokens) {
  if (severeDeathReferenceEn(tokens)) return false;
  for (let index = 0; index < tokens.length; index += 1) {
    if (["death", "deaths", "deadly"].includes(tokens[index])) return true;
    if (tokens[index] !== "dead") continue;
    if (!isBenignDeadSenseEn(tokens, index)) return true;
  }
  return false;
}

function isBenignDeadSenseEn(tokens, index) {
  if (hasNearbyToken(tokens, index, 1, ["batteries", "battery", "center", "centre", "end", "ends", "heat", "language", "languages", "link", "links", "signal", "tired"])) return true;
  if (!["are", "is", "seems", "went"].includes(tokens[index - 1])) return false;
  return ["batteries", "battery", "device", "devices", "laptop", "link", "links", "phone", "phones", "signal", "tablet"].includes(tokens[index - 2]);
}

function severeDeathReferenceCs(tokens) {
  return includesAnySequence(tokens, [
    ["mrtv\u00e9", "t\u011blo"],
    ["mrtv\u00e1", "t\u011bla"],
    ["nalezen", "mrtv\u00fd"],
    ["nalezena", "mrtv\u00e1"],
    ["k", "smrti"],
    ["v\u00fdhr\u016f\u017eka", "smrt\u00ed"],
  ]);
}

function deathReferenceNeedsReviewCs(tokens) {
  if (severeDeathReferenceCs(tokens)) return false;
  const references = ["mrtv\u00e1", "mrtv\u00e9", "mrtv\u00ed", "mrtv\u00fd", "smrt", "smrti", "smrt\u00ed", "smrteln\u00e1", "smrteln\u00e9", "smrteln\u00fd"];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!references.includes(tokens[index])) continue;
    if (["mrtv\u00e1", "mrtv\u00e9", "mrtv\u00fd"].includes(tokens[index]) && hasNearbyToken(tokens, index, 1, ["baterie", "bod", "jazyk"])) continue;
    return true;
  }
  return false;
}

function hasAnyToken(tokens, candidates) {
  const expected = new Set(candidates);
  return tokens.some((token) => expected.has(token));
}

function hasNearbyToken(tokens, index, distance, candidates) {
  return hasBackwardToken(tokens, index, distance, candidates) || hasForwardToken(tokens, index, distance, candidates);
}

function hasBackwardToken(tokens, index, distance, candidates) {
  const expected = new Set(candidates);
  for (let cursor = Math.max(0, index - distance); cursor < index; cursor += 1) {
    if (expected.has(tokens[cursor])) return true;
  }
  return false;
}

function hasForwardToken(tokens, index, distance, candidates) {
  const expected = new Set(candidates);
  for (let cursor = index + 1; cursor <= Math.min(tokens.length - 1, index + distance); cursor += 1) {
    if (expected.has(tokens[cursor])) return true;
  }
  return false;
}

function hasDirectTargetAfter(tokens, index, candidates) {
  const expected = new Set(candidates);
  if (expected.has(tokens[index + 1])) return true;
  if (["a", "an", "the", "at", "do", "na", "po", "toho", "tu", "ty"].includes(tokens[index + 1])) {
    return expected.has(tokens[index + 2]);
  }
  return false;
}

function credentialSolicitationEn(tokens) {
  const credentials = new Set(["password", "passcode", "pin"]);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "what" && tokens[index + 1] === "is" && ["the", "your"].includes(tokens[index + 2]) && credentials.has(tokens[index + 3])) return true;
    if (tokens[index] === "what's" && ["the", "your"].includes(tokens[index + 1]) && credentials.has(tokens[index + 2])) return true;
    if (["tell", "give", "send", "show"].includes(tokens[index]) && !isNegated(tokens, index) && tokens[index + 1] === "me" && ["the", "your"].includes(tokens[index + 2]) && credentials.has(tokens[index + 3])) return true;
    if (["enter", "share", "type"].includes(tokens[index]) && !isNegated(tokens, index) && ["the", "your"].includes(tokens[index + 1]) && credentials.has(tokens[index + 2])) return true;
  }
  return false;
}

function credentialSolicitationCs(tokens) {
  const credentials = new Set(["heslo", "pin", "kód"]);
  const possessives = new Set(["tvoje", "tvůj", "svoje", "své", "svůj", "vaše", "váš"]);
  for (let index = 0; index < tokens.length; index += 1) {
    if (["jaké", "jaký"].includes(tokens[index]) && tokens[index + 1] === "je" && credentials.has(tokens[index + 2])) return true;
    if (["jaké", "jaký"].includes(tokens[index]) && tokens[index + 1] === "je" && possessives.has(tokens[index + 2]) && credentials.has(tokens[index + 3])) return true;
    if (["řekni", "dej", "pošli", "ukaž"].includes(tokens[index]) && tokens[index + 1] === "mi" && possessives.has(tokens[index + 2]) && credentials.has(tokens[index + 3])) return true;
    if (["zadej", "sdílej", "napiš"].includes(tokens[index]) && possessives.has(tokens[index + 1]) && credentials.has(tokens[index + 2])) return true;
  }
  return false;
}

function personalDataSolicitationEn(tokens) {
  if (includesAnySequence(tokens, [
    ["what", "is", "your", "name"],
    ["what", "is", "your", "surname"],
    ["what", "is", "your", "address"],
    ["what", "is", "your", "email", "address"],
    ["what", "is", "your", "phone", "number"],
    ["what", "is", "your", "date", "of", "birth"],
    ["spell", "your", "name"],
    ["spell", "your", "surname"],
    ["write", "your", "name"],
    ["share", "your", "location"],
  ])) return true;
  return includesAnySequence(tokens, ["tell", "give", "send", "show", "write", "share"].flatMap((verb) => [
    [verb, "me", "your", "address"],
    [verb, "me", "your", "email"],
    [verb, "me", "your", "phone", "number"],
  ]));
}

function personalDataSolicitationCs(tokens) {
  return includesAnySequence(tokens, [
    ["jak", "se", "jmenuješ"],
    ["jaké", "je", "tvoje", "jméno"],
    ["jaké", "je", "vaše", "jméno"],
    ["jaké", "je", "tvoje", "bydliště"],
    ["jaké", "je", "vaše", "bydliště"],
    ["napiš", "své", "jméno"],
    ["napiš", "svoje", "jméno"],
    ["napiš", "telefonní", "číslo"],
    ["vyhláskovat", "své", "příjmení"],
    ["sdílej", "svou", "polohu"],
    ["sdílej", "svoji", "polohu"],
  ]) || tokens.some((token, index) => (
    ["napiš", "napište", "vyhláskuj", "vyhláskujte"].includes(token)
    && ["své", "svoje", "tvoje", "vaše"].includes(tokens[index + 1])
    && ["jméno", "příjmení"].includes(tokens[index + 2])
  ));
}

function ambiguousFirstPersonBallsEn(tokens) {
  const sportsContext = new Set(["baseball", "basketball", "football", "game", "games", "juggle", "juggling", "play", "practice", "soccer", "sport", "sports", "tennis", "toy", "toys"]);
  if (tokens.some((token) => sportsContext.has(token))) return false;
  return tokens.some((token, index) => (
    token === "i"
    && ["have", "hold", "own", "carry"].includes(tokens[index + 1])
    && isPluralNumber(tokens[index + 2], "en")
    && tokens[index + 3] === "balls"
  ));
}

function ambiguousFirstPersonBallsCs(tokens) {
  const sportsContext = new Set(["fotbal", "fotbalu", "hra", "hry", "hrát", "míčová", "míčové", "sport", "sportovní", "tenis", "tenisu", "trénink", "tréninku", "žonglovat"]);
  if (tokens.some((token) => sportsContext.has(token))) return false;
  return tokens.some((token, index) => (
    ["mám", "nesu", "vlastním"].includes(token)
    && isPluralNumber(tokens[index + 1], "cs")
    && ["míče", "koule"].includes(tokens[index + 2])
  ));
}

function isPluralNumber(token, locale) {
  if (/^[2-9][0-9]*$/u.test(token)) return true;
  return locale === "cs"
    ? ["dva", "dvě", "tři", "čtyři", "pět"].includes(token)
    : ["two", "three", "four", "five"].includes(token);
}

function includesAnySequence(tokens, sequences) {
  return sequences.some((sequence) => {
    if (sequence.length > tokens.length) return false;
    for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
      if (sequence.every((token, index) => tokens[start + index] === token)) return true;
    }
    return false;
  });
}

function isNegated(tokens, index) {
  return [tokens[index - 2], tokens[index - 1]].some((token) => ["don't", "never", "no", "not"].includes(token));
}

function addField(fields, field) {
  if (typeof field.text !== "string") throw new Error(`${field.file}${field.field}: expected text`);
  fields.push({ ...field, text: field.text.normalize("NFC") });
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}: expected non-empty text`);
  return value.trim().normalize("NFC");
}

function expectArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array`);
  return value;
}

function expectObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected an object`);
  return value;
}

function pointer(...parts) {
  return `/${parts.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function sourceForId(sourceId) {
  const source = SHIPPED_LEARNER_CONTENT_SOURCES.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Unsupported learner-content source: ${sourceId}`);
  return source;
}

async function findJsonFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findJsonFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
  }
  return files;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function slash(value) {
  return value.replaceAll("\\", "/");
}
