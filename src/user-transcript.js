// Per-call, in-memory captions. Never write audio or transcript text to storage.
export function createTranscriptState(){
 let latest=null,sequence=0;const rows=new Map();
 const select=id=>{if(!id)return null;let row=rows.get(id);if(!row){row={id,order:++sequence,text:'',status:'listening'};rows.set(id,row);while(rows.size>32)rows.delete(rows.keys().next().value);}if(!latest||row.order>latest.order)latest=row;return row;};
 return {
  event(e){
   if(typeof e?.type!=='string')return;
   const id=e.item_id;
   if(e.type==='input_audio_buffer.speech_started'){select(id);}
   else if(e.type==='input_audio_buffer.committed'){const row=select(id);if(row?.status==='listening')row.status='pending';}
   else if(e.type==='input_audio_buffer.speech_stopped'){const row=rows.get(id);if(row&&row.status==='listening')row.status='pending';}
   else if(e.type==='caption.delayed'){const row=rows.get(id);if(row&&['listening','pending'].includes(row.status))row.status='delayed';}
   else if(e.type.startsWith('conversation.item.input_audio_transcription.')){
    // Only known turns are eligible, so an old evicted completion never becomes current.
    const row=rows.get(id);if(!row)return;
    if(e.type.endsWith('.completed')){row.text=typeof e.transcript==='string'?e.transcript:'';row.status=row.text.trim()?'complete':'empty';}
    else if(e.type.endsWith('.failed')){if(row.status!=='complete'){row.text='';row.status='failed';}}
    else if(e.type.endsWith('.delta')&&!['complete','failed','empty'].includes(row.status)){row.text+=e.delta||'';row.status='partial';}
   }
  },
  read(){return latest?{...latest}:null;},
  clear(){rows.clear();latest=null;sequence=0;}
 };
}

// Best-effort captions never gate or terminate the audio conversation.
export function createUserTranscript(root,{text}){
 const panel=root.querySelector('[data-user-transcript]');
 if(!panel)return {start(){},event(){return false;},finish(){}};
 const body=root.querySelector('[data-user-transcript-text]');
 const toggle=root.querySelector('[data-user-transcript-toggle]');
 const announced=root.querySelector('[data-user-transcript-announcement]');
 const state=createTranscriptState();let currentId=null,expanded=false,active=false,unavailable=false;
 const enableId='portfolio-user-transcription-enable-v1';let ackTimer,turnTimer;
 const localized=(node,ja,en)=>{node.dataset.ja=ja;node.dataset.en=en;node.textContent=text(ja,en);};
 const measure=()=>{toggle.hidden=!expanded&&body.scrollHeight<=body.clientHeight+1;};
 const render=()=>{
  const row=state.read();panel.hidden=!row;if(!row)return;
  if(row.id!==currentId){currentId=row.id;expanded=false;}
  panel.dataset.expanded=String(expanded);toggle.setAttribute('aria-expanded',String(expanded));
  localized(toggle,expanded?'閉じる':'全文を見る',expanded?'Show less':'Show full text');
  const fallback=unavailable?['文字起こしを利用できません。会話は続けられます。','Transcription is unavailable. You can keep talking.']:
   row.status==='listening'?['聞き取り中…','Listening…']:
   row.status==='failed'?['文字起こしできませんでした。会話は続けられます。','Could not transcribe this turn. You can keep talking.']:
   row.status==='empty'?['音声を文字にできませんでした。','No speech could be transcribed.']:
   row.status==='delayed'?['文字起こしが遅れています。会話は続けられます。','Transcription is delayed. You can keep talking.']:
   ['文字起こし中…','Transcribing…'];
  if(row.text){delete body.dataset.ja;delete body.dataset.en;body.textContent=row.text;}else localized(body,...fallback);
  const announcement=text('あなた: ','You: ')+row.text;
  if(row.status==='complete'&&announced&&announced.textContent!==announcement)announced.textContent=announcement;
  requestAnimationFrame(measure);
 };
 toggle.addEventListener('click',()=>{expanded=!expanded;render();});
 window.addEventListener('resize',measure);
 return {
  start(send){state.clear();currentId=null;active=true;unavailable=false;panel.hidden=true;if(announced)announced.textContent='';
   // Enable on the established call: a configuration failure must not block voice.
   send({type:'session.update',event_id:enableId,session:{type:'realtime',audio:{input:{transcription:{model:'gpt-live-transcribe'}}}}});
   clearTimeout(ackTimer);ackTimer=setTimeout(()=>{if(active){unavailable=true;render();}},10000);
  },
  event(e){if(!active||typeof e?.type!=='string')return false;
   if(e.type==='error'&&e.error?.event_id===enableId){clearTimeout(ackTimer);unavailable=true;render();return true;}
   if(e.type==='session.updated'&&e.session?.audio?.input?.transcription?.model){clearTimeout(ackTimer);unavailable=false;render();}
   state.event(e);
   if(e.type.startsWith('conversation.item.input_audio_transcription.')){clearTimeout(ackTimer);unavailable=false;}
   if(e.type==='input_audio_buffer.speech_started'){clearTimeout(turnTimer);if(announced)announced.textContent='';}
   if(e.type==='input_audio_buffer.speech_stopped'){
    clearTimeout(turnTimer);const id=e.item_id;turnTimer=setTimeout(()=>{if(active&&state.read()?.id===id){state.event({type:'caption.delayed',item_id:id});render();}},15000);
   }
   if(e.type.startsWith('input_audio_buffer.')||e.type.startsWith('conversation.item.input_audio_transcription.'))render();
   return false;
  },
  finish(){active=false;clearTimeout(ackTimer);clearTimeout(turnTimer);state.clear();currentId=null;panel.hidden=true;body.textContent='';delete body.dataset.ja;delete body.dataset.en;if(announced)announced.textContent='';}
 };
}
