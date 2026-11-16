import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const context = vm.createContext({window:{}});
vm.runInContext(await readFile(new URL('../static/source/games/naturalization-nucleus/naturalization-nucleus.js', import.meta.url), 'utf8'), context);
const game = context.window.CaatuuNaturalizationNucleus;
const envelope = JSON.parse(await readFile(new URL('../../languages/mandarin-simplified/static/data/games/naturalization-nucleus/content.json', import.meta.url), 'utf8'));
const arabicEnvelope = JSON.parse(await readFile(new URL('../../languages/arabic-standard/static/data/games/naturalization-nucleus/content.json', import.meta.url), 'utf8'));
const syllables = [
 ['水','shuǐ',3],['火','huǒ',3],['木','mù',4],['山','shān',1],['田','tián',2],['口','kǒu',3],['人','rén',2],['天','tiān',1],['土','tǔ',3],
 ['日','rì',4],['月','yuè',4],['金','jīn',1],['石','shí',2],['风','fēng',1],['雨','yǔ',3],['云','yún',2],['雪','xuě',3],['电','diàn',4],
 ['书','shū',1],['笔','bǐ',3],['纸','zhǐ',3],['桌','zhuō',1],['椅','yǐ',3],['门','mén',2],['窗','chuāng',1],['床','chuáng',2],['灯','dēng',1],
 ['猫','māo',1],['狗','gǒu',3],['鱼','yú',2],['鸟','niǎo',3],['马','mǎ',3],['牛','niú',2],['羊','yáng',2],['兔','tù',4],['龙','lóng',2]
];
function fixture() {
 return {...structuredClone(envelope), challenges:syllables.map(([hanzi,pinyin,tone], i) => {
  const suffix=String(i+1).padStart(6,'0'), sourceConceptId=`fixture.context.${suffix}`;
  return {id:`zh.naturalization-nucleus.${suffix}`,semanticBankId:`sb.naturalization-nucleus.${suffix}`,hanzi,pinyin,tone,
   englishAuditText:'A reading fixture.',translation:'A reading fixture.',difficulty:Math.floor(i/9),usefulness:80,complexity:20,
   sourceConceptIds:[sourceConceptId],context:{text:`${hanzi}。`,notation:`${pinyin}.`,meaning:'A reading fixture.',sourceConceptId}};
 })};
}
function pending(course='zh') {
 return {id:`${course}.naturalization-nucleus.999999`,semanticBankId:'sb.naturalization-nucleus.999999',reviewStatus:'untranslated',
  target:'',reading:'',translation:'',englishAuditText:'Not authored yet.',difficulty:1,usefulness:80,complexity:20};
}
test('Nucleus mixed sources retain bank identity and only expose playable rows', () => {
 const source=fixture(); source.challenges.splice(2,0,pending());
 const normalized=game.validateCatalog(source);
 assert.equal(normalized.challenges.length,36);
 assert.equal(normalized.challenges[2].semanticBankId,'sb.naturalization-nucleus.000003');
 for (const difficulty of [0,1,2,3]) assert.equal(game.createRound(normalized,9,()=>0.4,'',difficulty).pieces.length,9);
});
test('strict untranslated sources are inspectable in both script schemas', () => {
 for (const [source,course] of [[envelope,'zh'],[arabicEnvelope,'ar']]) {
  const normalized=game.validateCatalog({...structuredClone(source),challenges:[pending(course)]});
  assert.equal(normalized.challenges.length,0);
 }
});
test('bank suffixes, course scope and authored context provenance remain strict', () => {
 for (const mutate of [
  x=>{x.id='ar.naturalization-nucleus.000001';},
  x=>{x.semanticBankId='sb.naturalization-nucleus.000002';},
  x=>{x.semanticBankId='sb.word-net.000001';},
  x=>{delete x.context;},
  x=>{x.context.sourceConceptId=x.semanticBankId; x.sourceConceptIds=[x.semanticBankId];},
  x=>{x.hanzi='水果';},
  x=>{x.pinyin='shuì';}
 ]) { const source=fixture(); mutate(source.challenges[0]); assert.throws(()=>game.validateCatalog(source)); }
});
test('pending rows cannot hide partially filled content or duplicate IDs', () => {
 for (const mutate of [x=>{x.target='水';},x=>{delete x.reading;},x=>{x.hanzi='水';},x=>{x.difficulty=4;}]) {
  const placeholder=pending();mutate(placeholder);
  assert.throws(()=>game.validateCatalog({...structuredClone(envelope),challenges:[placeholder]}));
 }
 const source=fixture();source.challenges.push({...pending(),id:source.challenges[0].id});
 assert.throws(()=>game.validateCatalog(source),/unique/u);
 const invalid=fixture();delete invalid.challenges[0].hanzi;
 assert.throws(()=>game.validateCatalog(invalid),/hanzi/u);
});
test('mixed-source support does not weaken catalog floors or legacy IDs', () => {
 const source=fixture();source.challenges.pop();source.challenges.push(pending());
 assert.throws(()=>game.validateCatalog(source),/Level 3/u);
 const legacy=fixture();legacy.challenges.forEach((row,index)=>{delete row.semanticBankId;row.id=`zh.hanzi.fixture-${index}`;});
 assert.equal(game.validateCatalog(legacy).challenges.length,36);
});
