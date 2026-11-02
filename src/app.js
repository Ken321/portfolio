let language = 'ja';
function applyLanguage(lang) {
  language = lang; document.documentElement.lang = lang;
  document.querySelectorAll('[data-ja][data-en]').forEach(node => { node.textContent = node.dataset[lang]; });
  document.querySelectorAll('[data-lang-content]').forEach(node => { node.hidden = node.dataset.langContent !== lang; });
  document.querySelectorAll('[data-language]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.language === lang)); });
}
document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => applyLanguage(button.dataset.language)));
// Expand the actual card into a dedicated page, retaining its place in the list.
const workCards=[];
let activeWork=null, listScroll=0, changing=false, pendingWork;
const reducedMotion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
// Measure both layouts on the same nodes, then interpolate their actual styles.
function measureWork(work){
  const card=work.card, picture=card.querySelector('picture'), image=picture.querySelector('img');
  const properties=['paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','fontSize','lineHeight','minHeight'];
  const nodes=[work.link,card.querySelector('.caption'),card.querySelector('.work-name'),card.querySelector('.work-summary')];
  const styles=nodes.map(node=>{
    const css=getComputedStyle(node),values={};
    for(const key of properties)if(css[key].endsWith('px'))values[key]=css[key];
    if(node===work.link)values.width=`${node.getBoundingClientRect().width}px`;
    return {node,values};
  });
  const box=image.getBoundingClientRect(),css=getComputedStyle(image);
  const ratio=image.naturalWidth/image.naturalHeight||box.width/box.height;
  const scale=css.objectFit==='contain'?Math.min(box.width/ratio,box.height):Math.max(box.width/ratio,box.height);
  const [px,py]=css.objectPosition.split(' ').map(v=>parseFloat(v)/100);
  return {styles,picture,image,pictureHeight:picture.getBoundingClientRect().height,
    bitmap:{width:scale*ratio,height:scale,left:(box.width-scale*ratio)*(Number.isFinite(px)?px:.5),top:(box.height-scale)*(Number.isFinite(py)?py:.5)},
    backHeight:work.back.getBoundingClientRect().height};
}
async function showWork(next){
  if(changing){pendingWork=next;return;}
  if(activeWork===next)return;
  changing=true;
  const previous=activeWork,moving=next||previous,card=moving.card;
  if(next){
    listScroll=history.state?.portfolioListScroll??window.scrollY;
    if(!moving.inner.childElementCount){
      moving.inner.append(document.getElementById(moving.link.dataset.work).content.cloneNode(true));
      moving.inner.querySelector('.work-close').addEventListener('click',closeWork);
      applyLanguage(language);
    }
    moving.listHeight=card.getBoundingClientRect().height;
  }
  const startLayout=measureWork(moving);
  const before=card.getBoundingClientRect();
  const placeholder=document.createElement('div');
  placeholder.className=card.classList.contains('featured')?'work featured':'work';
  placeholder.style.height=`${moving.listHeight||before.height}px`;
  placeholder.setAttribute('aria-hidden','true');
  card.before(placeholder);
  const originalStyle=card.getAttribute('style');
  // Move the actual card, including its original image, into a temporary animation layer.
  // The placeholder retains its grid position; no snapshot or duplicate image is used.
  document.body.append(card);
  card.classList.add('work-live-motion','work-page-selected','is-expanded');
  Object.assign(card.style,{position:'fixed',left:`${before.left}px`,top:`${before.top}px`,width:`${before.width}px`,height:`${before.height}px`,margin:'0',minHeight:'0'});
  document.body.classList.add('work-page-animating');
  moving.panel.setAttribute('aria-hidden','false');moving.panel.inert=false;
  moving.link.setAttribute('aria-expanded',String(!!next));moving.back.hidden=!next;
  let destination;
  if(next){
    const page=document.querySelector('.page').getBoundingClientRect();
    const top=matchMedia('(max-width:900px)').matches?document.querySelector('.site-header').getBoundingClientRect().bottom:0;
    destination={left:page.left,top,width:page.width,height:window.innerHeight-top};
  }else{
    // Restore the list behind the shrinking card before measuring its original slot.
    document.body.classList.remove('work-page-open');
    window.scrollTo({top:listScroll,behavior:'instant'});
    destination=placeholder.getBoundingClientRect();
  }
  // Measure the destination before painting, without cloning or replacing the image.
  Object.assign(card.style,{width:`${destination.width}px`,height:`${destination.height}px`});
  card.classList.toggle('work-page-selected',!!next);card.classList.toggle('is-expanded',!!next);
  moving.back.hidden=!next;
  const endLayout=measureWork(moving);
  card.classList.add('work-page-selected','is-expanded');moving.back.hidden=false;
  Object.assign(card.style,{width:`${before.width}px`,height:`${before.height}px`});
  const pictureStyle=startLayout.picture.getAttribute('style'),imageStyle=startLayout.image.getAttribute('style');
  startLayout.picture.style.position='relative';
  Object.assign(startLayout.image.style,{position:'absolute',maxHeight:'none',maxWidth:'none',aspectRatio:'auto',objectFit:'fill',transform:'none',transition:'none'});
  const childAnimations=[];
  const frame=(r,offset)=>({left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`,offset,easing:'cubic-bezier(.22,1,.36,1)'});
  const horizontalFirst=!!next&&matchMedia('(min-width:901px)').matches;
  const frames=[frame(before,0)];
  if(horizontalFirst)frames.push(frame({left:destination.left,top:before.top,width:destination.width,height:before.height},.45));
  frames.push(frame(destination,1));
  document.dispatchEvent(new Event('portfolio:work-page'));
  let animation;
  try{
    if(!reducedMotion()){
      const duration=horizontalFirst?720:550;
      const options={duration,fill:'forwards',easing:'cubic-bezier(.22,1,.36,1)'};
      const morph=(node,from,to)=>childAnimations.push(node.animate([from,to],options));
      startLayout.styles.forEach((entry,i)=>morph(entry.node,entry.values,endLayout.styles[i].values));
      morph(startLayout.picture,{height:`${startLayout.pictureHeight}px`},{height:`${endLayout.pictureHeight}px`});
      const bitmapFrame=bitmap=>Object.fromEntries(Object.entries(bitmap).map(([key,value])=>[key,`${value}px`]));
      morph(startLayout.image,bitmapFrame(startLayout.bitmap),bitmapFrame(endLayout.bitmap));
      morph(moving.back,{height:`${startLayout.backHeight}px`,minHeight:'0',paddingTop:'0px',paddingBottom:'0px',overflow:'hidden',opacity:next?0:1},{height:`${endLayout.backHeight}px`,minHeight:'0',paddingTop:'0px',paddingBottom:'0px',overflow:'hidden',opacity:next?1:0});
      animation=card.animate(frames,{duration,fill:'forwards'});
      await animation.finished;
    }
  }finally{
    activeWork=next;
    document.body.classList.toggle('work-page-open',!!next);
    placeholder.replaceWith(card);
    card.classList.remove('work-live-motion');
    card.classList.toggle('work-page-selected',!!next);card.classList.toggle('is-expanded',!!next);
    moving.panel.setAttribute('aria-hidden',String(!next));moving.panel.inert=!next;
    moving.back.hidden=!next;
    if(originalStyle===null)card.removeAttribute('style');else card.setAttribute('style',originalStyle);
    animation?.cancel();childAnimations.forEach(item=>item.cancel());
    if(pictureStyle===null)startLayout.picture.removeAttribute('style');else startLayout.picture.setAttribute('style',pictureStyle);
    if(imageStyle===null)startLayout.image.removeAttribute('style');else startLayout.image.setAttribute('style',imageStyle);
    document.body.classList.remove('work-page-animating');
    window.scrollTo({top:next?0:listScroll,behavior:'instant'});
    changing=false;
    (next?moving.back:moving.link).focus({preventScroll:true});
    document.dispatchEvent(new Event('portfolio:work-page'));
    if(pendingWork!==undefined){const pending=pendingWork;pendingWork=undefined;void showWork(pending);}
  }
}
function closeWork(){
  if(changing||!activeWork)return;
  if(history.state?.portfolioWork)history.back();else void showWork(null);
}
document.querySelectorAll('[data-work]').forEach(link=>{
  const card=link.closest('.work');
  const panel=document.createElement('div');panel.className='work-expansion';panel.id=`${link.dataset.work}-panel`;
  panel.setAttribute('role','region');panel.setAttribute('aria-labelledby',link.id);
  panel.setAttribute('aria-hidden','true');panel.inert=true;
  const inner=document.createElement('div');inner.className='work-expansion-inner';panel.append(inner);card.append(panel);
  const back=document.createElement('button');back.type='button';back.className='work-page-back';back.hidden=true;
  back.innerHTML='<span aria-hidden="true">←</span><span data-ja="作品一覧に戻る" data-en="Back to works">作品一覧に戻る</span>';
  back.addEventListener('click',closeWork);card.prepend(back);
  link.setAttribute('role','button');link.setAttribute('aria-expanded','false');link.setAttribute('aria-controls',panel.id);
  const work={card,link,panel,inner,back};workCards.push(work);
  const open=()=>{
    if(changing)return;
    if(activeWork===work){closeWork();return;}
    history.pushState({...history.state,portfolioWork:card.id,portfolioListScroll:window.scrollY},'',`#${card.id}`);
    void showWork(work);
  };
  link.addEventListener('click',event=>{
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;
    event.preventDefault();open();
  });
  link.addEventListener('keydown',event=>{if(event.key===' '){event.preventDefault();open();}});
});
window.addEventListener('popstate',event=>{
  void showWork(workCards.find(work=>work.card.id===event.state?.portfolioWork)||null);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeWork){event.preventDefault();closeWork();}});
// Restore an opened detail after refresh, and keep the home link useful in detail mode.
const restoredWork=workCards.find(work=>work.card.id===history.state?.portfolioWork);
if(restoredWork)void showWork(restoredWork);
document.querySelector('.site-header a[href="#top"]').addEventListener('click',event=>{
  if(activeWork){event.preventDefault();closeWork();}
});
// Navigation and work details are already usable before loading any 3D code.
if ('IntersectionObserver' in window && 'ResizeObserver' in window) {
  import('./effects-controller.js').then(({ startEffects }) => startEffects()).catch(error => console.warn('Static portfolio mode', error));
}
document.querySelectorAll('.avatar-scene').forEach(node => node.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.click(); }
}));

// Load voice networking only after an explicit conversation request.
const voiceRoot=document.querySelector('[data-voice]');
let voiceModule;
voiceRoot?.querySelector('[data-voice-start]').addEventListener('click',async function loadVoice(){
  const button=this;button.disabled=true;
  try{voiceModule=await import('./voice.js');const voice=voiceModule.createVoice(voiceRoot);button.removeEventListener('click',loadVoice);await voice.begin();}
  catch{voiceRoot.querySelector('[data-voice-status]').textContent=document.documentElement.lang==='en'?'Could not load voice chat. Please try again.':'音声会話を読み込めませんでした。もう一度お試しください。';}
  finally{button.disabled=false;}
});
