import { createPracticeCompass } from '../../practice-compass.mjs';
import { embedSharedEnglishTexts, normalizeSharedEnglishText, sharedEnglishEmbeddingOwner } from '../../english-image-search.mjs?v=english-image-search-5';
import { newContentEncounterId } from '../content-progression.mjs';
import { MEMORY_MOON_GAME, MEMORY_MOON_BANK, MEMORY_MOON_ROUND_COUNT, validateMemoryMoonCatalog, memoryMoonWeaknesses,
  selectMemoryMoonChallenges, createMoonSession, answerMoonChallenge, assistMoonChallenge, advanceMoonChallenge } from './memory-moon-core.mjs?v=memory-moon-3';

function aborted(signal) {
  if (signal?.aborted) { const error=new Error('Memory Moon selection cancelled.');error.name='AbortError';throw error; }
}
/** One active moon; every new round rereads course-local evidence. No source-game credit is written. */
export function createMemoryMoonPractice({ course, learning, pack, runtimeHref=globalThis.location?.href,
  random=Math.random, now=Date.now, resolveEvidence, embedTexts, encounterId=newContentEncounterId,
  owner=sharedEnglishEmbeddingOwner() }={}) {
  validateMemoryMoonCatalog(pack,{course});
  if(!course?.id || !learning || typeof learning.contentHistory!=='function')throw new TypeError('Memory Moon needs its course learning profile.');
  const profileSummary=learning.practiceSummary?.();
  if(profileSummary?.courseId && profileSummary.courseId!==course.id)throw new TypeError('Memory Moon learning profile belongs to another course.');
  const resolver=resolveEvidence ? null : createPracticeCompass({course,learning,runtimeHref});
  const resolve=resolveEvidence || (options=>resolver.resolve(options));
  const embed=embedTexts || ((texts)=>embedSharedEnglishTexts(texts,{owner,individualInputs:true,timeoutMs:8000}));
  let session=null, generation=null, epoch=0, disposed=false, lastIds=[], lastFamilies=[], encounter=null;
  let saveStatus='ready';
  const vectors=new Map();
  const snapshot=()=>session ? {...session,currentItem:session.items[session.index],
    saveStatus:learning.saveStatus?.().status==='error'?'unavailable':saveStatus} : null;
  const validGeneration=()=>typeof generation==='string' && learning.contentGeneration?.()===generation;
  function persist(correct,evidence) {
    if(!validGeneration()){saveStatus=typeof generation==='string'?'stale':'unavailable';return false;}
    if(typeof learning.recordExposure!=='function'){saveStatus='unavailable';return false;}
    try {
      const accepted=learning.recordExposure(MEMORY_MOON_GAME,{bankId:MEMORY_MOON_BANK,itemId:session.items[session.index].id,
        encounterId:encounter,generation,correct,evidence});
      if(accepted===false){saveStatus='stale';return false;}
      return true;
    }catch{saveStatus='unavailable';return false;}
  }
  function startEncounter(){encounter=encounterId();}
  return Object.freeze({
    snapshot,
    async startRound({difficulty=learning.difficulty?.()??1,signal}={}) {
      if(disposed)throw new Error('Memory Moon practice has been disposed.');
      const current=++epoch, capturedGeneration=learning.contentGeneration?.();
      const check=()=>{aborted(signal);if(disposed||current!==epoch){const error=new Error('Memory Moon selection replaced.');error.name='AbortError';throw error;}};
      check();
      let evidence=[],issues=[],semanticStatus='unused';
      try {const resolved=await resolve({signal});check();evidence=resolved.items||[];issues=resolved.issues||[];}
      catch(error){check();issues=['history-unavailable'];}
      const weaknesses=memoryMoonWeaknesses(evidence,{courseId:course.id,now:now()});
      let history={};
      try{history=learning.contentHistory(MEMORY_MOON_GAME,MEMORY_MOON_BANK)||{};}catch{issues.push('moon-history-unavailable');}
      const recentOwn=pack.challenges.some(item=>item.difficulty===difficulty&&now()-Date.parse(history[item.id]?.lastSeenAt)<300000);
      if(weaknesses.length||recentOwn){
        const texts=[...new Set([...weaknesses.map(row=>row.englishText),...pack.challenges.filter(item=>item.difficulty===difficulty).map(item=>item.englishText)])];
        const missing=texts.filter(value=>!vectors.has(value));
        semanticStatus='ready';
        try {
          for(let offset=0;offset<missing.length;offset+=16){
            check();const batch=missing.slice(offset,offset+16).map(normalizeSharedEnglishText);
            const encoded=await embed(batch,{signal});check();
            if(!Array.isArray(encoded)||encoded.length!==batch.length)throw new Error('Invalid Moon embedding batch.');
            encoded.forEach((vector,index)=>{if(!vector?.length||!Array.from(vector).every(Number.isFinite))throw new Error('Invalid Moon embedding.');vectors.set(batch[index],vector);});
            while(vectors.size>256)vectors.delete(vectors.keys().next().value);
          }
        }catch(error){check();semanticStatus='unavailable';}
      }
      check();
      if(capturedGeneration!==learning.contentGeneration?.()){const error=new Error('Learning progress changed while preparing Memory Moon.');error.name='AbortError';throw error;}
      const selection=selectMemoryMoonChallenges(pack,{difficulty,weaknesses,vectorsByText:vectors,history,
        recentIds:lastIds,recentFamilies:lastFamilies,random,limit:MEMORY_MOON_ROUND_COUNT,now:now()});
      if(selection.items.length<MEMORY_MOON_ROUND_COUNT)throw new Error(`Memory Moon needs ${MEMORY_MOON_ROUND_COUNT} questions at the selected difficulty.`);
      generation=capturedGeneration;saveStatus=typeof generation==='string'?'ready':'unavailable';
      session={...createMoonSession(selection.items),selection:{...selection.trace,
        mode:selection.trace.mode==='no-history'&&evidence.length?'balanced-practice':selection.trace.mode,
        sourceEvidenceCount:evidence.length,semanticStatus,issues}};
      lastIds=[...lastIds,...selection.items.map(item=>item.id)].slice(-12);
      lastFamilies=[...lastFamilies,...selection.items.map(item=>item.familyId)].slice(-12);
      startEncounter();return snapshot();
    },
    answer(choiceId){
      if(disposed||!session)return snapshot();
      const before=session,next=answerMoonChallenge(before,choiceId);
      if(next===before)return snapshot();
      session=next;
      const accepted=persist(next.lastAnswer.correct,before.assisted||before.attempts>0?'assisted':'independent');
      if(accepted&&validGeneration()){try{learning.record?.(MEMORY_MOON_GAME,{activities:1,attempts:1,successes:Number(next.lastAnswer.correct),
        xp:Number(next.lastAnswer.correct),rounds:Number(next.phase==='complete')});}catch{saveStatus='unavailable';}}
      else if(accepted)saveStatus='stale';
      return snapshot();
    },
    assist(reason='audio'){
      if(disposed||!session)return snapshot();
      // Speaking the authored target is another normal prompt modality. It does
      // not disclose the translation, and must not consume an independent-answer
      // receipt before the first response. That assessed encounter records its
      // exposure. Actual answer clues/reveals remain assistance below.
      if(reason==='audio'||reason==='target-audio'){
        if(session.phase==='question')session={...session,audioPresentations:(session.audioPresentations||0)+1};
        return snapshot();
      }
      const next=assistMoonChallenge(session,reason);
      if(next!==session){session=next;persist(null,'assisted');}
      return snapshot();
    },
    advance(){if(disposed||!session)return snapshot();const next=advanceMoonChallenge(session);if(next!==session){session=next;startEncounter();}return snapshot();},
    cancelPending(){epoch++;},
    dispose(){disposed=true;epoch++;vectors.clear();}
  });
}
