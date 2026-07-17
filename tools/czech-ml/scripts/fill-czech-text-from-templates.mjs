#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromRoot } from "./paths.mjs";
import { toJsonl } from "./jsonl.mjs";

const coreFile = path.resolve(
  process.argv.includes("--file")
    ? process.argv[process.argv.indexOf("--file") + 1]
    : fromRoot("data", "curriculum", "core-v0.2", "curated", "curriculum-core.en.jsonl"),
);
const dryRun = process.argv.includes("--dry-run");

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${file}:${index + 1}: ${error.message}`);
    }
  });
}

function translate(row) {
  const text = row.english_text;
  const normalized = text.replace(/\s+/g, " ").trim();
  const targetWords = new Set((row.target_words || []).map((word) => normalizeToken(word)));

  return firstMatch(normalized, [
    [/^(?:A|An) ([a-z]+) (runs|walks|jumps|sits|sleeps|plays|sings|smiles|laughs|swims|dances|waits|listens|rests|claps|waves) (in|at|on|by) the ([a-z]+)\.$/i,
      ([, subject, verb, prep, place]) => `${subjectNom(subject)} ${intransitive(verb)} ${placePhrase(prep, place)}.`],
    [/^(?:A|An) ([a-z]+) eats (?:a|an|some)? ?([a-z]+)\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} jí ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) drinks (?:a|an|some)? ?([a-z]+)\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} pije ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) has (?:a|an|some) ([a-z]+)\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} má ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) has pants\.$/i,
      ([, subject]) => `${subjectNom(subject)} má kalhoty.`],
    [/^(?:A|An) ([a-z]+) wears pants\.$/i,
      ([, subject]) => `${subjectNom(subject)} nosí kalhoty.`],
    [/^(?:A|An) ([a-z]+) chooses pants\.$/i,
      ([, subject]) => `${subjectNom(subject)} vybírá kalhoty.`],
    [/^(?:A|An) ([a-z]+) likes pants\.$/i,
      ([, subject]) => `${subjectNom(subject)} ${likesVerb(subject)} kalhoty.`],
    [/^(?:A|An) ([a-z]+) (sees|watches|finds|holds|carries|takes|chooses|opens|closes|washes|pushes|pulls|makes|draws|reads|uses) (?:the|a|an|some) ([a-z]+)\.$/i,
      ([, subject, verb, object]) => `${subjectNom(subject)} ${transitive(verb, object)} ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) touches (?:the|a|an|some) ([a-z]+)\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} sahá na ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) (likes|wants|needs) (?:a|an|some) ([a-z]+)\.$/i,
      ([, subject, verb, object]) => `${subjectNom(subject)} ${preferenceVerb(subject, verb)} ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) wears (?:a|an|the) ([a-z]+)\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} nosí ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) wears the ([a-z]+) ([a-z]+)\.$/i,
      ([, subject, adjective, object]) => `${subjectNom(subject)} nosí ${nounPhraseAcc(object, adjective)}.`],
    [/^(?:A|An) ([a-z]+) puts (?:the|a|an) ([a-z]+) (in|on) (?:the|a|an) ([a-z]+)\.$/i,
      ([, subject, object, prep, place]) => `${subjectNom(subject)} dává ${nounAcc(object)} ${destinationPhrase(prep, place)}.`],
    [/^(?:A|An) ([a-z]+) gives the ([a-z]+) (?:a|an|some) ([a-z]+)\.$/i,
      ([, subject, recipient, object]) => `${subjectNom(subject)} dává ${personDat(recipient)} ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) gives the ([a-z]+) a small ([a-z]+)\.$/i,
      ([, subject, recipient, object]) => `${subjectNom(subject)} dává ${personDat(recipient)} ${nounPhraseAcc(object, "small")}.`],
    [/^(?:A|An) ([a-z]+) helps the ([a-z]+)\.$/i,
      ([, subject, recipient]) => `${subjectNom(subject)} pomáhá ${personDat(recipient)}.`],
    [/^(?:A|An) ([a-z]+) does not (read|draw|play|walk|sleep|sing|run|jump|swim|sit)\.$/i,
      ([, subject, verb]) => `${subjectNom(subject)} ${negativeVerb(verb)}.`],
    [/^(?:A|An) ([a-z]+) does not (run|jump|walk|swim) fast\.$/i,
      ([, subject, verb]) => `${subjectNom(subject)} ${negativeVerb(verb)} rychle.`],
    [/^The ([a-z]+) is ([a-z]+)\.$/i,
      ([, object, adjective]) => `${sentenceStart(nounNom(object))} ${beVerb(object)} ${adjNom(object, adjective)}.`],
    [/^The ([a-z]+) are ([a-z]+)\.$/i,
      ([, object, adjective]) => `${sentenceStart(nounNom(object))} jsou ${adjNom(object, adjective)}.`],
    [/^The ([a-z]+) is very ([a-z]+)\.$/i,
      ([, object, adjective]) => `${sentenceStart(nounNom(object))} ${beVerb(object)} velmi ${adjNom(object, adjective)}.`],
    [/^Is the ([a-z]+) ([a-z]+)\?$/i,
      ([, object, adjective]) => `${questionBe(object)} ${nounNom(object)} ${adjNom(object, adjective)}?`],
    [/^Is the ([a-z]+) very ([a-z]+)\?$/i,
      ([, object, adjective]) => `${questionBe(object)} ${nounNom(object)} velmi ${adjNom(object, adjective)}?`],
    [/^Where is the ([a-z]+)\?$/i,
      ([, object]) => `Kde ${beVerb(object)} ${nounNom(object)}?`],
    [/^Can you see the ([a-z]+)\?$/i,
      ([, object]) => `Vidíš ${nounAcc(object)}?`],
    [/^Do you like (?:a|an|some) ([a-z]+)\?$/i,
      ([, object]) => `Máš rád ${nounAcc(object)}?`],
    [/^Do you want (?:a|an|some) ([a-z]+)\?$/i,
      ([, object]) => `Chceš ${nounAcc(object)}?`],
    [/^Please (open|close) the ([a-z]+) box\.$/i,
      ([, verb, modifier]) => `Prosím, ${imperative(verb, "box")} ${compoundBox(modifier)}.`],
    [/^Please (open|close) the ([a-z]+) now\.$/i,
      ([, verb, object]) => `Prosím, ${imperative(verb, object)} teď ${nounAcc(object)}.`],
    [/^Please (take|open|close|read|draw|find|hold|wash) the ([a-z]+)\.$/i,
      ([, verb, object]) => `Prosím, ${imperative(verb, object)} ${nounAcc(object)}.`],
    [/^Please (open|close) the ([a-z]+) ([a-z]+)\.$/i,
      ([, verb, adjective, object]) => `Prosím, ${imperative(verb, object)} ${nounPhraseAcc(object, adjective)}.`],
    [/^Please show me the ([a-z]+)\.$/i,
      ([, object]) => `Prosím, ukaž mi ${nounAcc(object)}.`],
    [/^Please put the ([a-z]+) on the table\.$/i,
      ([, object]) => `Prosím, dej ${nounAcc(object)} na stůl.`],
    [/^(?:A|An) ([a-z]+) uses (?:the|a|an) ([a-z]+) in class\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} používá ${nounAcc(object)} ve třídě.`],
    [/^(?:A|An) ([a-z]+) uses the ([a-z]+) ([a-z]+) in class\.$/i,
      ([, subject, adjective, object]) => `${subjectNom(subject)} ve třídě používá ${nounPhraseAcc(object, adjective)}.`],
    [/^(?:A|An) ([a-z]+) opens the ([a-z]+) ([a-z]+) in class\.$/i,
      ([, subject, adjective, object]) => `${subjectNom(subject)} ve třídě otevírá ${nounPhraseAcc(object, adjective)}.`],
    [/^(?:A|An) ([a-z]+) opens the ([a-z]+) in class\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} ve třídě otevírá ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) rides the(?: ([a-z]+))? bike on the path\.$/i,
      ([, subject, adjective]) => `${subjectNom(subject)} jede na ${adjective ? adjLoc("bike", adjective) + " " : ""}kole po cestě.`],
    [/^(?:A|An) ([a-z]+) shares the(?: ([a-z]+))? (cake|cookie) after lunch\.$/i,
      ([, subject, adjective, object]) => `${subjectNom(subject)} se po obědě dělí o ${nounPhraseAcc(object, adjective)}.`],
    [/^(?:A|An) ([a-z]+) tastes the ([a-z]+) with a spoon\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} ochutnává ${nounAcc(object)} lžící.`],
    [/^(?:A|An) ([a-z]+) eats the(?: ([a-z]+))? ([a-z]+) after lunch\.$/i,
      ([, subject, adjective, object]) => `${subjectNom(subject)} po obědě jí ${nounPhraseAcc(object, adjective)}.`],
    [/^(?:A|An) ([a-z]+) eats the ([a-z]+) at lunch\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} jí k obědu ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) reads (?:the|a)(?: ([a-z]+))? story before bed\.$/i,
      ([, subject, adjective]) => `${subjectNom(subject)} před spaním čte ${nounPhraseAcc("story", adjective)}.`],
    [/^(?:A|An) ([a-z]+) reads the story after lunch\.$/i,
      ([, subject]) => `${subjectNom(subject)} po obědě čte příběh.`],
    [/^(?:A|An) ([a-z]+) reads a short story to the ([a-z]+)\.$/i,
      ([, subject, recipient]) => `${subjectNom(subject)} čte ${personDat(recipient)} krátký příběh.`],
    [/^(?:A|An) ([a-z]+) carries the(?: ([a-z]+))? ([a-z]+) to the ([a-z]+)\.$/i,
      ([, subject, adjective, object, place]) => `${subjectNom(subject)} nese ${nounPhraseAcc(object, adjective)} ${toPhrase(place)}.`],
    [/^(?:A|An) ([a-z]+) looks for the ([a-z]+) near the ([a-z]+)\.$/i,
      ([, subject, object, place]) => `${subjectNom(subject)} hledá ${nounAcc(object)} ${nearPhrase(place)}.`],
    [/^(?:A|An) ([a-z]+) sees the(?: ([a-z]+))? ([a-z]+) near the ([a-z]+)\.$/i,
      ([, subject, adjective, object, place]) => `${subjectNom(subject)} vidí ${nounPhraseAcc(object, adjective)} ${nearPhrase(place)}.`],
    [/^(?:A|An) ([a-z]+) finds the(?: ([a-z]+))? ([a-z]+) (in|near) the ([a-z]+)\.$/i,
      ([, subject, adjective, object, prep, place]) => `${subjectNom(subject)} najde ${nounPhraseAcc(object, adjective)} ${prep === "in" ? placePhrase("in", place) : nearPhrase(place)}.`],
    [/^(?:A|An) ([a-z]+) points to the ([a-z]+)\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} ukazuje na ${nounAcc(object)}.`],
    [/^(?:A|An) ([a-z]+) moves the ([a-z]+) away from the ([a-z]+)\.$/i,
      ([, subject, object, place]) => `${subjectNom(subject)} posouvá ${nounAcc(object)} pryč od ${nounGen(place)}.`],
    [/^(?:A|An) ([a-z]+) builds the castle after school\.$/i,
      ([, subject]) => `${subjectNom(subject)} po škole staví hrad.`],
    [/^(?:A|An) ([a-z]+) puts the(?: ([a-z]+))? ([a-z]+) near the ([a-z]+)\.$/i,
      ([, subject, adjective, object, place]) => `${subjectNom(subject)} dává ${nounPhraseAcc(object, adjective)} k ${nounDatObject(place)}.`],
    [/^(?:A|An) ([a-z]+) puts the(?: ([a-z]+))? ([a-z]+) beside the ([a-z]+)\.$/i,
      ([, subject, adjective, object, person]) => `${subjectNom(subject)} dává ${nounPhraseAcc(object, adjective)} vedle ${nounGen(person)}.`],
    [/^(?:A|An) ([a-z]+) keeps the small ([a-z]+) for later\.$/i,
      ([, subject, object]) => `${subjectNom(subject)} si nechává ${nounPhraseAcc(object, "small")} na později.`],
    [/^(?:A|An) ([a-z]+) looks at the(?: ([a-z]+))? ([a-z]+) (?:with the ([a-z]+)|in class)\.$/i,
      ([, subject, adjective, object, person]) => person
        ? `${subjectNom(subject)} se s ${nounInstr(person)} dívá na ${nounPhraseAcc(object, adjective)}.`
        : `${subjectNom(subject)} se ve třídě dívá na ${nounPhraseAcc(object, adjective)}.`],
    [/^(?:A|An) ([a-z]+) takes the ([a-z]+) out of the ([a-z]+)\.$/i,
      ([, subject, object, place]) => `${subjectNom(subject)} bere ${nounAcc(object)} z ${nounGen(place)}.`],
    [/^(?:A|An) ([a-z]+) plays with the ([a-z]+) ([a-z]+) after school\.$/i,
      ([, subject, adjective, object]) => `${subjectNom(subject)} si po škole hraje ${withPhrase(nounPhraseInstr(object, adjective))}.`],
    [/^The ([a-z]+) is next to the ([a-z]+)\.$/i,
      ([, object, place]) => `${sentenceStart(nounNom(object))} ${beVerb(object)} vedle ${nounGen(place)}.`],
    [/^The ([a-z]+) is ready on the ([a-z]+)\.$/i,
      ([, object, place]) => `${sentenceStart(nounNom(object))} ${beVerb(object)} ${adjNom(object, "ready")} ${placePhrase("on", place)}.`],
    [/^The ([a-z]+) is in the ([a-z]+)\.$/i,
      ([, object, place]) => `${sentenceStart(nounNom(object))} ${beVerb(object)} ${placePhrase("in", place)}.`],
    [/^The ([a-z]+) is on the ([a-z]+)\.$/i,
      ([, object, place]) => `${sentenceStart(nounNom(object))} ${beVerb(object)} ${placePhrase("on", place)}.`],
    [/^The ([a-z]+) is beside the ([a-z]+)\.$/i,
      ([, object, place]) => `${sentenceStart(nounNom(object))} ${beVerb(object)} vedle ${nounGen(place)}.`],
    [/^The small ([a-z]+) is in the ([a-z]+)\.$/i,
      ([, object, place]) => `${sentenceStart(nounPhraseNom(object, "small"))} ${beVerb(object)} ${placePhrase("in", place)}.`],
    [/^The small ([a-z]+) is between the ([a-z]+) and the ([a-z]+)\.$/i,
      ([, object, first, second]) => `${sentenceStart(nounPhraseNom(object, "small"))} ${beVerb(object)} mezi ${nounInstr(first)} a ${nounInstr(second)}.`],
    [/^I can find the ([a-z]+) on the ([a-z]+)\.$/i,
      ([, object, place]) => `Najdu ${nounAcc(object)} ${placePhrase("on", place)}.`],
    [/^I can see the bright star at night\.$/i,
      () => "V noci vidím jasnou hvězdu."],
    [/^We look at the ([a-z]+) together\.$/i,
      ([, object]) => `Společně se díváme na ${nounAcc(object)}.`],
  ], targetWords, normalized);
}

function firstMatch(text, patterns, targetWords, original) {
  for (const [regex, render] of patterns) {
    const match = text.match(regex);
    if (match) return render(match, targetWords);
  }
  throw new Error(`No Czech template for: ${original}`);
}

function normalizeToken(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z]/g, "");
}

const nounForms = {
  dog: forms("pes", "psa", "psovi", "psa", "psovi", "psem", "m", true),
  cat: forms("kočka", "kočku", "kočce", "kočky", "kočce", "kočkou", "f"),
  bird: forms("pták", "ptáka", "ptákovi", "ptáka", "ptákovi", "ptákem", "m", true),
  fish: forms("ryba", "rybu", "rybě", "ryby", "rybě", "rybou", "f"),
  rabbit: forms("králík", "králíka", "králíkovi", "králíka", "králíkovi", "králíkem", "m", true),
  horse: forms("kůň", "koně", "koni", "koně", "koni", "koněm", "m", true),
  duck: forms("kachna", "kachnu", "kachně", "kachny", "kachně", "kachnou", "f"),
  mouse: forms("myš", "myš", "myši", "myši", "myši", "myší", "f"),
  cow: forms("kráva", "krávu", "krávě", "krávy", "krávě", "krávou", "f"),
  sheep: forms("ovce", "ovci", "ovci", "ovce", "ovci", "ovcí", "f"),
  goat: forms("koza", "kozu", "koze", "kozy", "koze", "kozou", "f"),
  chicken: forms("kuře", "kuře", "kuřeti", "kuřete", "kuřeti", "kuřetem", "n"),
  frog: forms("žába", "žábu", "žábě", "žáby", "žábě", "žábou", "f"),
  turtle: forms("želva", "želvu", "želvě", "želvy", "želvě", "želvě", "f"),
  bee: forms("včela", "včelu", "včele", "včely", "včele", "včelou", "f"),
  butterfly: forms("motýl", "motýla", "motýlovi", "motýla", "motýlovi", "motýlem", "m", true),
  ant: forms("mravenec", "mravence", "mravenci", "mravence", "mravenci", "mravencem", "m", true),
  bear: forms("medvěd", "medvěda", "medvědovi", "medvěda", "medvědovi", "medvědem", "m", true),
  lion: forms("lev", "lva", "lvovi", "lva", "lvovi", "lvem", "m", true),
  elephant: forms("slon", "slona", "slonovi", "slona", "slonovi", "slonem", "m", true),
  monkey: forms("opice", "opici", "opici", "opice", "opici", "opicí", "f"),
  pig: forms("prase", "prase", "praseti", "prasete", "praseti", "prasetem", "n"),
  deer: forms("jelen", "jelena", "jelenovi", "jelena", "jelenovi", "jelenem", "m", true),
  fox: forms("liška", "lišku", "lišce", "lišky", "lišce", "liškou", "f"),

  mother: forms("maminka", "maminku", "mamince", "maminky", "mamince", "maminkou", "f"),
  father: forms("tatínek", "tatínka", "tatínkovi", "tatínka", "tatínkovi", "tatínkem", "m", true),
  sister: forms("sestra", "sestru", "sestře", "sestry", "sestře", "sestrou", "f"),
  brother: forms("bratr", "bratra", "bratrovi", "bratra", "bratrovi", "bratrem", "m", true),
  child: forms("dítě", "dítě", "dítěti", "dítěte", "dítěti", "dítětem", "n"),
  baby: forms("miminko", "miminko", "miminku", "miminka", "miminku", "miminkem", "n"),
  friend: forms("kamarád", "kamaráda", "kamarádovi", "kamaráda", "kamarádovi", "kamarádem", "m", true),
  teacher: forms("učitel", "učitele", "učiteli", "učitele", "učiteli", "učitelem", "m", true),
  girl: forms("dívka", "dívku", "dívce", "dívky", "dívce", "dívkou", "f"),
  boy: forms("chlapec", "chlapce", "chlapci", "chlapce", "chlapci", "chlapcem", "m", true),
  parent: forms("rodič", "rodiče", "rodiči", "rodiče", "rodiči", "rodičem", "m", true),
  grandma: forms("babička", "babičku", "babičce", "babičky", "babičce", "babičkou", "f"),
  grandpa: forms("děda", "dědu", "dědovi", "dědy", "dědovi", "dědou", "m", true),
  student: forms("žák", "žáka", "žákovi", "žáka", "žákovi", "žákem", "m", true),
  neighbor: forms("soused", "souseda", "sousedovi", "souseda", "sousedovi", "sousedem", "m", true),
  family: forms("rodina", "rodinu", "rodině", "rodiny", "rodině", "rodinou", "f"),

  house: forms("dům", "dům", "domu", "domu", "domě", "domem", "m"),
  room: forms("pokoj", "pokoj", "pokoji", "pokoje", "pokoji", "pokojem", "m"),
  bed: forms("postel", "postel", "posteli", "postele", "posteli", "postelí", "f"),
  chair: forms("židle", "židli", "židli", "židle", "židli", "židlí", "f"),
  table: forms("stůl", "stůl", "stolu", "stolu", "stole", "stolem", "m"),
  door: forms("dveře", "dveře", "dveřím", "dveří", "dveřích", "dveřmi", "pl"),
  window: forms("okno", "okno", "oknu", "okna", "okně", "oknem", "n"),
  garden: forms("zahrada", "zahradu", "zahradě", "zahrady", "zahradě", "zahradou", "f"),
  yard: forms("dvůr", "dvůr", "dvoru", "dvora", "dvoře", "dvorem", "m"),
  kitchen: forms("kuchyně", "kuchyni", "kuchyni", "kuchyně", "kuchyni", "kuchyní", "f"),
  bathroom: forms("koupelna", "koupelnu", "koupelně", "koupelny", "koupelně", "koupelnou", "f"),
  bedroom: forms("ložnice", "ložnici", "ložnici", "ložnice", "ložnici", "ložnicí", "f"),
  floor: forms("podlaha", "podlahu", "podlaze", "podlahy", "podlaze", "podlahou", "f"),
  wall: forms("zeď", "zeď", "zdi", "zdi", "zdi", "zdí", "f"),
  lamp: forms("lampa", "lampu", "lampě", "lampy", "lampě", "lampou", "f"),
  cup: forms("hrnek", "hrnek", "hrnku", "hrnku", "hrnku", "hrnkem", "m"),
  plate: forms("talíř", "talíř", "talíři", "talíře", "talíři", "talířem", "m"),
  spoon: forms("lžíce", "lžíci", "lžíci", "lžíce", "lžíci", "lžící", "f"),
  blanket: forms("deka", "deku", "dece", "deky", "dece", "dekou", "f"),
  pillow: forms("polštář", "polštář", "polštáři", "polštáře", "polštáři", "polštářem", "m"),
  clock: forms("hodiny", "hodiny", "hodinám", "hodin", "hodinách", "hodinami", "pl"),
  shelf: forms("police", "polici", "polici", "police", "polici", "policí", "f"),
  sofa: forms("pohovka", "pohovku", "pohovce", "pohovky", "pohovce", "pohovkou", "f"),
  basket: forms("košík", "košík", "košíku", "košíku", "košíku", "košíkem", "m"),
  key: forms("klíč", "klíč", "klíči", "klíče", "klíči", "klíčem", "m"),
  drawer: forms("zásuvka", "zásuvku", "zásuvce", "zásuvky", "zásuvce", "zásuvkou", "f"),
  cupboard: forms("skříňka", "skříňku", "skříňce", "skříňky", "skříňce", "skříňkou", "f"),
  cabinet: forms("skříňka", "skříňku", "skříňce", "skříňky", "skříňce", "skříňkou", "f"),
  bottle: forms("láhev", "láhev", "láhvi", "láhve", "láhvi", "lahví", "f"),
  jar: forms("sklenice", "sklenici", "sklenici", "sklenice", "sklenici", "sklenicí", "f"),
  mailbox: forms("schránka", "schránku", "schránce", "schránky", "schránce", "schránkou", "f"),
  folder: forms("složka", "složku", "složce", "složky", "složce", "složkou", "f"),

  school: forms("škola", "školu", "škole", "školy", "škole", "školou", "f"),
  classroom: forms("třída", "třídu", "třídě", "třídy", "třídě", "třídou", "f"),
  library: forms("knihovna", "knihovnu", "knihovně", "knihovny", "knihovně", "knihovnou", "f"),
  book: forms("kniha", "knihu", "knize", "knihy", "knize", "knihou", "f"),
  pen: forms("pero", "pero", "peru", "pera", "peru", "perem", "n"),
  pencil: forms("tužka", "tužku", "tužce", "tužky", "tužce", "tužkou", "f"),
  bag: forms("taška", "tašku", "tašce", "tašky", "tašce", "taškou", "f"),
  paper: forms("papír", "papír", "papíru", "papíru", "papíru", "papírem", "m"),
  notebook: forms("sešit", "sešit", "sešitu", "sešitu", "sešitu", "sešitem", "m"),
  lesson: forms("lekce", "lekci", "lekci", "lekce", "lekci", "lekcí", "f"),
  desk: forms("lavice", "lavici", "lavici", "lavice", "lavici", "lavicí", "f"),
  picture: forms("obrázek", "obrázek", "obrázku", "obrázku", "obrázku", "obrázkem", "m"),
  ruler: forms("pravítko", "pravítko", "pravítku", "pravítka", "pravítku", "pravítkem", "n"),
  crayon: forms("pastelka", "pastelku", "pastelce", "pastelky", "pastelce", "pastelkou", "f"),
  board: forms("tabule", "tabuli", "tabuli", "tabule", "tabuli", "tabulí", "f"),
  eraser: forms("guma", "gumu", "gumě", "gumy", "gumě", "gumou", "f"),
  page: forms("stránka", "stránku", "stránce", "stránky", "stránce", "stránkou", "f"),
  story: forms("příběh", "příběh", "příběhu", "příběhu", "příběhu", "příběhem", "m"),
  letter: forms("dopis", "dopis", "dopisu", "dopisu", "dopisu", "dopisem", "m"),
  number: forms("číslo", "číslo", "číslu", "čísla", "číslu", "číslem", "n"),

  apple: forms("jablko", "jablko", "jablku", "jablka", "jablku", "jablkem", "n"),
  bread: forms("chléb", "chléb", "chlebu", "chleba", "chlebu", "chlebem", "m"),
  water: forms("voda", "vodu", "vodě", "vody", "vodě", "vodou", "f"),
  milk: forms("mléko", "mléko", "mléku", "mléka", "mléku", "mlékem", "n"),
  rice: forms("rýže", "rýži", "rýži", "rýže", "rýži", "rýží", "f"),
  soup: forms("polévka", "polévku", "polévce", "polévky", "polévce", "polévkou", "f"),
  banana: forms("banán", "banán", "banánu", "banánu", "banánu", "banánem", "m"),
  cake: forms("koláč", "koláč", "koláči", "koláče", "koláči", "koláčem", "m"),
  cheese: forms("sýr", "sýr", "sýru", "sýra", "sýru", "sýrem", "m"),
  egg: forms("vejce", "vejce", "vejci", "vejce", "vejci", "vejcem", "n"),
  cookie: forms("sušenka", "sušenku", "sušence", "sušenky", "sušence", "sušenkou", "f"),
  carrot: forms("mrkev", "mrkev", "mrkvi", "mrkve", "mrkvi", "mrkví", "f"),
  potato: forms("brambora", "bramboru", "bramboře", "brambory", "bramboře", "bramborou", "f"),
  sandwich: forms("sendvič", "sendvič", "sendviči", "sendviče", "sendviči", "sendvičem", "m"),
  juice: forms("šťáva", "šťávu", "šťávě", "šťávy", "šťávě", "šťávou", "f"),
  tea: forms("čaj", "čaj", "čaji", "čaje", "čaji", "čajem", "m"),
  orange: forms("pomeranč", "pomeranč", "pomeranči", "pomeranče", "pomeranči", "pomerančem", "m"),
  pear: forms("hruška", "hrušku", "hrušce", "hrušky", "hrušce", "hruškou", "f"),
  cereal: forms("cereálie", "cereálie", "cereáliím", "cereálií", "cereáliích", "cereáliemi", "pl"),
  yogurt: forms("jogurt", "jogurt", "jogurtu", "jogurtu", "jogurtu", "jogurtem", "m"),
  tomato: forms("rajče", "rajče", "rajčeti", "rajčete", "rajčeti", "rajčetem", "n"),
  salad: forms("salát", "salát", "salátu", "salátu", "salátu", "salátem", "m"),
  honey: forms("med", "med", "medu", "medu", "medu", "medem", "m"),
  pasta: forms("těstoviny", "těstoviny", "těstovinám", "těstovin", "těstovinách", "těstovinami", "pl"),

  tree: forms("strom", "strom", "stromu", "stromu", "stromě", "stromem", "m"),
  flower: forms("květina", "květinu", "květině", "květiny", "květině", "květinou", "f"),
  sun: forms("slunce", "slunce", "slunci", "slunce", "slunci", "sluncem", "n"),
  rain: forms("déšť", "déšť", "dešti", "deště", "dešti", "deštěm", "m"),
  sky: forms("nebe", "nebe", "nebi", "nebe", "nebi", "nebem", "n"),
  river: forms("řeka", "řeku", "řece", "řeky", "řece", "řekou", "f"),
  park: forms("park", "park", "parku", "parku", "parku", "parkem", "m"),
  hill: forms("kopec", "kopec", "kopci", "kopce", "kopci", "kopcem", "m"),
  grass: forms("tráva", "trávu", "trávě", "trávy", "trávě", "trávou", "f"),
  leaf: forms("list", "list", "listu", "listu", "listu", "listem", "m"),
  stone: forms("kámen", "kámen", "kameni", "kamene", "kameni", "kamenem", "m"),
  cloud: forms("mrak", "mrak", "mraku", "mraku", "mraku", "mrakem", "m"),
  snow: forms("sníh", "sníh", "sněhu", "sněhu", "sněhu", "sněhem", "m"),
  wind: forms("vítr", "vítr", "větru", "větru", "větru", "větrem", "m"),
  moon: forms("měsíc", "měsíc", "měsíci", "měsíce", "měsíci", "měsícem", "m"),
  star: forms("hvězda", "hvězdu", "hvězdě", "hvězdy", "hvězdě", "hvězdou", "f"),
  beach: forms("pláž", "pláž", "pláži", "pláže", "pláži", "pláží", "f"),
  lake: forms("jezero", "jezero", "jezeru", "jezera", "jezeru", "jezerem", "n"),
  path: forms("cesta", "cestu", "cestě", "cesty", "cestě", "cestou", "f"),
  forest: forms("les", "les", "lesu", "lesa", "lese", "lesem", "m"),
  seed: forms("semínko", "semínko", "semínku", "semínka", "semínku", "semínkem", "n"),
  sand: forms("písek", "písek", "písku", "písku", "písku", "pískem", "m"),
  mud: forms("bláto", "bláto", "blátu", "bláta", "blátě", "blátem", "n"),
  field: forms("pole", "pole", "poli", "pole", "poli", "polem", "n"),

  ball: forms("míč", "míč", "míči", "míče", "míči", "míčem", "m"),
  toy: forms("hračka", "hračku", "hračce", "hračky", "hračce", "hračkou", "f"),
  game: forms("hra", "hru", "hře", "hry", "hře", "hrou", "f"),
  song: forms("píseň", "píseň", "písni", "písně", "písni", "písní", "f"),
  bike: forms("kolo", "kolo", "kolu", "kola", "kole", "kolem", "n"),
  kite: forms("drak", "draka", "drakovi", "draka", "drakovi", "drakem", "m", true),
  box: forms("krabice", "krabici", "krabici", "krabice", "krabici", "krabicí", "f"),
  block: forms("kostka", "kostku", "kostce", "kostky", "kostce", "kostkou", "f"),
  doll: forms("panenka", "panenku", "panence", "panenky", "panence", "panenkou", "f"),
  puzzle: forms("puzzle", "puzzle", "puzzle", "puzzle", "puzzle", "puzzle", "n"),
  drum: forms("buben", "buben", "bubnu", "bubnu", "bubnu", "bubnem", "m"),
  swing: forms("houpačka", "houpačku", "houpačce", "houpačky", "houpačce", "houpačkou", "f"),
  slide: forms("skluzavka", "skluzavku", "skluzavce", "skluzavky", "skluzavce", "skluzavkou", "f"),
  rope: forms("provaz", "provaz", "provazu", "provazu", "provazu", "provazem", "m"),
  boat: forms("loď", "loď", "lodi", "lodi", "lodi", "lodí", "f"),
  train: forms("vlak", "vlak", "vlaku", "vlaku", "vlaku", "vlakem", "m"),
  car: forms("auto", "auto", "autu", "auta", "autě", "autem", "n"),
  plane: forms("letadlo", "letadlo", "letadlu", "letadla", "letadle", "letadlem", "n"),
  robot: forms("robot", "robota", "robotovi", "robota", "robotovi", "robotem", "m", true),
  castle: forms("hrad", "hrad", "hradu", "hradu", "hradu", "hradem", "m"),

  hand: forms("ruka", "ruku", "ruce", "ruky", "ruce", "rukou", "f"),
  foot: forms("noha", "nohu", "noze", "nohy", "noze", "nohou", "f"),
  eye: forms("oko", "oko", "oku", "oka", "oku", "okem", "n"),
  ear: forms("ucho", "ucho", "uchu", "ucha", "uchu", "uchem", "n"),
  nose: forms("nos", "nos", "nosu", "nosu", "nosu", "nosem", "m"),
  mouth: forms("ústa", "ústa", "ústům", "úst", "ústech", "ústy", "pl"),
  hair: forms("vlasy", "vlasy", "vlasům", "vlasů", "vlasech", "vlasy", "pl"),
  face: forms("obličej", "obličej", "obličeji", "obličeje", "obličeji", "obličejem", "m"),
  arm: forms("paže", "paži", "paži", "paže", "paži", "paží", "f"),
  leg: forms("noha", "nohu", "noze", "nohy", "noze", "nohou", "f"),
  head: forms("hlava", "hlavu", "hlavě", "hlavy", "hlavě", "hlavou", "f"),
  tooth: forms("zub", "zub", "zubu", "zubu", "zubu", "zubem", "m"),

  shirt: forms("košile", "košili", "košili", "košile", "košili", "košilí", "f"),
  shoe: forms("bota", "botu", "botě", "boty", "botě", "botou", "f"),
  hat: forms("čepice", "čepici", "čepici", "čepice", "čepici", "čepicí", "f"),
  coat: forms("kabát", "kabát", "kabátu", "kabátu", "kabátu", "kabátem", "m"),
  sock: forms("ponožka", "ponožku", "ponožce", "ponožky", "ponožce", "ponožkou", "f"),
  dress: forms("šaty", "šaty", "šatům", "šatů", "šatech", "šaty", "pl"),
  scarf: forms("šála", "šálu", "šále", "šály", "šále", "šálou", "f"),
  glove: forms("rukavice", "rukavici", "rukavici", "rukavice", "rukavici", "rukavicí", "f"),
  jacket: forms("bunda", "bundu", "bundě", "bundy", "bundě", "bundou", "f"),
  pants: forms("kalhoty", "kalhoty", "kalhotám", "kalhot", "kalhotách", "kalhotami", "pl"),
  skirt: forms("sukně", "sukni", "sukni", "sukně", "sukni", "sukní", "f"),
  boot: forms("bota", "botu", "botě", "boty", "botě", "botou", "f"),

  bus: forms("autobus", "autobus", "autobusu", "autobusu", "autobusu", "autobusem", "m"),
  road: forms("silnice", "silnici", "silnici", "silnice", "silnici", "silnicí", "f"),
  station: forms("stanice", "stanici", "stanici", "stanice", "stanici", "stanicí", "f"),
  stop: forms("zastávka", "zastávku", "zastávce", "zastávky", "zastávce", "zastávkou", "f"),
  street: forms("ulice", "ulici", "ulici", "ulice", "ulici", "ulicí", "f"),
  bridge: forms("most", "most", "mostu", "mostu", "mostě", "mostem", "m"),
  ticket: forms("lístek", "lístek", "lístku", "lístku", "lístku", "lístkem", "m"),
  morning: forms("ráno", "ráno", "ránu", "rána", "ránu", "ránem", "n"),
  day: forms("den", "den", "dni", "dne", "dni", "dnem", "m"),
  night: forms("noc", "noc", "noci", "noci", "noci", "nocí", "f"),
  homework: forms("úkol", "úkol", "úkolu", "úkolu", "úkolu", "úkolem", "m"),
  breakfast: forms("snídaně", "snídani", "snídani", "snídaně", "snídani", "snídaní", "f"),
  lunch: forms("oběd", "oběd", "obědu", "obědu", "obědě", "obědem", "m"),
  dinner: forms("večeře", "večeři", "večeři", "večeře", "večeři", "večeří", "f"),
  bath: forms("koupel", "koupel", "koupeli", "koupele", "koupeli", "koupelí", "f"),
  walk: forms("procházka", "procházku", "procházce", "procházky", "procházce", "procházkou", "f"),
  nap: forms("spánek", "spánek", "spánku", "spánku", "spánku", "spánkem", "m"),
  music: forms("hudba", "hudbu", "hudbě", "hudby", "hudbě", "hudbou", "f"),
  put: forms("věc", "věc", "věci", "věci", "věci", "věcí", "f"),
};

function forms(nom, acc, dat, gen, loc, instr, gender, animate = false) {
  return { nom, acc, dat, gen, loc, instr, gender, animate };
}

function noun(key) {
  const value = nounForms[normalizeToken(key)];
  if (!value) throw new Error(`Missing Czech noun: ${key}`);
  return value;
}

function subjectNom(key) {
  return sentenceStart(noun(key).nom);
}

function nounNom(key) {
  return noun(key).nom;
}

function nounAcc(key) {
  return noun(key).acc;
}

function nounDatObject(key) {
  return noun(key).dat;
}

function personDat(key) {
  return noun(key).dat;
}

function nounGen(key) {
  return noun(key).gen;
}

function nounInstr(key) {
  return noun(key).instr;
}

function beVerb(key) {
  return noun(key).gender === "pl" ? "jsou" : "je";
}

function questionBe(key) {
  return noun(key).gender === "pl" ? "Jsou" : "Je";
}

function sentenceStart(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function intransitive(verb) {
  return ({
    runs: "běží",
    walks: "jde",
    jumps: "skáče",
    sits: "sedí",
    sleeps: "spí",
    plays: "si hraje",
    sings: "zpívá",
    smiles: "usmívá se",
    laughs: "směje se",
    swims: "plave",
    dances: "tančí",
    waits: "čeká",
    listens: "poslouchá",
    rests: "odpočívá",
    claps: "tleská",
    waves: "mává",
  })[verb] ?? fail(`Missing intransitive verb: ${verb}`);
}

function transitive(verb, object) {
  if (verb === "washes" && ["shirt", "shoe", "plate", "cup"].includes(normalizeToken(object))) return "myje";
  return ({
    sees: "vidí",
    watches: "sleduje",
    finds: "najde",
    holds: "drží",
    carries: "nese",
    takes: "bere",
    chooses: "vybírá",
    opens: "otevírá",
    closes: "zavírá",
    washes: "myje",
    pushes: "tlačí",
    pulls: "táhne",
    makes: "dělá",
    draws: "kreslí",
    reads: "čte",
    uses: "používá",
  })[verb] ?? fail(`Missing transitive verb: ${verb}`);
}

function preferenceVerb(subject, verb) {
  if (verb === "likes") return likesVerb(subject);
  if (verb === "wants") return "chce";
  if (verb === "needs") return "potřebuje";
  return fail(`Missing preference verb: ${verb}`);
}

function likesVerb(subject) {
  const form = likeForm(subject);
  return `má ${form}`;
}

function likeForm(subject) {
  const gender = noun(subject).gender;
  if (gender === "f") return "ráda";
  if (gender === "n") return "rádo";
  return "rád";
}

function negativeVerb(verb) {
  return ({
    read: "nečte",
    draw: "nekreslí",
    play: "si nehraje",
    walk: "nejde",
    sleep: "nespí",
    sing: "nezpívá",
    run: "neběží",
    jump: "neskáče",
    swim: "neplave",
    sit: "nesedí",
  })[verb] ?? fail(`Missing negative verb: ${verb}`);
}

function imperative(verb, object) {
  if (verb === "wash" && ["shirt", "shoe"].includes(normalizeToken(object))) return "vyper";
  return ({
    take: "vezmi",
    open: "otevři",
    close: "zavři",
    read: "přečti",
    draw: "nakresli",
    find: "najdi",
    hold: "podrž",
    wash: "umyj",
  })[verb] ?? fail(`Missing imperative: ${verb}`);
}

function placePhrase(prep, place) {
  const key = normalizeToken(place);
  const special = {
    in: {
      garden: "na zahradě",
      classroom: "ve třídě",
      yard: "na dvoře",
      kitchen: "v kuchyni",
      forest: "v lese",
      field: "na poli",
      house: "v domě",
      room: "v pokoji",
      bedroom: "v ložnici",
      bathroom: "v koupelně",
      school: "ve škole",
      library: "v knihovně",
      box: "v krabici",
      bag: "v tašce",
      basket: "v košíku",
    },
    on: {
      hill: "na kopci",
      path: "po cestě",
      street: "na ulici",
      bridge: "na mostě",
      table: "na stole",
      desk: "na lavici",
      shelf: "na polici",
      bed: "na posteli",
      floor: "na podlaze",
      plate: "na talíři",
      box: "na krabici",
      chair: "na židli",
      basket: "v košíku",
    },
    at: {
      school: "ve škole",
      beach: "na pláži",
      station: "na stanici",
      stop: "na zastávce",
      table: "u stolu",
      door: "u dveří",
      lunch: "u oběda",
    },
    by: {
      river: "u řeky",
      lake: "u jezera",
      door: "u dveří",
    },
  };
  return special[prep]?.[key] ?? ({
    in: `v ${noun(key).loc}`,
    on: `na ${noun(key).loc}`,
    at: `u ${noun(key).gen}`,
    by: `u ${noun(key).gen}`,
  })[prep] ?? fail(`Missing place preposition: ${prep}`);
}

function destinationPhrase(prep, place) {
  const key = normalizeToken(place);
  if (prep === "in") {
    const special = {
      box: "do krabice",
      bag: "do tašky",
      basket: "do košíku",
      room: "do pokoje",
    };
    return special[key] ?? `do ${nounGen(key)}`;
  }
  if (prep === "on") {
    const special = {
      table: "na stůl",
      desk: "na lavici",
      shelf: "na polici",
      bed: "na postel",
      floor: "na podlahu",
      plate: "na talíř",
    };
    return special[key] ?? `na ${nounAcc(key)}`;
  }
  return fail(`Missing destination preposition: ${prep}`);
}

function toPhrase(place) {
  const key = normalizeToken(place);
  const special = {
    room: "do pokoje",
    table: "ke stolu",
    shelf: "k polici",
    desk: "k lavici",
    basket: "ke košíku",
    box: "ke krabici",
    classroom: "do třídy",
  };
  return special[key] ?? `k ${nounDatObject(key)}`;
}

function nearPhrase(place) {
  return `u ${nounGen(place)}`;
}

const adjectiveForms = {
  small: adj("malý", "malého", "malá", "malou", "malé", "malé", "malém", "malou", "malými"),
  big: adj("velký", "velkého", "velká", "velkou", "velké", "velké", "velkém", "velkou", "velkými"),
  little: adj("malý", "malého", "malá", "malou", "malé", "malé", "malém", "malou", "malými"),
  long: adj("dlouhý", "dlouhého", "dlouhá", "dlouhou", "dlouhé", "dlouhé", "dlouhém", "dlouhou", "dlouhými"),
  short: adj("krátký", "krátkého", "krátká", "krátkou", "krátké", "krátké", "krátkém", "krátkou", "krátkými"),
  red: adj("červený", "červeného", "červená", "červenou", "červené", "červené", "červeném", "červenou", "červenými"),
  blue: adj("modrý", "modrého", "modrá", "modrou", "modré", "modré", "modrém", "modrou", "modrými"),
  green: adj("zelený", "zeleného", "zelená", "zelenou", "zelené", "zelené", "zeleném", "zelenou", "zelenými"),
  yellow: adj("žlutý", "žlutého", "žlutá", "žlutou", "žluté", "žluté", "žlutém", "žlutou", "žlutými"),
  white: adj("bílý", "bílého", "bílá", "bílou", "bílé", "bílé", "bílém", "bílou", "bílými"),
  black: adj("černý", "černého", "černá", "černou", "černé", "černé", "černém", "černou", "černými"),
  brown: adj("hnědý", "hnědého", "hnědá", "hnědou", "hnědé", "hnědé", "hnědém", "hnědou", "hnědými"),
  happy: adj("šťastný", "šťastného", "šťastná", "šťastnou", "šťastné", "šťastné", "šťastném", "šťastnou", "šťastnými"),
  sad: adj("smutný", "smutného", "smutná", "smutnou", "smutné", "smutné", "smutném", "smutnou", "smutnými"),
  quiet: adj("tichý", "tichého", "tichá", "tichou", "tiché", "tiché", "tichém", "tichou", "tichými"),
  clean: adj("čistý", "čistého", "čistá", "čistou", "čisté", "čisté", "čistém", "čistou", "čistými"),
  warm: adj("teplý", "teplého", "teplá", "teplou", "teplé", "teplé", "teplém", "teplou", "teplými"),
  cold: adj("studený", "studeného", "studená", "studenou", "studené", "studené", "studeném", "studenou", "studenými"),
  soft: adj("měkký", "měkkého", "měkká", "měkkou", "měkké", "měkké", "měkkém", "měkkou", "měkkými"),
  hard: adj("tvrdý", "tvrdého", "tvrdá", "tvrdou", "tvrdé", "tvrdé", "tvrdém", "tvrdou", "tvrdými"),
  fast: adj("rychlý", "rychlého", "rychlá", "rychlou", "rychlé", "rychlé", "rychlém", "rychlou", "rychlými"),
  slow: adj("pomalý", "pomalého", "pomalá", "pomalou", "pomalé", "pomalé", "pomalém", "pomalou", "pomalými"),
  new: adj("nový", "nového", "nová", "novou", "nové", "nové", "novém", "novou", "novými"),
  old: adj("starý", "starého", "stará", "starou", "staré", "staré", "starém", "starou", "starými"),
  full: adj("plný", "plného", "plná", "plnou", "plné", "plné", "plném", "plnou", "plnými"),
  empty: adj("prázdný", "prázdného", "prázdná", "prázdnou", "prázdné", "prázdné", "prázdném", "prázdnou", "prázdnými"),
  wet: adj("mokrý", "mokrého", "mokrá", "mokrou", "mokré", "mokré", "mokrém", "mokrou", "mokrými"),
  dry: adj("suchý", "suchého", "suchá", "suchou", "suché", "suché", "suchém", "suchou", "suchými"),
  shiny: adj("lesklý", "lesklého", "lesklá", "lesklou", "lesklé", "lesklé", "lesklém", "lesklou", "lesklými"),
  sweet: adj("sladký", "sladkého", "sladká", "sladkou", "sladké", "sladké", "sladkém", "sladkou", "sladkými"),
  good: adj("dobrý", "dobrého", "dobrá", "dobrou", "dobré", "dobré", "dobrém", "dobrou", "dobrými"),
  bright: adj("jasný", "jasného", "jasná", "jasnou", "jasné", "jasné", "jasném", "jasnou", "jasnými"),
  pretty: adj("hezký", "hezkého", "hezká", "hezkou", "hezké", "hezké", "hezkém", "hezkou", "hezkými"),
  fresh: adj("čerstvý", "čerstvého", "čerstvá", "čerstvou", "čerstvé", "čerstvé", "čerstvém", "čerstvou", "čerstvými"),
  crunchy: adj("křupavý", "křupavého", "křupavá", "křupavou", "křupavé", "křupavé", "křupavém", "křupavou", "křupavými"),
  clear: adj("čistý", "čistého", "čistá", "čistou", "čisté", "čisté", "čistém", "čistou", "čistými"),
  easy: adj("snadný", "snadného", "snadná", "snadnou", "snadné", "snadné", "snadném", "snadnou", "snadnými"),
  hot: adj("horký", "horkého", "horká", "horkou", "horké", "horké", "horkém", "horkou", "horkými"),
  tiny: adj("maličký", "maličkého", "maličká", "maličkou", "maličké", "maličké", "maličkém", "maličkou", "maličkými"),
  round: adj("kulatý", "kulatého", "kulatá", "kulatou", "kulaté", "kulaté", "kulatém", "kulatou", "kulatými"),
  closed: adj("zavřený", "zavřeného", "zavřená", "zavřenou", "zavřené", "zavřené", "zavřeném", "zavřenou", "zavřenými"),
  ready: adj("připravený", "připraveného", "připravená", "připravenou", "připravené", "připravené", "připraveném", "připravenou", "připravenými"),
  open: adj("otevřený", "otevřeného", "otevřená", "otevřenou", "otevřené", "otevřené", "otevřeném", "otevřenou", "otevřenými"),
  orange: adj("oranžový", "oranžového", "oranžová", "oranžovou", "oranžové", "oranžové", "oranžovém", "oranžovou", "oranžovými"),
  fun: adj("zábavný", "zábavného", "zábavná", "zábavnou", "zábavné", "zábavné", "zábavném", "zábavnou", "zábavnými"),
};

function adj(mNom, mAccAnimate, fNom, fAcc, nNom, plNom, mLoc, fInstr, plInstr) {
  return { mNom, mAccAnimate, fNom, fAcc, nNom, plNom, mLoc, fInstr, plInstr };
}

function adjective(key) {
  const value = adjectiveForms[normalizeToken(key)];
  if (!value) throw new Error(`Missing Czech adjective: ${key}`);
  return value;
}

function adjNom(nounKey, adjectiveKey) {
  const form = adjective(adjectiveKey);
  const { gender } = noun(nounKey);
  if (gender === "f") return form.fNom;
  if (gender === "n") return form.nNom;
  if (gender === "pl") return form.plNom;
  return form.mNom;
}

function adjAcc(nounKey, adjectiveKey) {
  const form = adjective(adjectiveKey);
  const { gender, animate } = noun(nounKey);
  if (gender === "f") return form.fAcc;
  if (gender === "n") return form.nNom;
  if (gender === "pl") return form.plNom;
  if (animate) return form.mAccAnimate;
  return form.mNom;
}

function adjLoc(nounKey, adjectiveKey) {
  const form = adjective(adjectiveKey);
  const { gender } = noun(nounKey);
  if (gender === "f") return `${form.fNom.slice(0, -1)}é`;
  if (gender === "n") return form.mLoc;
  if (gender === "pl") return form.plNom;
  return form.mLoc;
}

function adjInstr(nounKey, adjectiveKey) {
  const form = adjective(adjectiveKey);
  const { gender } = noun(nounKey);
  if (gender === "f") return form.fInstr;
  if (gender === "pl") return form.plInstr;
  return form.nNom === form.mNom ? `${form.mNom}m` : form.mLoc;
}

function nounPhraseNom(nounKey, adjectiveKey) {
  return `${adjNom(nounKey, adjectiveKey)} ${nounNom(nounKey)}`;
}

function nounPhraseAcc(nounKey, adjectiveKey) {
  return adjectiveKey ? `${adjAcc(nounKey, adjectiveKey)} ${nounAcc(nounKey)}` : nounAcc(nounKey);
}

function nounPhraseInstr(nounKey, adjectiveKey) {
  return adjectiveKey ? `${adjInstr(nounKey, adjectiveKey)} ${nounInstr(nounKey)}` : nounInstr(nounKey);
}

function withPhrase(phrase) {
  return /^[szž]/i.test(phrase) ? `se ${phrase}` : `s ${phrase}`;
}

function compoundBox(modifier) {
  const key = normalizeToken(modifier);
  if (key === "paper") return "papírovou krabici";
  if (key === "lunch") return "krabičku na oběd";
  if (key === "toy") return "krabici s hračkami";
  return nounPhraseAcc("box", key);
}

function fail(message) {
  throw new Error(message);
}

async function main() {
  const rows = (await readJsonl(coreFile)).map((row) => ({ ...row, czech_text: row.czech_text ?? "" }));
  const changed = [];
  const failures = [];

  for (const row of rows) {
    if (String(row.czech_text || "").trim()) continue;
    try {
      row.czech_text = translate(row);
      changed.push(row.id);
    } catch (error) {
      failures.push({ id: row.id, english_text: row.english_text, error: error.message });
    }
  }

  if (failures.length) {
    console.error(JSON.stringify({ changed: changed.length, failures }, null, 2));
    process.exit(1);
  }

  if (!dryRun) {
    await fs.writeFile(coreFile, `${toJsonl(rows)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    file: coreFile,
    dry_run: dryRun,
    filled_blank_rows: changed.length,
    first_changed: changed[0] ?? null,
    last_changed: changed.at(-1) ?? null,
  }, null, 2));
}

await main();
