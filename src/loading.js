// Wait only for initial page resources and initially visible effects. Offscreen
// images, work details and voice remain lazy; waiting for them would deadlock.
export function finishInitialLoading(effectsReady){
 const loaded=document.readyState==='complete'?Promise.resolve():new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));
 Promise.allSettled([loaded,document.fonts?.ready,effectsReady]).then(()=>{
  const images=[...document.images].filter(img=>img.loading!=='lazy');
  return Promise.allSettled(images.map(img=>img.decode?.()));
 }).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>window.__finishPortfolioLoading?.('ready'))));
}
