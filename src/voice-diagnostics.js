// Local-only metadata: never persist transcripts, audio, SDP, tokens or raw errors.
const KEY='portfolio.voice.diagnostics.v1',MAX=300,TTL=24*60*60*1000;
const events=new Set(['response.created','response.done','input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','output_audio_buffer.started','output_audio_buffer.stopped','output_audio_buffer.cleared','error']);
const reasons=new Set(['max_output_tokens','content_filter','turn_detected','client_cancelled']);
export function responseMetadata(e){
  if(!events.has(e.type))return null;
  const row={event:e.type};
  if(e.type==='response.done'){
    row.status=['completed','cancelled','incomplete','failed'].includes(e.response?.status)?e.response.status:'unknown';
    const reason=e.response?.status_details?.reason;
    if(reason)row.reason=reasons.has(reason)?reason:'other';
    const usage=e.response?.usage;
    for(const [key,value] of Object.entries({outputTokens:usage?.output_tokens,audioTokens:usage?.output_token_details?.audio_tokens,textTokens:usage?.output_token_details?.text_tokens}))if(Number.isFinite(value))row[key]=value;
  }
  return row;
}
export function createVoiceDiagnostics(storage){
  let rows=[];
  try{const saved=JSON.parse(storage?.getItem(KEY)||'[]');if(Array.isArray(saved))rows=saved.filter(r=>r.at>Date.now()-TTL).slice(-MAX);}catch{}
  const record=(event,details={})=>{
    rows=rows.filter(r=>r.at>Date.now()-TTL);rows.push({at:Date.now(),event,...details});rows=rows.slice(-MAX);
    try{storage?.setItem(KEY,JSON.stringify(rows));}catch{}
  };
  return {record,event:e=>{const row=responseMetadata(e);if(row){const {event,...details}=row;record(event,details);}},read:()=>JSON.parse(JSON.stringify(rows.filter(r=>r.at>Date.now()-TTL)))};
}
