import test from 'node:test';
import assert from 'node:assert/strict';
import {speechEnvelope} from '../src/voice-motion.js';
test('silence and noise floor do not trigger gestures',()=>{
 assert.equal(speechEnvelope(new Float32Array(512),0,1/60),0);
 assert.equal(speechEnvelope(new Float32Array(512).fill(.003),0,1/60),0);
});
test('speech attacks promptly, remains bounded, and settles during pauses',()=>{
 const speech=new Float32Array(512).fill(.1), silence=new Float32Array(512);
 let level=0;for(let i=0;i<12;i++)level=speechEnvelope(speech,level,1/60);
 assert.ok(level>.7 && level<=1);
 for(let i=0;i<30;i++)level=speechEnvelope(silence,level,1/60);
 assert.ok(level<.01);
 assert.ok(speechEnvelope(new Float32Array(512).fill(1),.9,1/30)<=1);
});
