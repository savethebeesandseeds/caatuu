import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectSoundQuasarContent} from '../build-sound-quasar-content.mjs';
import {validateSoundQuasarCatalog} from '../../../apps/language-runtime/static/source/games/sound-quasar/sound-quasar-core.mjs';
const json=async file=>JSON.parse(await readFile(new URL(`../../../${file}`,import.meta.url),'utf8'));
async function inputs(directory){
 const course=await json(`apps/languages/${directory}/course.json`);
 return [course,await json(`apps/languages/${directory}/content/word-world/content.json`),await json(course.resources.verbNebulaCatalog.path)];
}
test('listening projects authored source roles and grades and excludes untranslated rows',async()=>{
 const args=await inputs('spanish'), [course,source,verbs]=args;
 const {document}=projectSoundQuasarContent(...args);
 const rows=new Map([...source.records,...verbs].map(row=>[row.id,row]));
 for(const row of [...document.items,...document.sentences]){
  const authored=rows.get(row.sourceId);assert.ok(authored);assert.notEqual(authored.reviewStatus,'untranslated');
  for(const key of ['difficulty','usefulness','complexity'])assert.equal(row[key],authored[key]);
  assert.equal(row.target,authored.targetText??authored.target);
 }
 assert.equal(document.audio.reviewStatus,'unreviewed');
 assert.equal(document.audio.locale,course.targetLanguage.speechLocale);
 assert.ok(document.sentences.every(row=>row.sourceReviewStatus===source.metadata.target.review.status));
 assert.deepEqual(projectSoundQuasarContent(...args).document,document,'Projection is deterministic.');
 const pending=source.records.find(row=>row.reviewStatus==='untranslated');
 pending.targetText='Never publish this unfinished translation.';
 assert.ok(!projectSoundQuasarContent(...args).document.sentences.some(row=>row.sourceId===pending.id));
 assert.equal(document.courseId,course.id);
});
test('Spanish-base listening keeps Spanish meanings separate from English audit',async()=>{
 const args=await inputs('english-from-spanish');
 const {document}=projectSoundQuasarContent(...args);
 const rows=new Map(args[1].records.map(row=>[row.id,row]));
 for(const row of document.sentences){
  assert.equal(row.meaning,rows.get(row.sourceId).learnerBase.text);
  assert.equal(row.englishAuditText,rows.get(row.sourceId).englishText);
  assert.equal(row.target,row.englishAuditText);
 }
});
test('listening rejects a missing difficulty pool instead of borrowing another badge',async()=>{
 const args=await inputs('spanish');
 args[1].records=args[1].records.filter(row=>row.difficulty!==3);
 assert.throws(()=>projectSoundQuasarContent(...args),/sentences difficulty 3 needs eight/u);
});
test('Mandarin vocabulary reading provenance can name only its own vocabulary or guide',async()=>{
 const raw=await json('apps/languages/mandarin-simplified/static/data/games/sound-quasar/content.json');
 const word=raw.items.find(row=>row.reading);assert.ok(word,'The listening vocabulary retains contextual pinyin.');
 word.reading.sourcePath=raw.provenance.sourcePath;
 assert.doesNotThrow(()=>validateSoundQuasarCatalog(raw));
 word.reading.sourcePath='apps/languages/spanish/static/data/games/verb-nebula/content.json';
 assert.throws(()=>validateSoundQuasarCatalog(raw),/reading-guide or vocabulary source/u);
});
