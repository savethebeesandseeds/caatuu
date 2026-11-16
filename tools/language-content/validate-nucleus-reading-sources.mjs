import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { romanizeArabic } from "../../apps/language-runtime/static/source/arabic-romanization.mjs";

// A bank defines the English meaning; it cannot prove a target-script reading.
// Bank-linked Nucleus content cites the actual authored Word Net occurrence.
export function validateNucleusReadingSources({ courseId, catalog, wordNetSource, semanticBank }) {
  assert.ok(["zh", "ar"].includes(courseId), "Only the Mandarin and Arabic reading courses are supported");
  assert.equal(catalog.courseId, courseId);
  const bank = new Map(semanticBank.map(row => [row.id, row]));
  const records = new Map(wordNetSource.records.map(row => [row.id, row]));
  let checked = 0;
  for (const challenge of catalog.challenges) {
    if (!challenge.semanticBankId) continue;
    const label = challenge.id;
    const meaning = bank.get(challenge.semanticBankId);
    assert.ok(meaning, `${label}: missing English bank row`);
    assert.equal(label, `${courseId}.naturalization-nucleus.${meaning.id.slice(-6)}`, `${label}: bank identity mismatch`);
    assert.equal(challenge.englishAuditText, meaning.englishText, `${label}: English audit changed`);
    for (const key of ["difficulty", "usefulness"]) assert.equal(challenge[key], meaning[key], `${label}: ${key} changed`);
    if (challenge.reviewStatus === "untranslated") continue;
    assert.equal(challenge.translation, meaning.englishText, `${label}: English meaning changed`);
    if (courseId === "zh") {
      const context = challenge.context;
      assert.ok(context, `${label}: missing authored context`);
      assert.ok(challenge.sourceConceptIds.includes(context.sourceConceptId), `${label}: context source is undeclared`);
      for (const id of challenge.sourceConceptIds) {
        const source = records.get(id);
        assert.ok(source && source.reviewStatus !== "untranslated", `${label}: missing authored source ${id}`);
      }
      const source = records.get(context.sourceConceptId);
      assert.equal(context.text, source.targetText, `${label}: context target differs from source`);
      assert.equal(context.meaning, source.englishText, `${label}: context meaning differs from source`);
      const units = source.tokens.flatMap(token => token.readingUnits ?? []);
      assert.equal(context.notation, units.map(unit => unit.pronunciation.notation).join(" "), `${label}: context reading differs from authored source`);
      assert.ok(units.some(unit => unit.surface === challenge.hanzi && unit.pronunciation.notation === challenge.pinyin), `${label}: character reading has no matching authored occurrence`);
    } else {
      assert.ok(Array.isArray(challenge.sourceItemIds) && challenge.sourceItemIds.length > 0, `${label}: at least one authored source token is required`);
      for (const id of challenge.sourceItemIds) {
        const match = /^(ar\.word-net\.\d{6})#token-([1-9]\d*)$/u.exec(id);
        assert.ok(match, `${label}: expected actual Word Net record and one-based token reference`);
        const source = records.get(match[1]);
        assert.ok(source && source.reviewStatus !== "untranslated", `${label}: missing authored source ${match[1]}`);
        assert.equal(source.tokens[Number(match[2]) - 1]?.surface, challenge.target, `${label}: target differs from cited source token`);
      }
      assert.equal(romanizeArabic(challenge.target), challenge.reading, `${label}: reading disagrees with the authored written vowels`);
    }
    checked += 1;
  }
  return { courseId, checked };
}

export async function readNucleusSourceInputs(courseId) {
  const directory = { zh: "mandarin-simplified", ar: "arabic-standard" }[courseId];
  assert.ok(directory, `Unknown reading course: ${courseId}`);
  const json = async path => JSON.parse(await readFile(path, "utf8"));
  const [catalog, wordNetSource, semanticBank] = await Promise.all([
    json(`apps/languages/${directory}/static/data/games/naturalization-nucleus/content.json`),
    json(`apps/languages/${directory}/content/word-world/content.json`),
    json("apps/languages/shared/semantic-banks/naturalization-nucleus.json")
  ]);
  return { courseId, catalog, wordNetSource, semanticBank };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courseIds = process.argv.slice(2);
  assert.ok(courseIds.length > 0, "Usage: validate-nucleus-reading-sources.mjs zh [ar]");
  for (const courseId of courseIds) console.log(JSON.stringify(validateNucleusReadingSources(await readNucleusSourceInputs(courseId))));
}
