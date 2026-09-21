import { sharedPracticeAxes, projectPracticeCompass } from './mapping-audit.mjs';

/** Uncached actual-model probe. These developer cases are never learner evidence. */
export async function inspectMappingEncoding(model) {
  const texts = [...sharedPracticeAxes.map(axis => axis.probe.text), 'eat', 'good school', 'the house', 'money'];
  const batched = await model.encodeBatchedDiagnostic(texts);
  const reversed = (await model.encodeBatchedDiagnostic([...texts].reverse())).reverse();
  const individual = await model.encode(texts);
  const partitioned = [];
  for (let offset=0; offset<texts.length; offset+=3) partitioned.push(...await model.encode(texts.slice(offset,offset+3)));
  const individualReversed = (await model.encode([...texts].reverse())).reverse();
  const delta = (a,b) => Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
  const project = vectors => projectPracticeCompass({courseId:'encoding-diagnostic',diagnostics:true,
    axisVectors:Object.fromEntries(sharedPracticeAxes.map((axis,i)=>[axis.id,vectors[i]])),
    items:texts.slice(7).map((text,i)=>({identity:{courseId:'encoding-diagnostic',gameId:'diagnostic',bankId:'probe',itemId:text},
      text,history:{exposures:1},vector:vectors[i+7]}))});
  const comparisons = texts.map((text,i)=>({text,legacyReverseDelta:delta(batched[i],reversed[i]),legacyVsIndividualDelta:delta(batched[i],individual[i]),
    correctedPartitionDelta:delta(individual[i],partitioned[i]),correctedReverseDelta:delta(individual[i],individualReversed[i])}));
  return { texts, modelSignature:model.signature, usesCachedVectors:false, comparisons,
    legacyProjection:project(batched), correctedProjection:project(individual),
    correctedInvariant:comparisons.every(row=>row.correctedPartitionDelta<=1e-9 && row.correctedReverseDelta<=1e-9),
    interpretation:'Measured batch dependence; internal numerical cause is not established. Individual-input inference isolates companions within the pinned backend; CPU/WASM equality is not assumed.' };
}
