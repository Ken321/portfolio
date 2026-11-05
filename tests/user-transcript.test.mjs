import test from 'node:test';import assert from 'node:assert/strict';import {createTranscriptState} from '../src/user-transcript.js';
const speech=(s,id)=>s.event({type:'input_audio_buffer.speech_started',item_id:id});
const done=(s,id,text)=>s.event({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});
test('late earlier result never replaces newer turn',()=>{const s=createTranscriptState();speech(s,'a');speech(s,'b');done(s,'b','二番目');done(s,'a','一番目');assert.equal(s.read().text,'二番目');});
test('response events do not clear retained user text',()=>{const s=createTranscriptState();speech(s,'a');done(s,'a','質問');s.event({type:'response.created'});assert.equal(s.read().text,'質問');});
test('partial result is reconciled by completion, not appended twice',()=>{const s=createTranscriptState();speech(s,'a');s.event({type:'conversation.item.input_audio_transcription.delta',item_id:'a',delta:'XR'});done(s,'a','XRについて');assert.equal(s.read().text,'XRについて');s.event({type:'conversation.item.input_audio_transcription.delta',item_id:'a',delta:'stale'});assert.equal(s.read().text,'XRについて');});
test('empty, failed, and cleared states',()=>{const s=createTranscriptState();speech(s,'a');done(s,'a','');assert.equal(s.read().status,'empty');speech(s,'b');s.event({type:'conversation.item.input_audio_transcription.delta',item_id:'b',delta:'incomplete'});s.event({type:'conversation.item.input_audio_transcription.failed',item_id:'b'});assert.equal(s.read().status,'failed');assert.equal(s.read().text,'');s.clear();done(s,'b','late');assert.equal(s.read(),null);});
test('evicted stale result cannot reappear',()=>{const s=createTranscriptState();for(let i=0;i<40;i++)speech(s,''+i);done(s,'0','old');assert.equal(s.read().id,'39');});
import {createUserTranscript} from '../src/user-transcript.js';
function ui(t){
 const originals=new Map();for(const [key,value] of Object.entries({window:new EventTarget(),requestAnimationFrame:f=>f()})){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
 t.after(()=>{for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 class Node extends EventTarget{hidden=false;textContent='';dataset={};scrollHeight=0;clientHeight=0;attributes={};setAttribute(k,v){this.attributes[k]=v;}}
 const nodes=Object.fromEntries(['','-text','-toggle','-announcement'].map(s=>[`[data-user-transcript${s}]`,new Node()]));
 const c=createUserTranscript({querySelector:s=>nodes[s]},{text:ja=>ja});t.after(()=>c.finish());return {c,nodes};
}
test('subtitle setup failure is handled without stopping voice; speech result can recover',t=>{
 const {c,nodes}=ui(t);let request;c.start(e=>request=e);assert.equal(request.session.audio.input.transcription.model,'gpt-live-transcribe');
 assert.equal(c.event({type:'error',error:{event_id:request.event_id}}),true);
 c.event({type:'input_audio_buffer.speech_started',item_id:'a'});assert.match(nodes['[data-user-transcript-text]'].textContent,/会話は続けられます/);
 c.event({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'こんにちは'});assert.equal(nodes['[data-user-transcript-text]'].textContent,'こんにちは');
 assert.equal(c.event({type:'error',error:{event_id:'unrelated'}}),false);
 c.finish();c.event({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'late'});assert.equal(nodes['[data-user-transcript]'].hidden,true);assert.equal(nodes['[data-user-transcript-text]'].textContent,'');
});
test('user text is rendered as text and a long utterance expands without clearing it',t=>{
 const {c,nodes}=ui(t);c.start(()=>{});nodes['[data-user-transcript-text]'].scrollHeight=200;nodes['[data-user-transcript-text]'].clientHeight=67;
 c.event({type:'input_audio_buffer.speech_started',item_id:'a'});c.event({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'<script>hello</script>'});
 assert.equal(nodes['[data-user-transcript-toggle]'].hidden,false);nodes['[data-user-transcript-toggle]'].dispatchEvent(new Event('click'));
 assert.equal(nodes['[data-user-transcript]'].dataset.expanded,'true');assert.equal(nodes['[data-user-transcript-text]'].textContent,'<script>hello</script>');
 c.event({type:'response.created'});assert.equal(nodes['[data-user-transcript-text]'].textContent,'<script>hello</script>');c.event({});
});
test('missing turn IDs are harmless and retry cannot revive a prior call transcript',t=>{
 const s=createTranscriptState();s.event({type:'input_audio_buffer.committed'});assert.equal(s.read(),null);
 const {c,nodes}=ui(t);c.start(()=>{});c.event({type:'input_audio_buffer.speech_started',item_id:'old'});c.finish();c.start(()=>{});
 c.event({type:'conversation.item.input_audio_transcription.completed',item_id:'old',transcript:'old private text'});assert.equal(nodes['[data-user-transcript]'].hidden,true);
});
test('language switches can translate UI labels without replacing the user transcript',t=>{
 const {c,nodes}=ui(t);c.start(()=>{});c.event({type:'input_audio_buffer.speech_started',item_id:'a'});
 assert.equal(nodes['[data-user-transcript-text]'].dataset.en,'Listening…');
 c.event({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'original speech'});
 assert.equal(nodes['[data-user-transcript-text]'].dataset.en,undefined);
 assert.equal(nodes['[data-user-transcript-toggle]'].dataset.en,'Show full text');
 nodes['[data-user-transcript-toggle]'].dispatchEvent(new Event('click'));assert.equal(nodes['[data-user-transcript-toggle]'].dataset.en,'Show less');
 assert.equal(nodes['[data-user-transcript-text]'].textContent,'original speech');
});
