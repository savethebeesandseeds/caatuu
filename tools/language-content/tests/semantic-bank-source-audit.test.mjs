import assert from 'node:assert/strict';
import test from 'node:test';
import {auditSemanticBankDocument} from '../audit-semantic-bank-content.mjs';
const authority={id:'sb.verb-lab.000001',englishText:'read',difficulty:0,usefulness:90};
const row={id:'es-en.verb-lab.000001',semanticBankId:authority.id,source:'leer',target:'read',difficulty:0,usefulness:90};
test('source inventory separates unfinished records while preserving the English target role',()=>{
 const result=auditSemanticBankDocument('es-en','verb-lab',[row],[authority]);
 assert.equal(result.authoredRootRecords,1);
 assert.equal(result.untranslatedRootRecords,0);
 assert.equal(auditSemanticBankDocument('es-en','verb-lab',[{...row,source:'',reviewStatus:'untranslated'}],[authority]).untranslatedRootRecords,1);
 for(const changed of [{...row,target:'write'},{...row,difficulty:1},{...row,id:'replacement'}])
  assert.throws(()=>auditSemanticBankDocument('es-en','verb-lab',[changed],[authority]));
 assert.throws(()=>auditSemanticBankDocument('es-en','verb-lab',[],[authority]),/lost/u);
 assert.throws(()=>auditSemanticBankDocument('es-en','verb-lab',[row,row],[authority]),/duplicate/u);
});
test('grammar example coverage is counted independently from challenge owners',()=>{
 const bank=[{id:'sb.grammar-gravity.000001',englishText:'small car',difficulty:1,usefulness:80},
  {id:'sb.grammar-gravity.000002',englishText:'small cars',difficulty:2,usefulness:81}];
 const challenges=bank.map(item=>({id:`es.grammar-gravity.${item.id.split('.').at(-1)}`,semanticBankId:item.id,
  englishAuditText:item.englishText,difficulty:item.difficulty,usefulness:item.usefulness,reviewStatus:'untranslated'}));
 delete challenges[0].reviewStatus;
 challenges[0].forms={plural:{displayForm:'pequeños',examples:[{id:'fixture-example',semanticBankId:bank[1].id,englishAuditText:bank[1].englishText,usefulness:bank[1].usefulness}]}};
 const result=auditSemanticBankDocument('es','grammar-gravity',{challenges},bank);
 assert.equal(result.authoredRootRecords,1);assert.equal(result.untranslatedRootRecords,1);
 assert.equal(result.referencedBankMeanings,2);assert.equal(result.nestedExamples,1);
 challenges[0].forms.plural.examples[0].englishAuditText='changed';
 assert.throws(()=>auditSemanticBankDocument('es','grammar-gravity',{challenges},bank),/source English/u);
});
