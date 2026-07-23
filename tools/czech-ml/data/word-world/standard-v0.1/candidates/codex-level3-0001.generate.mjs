import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const candidateDir = path.join(root, "tools/czech-ml/data/word-world/standard-v0.1/candidates");
const canonicalFile = path.join(root, "tools/czech-ml/data/word-world/standard-v0.1/source/common-phrases-pilot.jsonl");
const firstCandidateFile = path.join(candidateDir, "codex-expansion-0001.candidates.jsonl");
const coverageFile = path.join(root, "tools/czech-ml/data/word-world/standard-v0.1/reports/coverage.json");
const outputFile = path.join(candidateDir, "codex-level3-0001.candidates.jsonl");
const manifestFile = path.join(candidateDir, "codex-level3-0001.manifest.json");
const reportFile = path.join(candidateDir, "codex-level3-0001.authoring-report.json");

// topic, Czech, English, existing playable target, grammar focus, clause count, optional sentence type.
const rows = [
  ["people","Můj bratr chodí pěšky, protože bydlí blízko školy.","My brother walks because he lives near the school.","bratr","reason_clause",2],
  ["people","Naše rodina se večer sejde a každý vypráví svůj den.","Our family meets in the evening, and everyone talks about their day.","rodina","coordinated_clauses",2],
  ["people","Náš soused půjčil dětem míč, aby si mohly hrát.","Our neighbor lent the children a ball so they could play.","soused","purpose_clause",2],
  ["people","Kamarádi čekali před kinem, dokud nezačalo silně pršet.","The friends waited outside the cinema until it started raining heavily.","Kamarádi","time_clause",2],
  ["people","Když dítě potřebuje pomoc, může oslovit známého dospělého.","When a child needs help, they can ask a trusted adult.","pomoc","time_clause",2],
  ["people","Po krátké přestávce se všichni soustředili mnohem lépe.","After a short break, everyone concentrated much better.","lépe","comparative_adverb",1],
  ["people","O prázdninách navštívíme rodinu, která žije u velkého jezera.","During the holidays, we will visit family who live by a large lake.","rodinu","relative_clause",2],
  ["people","Náš tým prohrával, ale ve druhém poločase zabral.","Our team was losing, but it worked harder in the second half.","tým","contrast_clause",2],

  ["home","Klíče zůstaly na stole, přestože jsme je ráno hledali.","The keys stayed on the table although we searched for them this morning.","Klíče","concession_clause",2],
  ["home","Nejdřív utřeme podlahu, aby na ní nikdo neuklouzl.","First we will wipe the floor so nobody slips on it.","podlahu","purpose_clause",2],
  ["home","Po večeři umyjeme nádobí a potom uklidíme kuchyň.","After dinner, we will wash the dishes and then tidy the kitchen.","nádobí","coordinated_clauses",2],
  ["home","Budeme uklízet pokoj, zatímco rodič připraví večeři.","We will tidy the room while a parent prepares dinner.","uklízet","time_clause",2],
  ["home","Přesuň rostlinu k oknu, kde má během dne více světla.","Move the plant to the window, where it gets more light during the day.","rostlinu","relative_clause",2,"imperative"],
  ["home","Pohovka byla příliš široká, takže neprošla úzkými dveřmi.","The sofa was too wide, so it did not fit through the narrow door.","Pohovka","result_clause",2],
  ["home","Děti roztřídily hračky podle barev a uložily je do krabic.","The children sorted the toys by color and put them into boxes.","hračky","coordinated_clauses",2],
  ["home","Nástěnné hodiny se zastavily, protože jejich baterie byla vybitá.","The wall clock stopped because its battery was empty.","hodiny","reason_clause",2],

  ["school","Učitelka zopakovala otázku, aby jí rozuměla celá třída.","The teacher repeated the question so the whole class could understand it.","otázku","purpose_clause",2],
  ["school","Domácí úkol byl delší, než děti původně čekaly.","The homework was longer than the children originally expected.","úkol","comparative_clause",2],
  ["school","Na tabuli zůstal příklad, který jsme ještě nevyřešili.","An example remained on the board that we had not solved yet.","tabuli","relative_clause",2],
  ["school","Učitel ukázal mapu a vysvětlil, kudy vede řeka.","The teacher showed a map and explained where the river flows.","Učitel","indirect_question",3],
  ["school","Když odpověď nevím, nejdřív si znovu přečtu zadání.","When I do not know the answer, I first read the instructions again.","nevím","time_clause",2],
  ["school","Můžeš vysvětlit postup a neprozradit přitom výsledek?","Can you explain the steps without revealing the answer?","vysvětlit","coordinated_infinitives",1,"question"],
  ["school","Než odpovíš, zkus na otázku odpovědět celou větou.","Before you reply, try to answer the question with a full sentence.","odpovědět","time_clause",2,"imperative"],
  ["school","Skupina četla příběh nahlas a potom hledala hlavní myšlenku.","The group read the story aloud and then looked for the main idea.","nahlas","coordinated_clauses",2],

  ["play","Dva míče skončily za plotem, když děti trénovaly přihrávky.","Two balls ended up behind the fence while the children practiced passing.","míče","time_clause",2],
  ["play","Každý hráč přidal jednu větu, až vznikl legrační příběh.","Each player added one sentence until a funny story emerged.","příběh","result_clause",2],
  ["play","Věž z kostek spadla, protože její základna nebyla rovná.","The block tower fell because its base was not level.","Věž","reason_clause",2],
  ["play","Najdi cestu bludištěm, ale nepřekračuj vyznačené čáry.","Find a path through the maze, but do not cross the marked lines.","Najdi","contrast_clause",2,"imperative"],
  ["play","Vybarvi draka tak, aby každé křídlo mělo jinou barvu.","Color the dragon so that each wing has a different color.","Vybarvi","purpose_clause",2,"imperative"],
  ["play","Tancuj pomaleji, když hudba ztichne, a rychleji při refrénu.","Dance more slowly when the music softens, and faster during the chorus.","Tancuj","time_clause",2,"imperative"],
  ["play","Chybějící dílek byl pod stolem, kde ho našla mladší sestra.","The missing piece was under the table, where the younger sister found it.","Chybějící","relative_clause",2],
  ["play","Postav most, který unese tři figurky bez další podpory.","Build a bridge that can hold three pieces without extra support.","Postav","relative_clause",2,"imperative"],

  ["nature","Silný vítr shodil listy, které ležely na cestě.","The strong wind scattered leaves that were lying on the path.","vítr","relative_clause",2],
  ["nature","Když prší celý den, hledáme hry, které můžeme hrát doma.","When it rains all day, we find games that we can play indoors.","prší","nested_relative_clause",3],
  ["nature","Venku sněží, ale ptáci stále hledají semínka pod keři.","It is snowing outside, but birds are still looking for seeds under bushes.","sněží","contrast_clause",2],
  ["nature","Obloha se vyjasnila, jakmile se mraky přesunuly nad kopce.","The sky cleared as soon as the clouds moved over the hills.","Obloha","time_clause",2],
  ["nature","Dítě zasadilo květinu tam, kde na ni svítí ranní slunce.","The child planted the flower where the morning sun shines on it.","květinu","relative_location_clause",2],
  ["nature","Park vypadal po dešti svěžeji, protože se prach smyl.","The park looked fresher after the rain because the dust washed away.","Park","reason_clause",2],
  ["nature","Než si budeme hrát venku, zkontrolujeme, jestli neprší.","Before we play outside, we will check whether it is raining.","venku","indirect_question",3],
  ["nature","I když je slunečno, ve stínu zůstává ráno chladno.","Even when it is sunny, the shade stays cool in the morning.","slunečno","concession_clause",2],

  ["transport","Vlak odjel později, protože na nástupišti čekala velká skupina.","The train left later because a large group was waiting on the platform.","Vlak","reason_clause",2],
  ["transport","V autobuse jsme uvolnili místo člověku, který nesl těžkou tašku.","On the bus, we gave a seat to someone carrying a heavy bag.","autobuse","relative_clause",2],
  ["transport","Musíme vystoupit o zastávku dřív, pokud je most uzavřený.","We must get off one stop earlier if the bridge is closed.","vystoupit","conditional_clause",2],
  ["transport","Kvůli zpoždění jsme dorazili až po začátku představení.","Because of the delay, we arrived after the performance had started.","zpoždění","causal_prepositional_phrase",1],
  ["transport","Připoutej se dříve, než se auto začne pohybovat.","Fasten your seatbelt before the car starts moving.","Připoutej","time_clause",2,"imperative"],
  ["transport","Kolo necháme pod střechou, aby jeho sedlo nezmoklo.","We will leave the bike under cover so its seat stays dry.","Kolo","purpose_clause",2],
  ["transport","Letadlo klesalo pomalu, zatímco pod ním svítila světla města.","The plane descended slowly while the city lights shone below it.","Letadlo","time_clause",2],
  ["transport","Cesta domů trvala déle, protože jsme objížděli opravu silnice.","The journey home took longer because we detoured around roadworks.","Cesta","reason_clause",2],

  ["feelings","Když se cítím nejistě, požádám známého dospělého o pomoc.","When I feel unsure, I ask a trusted adult for help.","cítím","time_clause",2],
  ["feelings","Bojím se bouřky méně, když počítám čas mezi hromy.","I fear the storm less when I count the time between thunderclaps.","Bojím","time_clause",2],
  ["feelings","Po dlouhé procházce máme hlad, takže připravíme jednoduchou svačinu.","After a long walk, we are hungry, so we prepare a simple snack.","hlad","result_clause",2],
  ["feelings","Dítě mělo po běhu žízeň, a proto se napilo vody.","The child was thirsty after running, so it drank some water.","žízeň","result_clause",2],
  ["feelings","Chlapec byl unavený, protože šel večer spát příliš pozdě.","The boy was tired because he went to bed too late.","byl","reason_clause",2],
  ["feelings","Pes vypadal smutný, dokud se jeho rodina nevrátila domů.","The dog looked sad until its family returned home.","rodina","time_clause",2],
  ["feelings","Dědeček byl šťastný, když mu děti ukázaly hotový obrázek.","Grandpa was happy when the children showed him the finished picture.","dědeček","time_clause",2],
  ["feelings","Dívka byla nervózní, ale po prvním kole se uklidnila.","The girl was nervous, but she calmed down after the first round.","nervózní","contrast_clause",2],

  ["food","Polévka chutnala lépe, když jsme do ní přidali čerstvé bylinky.","The soup tasted better after we added fresh herbs.","Polévka","time_clause",2],
  ["food","Jablka nakrájíme později, aby na stole nezhnědla.","We will cut the apples later so they do not brown on the table.","Jablka","purpose_clause",2],
  ["food","Rozdělili jsme sušenku na čtyři části, aby každý ochutnal.","We divided the cookie into four pieces so everyone could taste it.","sušenku","purpose_clause",2],
  ["food","Polož hrnek na podložku, protože čaj je ještě horký.","Put the mug on a coaster because the tea is still hot.","hrnek","reason_clause",2,"imperative"],
  ["food","Snídaně bude připravená dříve, než ostatní vstanou.","Breakfast will be ready before everyone else gets up.","Snídaně","time_clause",2],
  ["food","Teplá večeře čekala v troubě, dokud se rodina nevrátila.","The warm dinner waited in the oven until the family returned.","Teplá","time_clause",2],
  ["food","Studené mléko necháme chvíli venku, než ho přidáme do těsta.","We will leave the cold milk out before adding it to the batter.","Studené","time_clause",2],
  ["food","Do džusu přidáme vodu, pokud je pro děti příliš sladký.","We will add water to the juice if it is too sweet for the children.","džusu","conditional_clause",2],

  ["weather","Vezmi si bundu, protože po západu slunce bude chladněji.","Take a jacket because it will get colder after sunset.","bundu","reason_clause",2,"imperative"],
  ["weather","Dítě si nasadilo čepici, než vyběhlo do studeného větru.","The child put on a hat before running into the cold wind.","čepici","time_clause",2],
  ["weather","Deštník necháme otevřený, dokud jeho látka úplně neuschne.","We will leave the umbrella open until its fabric is completely dry.","Deštník","time_clause",2],
  ["weather","Mokré boty polož vedle topení, ale ne příliš blízko.","Put the wet shoes by the heater, but not too close.","Mokré","contrast_phrase",1,"imperative"],
  ["weather","Suché oblečení uložíme zvlášť, aby zůstalo připravené na ráno.","We will store the dry clothes separately so they stay ready for morning.","Suché","purpose_clause",2],
  ["weather","Košile byla čistá, ale její rukávy potřebovaly vyžehlit.","The shirt was clean, but its sleeves needed ironing.","Košile","contrast_clause",2],
  ["weather","Svetr se po vyprání zmenšil, protože voda byla příliš horká.","The sweater shrank after washing because the water was too hot.","Svetr","reason_clause",2],
  ["weather","Ráno bylo zataženo, přesto jsme si vzali sluneční brýle.","The morning was cloudy, but we still took sunglasses.","zataženo","contrast_clause",2],

  ["technology","Baterie vydrží déle, když snížíme jas obrazovky.","The battery lasts longer when we lower the screen brightness.","Baterie","time_clause",2],
  ["technology","Heslo nesdílíme, i když o ně někdo zdvořile požádá.","We do not share a password even when someone asks politely.","Heslo","concession_clause",2],
  ["technology","Obrazovka zhasne automaticky, pokud se zařízení chvíli nepoužívá.","The screen turns off automatically if the device is not used for a while.","Obrazovka","conditional_clause",2],
  ["technology","Stránka se načítá pomalu, protože připojení není stabilní.","The page loads slowly because the connection is unstable.","načítá","reason_clause",2],
  ["technology","Pošli zprávu rodiči, až bezpečně dorazíš na místo.","Send a message to a parent when you arrive safely.","Pošli","time_clause",2,"imperative"],
  ["technology","Než odešleš zprávu, zkontroluj jméno příjemce ještě jednou.","Before sending the message, check the recipient's name again.","zprávu","time_clause",2,"imperative"],
  ["technology","Telefon zůstane vypnutý, dokud neskončí školní představení.","The phone will stay off until the school performance ends.","vypnutý","time_clause",2],
  ["technology","Když je zvuk příliš hlasitý, nejdřív sniž hlasitost zařízení.","When the sound is too loud, lower the device volume first.","zvuk","time_clause",2,"imperative"]
];

const topicMeta = {
  people: ["connect people, relationships, and everyday events", "people_and_relationships"],
  home: ["sequence home tasks and explain practical reasons", "home_and_responsibility"],
  school: ["follow and explain multi-step classroom language", "school_and_reasoning"],
  play: ["follow constraints and create through play", "play_and_problem_solving"],
  nature: ["describe changes and relationships in nature", "nature_and_outdoors"],
  transport: ["describe journeys, timing, and safe travel choices", "travel_and_transport"],
  feelings: ["connect feelings and needs with causes and responses", "feelings_and_needs"],
  food: ["sequence food preparation and explain results", "food_and_meals"],
  weather: ["connect weather with practical clothing choices", "weather_and_clothing"],
  technology: ["use everyday technology safely and deliberately", "everyday_technology"]
};

const a2Focus = new Set(["comparative_clause","conditional_clause","concession_clause","indirect_question","nested_relative_clause","purpose_clause","relative_clause","relative_location_clause","result_clause"]);

function tokens(text) {
  return text.match(/[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*/gu) || [];
}

function normalize(text) {
  return String(text || "").normalize("NFC").toLocaleLowerCase("cs-CZ");
}

function sentenceKey(text) {
  return tokens(text).map(normalize).join(" ");
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
}

function makeRecord(row, index) {
  const [topic, cs, en, intendedTarget, focus, clauseCount, explicitType] = row;
  const csTokens = tokens(cs);
  const targetIndex = csTokens.findIndex((token) => normalize(token) === normalize(intendedTarget));
  if (targetIndex < 0) throw new Error("Target '" + intendedTarget + "' is missing from: " + cs);
  const [objective, topicTag] = topicMeta[topic];
  const serial = String(index + 1).padStart(4, "0");
  return {
    schemaVersion: "caatuu-word-world-record-v1",
    id: "ww-codex-l3-0001-" + serial,
    languages: { en: { text: en, alternates: [] }, cs: { text: cs } },
    difficulty: 3,
    cefr: a2Focus.has(focus) || clauseCount === 3 ? "A2" : "A1/A2",
    topic,
    targets: [{ surface: csTokens[targetIndex], normalized: normalize(csTokens[targetIndex]), tokenIndex: targetIndex, playable: true }],
    learning: {
      objective,
      skillFocus: [focus.replaceAll("_", " "), "connect meaning across a richer sentence"],
      ageBand: "6-10",
      progression: {
        level: 3,
        rationale: "Richer but bounded learner language with concrete context, useful morphology, and a clear relationship between clauses or ideas.",
        prerequisites: ["recognize-level-1-words-and-formulas", "combine-level-2-everyday-patterns"]
      },
      support: { translationAvailable: true, imageSuitable: true, audioSuitable: true, dictionarySuitable: true }
    },
    grammar: { tags: ["codex_authored", "topic_" + topicTag, focus], sentenceType: explicitType || (cs.endsWith("?") ? "question" : "statement"), clauseCount },
    scene: { query: en.replace(/[.!?]$/u, ""), assetIds: [] },
    provenance: {
      sourceName: "Caatuu Word World Codex Level 3 expansion",
      sourceIds: ["codex-level3-0001-" + serial],
      sourceLicense: "Caatuu-authored candidate; licensing confirmation required before promotion",
      sourceType: "codex_authored",
      transformation: "Original bilingual Level 3 authoring for Caatuu; no external corpus text used. Guided metadata and exact target position were added from the authored pair."
    },
    review: {
      status: "candidate",
      reviewer: "candidate author self-check only",
      reviewedOn: "2026-07-22",
      humanApproved: false,
      checks: ["author structural self-check", "author bilingual self-check", "author Level 3 difficulty self-check", "author child-safety self-check"],
      notes: ["Author self-check is not acceptance. This record awaits independent Czech-English and pedagogy review."]
    }
  };
}

function jaccard(left, right) {
  const a = new Set(tokens(left).map(normalize));
  const b = new Set(tokens(right).map(normalize));
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

function nearMatches(records, reference, referenceName) {
  const matches = [];
  for (const record of records) {
    for (const other of reference) {
      const csA = record.languages.cs.text;
      const csB = other.languages.cs.text;
      const enA = record.languages.en.text;
      const enB = other.languages.en.text;
      const csSimilarity = jaccard(csA, csB);
      const enSimilarity = jaccard(enA, enB);
      if (Math.min(tokens(csA).length, tokens(csB).length) >= 5 && (csSimilarity >= 0.75 || enSimilarity >= 0.8)) {
        matches.push({ candidateId: record.id, reference: referenceName, referenceId: other.id, csSimilarity: Number(csSimilarity.toFixed(3)), enSimilarity: Number(enSimilarity.toFixed(3)) });
      }
    }
  }
  return matches;
}

const records = rows.map(makeRecord);
const canonical = readJsonl(canonicalFile);
const firstCandidates = readJsonl(firstCandidateFile);
const coverage = JSON.parse(fs.readFileSync(coverageFile, "utf8"));
const coverageMap = new Map(coverage.targets.perTarget.map((entry) => [normalize(entry.normalized), entry]));
const errors = [];
const warnings = [];

if (records.length !== 80) errors.push("batch must contain exactly 80 records; found " + records.length);
const ids = new Set();
const sourceIds = new Set();
const ownCs = new Set();
const ownEn = new Set();
const canonicalCs = new Set(canonical.map((record) => sentenceKey(record.languages.cs.text)));
const canonicalEn = new Set(canonical.map((record) => sentenceKey(record.languages.en.text)));
const firstCs = new Set(firstCandidates.map((record) => sentenceKey(record.languages.cs.text)));
const firstEn = new Set(firstCandidates.map((record) => sentenceKey(record.languages.en.text)));

for (const record of records) {
  const cs = record.languages.cs.text;
  const en = record.languages.en.text;
  const csTokens = tokens(cs);
  const enTokens = tokens(en);
  const sourceId = record.provenance.sourceIds[0];
  if (ids.has(record.id)) errors.push("duplicate id: " + record.id);
  if (sourceIds.has(sourceId)) errors.push("duplicate source id: " + sourceId);
  ids.add(record.id);
  sourceIds.add(sourceId);
  const csKey = sentenceKey(cs);
  const enKey = sentenceKey(en);
  if (ownCs.has(csKey)) errors.push("duplicate Czech within batch: " + cs);
  if (ownEn.has(enKey)) errors.push("duplicate English within batch: " + en);
  ownCs.add(csKey);
  ownEn.add(enKey);
  if (canonicalCs.has(csKey)) errors.push("exact Czech duplicate against canonical: " + record.id);
  if (canonicalEn.has(enKey)) errors.push("exact English duplicate against canonical: " + record.id);
  if (firstCs.has(csKey)) errors.push("exact Czech duplicate against first candidate batch: " + record.id);
  if (firstEn.has(enKey)) errors.push("exact English duplicate against first candidate batch: " + record.id);
  if (csTokens.length < 3 || csTokens.length > 16) errors.push(record.id + " has " + csTokens.length + " Czech tokens");
  if (enTokens.length > 18) errors.push(record.id + " has " + enTokens.length + " English tokens");
  if (cs.length > 130) errors.push(record.id + " exceeds Czech character cap");
  if (en.length > 140) errors.push(record.id + " exceeds English character cap");
  if (record.grammar.clauseCount < 1 || record.grammar.clauseCount > 3) errors.push(record.id + " has invalid clause count");
  if (cs !== cs.normalize("NFC") || en !== en.normalize("NFC")) errors.push(record.id + " is not UTF-8 NFC text");
  if (record.targets.length !== 1) errors.push(record.id + " must have exactly one target");
  const target = record.targets[0];
  if (csTokens[target.tokenIndex] !== target.surface) errors.push(record.id + " has an inexact target position");
  const prior = coverageMap.get(target.normalized);
  if (!prior) errors.push(record.id + " target is not canonical-playable: " + target.normalized);
  else if (prior.recordCount >= 5) errors.push(record.id + " target is already strong: " + target.normalized);
}

const selfNear = nearMatches(records, records, "same batch").filter((entry) => entry.candidateId < entry.referenceId);
const canonicalNear = nearMatches(records, canonical, "canonical");
const firstCandidateNear = nearMatches(records, firstCandidates, "codex-expansion-0001");
if (selfNear.length || canonicalNear.length || firstCandidateNear.length) warnings.push("Near-duplicate candidates require manual resolution before independent review.");

const targetCounts = new Map();
for (const record of records) {
  const target = record.targets[0].normalized;
  targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
}
const targetDelta = [...targetCounts].map(([target, added]) => {
  const prior = coverageMap.get(target);
  const before = prior?.recordCount || 0;
  return { target, before, added, projected: before + added, priorTopics: prior?.topics || [] };
}).sort((a, b) => a.before - b.before || a.target.localeCompare(b.target, "cs"));

const byTopic = Object.groupBy(records, (record) => record.topic);
const byCefr = Object.groupBy(records, (record) => record.cefr);
const byClauseCount = Object.groupBy(records, (record) => String(record.grammar.clauseCount));
const bySentenceType = Object.groupBy(records, (record) => record.grammar.sentenceType);
const csTokenCounts = records.map((record) => tokens(record.languages.cs.text).length);
const withinPreferredBand = csTokenCounts.filter((count) => count >= 7 && count <= 13).length;
const openingCounts = new Map();
for (const record of records) {
  const opening = normalize(tokens(record.languages.cs.text)[0]);
  openingCounts.set(opening, (openingCounts.get(opening) || 0) + 1);
}

const report = {
  schemaVersion: "caatuu-word-world-candidate-authoring-report-v1",
  batchId: "codex-level3-0001",
  createdOn: "2026-07-22",
  disposition: "candidate_only_pending_independent_review",
  selfReviewIsAcceptance: false,
  counts: {
    records: records.length,
    byDifficulty: { "3": records.length },
    byCefr: Object.fromEntries(Object.entries(byCefr).map(([key, value]) => [key, value.length])),
    byTopic: Object.fromEntries(Object.entries(byTopic).map(([key, value]) => [key, value.length])),
    byClauseCount: Object.fromEntries(Object.entries(byClauseCount).map(([key, value]) => [key, value.length])),
    bySentenceType: Object.fromEntries(Object.entries(bySentenceType).map(([key, value]) => [key, value.length])),
    czechTokenRange: { minimum: Math.min(...csTokenCounts), maximum: Math.max(...csTokenCounts), withinPreferred7To13: withinPreferredBand, shareWithinPreferred7To13: Number((withinPreferredBand / records.length).toFixed(4)) }
  },
  targetCoverage: {
    distinctTargets: targetCounts.size,
    absentFromCanonicalPlayable: targetDelta.filter((entry) => entry.before === 0).length,
    singletonTargetsBefore: targetDelta.filter((entry) => entry.before === 1).length,
    nonStrongTargetsBefore: targetDelta.filter((entry) => entry.before > 0 && entry.before < 5).length,
    alreadyStrongTargetsBefore: targetDelta.filter((entry) => entry.before >= 5).length,
    projectedNewBranchableTargets: targetDelta.filter((entry) => entry.before === 1 && entry.projected >= 2).length,
    projectedNewStrongTargets: targetDelta.filter((entry) => entry.before < 5 && entry.projected >= 5).length,
    perTarget: targetDelta
  },
  duplicateScan: {
    exactWithinBatch: { czech: 0, english: 0 },
    exactAgainstCanonical: { czech: 0, english: 0 },
    exactAgainstFirstCandidateBatch: { czech: 0, english: 0 },
    nearWithinBatch: selfNear,
    nearAgainstCanonical: canonicalNear,
    nearAgainstFirstCandidateBatch: firstCandidateNear,
    thresholds: { minimumCzechTokens: 5, czechJaccard: 0.75, englishJaccard: 0.8 }
  },
  diversity: {
    topCzechOpenings: [...openingCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "cs")).slice(0, 12).map(([opening, count]) => ({ opening, count }))
  },
  selfCheck: {
    passed: errors.length === 0 && selfNear.length === 0 && canonicalNear.length === 0 && firstCandidateNear.length === 0,
    errors,
    warnings,
    checks: [
      "exactly 80 Level 3 candidate records",
      "difficulty and CEFR contract",
      "Czech and English token and character caps",
      "preferred 7-13 Czech-token band",
      "UTF-8 NFC strings",
      "exactly one exact-position playable target",
      "target exists in canonical coverage and is not strong",
      "exact duplicate scan against canonical and first candidate batch",
      "Jaccard near-duplicate scan against canonical and first candidate batch",
      "author bilingual, grammatical-gender, child-safety, and hidden-context pass"
    ]
  },
  reviewRequired: [
    "independent Czech-English naturalness and semantic-equivalence review",
    "independent Level 3 difficulty, clause, and morphology review",
    "independent child-safety and guided-learning review",
    "license confirmation for first-party candidate data",
    "promotion decision per record; rejected records must not enter source/"
  ]
};

const recordsText = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
const manifest = {
  schemaVersion: "caatuu-word-world-candidate-manifest-v1",
  batchId: "codex-level3-0001",
  createdOn: "2026-07-22",
  recordsFile: path.basename(outputFile),
  recordsSha256: crypto.createHash("sha256").update(recordsText).digest("hex"),
  authoringReport: path.basename(reportFile),
  generatorFile: path.basename(import.meta.filename),
  recordCount: records.length,
  difficultyIntent: { level1: "not included", level2: "not included", level3: "richer bounded language candidate layer" },
  status: "candidate",
  acceptedIntoCanonicalSource: false,
  compiledIntoRuntimePack: false,
  externalCorpusTextUsed: false,
  sourceName: "Caatuu Word World Codex Level 3 expansion",
  sourceType: "codex_authored",
  licenseDisposition: "pending project confirmation before promotion",
  reviewDisposition: "author self-check complete; independent review required",
  intendedUse: "Supply a genuine Level 3 layer with bounded richer syntax, useful morphology, concrete contexts, and existing weak branch targets."
};

fs.writeFileSync(outputFile, recordsText, "utf8");
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");

if (!report.selfCheck.passed) {
  console.error(JSON.stringify(report.selfCheck, null, 2));
  process.exitCode = 1;
} else {
  console.log("Wrote " + records.length + " Level 3 candidates.");
  console.log("Preferred 7-13 Czech-token band: " + withinPreferredBand + "/" + records.length + ".");
  console.log("Projected new branchable targets: " + report.targetCoverage.projectedNewBranchableTargets + ".");
}
