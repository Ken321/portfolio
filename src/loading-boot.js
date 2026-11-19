// Inline before styles: survive failed modules, slow networks, and back/forward cache.
(()=>{const root=document.documentElement;root.classList.add('is-loading');const started=performance.now();let done=false,timer,slow;
window.__finishPortfolioLoading=reason=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(slow);root.classList.remove('is-loading');root.dataset.loadResult=reason;const content=document.getElementById('site-content');if(content){content.inert=false;content.removeAttribute('aria-hidden');}const loader=document.getElementById('site-loader');if(loader){const moveFocus=loader.contains?.(document.activeElement);loader.hidden=true;loader.setAttribute('aria-busy','false');if(moveFocus){const main=document.getElementById('main');main?.setAttribute('tabindex','-1');main?.focus({preventScroll:true});}}window.__portfolioLoadDuration=performance.now()-started;};
timer=setTimeout(()=>window.__finishPortfolioLoading('timeout'),10000);
slow=setTimeout(()=>{const button=document.getElementById('loading-continue');if(button)button.hidden=false;},5000);
window.addEventListener('pageshow',e=>{if(e.persisted)window.__finishPortfolioLoading('restored');});
})();
