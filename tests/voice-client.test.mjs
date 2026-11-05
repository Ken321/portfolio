import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { createVoice } from '../src/voice.js';
class Element extends EventTarget {hidden=false;dataset={};textContent='';attributes={};setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}}
test('microphone icon is decorative and only the label is replaced on language changes',()=>{
 const html=readFileSync(new URL('../src/index.template.html',import.meta.url),'utf8');
 const button=html.match(/<button[^>]*data-voice-mute\b[\s\S]*?<\/button>/)[0];
 assert.doesNotMatch(button.slice(0,button.indexOf('>')),/data-(ja|en)=/);
 assert.match(button,/<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
 assert.match(button,/data-voice-mute-slash/);
 assert.match(button,/<span data-voice-mute-label data-ja="マイクをオフる" data-en="Mute microphone">マイクをオフる<\/span>/);
});
function setup(t,fetcher,getUserMedia){
 const originals=new Map();const set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
 t.after(()=>{for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 const selectors=['[data-voice-start]','[data-voice-end]','[data-voice-mute]','[data-voice-mute-label]','[data-voice-status]','[data-voice-caption]','.avatar-scene'];const nodes=Object.fromEntries(selectors.map(s=>[s,new Element()]));
 const doc=Object.assign(new EventTarget(),{documentElement:{lang:'ja'},querySelector:()=>({content:'http://voice.test'}),body:{classList:{contains:()=>false}}});
 set('document',doc);set('window',Object.assign(new EventTarget(),{RTCPeerConnection:class{}}));set('location',{hostname:'localhost'});set('fetch',fetcher);set('navigator',{mediaDevices:{getUserMedia}});set('Audio',class{setAttribute(){}pause(){}});
 const voice=createVoice({querySelector:s=>nodes[s]});return {voice,nodes};
}
test('unconfigured backend does not request microphone',async t=>{
 let mic=0;const {voice,nodes}=setup(t,async()=>({ok:true,json:async()=>({available:false})}),async()=>{mic++;});
 await voice.begin();assert.equal(mic,0);assert.equal(nodes['[data-voice-status]'].textContent,'音声会話は準備中です。');assert.equal(nodes['[data-voice-start]'].hidden,false);
});
test('ending during a microphone permission prompt stops late tracks',async t=>{
 let accept,requested;const prompt=new Promise(r=>requested=r);let stopped=0;
 const {voice,nodes}=setup(t,async()=>({ok:true,json:async()=>({available:true})}),()=>{requested();return new Promise(r=>accept=r);});
 const starting=voice.begin();await prompt;
 nodes['[data-voice-end]'].dispatchEvent(new Event('click'));
 accept({getTracks:()=>[{stop:()=>stopped++}]});await starting;
 assert.equal(stopped,1);assert.equal(nodes['[data-voice-end]'].hidden,true);assert.equal(nodes['.avatar-scene'].dataset.voiceState,'idle');
});
test('microphone denial restores controls with an actionable message',async t=>{
 const {voice,nodes}=setup(t,async()=>({ok:true,json:async()=>({available:true})}),async()=>{throw new DOMException('denied','NotAllowedError');});
 await voice.begin();assert.match(nodes['[data-voice-status]'].textContent,/マイクの許可/);assert.equal(nodes['[data-voice-start]'].hidden,false);
});
test('a connected conversation can only run once per page and thanks appears on disabled button',async t=>{
 const track=Object.assign(new EventTarget(),{enabled:true,stop(){}});let channel;let sessions=0;const {voice,nodes}=setup(t,async url=>({ok:true,json:async()=>url.endsWith('/voice/status')?{available:true}:url.includes('/voice/session')?(sessions++,{token:'test',sdp:'answer',maxSeconds:180}):{ended:true}}),async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}));
 const previous=Object.getOwnPropertyDescriptor(globalThis,'RTCPeerConnection');
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'RTCPeerConnection',previous);else delete globalThis.RTCPeerConnection;});
 globalThis.RTCPeerConnection=class{
  addTrack(){}
  createDataChannel(){return channel=this.dc={send(){}};}async createOffer(){return {};}async setLocalDescription(){this.localDescription={sdp:'offer'};}async setRemoteDescription(){this.dc.onopen();}close(){}
 };
 await voice.begin();
 const mute=nodes['[data-voice-mute]'],label=nodes['[data-voice-mute-label]'];
 mute.dispatchEvent(new Event('click'));assert.equal(track.enabled,false);assert.equal(label.textContent,'マイクをつける');assert.equal(mute.getAttribute('aria-pressed'),'true');
 mute.dispatchEvent(new Event('click'));assert.equal(track.enabled,true);assert.equal(label.textContent,'マイクをオフる');assert.equal(mute.getAttribute('aria-pressed'),'false');
 document.documentElement.lang='en';
 mute.dispatchEvent(new Event('click'));assert.equal(track.enabled,false);assert.equal(label.textContent,'Unmute microphone');assert.equal(label.dataset.ja,'マイクをつける');assert.equal(mute.getAttribute('aria-pressed'),'true');
 mute.dispatchEvent(new Event('click'));assert.equal(track.enabled,true);assert.equal(label.textContent,'Mute microphone');assert.equal(mute.getAttribute('aria-pressed'),'false');
 assert.equal(mute.textContent,''); // State changes must not replace the button's icon/label children.
 document.documentElement.lang='ja';
 for(const type of ['output_audio_buffer.started','input_audio_buffer.speech_stopped']){channel.onmessage({data:JSON.stringify({type})});assert.equal(nodes['[data-voice-status]'].textContent,'');}
 channel.onmessage({data:JSON.stringify({type:'response.output_audio_transcript.delta',delta:'最初の文。次の文です'})});
 assert.equal(nodes['[data-voice-caption]'].textContent,'最初の文。次の文です');
 const extra='長い返答も最後まで表示します。'.repeat(120);
 channel.onmessage({data:JSON.stringify({type:'response.output_audio_transcript.delta',delta:extra})});
 assert.equal(nodes['[data-voice-caption]'].textContent,'最初の文。次の文です'+extra);
 channel.onmessage({data:JSON.stringify({type:'input_audio_buffer.speech_started'})});
 assert.equal(nodes['[data-voice-caption]'].textContent,'最初の文。次の文です'+extra);
 nodes['[data-voice-end]'].dispatchEvent(new Event('click'));
 assert.equal(nodes['[data-voice-start]'].disabled,true);
 assert.equal(nodes['[data-voice-end]'].textContent,'お話ありがとう！');
 assert.equal(nodes['[data-voice-status]'].textContent,'');
 assert.equal(mute.hidden,true);assert.equal(mute.getAttribute('aria-pressed'),'false');assert.equal(label.textContent,'マイクをオフる');
 await voice.begin();assert.equal(sessions,1);
});
for(const ending of ['playback','manual','hidden','timeout','error'])test(`closing lifecycle: ${ending}, immediate cleanup and no late restart`,async t=>{
 let channel,ended=0,stopped=0;const sent=[],timers=[];const track=Object.assign(new EventTarget(),{enabled:true,stop(){stopped++;}});
 const {voice,nodes}=setup(t,async url=>{if(url.endsWith('/voice/end'))ended++;return {ok:true,json:async()=>url.endsWith('/voice/status')?{available:true}:url.includes('/voice/session')?{token:'mock',sdp:'answer',maxSeconds:180}:{ended:true}};},async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}));
 const timeout=globalThis.setTimeout,clear=globalThis.clearTimeout,peer=globalThis.RTCPeerConnection;
 t.after(()=>{globalThis.setTimeout=timeout;globalThis.clearTimeout=clear;if(peer)globalThis.RTCPeerConnection=peer;else delete globalThis.RTCPeerConnection;});
 globalThis.setTimeout=(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;};globalThis.clearTimeout=timer=>{if(timer)timer.cancelled=true;};
 globalThis.RTCPeerConnection=class{addTrack(){}createDataChannel(){return channel=this.dc={send:e=>sent.push(JSON.parse(e))};}async createOffer(){return {};}async setLocalDescription(){this.localDescription={sdp:'offer'};}async setRemoteDescription(){this.dc.onopen();}close(){}};
 await voice.begin();const event=e=>channel.onmessage({data:JSON.stringify(e)});
 timers.find(t=>t.ms>160000&&t.ms<170000).fn();
 assert.equal(track.enabled,false);assert.equal(nodes['[data-voice-mute]'].disabled,true);nodes['[data-voice-mute]'].dispatchEvent(new Event('click'));assert.equal(track.enabled,false);
 event({type:'input_audio_buffer.speech_started'});event({type:'response.output_audio_transcript.delta',response_id:'old',delta:'late ordinary text'});assert.equal(nodes['[data-voice-caption]'].textContent,'');
 event({type:'error',error:{event_id:'portfolio-user-transcription-enable-v1'}});assert.equal(stopped,0);
 event({type:'response.created',response:{id:'bye',metadata:{purpose:'portfolio-time-limit-goodbye-v1'}}});event({type:'response.output_audio_transcript.delta',response_id:'bye',delta:'お話ありがとう！'});
 if(ending==='playback'){
   event({type:'output_audio_buffer.started',response_id:'bye'});event({type:'response.done',response:{id:'bye',status:'completed'}});assert.equal(stopped,0);
   event({type:'output_audio_buffer.stopped',response_id:'bye'});timers.find(t=>t.ms===750).fn();assert.equal(nodes['[data-voice-caption]'].textContent,'お話ありがとう！');
 }else if(ending==='manual')nodes['[data-voice-end]'].dispatchEvent(new Event('click'));
 else if(ending==='hidden'){document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
 else if(ending==='timeout')timers.find(t=>t.ms>175000).fn();
 else event({type:'error',error:{message:'connection lost'}});
 await Promise.resolve();assert.equal(ended,1);assert.equal(stopped,1);assert.equal(nodes['[data-voice-end]'].textContent,'お話ありがとう！');assert.equal(nodes['[data-voice-end]'].disabled,true);assert.equal(nodes['[data-voice-start]'].hidden,true);
 const requests=sent.length;event({type:'response.output_audio_transcript.delta',response_id:'bye',delta:'late'});assert.equal(sent.length,requests);
 for(const timer of timers.filter(t=>t.ms===3000&&!t.cancelled))timer.fn();assert.equal(nodes['[data-voice-caption]'].textContent,'');
});
