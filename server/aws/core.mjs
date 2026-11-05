import { randomBytes } from 'node:crypto';
import { instructions, portfolioInstructions, noteTools, readNoteArticles } from '../voice.mjs';

// Dependencies are injected so failure paths can be tested without paid API calls.
export function createHandlers({store, queue, getKey, env, fetcher=fetch, now=Date.now, log=console.log, readReference=readNoteArticles, referenceTools=noteTools}) {
  const seconds=180;
  const origins=new Set(env.VOICE_ALLOWED_ORIGINS.split(',').map(v=>v.trim()));
  async function hangup(id) {
    const r=await fetcher(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(id)}/hangup`, {
      method:'POST',headers:{Authorization:`Bearer ${await getKey()}`},signal:AbortSignal.timeout(8000)
    });
    if(!r.ok && r.status!==404)throw Error('hangup_failed');
  }
  async function end(token) {
    const call=await store.get(token);
    if(!call)return;
    if(!call.id)throw Error('call_pending');
    await hangup(call.id);
    await store.release(token,call.slot);
  }
  async function worker(event) {
    const batchItemFailures=[];
    for(const record of event.Records) {
      try {await end(JSON.parse(record.body).token);}
      catch {log(JSON.stringify({event:'hangup_retry'}));batchItemFailures.push({itemIdentifier:record.messageId});}
    }
    return {batchItemFailures};
  }
  async function api(event) {
    const start=now();
    const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
    const origin=headers.origin;
    const allowed=origins.has(origin);
    const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin',...(allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}:{})},body:statusCode===204?'':JSON.stringify(data)});
    const method=event.requestContext?.http?.method;
    const path=event.rawPath;
    const useNotes=event.queryStringParameters?.references==='note-v1' && referenceTools.length>0;
    try {
      if(!allowed)return reply(403,{error:'origin'});
      if(method==='OPTIONS')return reply(204);
      if(method==='GET' && path==='/voice/status')return reply(200,{available:env.VOICE_ENABLED==='true',maxSeconds:seconds});
      if(method!=='POST')return reply(405,{error:'method'});
      const body=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):(event.body||'');
      if(path==='/voice/end') {
        if(Buffer.byteLength(body)>1024)return reply(413,{error:'size'});
        let token;try{({token}=JSON.parse(body));}catch{return reply(400,{error:'body'});}
        if(typeof token!=='string' || !/^[a-f0-9]{48}$/.test(token))return reply(400,{error:'token'});
        await end(token);return reply(200,{ended:true});
      }
      if(path==='/voice/articles') {
        if(headers['content-type']!=='application/json')return reply(415,{error:'type'});
        if(Buffer.byteLength(body)>2048)return reply(413,{error:'size'});
        let token,article_ids,result;
        try{({token,article_ids}=JSON.parse(body));result=readReference(article_ids);}catch{return reply(400,{error:'body'});}
        if(typeof token!=='string'||!/^[a-f0-9]{48}$/.test(token))return reply(403,{error:'session'});
        if(!await store.claimReference(token,now(),seconds*1000))return reply(403,{error:'session_or_limit'});
        return reply(200,result);
      }
      if(path!=='/voice/session')return reply(404,{error:'path'});
      if(env.VOICE_ENABLED!=='true')return reply(503,{error:'disabled'});
      if(headers['content-type']!=='application/sdp')return reply(415,{error:'type'});
      if(Buffer.byteLength(body)>65536)return reply(413,{error:'size'});
      if(!body.startsWith('v=0'))return reply(400,{error:'sdp'});
      const key=await getKey();
      const token=randomBytes(24).toString('hex');
      const slot=await store.reserve(token,now(),Number(env.VOICE_DAILY_CALL_LIMIT||20));
      if(slot===null)return reply(429,{error:'limit'});
      let id, upstreamStarted=false;
      try {
        // Schedule BEFORE creating a paid call. No call starts without a durable cleanup job.
        await queue(token,seconds+30);
        const form=new FormData();form.set('sdp',body);
        form.set('session',JSON.stringify({type:'realtime',model:env.OPENAI_REALTIME_MODEL||'gpt-realtime-2.1-mini',instructions:useNotes?instructions:portfolioInstructions,tools:useNotes?referenceTools:[],max_output_tokens:4096,audio:{input:{turn_detection:{type:'server_vad',create_response:true,interrupt_response:true,silence_duration_ms:650}},output:{voice:env.OPENAI_REALTIME_VOICE||'echo'}}}));
        upstreamStarted=true;
        const r=await fetcher('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(20000)});
        if(!r.ok){upstreamStarted=false;throw Error('upstream');}
        id=r.headers.get('location')?.split('/').pop();
        if(!id)throw Error('call_id');
        await store.activate(token,id);
        // Precise normal deadline; the pre-created job is an idempotent safety net.
        await queue(token,seconds);
        const sdp=await r.text();
        log(JSON.stringify({event:'session_started',durationMs:now()-start}));
        return reply(200,{sdp,token,maxSeconds:seconds});
      } catch {
        if(id) {
          try {await hangup(id);await store.release(token,slot);}catch{log(JSON.stringify({event:'cleanup_pending'}));}
        } else if(!upstreamStarted)await store.release(token,slot);
        // Ambiguous upstream result stays occupied rather than allowing unlimited retries.
        // Durable pending row and DLQ expose this rare case for operator investigation.
        log(JSON.stringify({event:'session_failed',unknownCall:upstreamStarted&&!id}));
        return reply(502,{error:'connection'});
      }
    } catch {log(JSON.stringify({event:'request_failed',path}));return reply(503,{error:'unavailable'});}
  }
  return {api,worker};
}
