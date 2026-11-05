// Public reference lookup only. No transcript, audio or raw API errors are stored.
export function createNoteToolHandler({send,fetcher=fetch,base,getToken,isCurrent,signal,timeoutMs=6000}) {
  const handled=new Set();let speechGeneration=0,reads=0;
  async function handle(event) {
    if(event.type!=='response.done'||event.response?.status!=='completed')return;
    const calls=(event.response.output||[]).filter(item=>item.type==='function_call'&&item.name==='read_note_articles'&&typeof item.call_id==='string'&&!handled.has(item.call_id));
    if(!calls.length)return;
    const generation=speechGeneration;
    for(const call of calls)handled.add(call.call_id);
    for(const call of calls) {
      if(!isCurrent()||signal?.aborted)return;
      let output={error:'reference_unavailable',instruction:'Cannot confirm article details. Do not invent them.'};
      const abort=new AbortController();const cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(cancel,timeoutMs);
      try {
        const args=JSON.parse(call.arguments);
        if(++reads>12||!Array.isArray(args.article_ids)||args.article_ids.length<1||args.article_ids.length>2)throw Error('invalid');
        const response=await fetcher(`${base}/voice/articles`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:getToken(),article_ids:args.article_ids}),signal:abort.signal});
        if(!response.ok)throw Error('unavailable');
        output=await response.json();
      } catch {} finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
      if(!isCurrent()||signal?.aborted)return;
      send({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:JSON.stringify(output)}});
    }
    // An older lookup must not restart speech over a newly spoken user turn.
    if(isCurrent()&&!signal?.aborted&&speechGeneration===generation)send({type:'response.create'});
  }
  return {handle,interrupt:()=>{speechGeneration++;}};
}
