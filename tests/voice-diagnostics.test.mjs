import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceDiagnostics,responseMetadata} from '../src/voice-diagnostics.js';
test('diagnostics retain stop reason and usage without conversation or credentials',()=>{
 const row=responseMetadata({type:'response.done',response:{status:'incomplete',status_details:{reason:'max_output_tokens'},usage:{output_tokens:600,output_token_details:{audio_tokens:500,text_tokens:100}},output:[{text:'private transcript'}]},token:'secret'});
 assert.deepEqual(row,{event:'response.done',status:'incomplete',reason:'max_output_tokens',outputTokens:600,audioTokens:500,textTokens:100});
 assert.equal(responseMetadata({type:'response.output_audio_transcript.delta',delta:'private'}),null);
 assert.deepEqual(responseMetadata({type:'error',error:{message:'secret'}}),{event:'error'});
});
test('storage is bounded, expires old entries, survives reload and tolerates disabled storage',()=>{
 let value=JSON.stringify([{at:Date.now()-25*3600000,event:'old'}]);const storage={getItem:()=>value,setItem:(_,s)=>value=s};
 const log=createVoiceDiagnostics(storage);assert.equal(log.read().length,0);
 for(let i=0;i<310;i++)log.event({type:'input_audio_buffer.speech_started'});
 assert.equal(log.read().length,300);assert.equal(createVoiceDiagnostics(storage).read().length,300);
 assert.doesNotThrow(()=>createVoiceDiagnostics({getItem(){throw Error();},setItem(){throw Error();}}).record('session.start'));
});
