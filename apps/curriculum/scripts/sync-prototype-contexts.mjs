import { readFile, writeFile } from "node:fs/promises";

import {
  computeCanonicalContractDigest,
  computeTargetPackDigest
} from "../src/validate-conformance.mjs";

const packUrl = new URL("../data/cs-CZ.realization-pack.v1.json", import.meta.url);
const curriculumUrl = new URL("../data/canonical-curriculum.v1.en.json", import.meta.url);
const registryUrl = new URL("../data/cs-CZ.cross-game-bindings.v1.json", import.meta.url);
const prototypeReview = (notesEn) => ({
  status: "prototype-not-human-approved",
  notesEn
});

const u1 = "unit.interaction.entry-and-repair.01";
const u2 = "unit.needs.possession-and-choice.01";
const u3 = "unit.routine.familiar-actions.01";

const [pack, curriculum, registry] = await Promise.all([
  readFile(packUrl, "utf8").then(JSON.parse),
  readFile(curriculumUrl, "utf8").then(JSON.parse),
  readFile(registryUrl, "utf8").then(JSON.parse)
]);
pack.canonicalContractDigest = computeCanonicalContractDigest(curriculum);
const bindingsByUnit = new Map(pack.unitBindings.map((binding) => [binding.unitId, binding]));

const skillCanonicalIds = new Map(pack.skills.map((skill) => [skill.id, new Set()]));
const utteranceConceptIds = new Map(pack.utterances.map((utterance) => [utterance.id, new Set()]));
for (const binding of pack.unitBindings) {
  for (const field of ["functionBindings", "frameBindings", "conceptBindings"]) {
    for (const semanticBinding of binding[field]) {
      for (const skillId of semanticBinding.targetSkillIds) {
        skillCanonicalIds.get(skillId)?.add(semanticBinding.canonicalId);
      }
      if (field === "conceptBindings") {
        for (const utteranceId of semanticBinding.utteranceIds) {
          utteranceConceptIds.get(utteranceId)?.add(semanticBinding.canonicalId);
        }
      }
    }
  }
}

pack.skills = pack.skills.map((skill) => ({
  ...skill,
  canonicalIds: [...(skillCanonicalIds.get(skill.id) || [])],
  review: skill.review || prototypeReview("Target skill definition requires native Czech educator review.")
}));
pack.utterances = pack.utterances.map((utterance) => ({
  ...utterance,
  conceptIds: [...(utteranceConceptIds.get(utterance.id) || [])]
}));

const utterance = ({ id, unitId, text, functionIds, frameIds, conceptIds, skillIds, notesEn }) => ({
  id,
  revision: 1,
  unitId,
  locale: "cs-CZ",
  normalization: "NFC",
  text,
  functionIds,
  frameIds,
  conceptIds,
  skillIds,
  review: prototypeReview(notesEn || "Prototype utterance requires native Czech educator review.")
});

const additionalUtterances = [
  utterance({id: "cs.utterance.pomoz-mi-prosim", unitId: u1, text: "Pomoz mi, prosím.", functionIds: ["function.request-help"], frameIds: ["frame.interaction.repair"], conceptIds: ["concept.assistance"], skillIds: ["cs.skill.function.request-help"], notesEn: "Informal peer-directed repair expression requires review."}),
  utterance({id: "cs.utterance.muzes-to-zopakovat", unitId: u1, text: "Můžeš to zopakovat?", functionIds: ["function.request-repetition"], frameIds: ["frame.interaction.repair"], conceptIds: ["concept.repetition"], skillIds: ["cs.skill.function.request-repetition"], notesEn: "Informal peer-directed repetition request requires review."}),

  utterance({id: "cs.utterance.mam-mic", unitId: u2, text: "Mám míč.", functionIds: ["function.state-possession"], frameIds: ["frame.possess"], conceptIds: ["concept.person.self", "concept.familiar-item"], skillIds: ["cs.skill.function.state-possession"]}),
  utterance({id: "cs.utterance.mam-tuzku", unitId: u2, text: "Mám tužku.", functionIds: ["function.state-possession"], frameIds: ["frame.possess"], conceptIds: ["concept.person.self", "concept.familiar-item"], skillIds: ["cs.skill.function.state-possession"]}),
  utterance({id: "cs.utterance.chci-dzus", unitId: u2, text: "Chci džus.", functionIds: ["function.state-want"], frameIds: ["frame.want"], conceptIds: ["concept.person.self", "concept.drink"], skillIds: ["cs.skill.function.state-want"]}),
  utterance({id: "cs.utterance.chci-mic", unitId: u2, text: "Chci míč.", functionIds: ["function.state-want"], frameIds: ["frame.want"], conceptIds: ["concept.person.self", "concept.familiar-item"], skillIds: ["cs.skill.function.state-want"]}),
  utterance({id: "cs.utterance.potrebuji-tuzku", unitId: u2, text: "Potřebuji tužku.", functionIds: ["function.state-need"], frameIds: ["frame.need"], conceptIds: ["concept.person.self", "concept.familiar-item"], skillIds: ["cs.skill.function.state-need"]}),
  utterance({id: "cs.utterance.potrebuji-vodu", unitId: u2, text: "Potřebuji vodu.", functionIds: ["function.state-need"], frameIds: ["frame.need"], conceptIds: ["concept.person.self", "concept.drink"], skillIds: ["cs.skill.function.state-need"]}),
  utterance({id: "cs.utterance.mam-rada-knihy", unitId: u2, text: "Mám ráda knihy.", functionIds: ["function.state-like"], frameIds: ["frame.like"], conceptIds: ["concept.person.self", "concept.familiar-item"], skillIds: ["cs.skill.function.state-like"], notesEn: "Feminine speaker agreement must be bound to a compatible learner or character profile."}),
  utterance({id: "cs.utterance.libi-se-mi-ten-mic", unitId: u2, text: "Líbí se mi ten míč.", functionIds: ["function.state-like"], frameIds: ["frame.like"], conceptIds: ["concept.person.self", "concept.familiar-item"], skillIds: ["cs.skill.function.state-like"], notesEn: "Gender-neutral experiencer construction requires review for beginner suitability."}),
  utterance({id: "cs.utterance.chces-jablko-nebo-banan", unitId: u2, text: "Chceš jablko, nebo banán?", functionIds: ["function.understand-simple-choice"], frameIds: ["frame.simple-choice"], conceptIds: ["concept.food"], skillIds: ["cs.skill.function.understand-simple-choice"]}),
  utterance({id: "cs.utterance.jablko-prosim", unitId: u2, text: "Jablko, prosím.", functionIds: ["function.respond-simple-choice"], frameIds: ["frame.simple-choice"], conceptIds: ["concept.food"], skillIds: ["cs.skill.function.respond-simple-choice"]}),
  utterance({id: "cs.utterance.chces-knihu-nebo-tuzku", unitId: u2, text: "Chceš knihu, nebo tužku?", functionIds: ["function.understand-simple-choice"], frameIds: ["frame.simple-choice"], conceptIds: ["concept.familiar-item"], skillIds: ["cs.skill.function.understand-simple-choice"]}),
  utterance({id: "cs.utterance.knihu-prosim", unitId: u2, text: "Knihu, prosím.", functionIds: ["function.respond-simple-choice"], frameIds: ["frame.simple-choice"], conceptIds: ["concept.familiar-item"], skillIds: ["cs.skill.function.respond-simple-choice"]}),

  utterance({id: "cs.utterance.anna-ji-jablko", unitId: u3, text: "Anna jí jablko.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.eat"], skillIds: ["cs.skill.sense.jist.eat"]}),
  utterance({id: "cs.utterance.anna-ji-kazdy-den", unitId: u3, text: "Anna jí každý den.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.eat"], skillIds: ["cs.skill.sense.jist.eat"]}),
  utterance({id: "cs.utterance.anna-pije-vodu", unitId: u3, text: "Anna pije vodu.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.drink"], skillIds: ["cs.skill.sense.pit.drink"]}),
  utterance({id: "cs.utterance.anna-pije-kazdy-den", unitId: u3, text: "Anna pije vodu každý den.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.drink"], skillIds: ["cs.skill.sense.pit.drink"]}),
  utterance({id: "cs.utterance.dite-spi", unitId: u3, text: "Dítě spí.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.sleep"], skillIds: ["cs.skill.sense.spat.sleep"]}),
  utterance({id: "cs.utterance.spim-kazdou-noc", unitId: u3, text: "Spím každou noc.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.sleep"], skillIds: ["cs.skill.sense.spat.sleep"]}),
  utterance({id: "cs.utterance.dite-spi-kazdou-noc", unitId: u3, text: "Dítě spí každou noc.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.sleep"], skillIds: ["cs.skill.sense.spat.sleep"]}),
  utterance({id: "cs.utterance.dedecek-cte", unitId: u3, text: "Dědeček čte.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.read"], skillIds: ["cs.skill.sense.cist.read"], notesEn: "Matches Word World record ww-cp-000146; corpus provenance and naturalness still require review."}),
  utterance({id: "cs.utterance.dedecek-cte-kazdy-vecer", unitId: u3, text: "Dědeček čte každý večer.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.read"], skillIds: ["cs.skill.sense.cist.read"]}),
  utterance({id: "cs.utterance.dite-si-hraje", unitId: u3, text: "Dítě si hraje.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.play"], skillIds: ["cs.skill.sense.hrat-si.play"]}),
  utterance({id: "cs.utterance.dite-si-hraje-kazdy-den", unitId: u3, text: "Dítě si hraje každý den.", functionIds: ["function.describe-action"], frameIds: ["frame.action"], conceptIds: ["concept.action.play"], skillIds: ["cs.skill.sense.hrat-si.play"]}),
  utterance({id: "cs.utterance.co-dela-dedecek", unitId: u3, text: "Co dělá dědeček?", functionIds: ["function.understand-action-question"], frameIds: ["frame.action-question"], conceptIds: [], skillIds: ["cs.skill.function.understand-action-question"]}),
  utterance({id: "cs.utterance.co-dela-anna-kazdy-den", unitId: u3, text: "Co dělá Anna každý den?", functionIds: ["function.understand-action-question"], frameIds: ["frame.action-question"], conceptIds: [], skillIds: ["cs.skill.function.understand-action-question"]}),
  utterance({id: "cs.utterance.ctes", unitId: u3, text: "Čteš?", functionIds: ["function.understand-action-question"], frameIds: ["frame.action-question"], conceptIds: ["concept.action.read"], skillIds: ["cs.skill.function.understand-action-question"]}),
  utterance({id: "cs.utterance.cte-dedecek", unitId: u3, text: "Čte dědeček?", functionIds: ["function.understand-action-question"], frameIds: ["frame.action-question"], conceptIds: ["concept.action.read"], skillIds: ["cs.skill.function.understand-action-question"]}),
  utterance({id: "cs.utterance.cte-dedecek-kazdy-vecer", unitId: u3, text: "Čte dědeček každý večer?", functionIds: ["function.understand-action-question"], frameIds: ["frame.action-question"], conceptIds: ["concept.action.read"], skillIds: ["cs.skill.function.understand-action-question"]}),
  utterance({id: "cs.utterance.ano-dedecek-cte", unitId: u3, text: "Ano, dědeček čte.", functionIds: ["function.affirm-action"], frameIds: ["frame.action-polarity"], conceptIds: ["concept.action.read"], skillIds: ["cs.skill.function.affirm-action", "cs.skill.sense.cist.read"]}),
  utterance({id: "cs.utterance.ano-cte-kazdy-vecer", unitId: u3, text: "Ano, čte každý večer.", functionIds: ["function.affirm-action"], frameIds: ["frame.action-polarity"], conceptIds: ["concept.action.read"], skillIds: ["cs.skill.function.affirm-action", "cs.skill.sense.cist.read"]}),
  utterance({id: "cs.utterance.spis", unitId: u3, text: "Spíš?", functionIds: ["function.understand-action-question"], frameIds: ["frame.action-question"], conceptIds: ["concept.action.sleep"], skillIds: ["cs.skill.function.understand-action-question"]}),
  utterance({id: "cs.utterance.spi-dite", unitId: u3, text: "Spí dítě?", functionIds: ["function.understand-action-question"], frameIds: ["frame.action-question"], conceptIds: ["concept.action.sleep"], skillIds: ["cs.skill.function.understand-action-question"]}),
  utterance({id: "cs.utterance.spi-dite-kazdou-noc", unitId: u3, text: "Spí dítě každou noc?", functionIds: ["function.understand-action-question"], frameIds: ["frame.action-question"], conceptIds: ["concept.action.sleep"], skillIds: ["cs.skill.function.understand-action-question"]}),
  utterance({id: "cs.utterance.ne-dite-nespi", unitId: u3, text: "Ne, dítě nespí.", functionIds: ["function.reject-action"], frameIds: ["frame.action-polarity"], conceptIds: ["concept.action.sleep"], skillIds: ["cs.skill.function.reject-action", "cs.skill.sense.spat.sleep"]}),
  utterance({id: "cs.utterance.ne-dite-nespi-kazdou-noc", unitId: u3, text: "Ne, dítě nespí každou noc.", functionIds: ["function.reject-action"], frameIds: ["frame.action-polarity"], conceptIds: ["concept.action.sleep"], skillIds: ["cs.skill.function.reject-action", "cs.skill.sense.spat.sleep"]})
];

const utterancesById = new Map(pack.utterances.map((row) => [row.id, row]));
for (const row of additionalUtterances) utterancesById.set(row.id, row);
pack.utterances = [...utterancesById.values()];

const claimFieldByBindingField = {
  functionBindings: "functionIds",
  frameBindings: "frameIds",
  conceptBindings: "conceptIds"
};
for (const binding of pack.unitBindings) {
  const unitSkills = pack.skills.filter((skill) => skill.unitId === binding.unitId);
  const unitUtterances = pack.utterances.filter((row) => row.unitId === binding.unitId);
  for (const [bindingField, claimField] of Object.entries(claimFieldByBindingField)) {
    for (const semanticBinding of binding[bindingField]) {
      semanticBinding.utteranceIds = unitUtterances
        .filter((row) => row[claimField].includes(semanticBinding.canonicalId))
        .map((row) => row.id);
      semanticBinding.targetSkillIds = unitSkills
        .filter((skill) => skill.canonicalIds.includes(semanticBinding.canonicalId))
        .map((skill) => skill.id);
    }
  }
  binding.targetSkillIds = unitSkills.map((skill) => skill.id);
  binding.utteranceIds = unitUtterances.map((row) => row.id);
}

const opportunity = ({ id, operation, targetSkillIds, stimulusUtteranceIds = [], expectedUtteranceIds = [] }) => ({
  id,
  operation,
  targetSkillIds,
  stimulusUtteranceIds,
  expectedUtteranceIds
});

const context = ({ id, unitId, descriptionEn, featureValues, opportunities }) => ({
  id,
  revision: 1,
  unitId,
  locale: "cs-CZ",
  descriptionEn,
  featureValues,
  opportunities,
  review: prototypeReview("Context and opportunity bindings require native Czech educator review.")
});

const contexts = [
  context({id: "cs.context.u1.peer-meeting", unitId: u1, descriptionEn: "An informal first meeting with a peer.", featureValues: {"interlocutor-role": "peer", register: "informal"}, opportunities: [
    opportunity({id: "greet-peer", operation: "produce", targetSkillIds: ["cs.skill.function.greet"], expectedUtteranceIds: ["cs.utterance.ahoj"]}),
    opportunity({id: "identify-peer", operation: "produce", targetSkillIds: ["cs.skill.function.identify-self"], expectedUtteranceIds: ["cs.utterance.jmenuji-se-anna"]})
  ]}),
  context({id: "cs.context.u1.teacher-meeting", unitId: u1, descriptionEn: "A polite first meeting with a teacher or helper.", featureValues: {"interlocutor-role": "teacher-or-helper", register: "polite"}, opportunities: [
    opportunity({id: "greet-teacher", operation: "produce", targetSkillIds: ["cs.skill.function.greet"], expectedUtteranceIds: ["cs.utterance.dobry-den"]}),
    opportunity({id: "identify-teacher", operation: "produce", targetSkillIds: ["cs.skill.function.identify-self"], expectedUtteranceIds: ["cs.utterance.jmenuji-se-anna"]})
  ]}),
  context({id: "cs.context.u1.peer-polarity", unitId: u1, descriptionEn: "A peer asks a simple yes-or-no question supported by a scene.", featureValues: {"interlocutor-role": "peer", register: "informal"}, opportunities: [
    opportunity({id: "affirm-peer", operation: "produce", targetSkillIds: ["cs.skill.function.affirm"], expectedUtteranceIds: ["cs.utterance.ano"]}),
    opportunity({id: "reject-peer", operation: "produce", targetSkillIds: ["cs.skill.function.reject"], expectedUtteranceIds: ["cs.utterance.ne"]})
  ]}),
  context({id: "cs.context.u1.helper-polarity", unitId: u1, descriptionEn: "A helper asks a simple yes-or-no question supported by a scene.", featureValues: {"interlocutor-role": "teacher-or-helper", register: "polite"}, opportunities: [
    opportunity({id: "affirm-helper", operation: "produce", targetSkillIds: ["cs.skill.function.affirm"], expectedUtteranceIds: ["cs.utterance.ano"]}),
    opportunity({id: "reject-helper", operation: "produce", targetSkillIds: ["cs.skill.function.reject"], expectedUtteranceIds: ["cs.utterance.ne"]})
  ]}),
  context({id: "cs.context.u1.peer-task-help", unitId: u1, descriptionEn: "The learner cannot complete a task with a peer and asks for help.", featureValues: {"interlocutor-role": "peer", register: "informal", "breakdown-cause": "cannot-complete-task"}, opportunities: [
    opportunity({id: "help-peer", operation: "produce", targetSkillIds: ["cs.skill.function.request-help"], expectedUtteranceIds: ["cs.utterance.pomoz-mi-prosim"]})
  ]}),
  context({id: "cs.context.u1.teacher-task-help", unitId: u1, descriptionEn: "The learner cannot complete a task with a teacher and asks for help.", featureValues: {"interlocutor-role": "teacher-or-helper", register: "polite", "breakdown-cause": "cannot-complete-task"}, opportunities: [
    opportunity({id: "help-teacher", operation: "produce", targetSkillIds: ["cs.skill.function.request-help"], expectedUtteranceIds: ["cs.utterance.prosim-pomozte-mi"]})
  ]}),
  context({id: "cs.context.u1.peer-hearing-repair", unitId: u1, descriptionEn: "The learner cannot understand a peer's previous message and asks for repetition.", featureValues: {"interlocutor-role": "peer", register: "informal", "breakdown-cause": "message-not-understood"}, opportunities: [
    opportunity({id: "repeat-peer", operation: "produce", targetSkillIds: ["cs.skill.function.request-repetition"], expectedUtteranceIds: ["cs.utterance.muzes-to-zopakovat"]})
  ]}),
  context({id: "cs.context.u1.teacher-hearing-repair", unitId: u1, descriptionEn: "The learner cannot understand a teacher's previous message and asks for repetition.", featureValues: {"interlocutor-role": "teacher-or-helper", register: "polite", "breakdown-cause": "message-not-understood"}, opportunities: [
    opportunity({id: "repeat-teacher", operation: "produce", targetSkillIds: ["cs.skill.function.request-repetition"], expectedUtteranceIds: ["cs.utterance.muzete-to-zopakovat"]})
  ]})
];

const productionFamilies = [
  ["possession", "cs.skill.function.state-possession", [["home", "book", "cs.utterance.mam-knihu"], ["school", "pencil", "cs.utterance.mam-tuzku"], ["playground", "ball", "cs.utterance.mam-mic"]]],
  ["want", "cs.skill.function.state-want", [["meal", "water", "cs.utterance.chci-vodu"], ["travel", "juice", "cs.utterance.chci-dzus"], ["playground", "ball", "cs.utterance.chci-mic"]]],
  ["need", "cs.skill.function.state-need", [["school", "help", "cs.utterance.potrebuji-pomoc"], ["art-class", "pencil", "cs.utterance.potrebuji-tuzku"], ["travel", "water", "cs.utterance.potrebuji-vodu"]]],
  ["like", "cs.skill.function.state-like", [["meal", "apples", "cs.utterance.mam-rad-jablka"], ["library", "books", "cs.utterance.mam-rada-knihy"], ["playground", "ball", "cs.utterance.libi-se-mi-ten-mic"]]]
];
for (const [family, skillId, rows] of productionFamilies) {
  rows.forEach(([setting, referent, utteranceId]) => contexts.push(context({
    id: `cs.context.u2.${family}-${setting}`,
    unitId: u2,
    descriptionEn: `${family} involving ${referent} in the ${setting} setting.`,
    featureValues: {setting, "referent-item": referent},
    opportunities: [opportunity({id: `${family}-${setting}`, operation: "produce", targetSkillIds: [skillId], expectedUtteranceIds: [utteranceId]})]
  })));
}

const choices = [
  ["snack", "water-or-juice", "cs.utterance.chces-vodu-nebo-dzus", "cs.utterance.vodu-prosim"],
  ["home", "apple-or-banana", "cs.utterance.chces-jablko-nebo-banan", "cs.utterance.jablko-prosim"],
  ["school", "book-or-pencil", "cs.utterance.chces-knihu-nebo-tuzku", "cs.utterance.knihu-prosim"]
];
for (const [setting, referent, promptId, responseId] of choices) contexts.push(context({
  id: `cs.context.u2.choice-${setting}`,
  unitId: u2,
  descriptionEn: `Understanding and answering a choice between ${referent} in the ${setting} setting.`,
  featureValues: {setting, "referent-item": referent},
  opportunities: [
    opportunity({id: `understand-choice-${setting}`, operation: "interpret", targetSkillIds: ["cs.skill.function.understand-simple-choice"], stimulusUtteranceIds: [promptId]}),
    opportunity({id: `respond-choice-${setting}`, operation: "respond", targetSkillIds: ["cs.skill.function.respond-simple-choice"], stimulusUtteranceIds: [promptId], expectedUtteranceIds: [responseId]})
  ]
}));

const actionFamilies = [
  ["eat", "cs.skill.sense.jist.eat", [["home", "self", "current", "cs.utterance.jim-jablko"], ["school", "anna", "current", "cs.utterance.anna-ji-jablko"], ["camp", "anna", "habitual", "cs.utterance.anna-ji-kazdy-den"]]],
  ["drink", "cs.skill.sense.pit.drink", [["home", "self", "current", "cs.utterance.piju-vodu"], ["school", "anna", "current", "cs.utterance.anna-pije-vodu"], ["camp", "anna", "habitual", "cs.utterance.anna-pije-kazdy-den"]]],
  ["sleep", "cs.skill.sense.spat.sleep", [["home", "child", "current", "cs.utterance.dite-spi"], ["home", "self", "habitual", "cs.utterance.spim"], ["camp", "self", "habitual", "cs.utterance.spim-kazdou-noc"], ["grandparents-home", "child", "habitual", "cs.utterance.dite-spi-kazdou-noc"]]],
  ["read", "cs.skill.sense.cist.read", [["home", "self", "current", "cs.utterance.ctu-knihu"], ["library", "grandfather", "current", "cs.utterance.dedecek-cte"], ["grandparents-home", "grandfather", "habitual", "cs.utterance.dedecek-cte-kazdy-vecer"]]],
  ["play", "cs.skill.sense.hrat-si.play", [["home", "self", "current", "cs.utterance.hraju-si"], ["playground", "child", "current", "cs.utterance.dite-si-hraje"], ["school", "child", "habitual", "cs.utterance.dite-si-hraje-kazdy-den"]]]
];
for (const [family, skillId, rows] of actionFamilies) {
  rows.forEach(([setting, referent, timeProfile, utteranceId]) => contexts.push(context({
    id: `cs.context.u3.${family}-${setting}-${timeProfile}`,
    unitId: u3,
    descriptionEn: `${family} by ${referent} in ${setting} with a ${timeProfile} time profile.`,
    featureValues: {setting, "referent-person": referent, "time-profile": timeProfile},
    opportunities: [opportunity({id: `${family}-${setting}-${timeProfile}`, operation: "produce", targetSkillIds: [skillId], expectedUtteranceIds: [utteranceId]})]
  })));
}

const wordWorldReadContext = contexts.find((row) => row.id === "cs.context.u3.read-library-current");
wordWorldReadContext.opportunities.push(opportunity({
  id: "interpret-read-library-current",
  operation: "interpret",
  targetSkillIds: ["cs.skill.sense.cist.read"],
  stimulusUtteranceIds: ["cs.utterance.dedecek-cte"]
}));

const questionContexts = [
  ["self-home-current", "home", "self", "current", "cs.utterance.co-delas"],
  ["grandfather-library-current", "library", "grandfather", "current", "cs.utterance.co-dela-dedecek"],
  ["anna-school-habitual", "school", "anna", "habitual", "cs.utterance.co-dela-anna-kazdy-den"]
];
for (const [suffix, setting, referent, timeProfile, promptId] of questionContexts) contexts.push(context({
  id: `cs.context.u3.question-${suffix}`,
  unitId: u3,
  descriptionEn: `Interpreting an action question about ${referent} in ${setting}.`,
  featureValues: {setting, "referent-person": referent, "time-profile": timeProfile},
  opportunities: [opportunity({id: `question-${suffix}`, operation: "interpret", targetSkillIds: ["cs.skill.function.understand-action-question"], stimulusUtteranceIds: [promptId]})]
}));

const polarityContexts = [
  ["affirm", "cs.skill.function.affirm-action", "self-home-current", "home", "self", "current", "cs.utterance.ctes", "cs.utterance.ano-ctu"],
  ["affirm", "cs.skill.function.affirm-action", "grandfather-library-current", "library", "grandfather", "current", "cs.utterance.cte-dedecek", "cs.utterance.ano-dedecek-cte"],
  ["affirm", "cs.skill.function.affirm-action", "grandfather-home-habitual", "grandparents-home", "grandfather", "habitual", "cs.utterance.cte-dedecek-kazdy-vecer", "cs.utterance.ano-cte-kazdy-vecer"],
  ["reject", "cs.skill.function.reject-action", "self-home-current", "home", "self", "current", "cs.utterance.spis", "cs.utterance.ne-nespim"],
  ["reject", "cs.skill.function.reject-action", "child-school-current", "school", "child", "current", "cs.utterance.spi-dite", "cs.utterance.ne-dite-nespi"],
  ["reject", "cs.skill.function.reject-action", "child-camp-habitual", "camp", "child", "habitual", "cs.utterance.spi-dite-kazdou-noc", "cs.utterance.ne-dite-nespi-kazdou-noc"]
];
for (const [family, skillId, suffix, setting, referent, timeProfile, promptId, responseId] of polarityContexts) contexts.push(context({
  id: `cs.context.u3.${family}-${suffix}`,
  unitId: u3,
  descriptionEn: `${family}ing a proposition about ${referent}'s action in ${setting}.`,
  featureValues: {setting, "referent-person": referent, "time-profile": timeProfile},
  opportunities: [opportunity({id: `${family}-${suffix}`, operation: "respond", targetSkillIds: [skillId], stimulusUtteranceIds: [promptId], expectedUtteranceIds: [responseId]})]
}));

pack.contexts = contexts;
for (const binding of pack.unitBindings) {
  binding.contextIds = contexts.filter((row) => row.unitId === binding.unitId).map((row) => row.id);
}

await writeFile(packUrl, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
const targetPackDigest = computeTargetPackDigest(pack);
registry.targetPack = {
  id: pack.packId,
  version: pack.version,
  targetLocale: pack.targetLocale,
  targetPackDigest
};
const wordWorldBinding = registry.bindings.find((row) => row.id === "binding.word-world.ww-cp-000146");
wordWorldBinding.opportunityId = "interpret-read-library-current";
await writeFile(registryUrl, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${pack.skills.length} reviewed-shape skills, ${pack.utterances.length} utterances, ${contexts.length} structured prototype contexts, and target-pack pin ${targetPackDigest}.\n`);
