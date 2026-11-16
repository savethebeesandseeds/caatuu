import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tokenize } from '../../czech-ml/scripts/word-world-standard-lib.mjs';
import { inspectLearnerFields } from '../../czech-ml/scripts/learner-content-safety-lib.mjs';
import { normalizeContentProgression } from '../../../apps/language-runtime/static/source/games/content-progression.mjs';

const plain=(value,label)=>assert.ok(typeof value==='string' && value.trim()===value && value.length>0
  && value===value.normalize('NFC') && !/[<>\p{Cc}\p{Cf}]/u.test(value),`${label}: normalized nonempty plain text required`);
const exact=(value,keys,label)=>assert.deepEqual(Object.keys(value??{}).sort(),[...keys].sort(),`${label}: unexpected or missing fields`);

function validateReview(review,id) {
  exact(review,['status','reviewer','reviewedOn','humanApproved','checks','notes'],`${id}.review`);
  assert.equal(review.status,'machine-assisted-preview',`${id}: bank content must retain its honest AI draft status`);
  assert.equal(review.humanApproved,false,`${id}: human review cannot be invented`);
  plain(review.reviewer,`${id}.reviewer`);
  assert.match(review.reviewedOn,/^\d{4}-\d{2}-\d{2}$/u);
  for(const key of ['checks','notes']) {
    assert.ok(Array.isArray(review[key]) && review[key].length,`${id}.review.${key}`);
    review[key].forEach(value=>plain(value,`${id}.review.${key}`));
  }
}

export function czechSemanticBankRuntimeRecords(document) {
  plain(document.metadata?.corpusVersion,'corpusVersion');
  assert.ok(document.metadata.corpusVersion.startsWith('semantic-bank-'), 'Bank records need a distinct semantic-bank corpus version');
  const source=document.records.filter(item=>item.reviewStatus!=='untranslated');
  const ids=new Set(),bankIds=new Set(),fields=[];
  const runtime=source.map(item=>{
    assert.match(item.semanticBankId,/^sb\.word-net\.\d{6}$/u,`${item.id}: bank reference`);
    assert.equal(item.id,`${document.courseId}.word-net.${item.semanticBankId.split('.').at(-1)}`,`${item.id}: stable course ID must match its bank row`);
    assert.ok(!ids.has(item.id) && !bankIds.has(item.semanticBankId),'Duplicate course or bank identity');
    ids.add(item.id);bankIds.add(item.semanticBankId);
    assert.equal(item.embeddingText,item.englishText,`${item.id}: ranking uses the included English only`);
    assert.equal(item.pronunciation,null);
    assert.equal(item.learnerBase,null);
    assert.deepEqual(item.englishAlternates,[],'The bank owns the exact English meaning');
    assert.deepEqual(item.sceneAssetIds,[],'Bank content uses English image queries');
    assert.ok([0,1,2,3].includes(item.difficulty));
    for(const key of ['englishText','targetText','sceneQuery','topic'])plain(item[key],`${item.id}.${key}`);
    assert.ok(/\p{Script=Latin}/u.test(item.targetText) && ![...item.targetText].some(char=>/\p{L}/u.test(char)&&!/\p{Script=Latin}/u.test(char)),`${item.id}: Czech target must use Latin script`);
    exact(item.annotations,['review'],`${item.id}.annotations`);
    validateReview(item.annotations.review,item.id);
    const expected=tokenize(item.targetText);
    assert.equal(item.tokens.length,expected.length,`${item.id}: annotate every Czech word exactly once`);
    assert.ok(item.tokens.some(token=>token.playable===true),`${item.id}: needs a playable target`);
    item.tokens.forEach((token,index)=>{
      exact(token,['surface','normalized','tokenIndex','playable','gloss'],`${item.id}.tokens[${index}]`);
      assert.equal(token.tokenIndex,index);
      assert.equal(token.surface,expected[index].surface);
      assert.equal(token.normalized,expected[index].normalized);
      assert.equal(typeof token.playable,'boolean');
      plain(token.gloss,`${item.id}.tokens[${index}].gloss`);
      fields.push({file:'czech-bank-authoring',contentId:item.id,field:`tokens[${index}].gloss`,locale:'en',text:token.gloss});
    });
    for(const [key,locale] of [['englishText','en'],['targetText','cs'],['sceneQuery','en']])fields.push({file:'czech-bank-authoring',contentId:item.id,field:key,locale,text:item[key]});
    return {id:item.id,semanticBankId:item.semanticBankId,cs:item.targetText,en:item.englishText,enAlternates:[],
      difficulty:item.difficulty,...normalizeContentProgression(item,item.id),topic:item.topic,
      targets:structuredClone(item.tokens),sceneQuery:item.sceneQuery,sceneAssetIds:[],
      provenance:{kind:'semantic-bank-authored',semanticBankId:item.semanticBankId},review:structuredClone(item.annotations.review)};
  });
  assert.deepEqual(inspectLearnerFields(fields),[],'Czech/English child-content checks failed');
  return runtime;
}

export const czechSemanticBankRecordsProvider=Object.freeze({
  id:'czech-semantic-bank-records-v1',
  rubricPath:'tools/language-content/record-projection/czech-semantic-bank-policy.v1.json',
  validate(document,course){
    assert.equal(course.sourceLanguage.locale,'en');
    assert.equal(course.targetLanguage.locale,'cs-CZ');
    assert.equal(document.sourceLanguage,course.sourceLanguage.locale);
    assert.equal(document.targetLanguage,course.targetLanguage.locale);
    assert.equal(document.courseId,course.id);
    czechSemanticBankRuntimeRecords(document);
  },
  project({document,rubric:policy,manifest,sourcePath,runtimeFile}){
    assert.equal(policy.schemaVersion,'caatuu-czech-semantic-bank-policy-v1');
    assert.equal(policy.reviewStatus,'machine-assisted-preview');
    assert.equal(policy.humanApprovalAllowed,false);
    for(const key of ['minimumRecordsPerDifficulty','branchableTargetMinimumRecords','strongTargetMinimumRecords'])assert.ok(Number.isInteger(policy[key]) && policy[key]>0);
    assert.equal(manifest.schemaVersion,'caatuu-word-world-runtime-manifest-v1');
    assert.equal(manifest.mode,'standard');
    assert.equal(manifest.sessionProvider?.kind,'standard-corpus');
    const records=czechSemanticBankRuntimeRecords(document);
    const byDifficulty=Object.fromEntries([0,1,2,3].map(level=>[level,records.filter(row=>row.difficulty===level).length]));
    for(const [level,count]of Object.entries(byDifficulty))assert.ok(count>=policy.minimumRecordsPerDifficulty,
      `Czech bank publication needs ${policy.minimumRecordsPerDifficulty} reviewed records in difficulty ${level}; found ${count}.`);
    const counts=new Map();
    for(const row of records)for(const word of new Set(row.targets.filter(token=>token.playable).map(token=>token.normalized)))counts.set(word,(counts.get(word)||0)+1);
    const branchable=[...counts.values()].filter(count=>count>=policy.branchableTargetMinimumRecords).length;
    const strong=[...counts.values()].filter(count=>count>=policy.strongTargetMinimumRecords).length;
    const version=document.metadata.corpusVersion;
    const bytes=JSON.stringify({schemaVersion:'caatuu-word-world-runtime-v1',corpusVersion:version,records})+'\n';
    const contentSha256=createHash('sha256').update(bytes).digest('hex');
    // Historical standard-corpus review receipts and distribution rules do not
    // describe newly authored bank content. Retain them only with that provider.
    const {editorialOverrides,tokenMeanings,minimumLevel2Share,minimumLevel3Records,...base}=manifest;
    const next={...base,corpusVersion:version,runtimeFile:`${runtimeFile}?v=${contentSha256.slice(0,16)}`,
      recordCount:records.length,contentSha256,difficultyDistribution:byDifficulty,
      difficultyShare:Object.fromEntries(Object.entries(byDifficulty).map(([level,count])=>[level,count/records.length])),
      playableTargets:counts.size,branchability:{branchableMinimumRecords:policy.branchableTargetMinimumRecords,branchableTargets:branchable,
        strongMinimumRecords:policy.strongTargetMinimumRecords,strongTargets:strong},
      reviewStatus:'machine-assisted-preview',humanApproved:false,authoringFile:sourcePath,authoringSchema:document.schemaVersion};
    return {bytes,manifest:next,coverage:{records:{total:records.length,byDifficulty},playableTargets:counts.size},validation:{valid:true,errors:[]}};
  }
});
