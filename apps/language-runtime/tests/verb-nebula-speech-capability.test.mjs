import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=await readFile(new URL('../static/source/caatuu-workspace.js',import.meta.url),'utf8');
function between(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert.ok(first>=0&&last>first);return source.slice(first,last);}
function harness(speech){
 const menu={hidden:false},button={disabled:false,setAttribute(){},classList:{toggle(){}}};let calls=0;
 const context={course:{capabilities:{speech}},state:{verbSpeakOnTap:true,verbRound:[{id:'example',target:'კითხვა'}]},document:{querySelector(selector){return selector.endsWith(' > summary')?null:menu;}},$:selector=>selector==='#verbSpeakOnTap'?button:null,window:{CaatuuChrome:{speakText(){calls++;return Promise.resolve();},getSpeechVoiceControlState(){throw new Error('Unsupported voice provider was queried.');}}},verbTargetLabel:'Georgian'};
 vm.createContext(context);vm.runInContext([between('function renderVerbAudioControls()', 'function renderVerbDisplayControls()'),between('async function refreshVerbAudioVoiceControls()', 'function closeVerbToolbarMenus('),between('function speakVerbCzechOnTap(', 'function renderVerbMatchStats()')].join('\n'),context);
 return {context,menu,button,calls:()=>calls};
}
test('a speech-disabled course hides Verb Nebula audio and never calls a provider despite a saved on preference',async()=>{
 const game=harness(false);game.context.renderVerbAudioControls();game.context.speakVerbCzechOnTap('example');await game.context.refreshVerbAudioVoiceControls();assert.equal(game.menu.hidden,true);assert.equal(game.button.disabled,true);assert.equal(game.calls(),0);
});
test('a speech-enabled course retains verb tap speech',()=>{
 const game=harness(true);game.context.speakVerbCzechOnTap('example');assert.equal(game.calls(),1);
});
