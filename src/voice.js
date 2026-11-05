import { createNoteToolHandler } from './note-tools.js';
import { createVoiceDiagnostics } from './voice-diagnostics.js';
import { connectSpeechMeter } from './voice-motion.js';
export function createVoice(root) {
  const start=root.querySelector('[data-voice-start]'),end=root.querySelector('[data-voice-end]'),mute=root.querySelector('[data-voice-mute]');
  const status=root.querySelector('[data-voice-status]'),caption=root.querySelector('[data-voice-caption]');
  const scene=root.querySelector('.avatar-scene');
  const configured=document.querySelector('meta[name="voice-api"]')?.content;
  const base=(configured || (['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:8787':'')).replace(/\/$/,'');
  let storage;try{storage=window.localStorage;}catch{}
  const diagnostics=createVoiceDiagnostics(storage);
  window.portfolioVoiceDiagnostics={read:diagnostics.read};
  let run=null,completed=false;
  const text=(ja,en)=>document.documentElement.lang==='en'?en:ja;
  const state=(value,ja,en)=>{scene.dataset.voiceState=value;status.textContent=['listening','speaking','thinking'].includes(value)?'':text(ja,en);};
  const idle=()=>state('idle','','');
  const setMuteLabel=muted=>{
    mute.setAttribute('aria-pressed',String(muted));
    mute.dataset.ja=muted?'マイクオン':'マイクオフ';
    mute.dataset.en=muted?'Unmute microphone':'Mute microphone';
    mute.textContent=text(mute.dataset.ja,mute.dataset.en);
  };
  function finish(message,reason='ended'){
    const r=run;if(!r)return;diagnostics.record('session.end',{reason});run=null;
    clearTimeout(r.timer);clearTimeout(r.connectTimer);r.abort.abort();r.stream?.getTracks().forEach(t=>t.stop());r.pc?.close();r.audio.pause();r.audio.srcObject=null;r.disconnectMeter?.();r.context?.close().catch(()=>{});
    if(r.token)fetch(`${base}/voice/end`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:r.token}),keepalive:true}).catch(()=>{});
    start.hidden=false;end.hidden=true;mute.hidden=true;setMuteLabel(false);
    idle();
    if(r.started){
      completed=true;start.disabled=true;start.dataset.ja='お話ありがとう！';start.dataset.en='Thanks for chatting!';start.textContent=text(start.dataset.ja,start.dataset.en);
    }
    if(message && !['user_end','time_limit'].includes(reason))status.textContent=message;
  }
  async function begin(){
    if(run || completed)return;
    if(!base){state('idle','音声会話は準備中です。','Voice chat is being prepared.');return;}
    if(!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection){state('idle','このブラウザーでは音声会話を利用できません。','Voice chat is unavailable in this browser.');return;}
    const r={abort:new AbortController(),audio:new Audio()};run=r;
    diagnostics.record('session.start');
    r.audio.autoplay=true;r.audio.setAttribute('playsinline','');
    // Resume inside the explicit button gesture, before microphone/network awaits.
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(AudioContextClass){try{r.context=new AudioContextClass();r.context.resume().catch(()=>{});}catch{}}

    start.hidden=true;end.hidden=false;caption.textContent='';state('connecting','接続しています…','Connecting…');
    r.connectTimer=setTimeout(()=>{if(run===r)finish(text('接続できませんでした。もう一度お試しください。','Could not connect. Please try again.'));},35000);
    try {
      const availability=await fetch(`${base}/voice/status`,{signal:r.abort.signal});
      if(!availability.ok || !(await availability.json()).available)throw new Error('not_configured');
      if(run!==r)return;
      state('connecting','マイクの使用を許可してください。','Please allow microphone access.');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(run!==r){stream.getTracks().forEach(t=>t.stop());return;}r.stream=stream;
      stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{if(run===r)finish(text('マイクが切断されました。','Microphone disconnected.'));}));
      r.pc=new RTCPeerConnection();stream.getTracks().forEach(t=>r.pc.addTrack(t,stream));
      r.pc.ontrack=event=>{if(run!==r)return;r.audio.srcObject=event.streams[0]||new MediaStream([event.track]);
        if(r.context){try{r.disconnectMeter?.();r.disconnectMeter=connectSpeechMeter(scene,r.context,r.audio.srcObject);}catch{}}
        r.audio.play().catch(()=>finish(text('音声を再生できませんでした。もう一度お試しください。','Audio playback was blocked. Please try again.')));};
      r.pc.onconnectionstatechange=()=>{diagnostics.record('connection.state',{state:r.pc.connectionState});if(run===r && ['failed','closed','disconnected'].includes(r.pc.connectionState))finish(text('会話が終了しました。','Conversation ended.'),'connection');};
      const dc=r.pc.createDataChannel('oai-events');r.dc=dc;
      r.noteTools=createNoteToolHandler({send:event=>dc.send(JSON.stringify(event)),base,getToken:()=>r.token,isCurrent:()=>run===r,signal:r.abort.signal});
      dc.onopen=()=>{
        if(run!==r)return;r.started=true;clearTimeout(r.connectTimer);mute.hidden=false;
        state('listening','聞いています。','Listening.');
        dc.send(JSON.stringify({type:'response.create',response:{instructions:document.documentElement.lang==='en'?'Introduce yourself briefly as the AI guide to Ken’s portfolio. Audibly start with “Oh, um, hello!” in a timid, flustered voice, with a brief restart mid-sentence. Invite a question casually. Keep the whole greeting around 20–30 words, a soft target; finish naturally even if longer. Gradually reduce volume over the last few syllables of each sentence, with slightly breathy, less distinct articulation, while keeping every word audible and complete. Begin the next sentence at a comfortable soft volume again. Never describe this delivery or say you are nervous.':'「あ、えっと、こんにちは！」と実際に言い淀んで話し始めてください。Kenの作品を案内するAIだと短く名乗り、「よ、よかったら、何か聞いてください」のように質問を歓迎してください。常にオドオドした、ためらいがはっきり聞こえる声で、途中にも短いつかえや間を入れます。丁寧語ですがフランクに。流暢な司会口調にしないでください。全体を40〜60文字程度の短い挨拶にしてください。文字数は目安なので、超えても文を最後まで話してください。各文の語尾に向かって少しずつ声量を落とし、最後の数音は息混じりで少しぼそぼそと、滑舌を柔らかく曖昧にしてください。ただし語尾を省略したり無音にせず、言葉は聞き取れるように最後まで発音してください。次の文は聞こえる柔らかな声量に戻してください。この話し方を説明したり、自分が緊張していると言ったりしないでください。'}}));
      };
      dc.onmessage=({data})=>{
        if(run!==r)return;let e;try{e=JSON.parse(data);}catch{return;}
        diagnostics.event(e);
        void r.noteTools.handle(e).catch(()=>{});
        if(e.type==='input_audio_buffer.speech_started'){r.noteTools.interrupt();state('listening','聞いています。','Listening.');}
        if(e.type==='input_audio_buffer.speech_stopped')state('thinking','考えています…','Thinking…');
        if(e.type==='response.created')caption.textContent='';
        if(e.type==='output_audio_buffer.started')state('speaking','話しています。','Speaking.');
        if(['output_audio_buffer.stopped','output_audio_buffer.cleared'].includes(e.type))state('listening','聞いています。','Listening.');
        if(e.type==='response.output_audio_transcript.delta')caption.textContent+=e.delta||'';
        if(e.type==='response.done' && e.response?.status==='failed')finish(text('返答を生成できませんでした。もう一度お試しください。','Could not generate a reply. Please try again.'));
        if(e.type==='error')finish(text('会話に接続できませんでした。もう一度お試しください。','Conversation failed. Please try again.'));
      };
      await r.pc.setLocalDescription(await r.pc.createOffer());
      const response=await fetch(`${base}/voice/session?references=note-v1`,{method:'POST',headers:{'Content-Type':'application/sdp'},body:r.pc.localDescription.sdp,signal:r.abort.signal});
      if(!response.ok)throw new Error(response.status===429?'limit':'connection');
      const answer=await response.json();r.token=answer.token;
      if(run!==r){fetch(`${base}/voice/end`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:r.token})}).catch(()=>{});return;}
      r.timer=setTimeout(()=>finish(undefined,'time_limit'),answer.maxSeconds*1000);
      await r.pc.setRemoteDescription({type:'answer',sdp:answer.sdp});
    }catch(error){
      if(run!==r)return;
      const message=error.name==='NotAllowedError'?text('マイクの許可が必要です。ブラウザーの設定から変更できます。','Microphone permission is required. Check your browser settings.'):
        error.message==='limit'?text('ただいま会話の受付をお休みしています。また後でどうぞ。','Voice chat is at capacity. Please try later.'):
        error.message==='not_configured'?text('音声会話は準備中です。','Voice chat is being prepared.'):
        text('接続できませんでした。もう一度お試しください。','Could not connect. Please try again.');
      finish(message);
    }
  }
  start.addEventListener('click',begin);end.addEventListener('click',()=>finish(undefined,'user_end'));
  mute.addEventListener('click',()=>{if(!run?.stream)return;const muted=mute.getAttribute('aria-pressed')!=='true';run.stream.getAudioTracks().forEach(t=>t.enabled=!muted);setMuteLabel(muted);status.textContent='';});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish(undefined,'page_hidden');});
  window.addEventListener('pagehide',()=>finish(undefined,'pagehide'));
  document.addEventListener('portfolio:work-page',()=>{if(document.body.classList.contains('work-page-animating'))finish();});
  idle();
  return {begin};
}
