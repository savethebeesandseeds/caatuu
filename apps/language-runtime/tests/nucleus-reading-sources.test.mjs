import assert from "node:assert/strict";
import test from "node:test";
import { readNucleusSourceInputs, validateNucleusReadingSources } from "../../../tools/language-content/validate-nucleus-reading-sources.mjs";

for (const courseId of ["zh", "ar"]) {
  test(`${courseId}: bank-linked readings cite the exact authored course occurrence`, async () => {
    const inputs = await readNucleusSourceInputs(courseId);
    const authored = inputs.catalog.challenges.filter(row => row.semanticBankId && row.reviewStatus !== "untranslated");
    assert.equal(validateNucleusReadingSources(inputs).checked, authored.length);
    assert.ok(authored.length > 0);
    const clone = () => structuredClone(inputs);
    const first = value => value.catalog.challenges.find(row => row.semanticBankId && row.reviewStatus !== "untranslated");
    let broken = clone();
    first(broken).usefulness = first(broken).usefulness === 100 ? 99 : 100;
    assert.throws(() => validateNucleusReadingSources(broken), /usefulness changed/);
    broken = clone();
    first(broken).englishAuditText = "unrelated meaning";
    assert.throws(() => validateNucleusReadingSources(broken), /English audit changed/);
    broken = clone();
    if (courseId === "zh") {
      first(broken).context.text = "无关。";
      assert.throws(() => validateNucleusReadingSources(broken), /context target differs/);
      broken = clone();
      first(broken).pinyin = "mā";
      assert.throws(() => validateNucleusReadingSources(broken), /no matching authored occurrence/);
    } else {
      first(broken).sourceItemIds = [];
      assert.throws(() => validateNucleusReadingSources(broken), /at least one authored source token/);
      broken = clone();
      first(broken).sourceItemIds = ["sb.naturalization-nucleus.000001"];
      assert.throws(() => validateNucleusReadingSources(broken), /actual Word Net record/);
      broken = clone();
      first(broken).reading = "incorrect";
      assert.throws(() => validateNucleusReadingSources(broken), /written vowels/);
    }
    broken = clone();
    for (const record of broken.wordNetSource.records) record.reviewStatus = "untranslated";
    assert.throws(() => validateNucleusReadingSources(broken), /missing authored source/);
  });
}
