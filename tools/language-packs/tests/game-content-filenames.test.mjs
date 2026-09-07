import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
const root=new URL('../../../',import.meta.url);
const read=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
test('every enabled game uses content.json and keeps its declared companion catalogs',async()=>{
  const catalog=await read('apps/languages/catalog.json');
  const mainKeys=['verbNebulaCatalog','conjugationCometCatalog','caseCosmosCatalog','grammarGravityCatalog','naturalizationNucleusCatalog','soundQuasarCatalog'];
  for(const {manifest} of catalog.courses){
    const course=await read(manifest);
    for(const key of mainKeys){
      const resource=course.resources[key];if(!resource)continue;
      assert.equal(path.posix.basename(resource.path),'content.json',`${course.id}/${key}`);
      await read(resource.path);
    }
    const resource=course.resources.wordWorldManifest;
    const ww=await read(resource.path);
    assert.equal((ww.runtimeFile||ww.realizationFile).split('?')[0],'content.json');
    await read(path.posix.join(path.posix.dirname(resource.path),'content.json'));
    if(ww.targetTextGuide)assert.equal(ww.targetTextGuide.file,'reading-guides.json');
    if(ww.learnerBaseFile)assert.equal(ww.learnerBaseFile,'learner-base.json');
    if(course.resources.grammarGravityNouns)assert.equal(path.posix.basename(course.resources.grammarGravityNouns.path),'nouns.json');
  }
});
