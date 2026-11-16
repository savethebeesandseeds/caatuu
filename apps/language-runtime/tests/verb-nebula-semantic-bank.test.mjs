import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCoreVerbPairs, validateVerbNebulaCatalog } from '../static/source/games/verb-nebula/verb-nebula-core.mjs';

const spanishBase = [
  {id:'es-en.verb-lab.000001', semanticBankId:'sb.verb-lab.000001', kind:'verb', source:'comer', target:'eat', englishAuditText:'eat', difficulty:1, usefulness:95, complexity:20},
  {id:'es-en.verb-lab.000002', semanticBankId:'sb.verb-lab.000002', kind:'verb', source:'beber', target:'drink', englishAuditText:'drink', difficulty:1, usefulness:94, complexity:21}
];

test('mixed Spanish-base verb catalogs retain authored identities and skip placeholders', () => {
  const placeholder = {...spanishBase[0], id:'es-en.verb-lab.000003', semanticBankId:'sb.verb-lab.000003', source:'', target:'walk', reviewStatus:'untranslated'};
  const pairs = validateVerbNebulaCatalog([placeholder, ...spanishBase], {learnerBaseLanguage:'es-ES'});
  assert.deepEqual(pairs.map(pair => [pair.id, pair.semanticBankId, pair.englishAuditText, pair.sourceIndex]), [
    [spanishBase[0].id, spanishBase[0].semanticBankId, 'eat', 1],
    [spanishBase[1].id, spanishBase[1].semanticBankId, 'drink', 2]
  ]);
});

test('an untranslated status prevents accidentally filled drafts from reaching play', () => {
  assert.deepEqual(extractCoreVerbPairs(spanishBase.map(row => ({...row, reviewStatus:'untranslated'})), {learnerBaseLanguage:'es-ES'}), []);
});

test('partial catalogs still reject duplicate authored answers and missing English audit text', () => {
  assert.throws(() => validateVerbNebulaCatalog([...spanishBase, {...spanishBase[0], id:'another-id'}], {learnerBaseLanguage:'es-ES'}), /distinct authored/u);
  assert.throws(() => validateVerbNebulaCatalog([{...spanishBase[0], englishAuditText:''}, spanishBase[1]], {learnerBaseLanguage:'es-ES'}), /explicit English audit/u);
});

test('verb references must name the correct bank while legacy pairs remain accepted', () => {
  assert.throws(() => extractCoreVerbPairs([{...spanishBase[0], semanticBankId:'sb.word-net.000001'}]), /semanticBankId/u);
  const legacy = spanishBase.map(({semanticBankId, ...row}) => row);
  assert.equal(validateVerbNebulaCatalog(legacy, {learnerBaseLanguage:'es-ES'}).length, 2);
});
