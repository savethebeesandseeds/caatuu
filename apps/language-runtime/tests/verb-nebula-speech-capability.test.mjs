import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { afterInteractionPaint } from '../static/source/games/practice-pacing.mjs';

const source=await readFile(new URL('../static/source/caatuu-workspace.js',import.meta.url),'utf8');
function between(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert.ok(first>=0&&last>first);return source.slice(first,last);}
function harness(speech){
 const menu={hidden:false},button={disabled:false,setAttribute(){},classList:{toggle(){}}};
 const frames=[],tasks=[],spoken=[],cards=[];
 const state={activeView:'verbs',trainTab:'verb-lab',verbSpeakOnTap:true,
   verbRound:[{id:'example',target:'კითხვა'},{id:'second',target:'საუბარი'}]};
 const context={course:{capabilities:{speech}},state,
   document:{querySelector(selector){return selector.endsWith(' > summary')?null:menu;},querySelectorAll:()=>cards},
   $:selector=>selector==='#verbSpeakOnTap'?button:null,
   window:{CaatuuPracticePacing:{afterInteractionPaint},requestAnimationFrame:callback=>frames.push(callback),cancelAnimationFrame(){},setTimeout:callback=>tasks.push(callback),clearTimeout(){},
     CaatuuChrome:{speakText(text){spoken.push(text);return Promise.resolve();},getSpeechVoiceControlState(){throw new Error('Unsupported voice provider was queried.');}}},
   verbGuidedInteractionLocked:()=>false,trackVerbGuidedOperation:operation=>operation(),settleVerbMatch(){},verbTargetLabel:'Georgian'};
 vm.createContext(context);vm.runInContext([between('function renderVerbAudioControls()', 'function renderVerbDisplayControls()'),between('async function refreshVerbAudioVoiceControls()', 'function closeVerbToolbarMenus('),between('function speakVerbCzechOnTap(', 'function renderVerbMatchStats()'),between('function chooseVerbMatchCard(event)', 'function changeVerbPairCount(')].join('\n'),context);
 const card=(id,side='cz')=>{
   const selected=new Set(),attributes={};
   const value={dataset:{verbId:id,verbSide:side},closest:()=>value,
     setAttribute:(name,value)=>{attributes[name]=value;},classList:{toggle:(name,on)=>on?selected.add(name):selected.delete(name)}};
   cards.push(value);return {value,selected,attributes};
 };
 return {context,state,menu,button,frames,tasks,spoken,card,calls:()=>spoken.length,
   frame:()=>frames.splice(0).forEach(callback=>callback()),
   task:()=>tasks.splice(0).forEach(callback=>callback())};
}
test('a speech-disabled course hides Verb Nebula audio and never calls a provider despite a saved on preference',async()=>{
 const game=harness(false);game.context.renderVerbAudioControls();game.context.speakVerbCzechOnTap('example');await game.context.refreshVerbAudioVoiceControls();assert.equal(game.menu.hidden,true);assert.equal(game.button.disabled,true);assert.equal(game.calls(),0);
});
test('a speech-enabled course retains verb tap speech',async()=>{
 const game=harness(true);game.context.speakVerbCzechOnTap('example');
 await Promise.resolve();assert.equal(game.calls(),0,'speech must not run in the pre-paint microtask checkpoint');
 game.frame();await Promise.resolve();assert.equal(game.calls(),0,'speech must leave the rendering callback before provider work');
 game.task();await Promise.resolve();assert.deepEqual(game.spoken,['კითხვა']);
});

test('verb cards apply selection immediately and a slow speech provider cannot delay the next tap',async()=>{
 const game=harness(true),first=game.card('example'),second=game.card('second');
 game.context.window.CaatuuChrome.speakText=text=>{game.spoken.push(text);return new Promise(()=>{});};
 game.context.chooseVerbMatchCard({target:first.value});
 assert.equal(game.state.verbSelectedCzechId,'example');
 assert.equal(first.attributes['aria-pressed'],'true');
 assert.equal(first.selected.has('is-selected'),true);
 game.frame();game.task();await Promise.resolve();assert.equal(game.calls(),1);
 game.context.chooseVerbMatchCard({target:second.value});
 assert.equal(first.attributes['aria-pressed'],'false');
 assert.equal(second.attributes['aria-pressed'],'true');
 assert.equal(game.state.verbSelectedCzechId,'second');
});

test('rapid verb taps pronounce the latest word rather than queuing stale selections',async()=>{
 const game=harness(true),first=game.card('example'),second=game.card('second');
 game.context.chooseVerbMatchCard({target:first.value});game.context.chooseVerbMatchCard({target:second.value});
 game.frame();game.task();await Promise.resolve();assert.deepEqual(game.spoken,['საუბარი']);
});

test('deferred verb speech cannot leak into an inactive presentation or a different round',async()=>{
 for(const retire of [
   game=>{game.state.activeView='home';},game=>{game.state.trainTab='word-net';},
   game=>{game.context.document.hidden=true;},game=>{game.context.document.visibilityState='hidden';},
   game=>{game.state.verbRoundTransitioning=true;},game=>{game.state.campaignTransitioning=true;},
   game=>{game.state.campaignHandoffPending=true;},game=>{game.context.window.CaatuuGameDynamics={active:true};},
   game=>{game.state.verbRound=[...game.state.verbRound];},game=>{game.state.verbRoundTransitionId=1;},
   game=>{game.state.verbSpeakOnTap=false;}
 ]){
   const game=harness(true);game.context.speakVerbCzechOnTap('example');
   game.frame();retire(game);game.task();await Promise.resolve();assert.equal(game.calls(),0);
 }
});
