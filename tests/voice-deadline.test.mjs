import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceDeadline} from '../src/voice-deadline.js';
function fixture({elapsed=0,seconds=180,lang='ja'}={}){
 let time=elapsed,closing=0,spoken=0,caption='';const sent=[],finished=[],timers=[];
 const d=createVoiceDeadline({send:e=>sent.push(e),onClosing:()=>closing++,onText:t=>caption+=t,onSpeaking:()=>spoken++,onFinish:p=>{finished.push(p);d.stop();},language:()=>lang,now:()=>time,schedule:(fn,delay)=>{const t={fn,at:time+delay};timers.push(t);return t;},cancel:t=>t.cancelled=true});
 d.arm(0,seconds);
 const advance=t=>{time=t;for(;;){const next=timers.filter(x=>!x.cancelled&&x.at<=time).sort((a,b)=>a.at-b.at)[0];if(!next)break;next.cancelled=true;next.fn();}};
 const event=e=>d.event(e),create=()=>event({type:'response.created',response:{id:'bye',metadata:{purpose:'portfolio-time-limit-goodbye-v1'}}});
 return {d,advance,event,create,sent,finished,get closing(){return closing;},get caption(){return caption;},get spoken(){return spoken;}};
}
test('165s closing includes request time, never extends 180s cap, and only requests once',()=>{
 const f=fixture({elapsed:2000});f.advance(164999);assert.equal(f.closing,0);f.advance(165000);assert.equal(f.closing,1);assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);assert.equal(f.sent[0].session.audio.input.turn_detection,null);f.advance(179999);assert.deepEqual(f.finished,[]);f.advance(180000);assert.deepEqual(f.finished,[false]);f.advance(200000);assert.equal(f.closing,1);
});
test('generation complete alone cannot finish; matching playback drain and tail are required',()=>{
 const f=fixture();f.advance(165000);f.create();f.event({type:'response.output_audio_transcript.delta',response_id:'old',delta:'wrong'});f.event({type:'response.output_audio_transcript.delta',response_id:'bye',delta:'お話ありがとう！'});assert.equal(f.caption,'お話ありがとう！');
 f.event({type:'output_audio_buffer.started',response_id:'bye'});f.event({type:'response.done',response:{id:'bye',status:'completed'}});assert.deepEqual(f.finished,[]);
 f.event({type:'output_audio_buffer.stopped',response_id:'old'});f.advance(166000);assert.deepEqual(f.finished,[]);
 f.event({type:'output_audio_buffer.stopped',response_id:'bye'});f.advance(166749);assert.deepEqual(f.finished,[]);f.advance(166750);assert.deepEqual(f.finished,[true]);assert.equal(f.spoken,1);
});
test('active reply is cancelled before farewell and late ordinary events cannot replace it',()=>{
 const f=fixture();f.event({type:'response.created',response:{id:'old'}});f.advance(165000);assert.equal(f.sent.at(-1).type,'response.cancel');assert.equal(f.sent.at(-1).response_id,'old');assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);
 f.event({type:'response.done',response:{id:'old',status:'cancelled'}});assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);f.event({type:'response.done',response:{id:'old',status:'cancelled'}});assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 assert.equal(f.event({type:'input_audio_buffer.speech_started'}),true);f.create();f.event({type:'response.output_audio_transcript.delta',response_id:'old',delta:'late note'});assert.equal(f.caption,'');
});
test('manual stop cancels both timers and delayed final events',()=>{
 const f=fixture();f.advance(165000);f.d.stop();f.create();f.advance(200000);assert.deepEqual(f.finished,[]);assert.equal(f.event({type:'error'}),true);
});
test('failure or cleared final playback uses fallback; missing response still hits hard cap',()=>{
 for(const type of ['response.done','output_audio_buffer.cleared']){const f=fixture();f.advance(165000);f.create();f.event({type,response_id:'bye',response:{id:'bye',status:'failed'}});assert.deepEqual(f.finished,[false]);}
 const f=fixture();f.event({type:'response.created',response:{id:'unresponsive'}});f.advance(165000);f.advance(180000);assert.deepEqual(f.finished,[false]);
});
test('English closing and smaller server duration preserve cap',()=>{
 const f=fixture({lang:'en',seconds:30});f.advance(15000);assert.match(f.sent.at(-1).response.instructions,/tired/);assert.equal(f.sent.at(-1).response.tool_choice,'none');f.advance(30000);assert.deepEqual(f.finished,[false]);
 const g=fixture({seconds:900});g.advance(180000);assert.deepEqual(g.finished,[false]);
});
