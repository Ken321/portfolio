import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceServer } from '../server/voice.mjs';
const origin='http://127.0.0.1:8765';
async function fixture(t,options={}){
 const server=createVoiceServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await server.stopCalls();await new Promise(r=>server.close(r));});
 const url=`http://127.0.0.1:${server.address().port}`;
 return (path,init={})=>fetch(url+path,{...init,headers:{Origin:origin,...init.headers}});
}
const offer={method:'POST',headers:{'Content-Type':'application/sdp'},body:'v=0\r\n'};
test('missing credentials never calls OpenAI; foreign origins are rejected',async t=>{
 let requests=0;const request=await fixture(t,{env:{},fetcher:()=>{requests++;throw Error();}});
 assert.deepEqual(await(await request('/voice/status')).json(),{available:false,maxSeconds:180});
 assert.equal((await request('/voice/session',offer)).status,503);
 assert.equal((await request('/voice/status',{headers:{Origin:'https://other.test'}})).status,403);
 assert.equal(requests,0);
});
test('call admission, opaque end token, instructions and server timeout',async t=>{
 const seen=[];let count=0;
 const request=await fixture(t,{env:{OPENAI_API_KEY:'test-only-secret',VOICE_DAILY_CALL_LIMIT:'2'},durationMs:100,fetcher:async(url,init)=>{
 seen.push({url,init});if(url.endsWith('/hangup'))return new Response(null,{status:200});
 count++;return new Response('v=0\r\nanswer',{headers:{Location:`https://api.openai.com/v1/realtime/calls/call_${count}`}});
 }});
 const one=await(await request('/voice/session',offer)).json();assert.equal(one.sdp,'v=0\r\nanswer');assert.ok(one.token);assert.ok(!JSON.stringify(one).includes('test-only-secret'));
 const session=JSON.parse(seen[0].init.body.get('session'));assert.match(session.instructions,/Bugs Symphony/);assert.equal(session.audio.input.turn_detection.interrupt_response,true);
 await request('/voice/end',{method:'POST',body:JSON.stringify({token:'call_1'})});assert.equal(seen.length,1);
 await request('/voice/end',{method:'POST',body:JSON.stringify({token:one.token})});assert.ok(seen[1].url.endsWith('/call_1/hangup'));
 await request('/voice/session',offer);
 assert.equal((await request('/voice/session',offer)).status,429);
 await new Promise(r=>setTimeout(r,150));assert.ok(seen.some(x=>x.url.endsWith('/call_2/hangup')));
});
test('malformed offers rejected and upstream errors do not expose credentials',async t=>{
 const request=await fixture(t,{env:{OPENAI_API_KEY:'private'},fetcher:async()=>new Response('private upstream details',{status:401})});
 assert.equal((await request('/voice/session',{...offer,body:'bad'})).status,400);
 const r=await request('/voice/session',offer);assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'upstream'});
});
