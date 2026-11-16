#!/usr/bin/env node
// Read-only source audit. Does not generate translations or publish catalogs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {courseRecordId} from './lib/derive-semantic-bank-content.mjs';
import {loadProgressionCatalogs,repositoryRoot} from './quality/content-progression-catalogs.mjs';

const games={'word-world':'word-net','verb-nebula':'verb-lab','memory-moon':'memory-moon',
 'grammar-gravity':'grammar-gravity','conjugation-comet':'conjugation-comet',
 'naturalization-nucleus':'naturalization-nucleus','case-cosmos':'case-cosmos'};
const rowsFor=(game,document)=>game==='verb-lab'?document:game==='word-net'?document.records:
 game==='conjugation-comet'?document.verbs:game==='case-cosmos'?document.contexts:document.challenges;
const englishFor=(courseId,game,row)=>game==='word-net'||game==='memory-moon'?row.englishText:
 game==='case-cosmos'?row.english:game==='verb-lab'?(row.englishAuditText??(courseId==='es-en'?row.target:row.source)):row.englishAuditText;

export function auditSemanticBankDocument(courseId,game,document,bankRows){
 const bank=new Map(bankRows.map(row=>[row.id,row]));
 assert.equal(bank.size,bankRows.length,'Bank identities must be unique');
 const rows=rowsFor(game,document),seen=new Set(),referenced=new Set();
 let examples=0,forms=0;
 for(const row of rows){
  const authority=bank.get(row.semanticBankId);assert.ok(authority,`${courseId}/${game}: unknown ${row.semanticBankId}`);
  assert.ok(!seen.has(row.semanticBankId),`${courseId}/${game}: duplicate ${row.semanticBankId}`);seen.add(row.semanticBankId);
  assert.equal(row.id,courseRecordId(courseId,game,authority.id),'Stable course identity changed');
  assert.equal(englishFor(courseId,game,row),authority.englishText,`${row.id}: source English changed`);
  for(const key of ['difficulty','usefulness'])assert.equal(row[key],authority[key],`${row.id}: ${key} changed`);
  if(row.reviewStatus==='untranslated')continue;
  referenced.add(row.semanticBankId);
  if(game==='conjugation-comet')forms+=row.forms.length;
  if(game==='grammar-gravity')for(const form of Object.values(row.forms)){
   forms++;
   for(const example of form.examples){
    const source=bank.get(example.semanticBankId);assert.ok(source,`${example.id}: missing example bank source`);
    assert.equal(example.englishAuditText,source.englishText,`${example.id}: source English changed`);
    assert.equal(example.usefulness,source.usefulness,`${example.id}: source usefulness changed`);
    assert.equal(example.complexity,rows.find(row=>row.semanticBankId===source.id)?.complexity,`${example.id}: source complexity changed`);
    referenced.add(source.id);examples++;
   }
  }
 }
 assert.equal(seen.size,bank.size,`${courseId}/${game}: bank rows were lost from the source`);
 const authored=rows.filter(row=>row.reviewStatus!=='untranslated');
 return {courseId,game,sourceRecords:rows.length,authoredRootRecords:authored.length,
  untranslatedRootRecords:rows.length-authored.length,referencedBankMeanings:referenced.size,
  nestedForms:forms,nestedExamples:examples,
  authoredByDifficulty:Object.fromEntries([0,1,2,3].map(level=>[level,authored.filter(row=>row.difficulty===level).length]))};
}

export async function auditSemanticBankContent({root=repositoryRoot}={}){
 const banks=new Map(),bankHashes={};
 for(const game of Object.values(games)){
  const bytes=await readFile(path.join(root,`apps/languages/shared/semantic-banks/${game}.json`));
  banks.set(game,JSON.parse(bytes));bankHashes[game]=createHash('sha256').update(bytes).digest('hex');
 }
 const files=[];
 for(const catalog of await loadProgressionCatalogs(root)){
  const game=games[catalog.game];if(!game)continue;
  const bytes=await readFile(path.join(root,catalog.path));
  assert.deepEqual(JSON.parse(bytes),catalog.document,`${catalog.path}: source changed during inspection`);
  files.push({...auditSemanticBankDocument(catalog.course.id,game,catalog.document,banks.get(game)),path:catalog.path,
   sourceSha256:createHash('sha256').update(bytes).digest('hex')});
 }
 return {schemaVersion:'caatuu-semantic-bank-source-audit-v1',
  scope:'Source integrity and inventory only. Authored status is not a native review or publication claim.',bankHashes,
  totals:{files:files.length,sourceRecords:files.reduce((sum,row)=>sum+row.sourceRecords,0),
   authoredRootRecords:files.reduce((sum,row)=>sum+row.authoredRootRecords,0),
   untranslatedRootRecords:files.reduce((sum,row)=>sum+row.untranslatedRootRecords,0)},files};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert.ok(args.length===0||(args.length===1&&args[0]==='--summary'),'Usage: audit-semantic-bank-content.mjs [--summary]');
 const report=await auditSemanticBankContent();
 console.log(JSON.stringify(args.length?{...report,files:report.files.map(({courseId,game,authoredRootRecords,untranslatedRootRecords,nestedForms,nestedExamples})=>({courseId,game,authored:authoredRootRecords,pending:untranslatedRootRecords,forms:nestedForms,examples:nestedExamples}))}:report,null,2));
}
