import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGREEMENT_AURORA_SCHEMA_VERSION,
  agreementAuroraPairMatches,
  agreementAuroraRoundComplete,
  buildAgreementAuroraRounds,
  derangeAgreementAuroraMatches,
  normalizeAgreementAuroraPack,
  validateAgreementAuroraPack
} from "../static/source/games/agreement-aurora/agreement-aurora-core.mjs";
import {
  focusAgreementAuroraElement
} from "../static/source/games/agreement-aurora/agreement-aurora-host.mjs";

const spanishCatalogUrl = new URL(
  "../../languages/spanish/static/data/games/agreement-aurora/challenges.json",
  import.meta.url
);
const czechCatalogUrl = new URL(
  "../../languages/czech/static/data/games/agreement-aurora/challenges.json",
  import.meta.url
);

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("the Spanish pilot declares four language-owned agreement axes and explicit English audit text", async () => {
  const document = await json(spanishCatalogUrl);
  const pack = normalizeAgreementAuroraPack(document, {
    courseId: "es",
    learnerBaseLanguage: "en",
    targetLanguage: "es-ES",
    targetLabel: "Spanish"
  });

  assert.equal(pack.schemaVersion, AGREEMENT_AURORA_SCHEMA_VERSION);
  assert.equal(pack.review.status, "native-review-required");
  assert.equal(pack.license.status, "release-review-required");
  assert.deepEqual(pack.axes.map(({ id }) => id), [
    "masculine-singular",
    "feminine-singular",
    "masculine-plural",
    "feminine-plural"
  ]);
  assert.equal(pack.challenges.length, 8);
  assert.ok(Object.isFrozen(pack));

  const challengeIds = new Set();
  const exampleIds = new Set();
  for (const challenge of pack.challenges) {
    assert.equal(challengeIds.has(challenge.id), false);
    challengeIds.add(challenge.id);
    assert.ok(Number.isInteger(challenge.revision));
    for (const axis of pack.axes) {
      const form = challenge.forms[axis.id];
      assert.ok(form, `${challenge.id} is missing ${axis.id}`);
      for (const example of form.examples) {
        assert.equal(exampleIds.has(example.id), false);
        exampleIds.add(example.id);
        assert.equal(example.learnerBaseText, example.englishAuditText);
        assert.ok(example.targetText.includes(form.displayForm));
      }
    }
  }
  assert.ok(
    pack.challenges.some(({ id }) => id === "es.agreement.determiner-definite-surprises"),
    "the pilot must include misleading Spanish noun genders"
  );
});

test("difficulty tiers select only complete authored phrases and never generate a morphology product", async () => {
  const pack = validateAgreementAuroraPack(await json(spanishCatalogUrl), {
    courseId: "es",
    learnerBaseLanguage: "en",
    targetLanguage: "es-ES"
  });
  const explorer = buildAgreementAuroraRounds(pack, 1, () => 0);
  const traveler = buildAgreementAuroraRounds(pack, 2, () => 0);
  const navigator = buildAgreementAuroraRounds(pack, 3, () => 0);

  assert.deepEqual([explorer.length, traveler.length, navigator.length], [3, 6, 8]);
  for (const round of navigator) {
    assert.equal(round.matches.length, pack.axes.length);
    const challenge = pack.challenges.find(({ id }) => id === round.id);
    for (const match of round.matches) {
      assert.ok(
        challenge.forms[match.axisId].examples.some((example) => (
          example.id === match.id
          && example.targetText === match.targetText
          && example.learnerBaseText === match.learnerBaseText
        )),
        `${match.id} must remain one intact authored phrase pair`
      );
      assert.equal("englishAuditText" in match, false, "audit-only text must not enter the renderable round");
    }
  }
});

test("matching uses stable example IDs and target cards are deranged", async () => {
  const pack = normalizeAgreementAuroraPack(await json(spanishCatalogUrl), {
    courseId: "es",
    learnerBaseLanguage: "en",
    targetLanguage: "es-ES",
    targetLabel: "Spanish"
  });
  const [round] = buildAgreementAuroraRounds(pack, 1, () => 0);
  const targets = derangeAgreementAuroraMatches(round.matches, () => 0);
  assert.ok(targets.every((match, index) => match.id !== round.matches[index].id));
  assert.equal(agreementAuroraPairMatches(round.matches[0].id, targets[0].id), false);
  assert.equal(agreementAuroraPairMatches(round.matches[0].id, round.matches[0].id), true);
  assert.equal(agreementAuroraRoundComplete(round.matches, round.matches.map(({ id }) => id)), true);
  assert.equal(agreementAuroraRoundComplete(round.matches, [round.matches[0].id]), false);
});

test("the compatibility normalizer admits the unchanged Czech authored list without teaching the renderer Czech", async () => {
  const legacy = await json(czechCatalogUrl);
  const pack = normalizeAgreementAuroraPack(legacy, {
    courseId: "cz",
    learnerBaseLanguage: "en",
    targetLanguage: "cs-CZ",
    targetLabel: "Czech"
  });
  assert.equal(pack.contentId, "cz.agreement-aurora.legacy-v1");
  assert.deepEqual(pack.axes.map(({ id }) => id), Object.keys(legacy[0].forms));
  assert.equal(pack.challenges.length, legacy.length);
  assert.equal(pack.challenges[0].forms.masculine.examples[0].targetText, legacy[0].forms.masculine.examples[0].czech);
  assert.equal(pack.challenges[0].forms.masculine.examples[0].englishAuditText, legacy[0].forms.masculine.examples[0].english);
});

test("legacy array content is rejected outside the exact Czech English-base migration", async () => {
  const legacy = await json(czechCatalogUrl);
  assert.throws(
    () => normalizeAgreementAuroraPack(legacy, {
      courseId: "future-course",
      learnerBaseLanguage: "en",
      targetLanguage: "de-DE",
      targetLabel: "German"
    }),
    /confined to the Czech English-base migration/u
  );
  assert.throws(
    () => normalizeAgreementAuroraPack(legacy, {
      courseId: "cz",
      learnerBaseLanguage: "fr-FR",
      targetLanguage: "cs-CZ",
      targetLabel: "Czech"
    }),
    /confined to the Czech English-base migration/u
  );
});

test("the shared host consumes only projected game authority and contains no course-specific agreement inventory", async () => {
  const [host, html] = await Promise.all([
    readFile(new URL("../static/source/games/agreement-aurora/agreement-aurora-host.mjs", import.meta.url), "utf8"),
    readFile(new URL("../static/games/agreement-aurora.html", import.meta.url), "utf8")
  ]);
  assert.match(host, /fetchDeclaredCourseGameJson/u);
  assert.match(host, /agreementAuroraCatalog/u);
  assert.match(host, /CaatuuLearning/u);
  assert.match(host, /round-success/u);
  assert.doesNotMatch(host, /englishAuditText/u);
  assert.doesNotMatch(host, /(?:Choose one|Now choose|Try again|Those complete phrases|Restart lesson|Next pattern|Showing \{)/u);
  assert.doesNotMatch(host, /(?:cs-CZ|es-ES|\bCzech\b|\bSpanish\b|GENDERS)/u);
  assert.doesNotMatch(host, /data\/games\/agreement-aurora\/challenges\.json/u);
  assert.match(html, /agreement-aurora-host\.mjs/u);
  assert.doesNotMatch(html, /(?:Caatuu Czech|Caatuu Spanish|source\/shared\/course-profile)/u);
});

test("a non-English learner base remains distinct from the mandatory English audit role", async () => {
  const fixture = structuredClone(await json(spanishCatalogUrl));
  fixture.courseId = "fr-es";
  fixture.contentId = "fr-es.agreement-aurora.fixture-v1";
  fixture.learnerBaseLanguage = "fr-FR";
  fixture.lesson = {
    kicker: "Accorde les mots",
    loadingText: "Préparation du premier modèle…",
    title: "Accorde toute la phrase",
    instruction: "Associe chaque sens français à la phrase espagnole complète.",
    idea: "Les déterminants et les adjectifs espagnols s'accordent avec le genre et le nombre du nom.",
    matchingTitle: "Choisis un sens et une phrase complète",
    learnerBaseColumnLabel: "Sens français",
    targetColumnLabel: "Phrase espagnole",
    completeKicker: "Quatre associations réussies"
  };
  fixture.presentation = {
    difficultyFallback: "Niveau {level}",
    roundTitle: "Manche {round} · {focus} · niveau {level}",
    progress: "Manche {round} sur {total} · {difficulty}",
    initialFeedback: "Choisis un sens français, puis la phrase espagnole complète.",
    selectTargetFeedback: "Choisis maintenant la {targetColumn} de même sens.",
    selectLearnerBaseFeedback: "Choisis maintenant le {learnerBaseColumn} correspondant.",
    retryFeedback: "Réessaie avec deux phrases de même sens.",
    wrongFeedback: "Ces phrases n'ont pas le même sens.",
    matchedFeedback: "Association {axis} : {form}.",
    completeFeedback: "Les {count} phrases sont associées.",
    nextRoundLabel: "Modèle suivant",
    restartLessonLabel: "Recommencer la leçon",
    difficultyChangedFeedback: "Modèles du niveau {difficulty}.",
    reviewRequiredLabel: "Contenu de développement · révision native requise",
    errorTitle: "Impossible de charger Agreement Aurora",
    errorDetail: "Retourne aux planètes et réessaie.",
    backLabel: "Retour aux jeux"
  };
  fixture.axes.forEach((axis, index) => {
    axis.label = ["Masculin singulier", "Féminin singulier", "Masculin pluriel", "Féminin pluriel"][index];
  });
  fixture.challenges.forEach((challenge) => {
    challenge.focus.label = `Forme cible : ${challenge.focus.targetText}`;
    challenge.focus.resultTitle = `Modèle de ${challenge.focus.targetText}`;
    challenge.focus.summary = `Compare les formes révisées de ${challenge.focus.targetText}.`;
    Object.values(challenge.forms).forEach((form) => {
      form.examples.forEach((example) => {
        example.learnerBaseText = `sens français ${example.id}`;
      });
    });
  });

  const pack = validateAgreementAuroraPack(fixture, {
    courseId: "fr-es",
    learnerBaseLanguage: "fr-FR",
    targetLanguage: "es-ES"
  });
  const [round] = buildAgreementAuroraRounds(pack, 1, () => 0);
  const authored = pack.challenges[0].forms[round.matches[0].axisId].examples[0];
  assert.notEqual(authored.learnerBaseText, authored.englishAuditText);
  assert.equal(round.matches[0].learnerBaseText, authored.learnerBaseText);
  assert.equal("englishAuditText" in round.matches[0], false);
  assert.doesNotMatch(JSON.stringify(round), new RegExp(authored.englishAuditText, "u"));
});

test("the rerender focus helper targets the requested live column or control", () => {
  const calls = [];
  const root = {
    querySelector(selector) {
      calls.push(["query", selector]);
      return { focus(options) { calls.push(["focus", options]); } };
    }
  };
  assert.equal(focusAgreementAuroraElement("target", root), true);
  assert.equal(focusAgreementAuroraElement("learner-base", root), true);
  assert.equal(focusAgreementAuroraElement("next", root), true);
  assert.deepEqual(calls, [
    ["query", "#agreementAuroraTargetOptions button:not(:disabled)"],
    ["focus", { preventScroll: true }],
    ["query", "#agreementAuroraLearnerBaseOptions button:not(:disabled)"],
    ["focus", { preventScroll: true }],
    ["query", "#agreementAuroraNext"],
    ["focus", { preventScroll: true }]
  ]);
  assert.equal(focusAgreementAuroraElement("unknown", root), false);
});

test("selection rerenders transfer focus to the opposite column and then the next unmatched prompt", async () => {
  const host = await readFile(
    new URL("../static/source/games/agreement-aurora/agreement-aurora-host.mjs", import.meta.url),
    "utf8"
  );
  assert.match(host, /if \(!state\.selectedTarget\) \{\s*focusNextTarget\(\);/u);
  assert.match(host, /if \(!state\.selectedLearnerBase\) \{\s*focusNextLearnerBase\(\);/u);
  assert.match(host, /if \(state\.phase === "complete"\) focusAgreementAuroraElement\("next"\);\s*else focusNextLearnerBase\(\);/u);
});

test("invalid or ambiguous content fails closed", async () => {
  const document = await json(spanishCatalogUrl);
  const missingAudit = structuredClone(document);
  delete missingAudit.challenges[0].forms["masculine-singular"].examples[0].englishAuditText;
  assert.throws(
    () => validateAgreementAuroraPack(missingAudit, {
      courseId: "es",
      learnerBaseLanguage: "en",
      targetLanguage: "es-ES"
    }),
    /englishAuditText/u
  );

  const wrongAxes = structuredClone(document);
  delete wrongAxes.challenges[0].forms["feminine-plural"];
  assert.throws(
    () => validateAgreementAuroraPack(wrongAxes, {
      courseId: "es",
      learnerBaseLanguage: "en",
      targetLanguage: "es-ES"
    }),
    /content-declared axes/u
  );

  assert.throws(
    () => validateAgreementAuroraPack(document, {
      courseId: "es",
      learnerBaseLanguage: "en",
      targetLanguage: "fr-FR"
    }),
    /not fr-FR/u
  );
});

test("license governance rejects unsupported or internally inconsistent clearance states", async () => {
  const document = await json(spanishCatalogUrl);

  const unsupportedStatus = structuredClone(document);
  unsupportedStatus.license.status = "probably-cleared";
  assert.throws(
    () => validateAgreementAuroraPack(unsupportedStatus, {
      courseId: "es",
      learnerBaseLanguage: "en",
      targetLanguage: "es-ES"
    }),
    /license\.status must be release-review-required, release-cleared, or legacy-review-required/u
  );

  const pendingWithSpdx = structuredClone(document);
  pendingWithSpdx.license.spdxExpression = "AGPL-3.0-only";
  assert.throws(
    () => validateAgreementAuroraPack(pendingWithSpdx, {
      courseId: "es",
      learnerBaseLanguage: "en",
      targetLanguage: "es-ES"
    }),
    /review-required Agreement Aurora license must keep spdxExpression null/u
  );

  const clearedWithoutSpdx = structuredClone(document);
  clearedWithoutSpdx.license.status = "release-cleared";
  assert.throws(
    () => validateAgreementAuroraPack(clearedWithoutSpdx, {
      courseId: "es",
      learnerBaseLanguage: "en",
      targetLanguage: "es-ES"
    }),
    /release-cleared Agreement Aurora license requires an SPDX expression/u
  );

  const consistentFutureClearance = structuredClone(document);
  consistentFutureClearance.license.status = "release-cleared";
  consistentFutureClearance.license.spdxExpression = "AGPL-3.0-only";
  assert.doesNotThrow(() => validateAgreementAuroraPack(consistentFutureClearance, {
    courseId: "es",
    learnerBaseLanguage: "en",
    targetLanguage: "es-ES"
  }));
});
