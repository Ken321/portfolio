import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoice } from '../src/voice.js';
class Element extends EventTarget {hidden=false;dataset={};textContent='';attributes={};setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}}
function setup(t,fetcher,getUserMedia){
 const originals=new Map();const set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
 t.after(()=>{for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 const selectors=['[data-voice-start]','[data-voice-end]','[data-voice-mute]','[data-voice-status]','[data-voice-caption]','.avatar-scene'];const nodes=Object.fromEntries(selectors.map(s=>[s,new Element()]));
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
 const mute=nodes['[data-voice-mute]'];
 mute.dispatchEvent(new Event('click'));assert.equal(track.enabled,false);assert.equal(mute.textContent,'マイクオン');assert.equal(mute.getAttribute('aria-pressed'),'true');
 mute.dispatchEvent(new Event('click'));assert.equal(track.enabled,true);assert.equal(mute.textContent,'マイクオフ');assert.equal(mute.getAttribute('aria-pressed'),'false');
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
 assert.equal(nodes['[data-voice-start]'].textContent,'お話ありがとう！');
 assert.equal(nodes['[data-voice-status]'].textContent,'');
 await voice.begin();assert.equal(sessions,1);
});
