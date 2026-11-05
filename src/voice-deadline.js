// Keep the client deadline conservatively inside both backends' unchanged 180s cap.
export function createVoiceDeadline({send,onClosing,onText,onSpeaking,onFinish,language,now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout,playoutMs=750}){
  let stopped=false,closing=false,requested=false,active=null,finalId=null,generated=false,playing=false;
  const timers=[];
  const later=(fn,ms)=>timers.push(schedule(()=>{if(!stopped)fn();},Math.max(0,ms)));
  const request=()=>{
    if(requested||stopped)return;requested=true;
    send({type:'response.create',response:{conversation:'none',input:[],metadata:{purpose:'portfolio-time-limit-goodbye-v1'},tool_choice:'none',output_modalities:['audio'],max_output_tokens:512,instructions:language()==='en'?'Say only: “Oh, um, thanks for chatting! I’m a little tired, so I’ll stop here for today.” Keep the existing hesitant, soft character voice. Do not ask a question.':'「あ、えっと、お話ありがとう！ちょっと疲れちゃったから、今日はここまでにしますね。」だけを、いつものためらいがちな柔らかい口調で短く話してください。質問はしないでください。'}});
  };
  return {
    arm(startedAt,maxSeconds){
      const seconds=Number(maxSeconds),duration=Number.isFinite(seconds)&&seconds>0?Math.min(180,seconds)*1000:180000;
      const elapsed=Math.max(0,now()-startedAt);
      later(()=>onFinish(false),duration-elapsed);
      later(()=>{
        closing=true;onClosing();
        try{
          send({type:'session.update',session:{type:'realtime',audio:{input:{turn_detection:null}}}});
          send({type:'output_audio_buffer.clear'});
          if(active)send({type:'response.cancel',response_id:active});else request();
        }catch{onFinish(false);}
      },Math.max(0,duration-15000)-elapsed);
    },
    isClosing:()=>closing,
    event(e){
      if(stopped)return true;
      if(!closing){
        if(e.type==='response.created')active=e.response?.id||null;
        if(e.type==='response.done'&&(!e.response?.id||e.response.id===active))active=null;
        return false;
      }
      if(e.type==='response.done'&&active&&e.response?.id===active){active=null;try{request();}catch{onFinish(false);}return true;}
      if(e.type==='response.created'&&e.response?.metadata?.purpose==='portfolio-time-limit-goodbye-v1')finalId=e.response.id;
      const id=e.response_id||e.response?.id;
      if(finalId&&id===finalId){
        if(e.type==='response.output_audio_transcript.delta')onText(e.delta||'');
        if(e.type==='output_audio_buffer.started'){playing=true;onSpeaking();}
        if(e.type==='response.done'){
          generated=e.response.status==='completed';
          if(!generated)onFinish(false);
        }
        // Server-buffer drain is followed by a bounded client playout allowance.
        if(e.type==='output_audio_buffer.stopped'&&generated&&playing){playing=false;later(()=>onFinish(true),playoutMs);}
        if(e.type==='output_audio_buffer.cleared')onFinish(false);
      }
      return e.type!=='error';
    },
    stop(){stopped=true;timers.forEach(cancel);}
  };
}
