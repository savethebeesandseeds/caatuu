import assert from 'node:assert/strict';
import test from 'node:test';
import { czechSemanticBankRuntimeRecords, czechSemanticBankRecordsProvider as provider } from '../record-projection/czech-semantic-bank.mjs';
import { tokenize } from '../../czech-ml/scripts/word-world-standard-lib.mjs';
import { normalizeStandardRecord, StandardWordWorldProvider } from '../../../apps/languages/czech/static/source/games/word-world/word-net-standard.mjs';
const review={status:'machine-assisted-preview',reviewer:'OpenAI Codex',reviewedOn:'2026-11-13',humanApproved:false,
  checks:['bilingual author review','contextual token alignment'],notes:['Synthetic provider contract fixture; no native review.']};
function fixture(){
  const meanings=[['Hello.','Ahoj.'],['I want water.','Chci vodu.'],['Where is the book?','Kde je kniha?'],['We can go outside when the rain stops.','Můžeme jít ven, až přestane pršet.']];
  return {schemaVersion:'caatuu-word-world-course-content-v1',courseId:'cz',sourceLanguage:'en',targetLanguage:'cs-CZ',
    metadata:{corpusVersion:'semantic-bank-cs-v1'},records:meanings.map(([englishText,targetText],difficulty)=>({
      id:`cz.word-net.${String(difficulty+1).padStart(6,'0')}`,semanticBankId:`sb.word-net.${String(difficulty+1).padStart(6,'0')}`,
      englishText,targetText,embeddingText:englishText,englishAlternates:[],sceneQuery:englishText,sceneAssetIds:[],learnerBase:null,
      topic:'everyday',difficulty,usefulness:90-difficulty,complexity:10+difficulty*20,pronunciation:null,
      tokens:tokenize(targetText).map(token=>({...token,gloss:'fixture hint',playable:true})),annotations:{review:structuredClone(review)}
    }))};
}
const policy={schemaVersion:'caatuu-czech-semantic-bank-policy-v1',minimumRecordsPerDifficulty:1,
  branchableTargetMinimumRecords:2,strongTargetMinimumRecords:5,reviewStatus:'machine-assisted-preview',humanApprovalAllowed:false};
const manifest={schemaVersion:'caatuu-word-world-runtime-manifest-v1',mode:'standard',sessionProvider:{kind:'standard-corpus'},
  editorialOverrides:{historical:true},tokenMeanings:{historical:true},minimumLevel2Share:0.6,minimumLevel3Records:50};

test('Czech bank records use their own strict contract and remain consumable by the standard runtime',()=>{
  const document=fixture();
  provider.validate(document,{id:'cz',sourceLanguage:{locale:'en'},targetLanguage:{locale:'cs-CZ'}});
  const runtime=czechSemanticBankRuntimeRecords(document);
  assert.equal(runtime.length,4);
  for(const [index,row]of runtime.entries()){
    const normalized=normalizeStandardRecord(row);
    assert.equal(normalized.semanticBankId,document.records[index].semanticBankId);
    assert.equal(normalized.cs,document.records[index].targetText);
    assert.equal(normalized.usefulness,document.records[index].usefulness);
  }
  const selected=new StandardWordWorldProvider({pack:{records:runtime,corpusVersion:document.metadata.corpusVersion}});
  assert.equal(selected.records.length,4);
});

test('mixed Czech bank records cannot shift contextual hints or grades',()=>{
  const document=fixture(), expected=czechSemanticBankRuntimeRecords(document);
  document.records.splice(1,0,{reviewStatus:'untranslated',tokens:[],usefulness:1,complexity:99});
  assert.deepEqual(czechSemanticBankRuntimeRecords(document),expected);
});

test('Czech bank provider rejects false review, lost English authority and malformed token identity',()=>{
  for(const mutate of [
    row=>{row.annotations.review.humanApproved=true;},
    row=>{row.annotations.review.status='native-reviewed';},
    row=>{row.embeddingText='Czech must not enter English ranking';},
    row=>{row.semanticBankId='sb.memory-moon.000001';},
    row=>{row.id='ww-legacy-id';},
    row=>{row.tokens[0].tokenIndex=10;},
    row=>{row.tokens[0].normalized='wrong';},
    row=>{row.tokens[0].gloss=null;},
    row=>{row.annotations.fakeApproval=true;}
  ]){
    const document=fixture();mutate(document.records[0]);
    assert.throws(()=>czechSemanticBankRuntimeRecords(document));
  }
});

test('Czech bank publication reports real coverage and does not copy historical review receipts',()=>{
  const result=provider.project({document:fixture(),rubric:policy,manifest,sourcePath:'fixture/content.json',runtimeFile:'content.json'});
  assert.equal(result.manifest.recordCount,4);
  assert.deepEqual(result.manifest.difficultyDistribution,{'0':1,'1':1,'2':1,'3':1});
  assert.equal(result.manifest.reviewStatus,'machine-assisted-preview');
  assert.equal(result.manifest.humanApproved,false);
  for(const key of ['editorialOverrides','tokenMeanings','minimumLevel2Share','minimumLevel3Records'])assert.equal(Object.hasOwn(result.manifest,key),false);
  assert.match(result.manifest.contentSha256,/^[a-f0-9]{64}$/u);
  assert.throws(()=>provider.project({document:fixture(),rubric:{...policy,minimumRecordsPerDifficulty:8},manifest,
    sourcePath:'fixture/content.json',runtimeFile:'content.json'}),/difficulty 0; found 1/u);
});
