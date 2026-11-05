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
test('local article lookup requires an active session and enforces the read cap',async t=>{
 const request=await fixture(t,{env:{OPENAI_API_KEY:'test'},readReference:ids=>{if(ids?.[0]!=='n123')throw Error('bad');return {articles:[{body:'complete public text'}]};},fetcher:async url=>url.endsWith('/hangup')?new Response(null,{status:200}):new Response('answer',{headers:{location:'/call_note'}})});
 const read=token=>request('/voice/articles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,article_ids:['n123']})});
 assert.equal((await read('invalid')).status,403);
 const {token}=await(await request('/voice/session',offer)).json();
 for(let i=0;i<12;i++)assert.equal((await read(token)).status,200);
 assert.equal((await read(token)).status,429);
 await request('/voice/end',{method:'POST',body:JSON.stringify({token})});assert.equal((await read(token)).status,403);
});
test('local opt-in keeps old browser sessions compatible',async t=>{
 const sessions=[];const request=await fixture(t,{env:{OPENAI_API_KEY:'test'},referenceTools:[{type:'function',name:'read_note_articles'}],fetcher:async(url,init)=>{if(url.endsWith('/hangup'))return new Response(null,{status:200});sessions.push(JSON.parse(init.body.get('session')));return new Response('answer',{headers:{location:'/test'}});}});
 await request('/voice/session',offer);await request('/voice/session?references=note-v1',offer);
 assert.deepEqual(sessions[0].tools,[]);assert.ok(!sessions[0].instructions.includes('BEGIN_NOTE_CATALOG_DATA'));assert.equal(sessions[1].tools[0].name,'read_note_articles');
});
