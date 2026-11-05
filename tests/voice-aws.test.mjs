import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandlers} from '../server/aws/core.mjs';
function fixture(overrides={}) {
 const calls=new Map(),slots=new Set(),jobs=[],events=[];let daily=0,upstream=0,hangups=0;
 const store={get:async t=>calls.get(t),reserve:async(t,now,limit)=>{if(daily>=limit||slots.size>=2)return null;daily++;let slot=slots.has(0)?1:0;slots.add(slot);calls.set(t,{slot,createdAt:now,referenceReads:0});return slot;},claimReference:async(t,now,duration)=>{const c=calls.get(t);if(!c?.id||now-c.createdAt>=duration||c.referenceReads>=12)return false;c.referenceReads++;return true;},activate:async(t,id)=>{calls.get(t).id=id;},release:async(t,s)=>{slots.delete(s);calls.delete(t);}};
 const handlers=createHandlers({store,queue:async(t,d)=>jobs.push({token:t,delay:d}),getKey:async()=>'SECRET',env:{VOICE_ALLOWED_ORIGINS:'https://321ken.com',VOICE_ENABLED:'true',VOICE_DAILY_CALL_LIMIT:'3'},fetcher:async(url)=>{if(url.endsWith('/hangup')){hangups++;return new Response(null,{status:200});}upstream++;return new Response('answer',{headers:{location:'https://api.openai.com/v1/realtime/calls/call_1'}});},log:e=>events.push(e),...overrides});
 const request=(path='/voice/session',body='v=0\r\n',extra={})=>handlers.api({rawPath:path,headers:{origin:'https://321ken.com','content-type':'application/sdp'},requestContext:{http:{method:'POST'}},body,...extra});
 return {...handlers,request,calls,slots,jobs,events,store,counts:()=>({daily,upstream,hangups})};
}
test('durable deadline, opaque token, idempotent end and duplicate queue delivery',async()=>{
 const f=fixture();const r=await f.request();assert.equal(r.statusCode,200);const {token}=JSON.parse(r.body);assert.match(token,/^[a-f0-9]{48}$/);assert.equal(f.jobs.length,2);assert.deepEqual(f.jobs.map(j=>j.delay),[210,180]);assert.ok(!r.body.includes('SECRET'));
 assert.equal((await f.request('/voice/end',JSON.stringify({token}))).statusCode,200);
 assert.deepEqual(await f.worker({Records:[{messageId:'m',body:JSON.stringify({token})}]}),{batchItemFailures:[]});assert.equal(f.counts().hangups,1);assert.equal(f.slots.size,0);
});
test('foreign origins and invalid requests cannot start paid calls',async()=>{
 const f=fixture();assert.equal((await f.request(undefined,undefined,{headers:{origin:'https://evil.test'}})).statusCode,403);
 assert.equal((await f.request(undefined,'bad')).statusCode,400);
 assert.equal((await f.request(undefined,'v=0'+'x'.repeat(65536))).statusCode,413);
 assert.equal((await f.request('/voice/end','bad')).statusCode,400);assert.equal(f.counts().upstream,0);
});
test('global admission survives independent handlers and daily attempts remain consumed',async()=>{
 const f=fixture();const a=JSON.parse((await f.request()).body);await f.request();assert.equal((await f.request()).statusCode,429);
 await f.request('/voice/end',JSON.stringify({token:a.token}));await f.request();assert.equal((await f.request()).statusCode,429);assert.equal(f.counts().upstream,3);
});
test('queue failure prevents upstream call and releases admission',async()=>{
 const f=fixture({queue:async()=>{throw Error('queue');}});assert.equal((await f.request()).statusCode,502);assert.equal(f.counts().upstream,0);assert.equal(f.slots.size,0);
});
test('hangup failure is retried and never releases occupied slot',async()=>{
 const f=fixture({fetcher:async url=>url.endsWith('/hangup')?new Response(null,{status:500}):new Response('answer',{headers:{location:'/call_1'}})});
 const {token}=JSON.parse((await f.request()).body);
 assert.equal((await f.request('/voice/end',JSON.stringify({token}))).statusCode,503);
 assert.deepEqual(await f.worker({Records:[{messageId:'retry',body:JSON.stringify({token})}]}),{batchItemFailures:[{itemIdentifier:'retry'}]});assert.equal(f.slots.size,1);
});
test('uncertain upstream outcome fails closed; no secrets or SDP in logs',async()=>{
 const f=fixture({fetcher:async()=>{throw Error('SECRET');}});assert.equal((await f.request()).statusCode,502);assert.equal(f.slots.size,1);
 assert.ok(!f.events.join('').includes('SECRET'));assert.ok(!f.events.join('').includes('v=0'));
 assert.deepEqual(await f.worker({Records:[{messageId:'pending',body:JSON.stringify(f.jobs[0])}]}),{batchItemFailures:[{itemIdentifier:'pending'}]});
});
test('disabled service does not create sessions',async()=>{
 const f=fixture({env:{VOICE_ALLOWED_ORIGINS:'https://321ken.com',VOICE_ENABLED:'false'}});assert.equal((await f.request()).statusCode,503);assert.equal(f.counts().upstream,0);
});
test('a second Lambda instance observes the same occupied slots',async()=>{
 const first=fixture();const second=fixture({store:first.store});
 await first.request();await second.request();
 assert.equal((await second.request()).statusCode,429);
});
test('persistence failure after creation hangs up before releasing slot',async()=>{
 const f=fixture();f.store.activate=async()=>{throw Error('storage');};
 assert.equal((await f.request()).statusCode,502);
 assert.equal(f.counts().hangups,1);assert.equal(f.slots.size,0);
});
test('article lookup uses active opaque session, caps reads and never calls a paid model',async()=>{
 let clock=100000;const readReference=ids=>{if(ids?.length!==1||ids[0]!=='n123')throw Error('bad');return {articles:[{body:'complete public text'}]};};
 const f=fixture({now:()=>clock,readReference});
 const lookup=token=>f.request('/voice/articles',JSON.stringify({token,article_ids:['n123']}),{headers:{origin:'https://321ken.com','content-type':'application/json'}});
 assert.equal((await lookup('a'.repeat(48))).statusCode,403);
 const {token}=JSON.parse((await f.request()).body);
 for(let i=0;i<12;i++){const r=await lookup(token);assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).articles[0].body,'complete public text');}
 assert.equal((await lookup(token)).statusCode,403);assert.equal(f.counts().upstream,1);
 await f.request('/voice/end',JSON.stringify({token}));assert.equal((await lookup(token)).statusCode,403);
 const second=JSON.parse((await f.request()).body);clock+=180001;assert.equal((await lookup(second.token)).statusCode,403);
});
test('only note-capable clients receive reference tools; old cached pages retain portfolio-only sessions',async()=>{
 const sessions=[];const f=fixture({referenceTools:[{type:'function',name:'read_note_articles'}],fetcher:async(url,init)=>{sessions.push(JSON.parse(init.body.get('session')));return new Response('answer',{headers:{location:'/test'}});}});
 await f.request();await f.request(undefined,undefined,{queryStringParameters:{references:'note-v1'}});
 assert.deepEqual(sessions[0].tools,[]);assert.ok(!sessions[0].instructions.includes('BEGIN_NOTE_CATALOG_DATA'));
 assert.equal(sessions[1].tools[0].name,'read_note_articles');
});
