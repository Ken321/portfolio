// Keep touch holds separate from mouse hover; a scroll gesture cancels the hold.
export function bindHeroTouch(root, pointer, delay=180) {
  let press=null,timer;
  const clear=()=>{
    clearTimeout(timer);
    if(press){pointer.active=false;pointer.cell=null;}
    press=null;
  };
  const down=e=>{
    if(e.pointerType!=='touch')return;
    if(press){clear();return;}
    const cell=e.target.closest?.('.hero-art [data-effect]');
    if(!cell)return;
    press={id:e.pointerId,x:e.clientX,y:e.clientY,cell};
    timer=setTimeout(()=>{
      if(!press)return;
      pointer.active=true;pointer.cell=press.cell;
      // Touch holds change the effect without adding a large screen-position tilt.
      pointer.nx=0;pointer.ny=0;
    },delay);
  };
  const move=e=>{if(press && e.pointerId===press.id && Math.hypot(e.clientX-press.x,e.clientY-press.y)>12)clear();};
  const end=e=>{if(press && e.pointerId===press.id)clear();};
  const menu=e=>{if(e.target.closest?.('.hero-art'))e.preventDefault();};
  const listeners={pointerdown:down,pointermove:move,pointerup:end,pointercancel:end,blur:clear,contextmenu:menu};
  for(const [name,fn] of Object.entries(listeners))root.addEventListener(name,fn);
  return ()=>{clear();for(const [name,fn] of Object.entries(listeners))root.removeEventListener(name,fn);};
}
export const isEffectDrag = event => event.type==='touchmove' && !!event.target.closest?.('.contact-play:has(.effect-ready), .ken-scene.effect-ready');
