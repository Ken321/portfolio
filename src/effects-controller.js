import { isEffectDrag } from './hero-touch.js';
import { advanceTime, effectFrameInterval } from './timing.js';
const mobile = matchMedia('(max-width: 900px), (pointer: coarse)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let motionReduced = reduced.matches;
const states = [];
const diagnostics = new URLSearchParams(location.search).has('perf');
document.addEventListener('portfolio:work-page', () => schedule());
let frame = 0, lastFrame = null, scrolling = false, scrollTimer;
const canRun = state => state.visible && state.effect && !document.hidden && !motionReduced && !document.body.classList.contains('work-page-open') && !document.body.classList.contains('work-page-animating');

const intervalFor = state => effectFrameInterval({mobile:mobile.matches, scrolling, kind:state.kind, interacting:state.effect?.isInteracting?.() ?? false});

function render(now) {
  frame = 0;
  const active = states.filter(canRun);
  if (!active.length) { lastFrame = null; return; }
  const interval = Math.min(...active.map(intervalFor));
  const elapsed = lastFrame === null ? interval : now - lastFrame;
  if (elapsed >= interval - .5) {
    lastFrame = now;
    for (const state of active) {
      const stateInterval = intervalFor(state);
      const stateElapsed = state.lastDrawTime == null ? stateInterval : now - state.lastDrawTime;
      if (stateElapsed < stateInterval - .5) continue;
      state.lastDrawTime = now;
      state.time = advanceTime(state.time, stateElapsed);
      try {
        state.effect.tick?.(state.time);
        if (!state.effect.tick) { state.effect.update?.(state.time); state.effect.render?.(state.size); }
        state.frames++;
        if (diagnostics && state.frames % 15 === 0) {
          state.node.dataset.performance = JSON.stringify({ frames: state.frames, time: state.time, ...state.effect.debug?.() });
        }
      } catch (error) { fail(state, error); }
    }
  }
  if (states.some(canRun)) frame = requestAnimationFrame(render);
}
function schedule() {
  states.forEach(state => { if (!canRun(state)) state.lastDrawTime = null; });
  if (states.some(canRun)) { if (!frame) { lastFrame = null; frame = requestAnimationFrame(render); } }
  else { cancelAnimationFrame(frame); frame = 0; lastFrame = null; }
}
function release(state) {
  const effect = state.effect;
  state.effect = null;
  state.node.classList.remove('effect-ready');
  state.node.dataset.state = 'idle';
  state.time = 0; state.lastDrawTime = null;
  effect?.dispose?.();
  schedule();
}
function fail(state, error) {
  release(state);
  state.failed = true; state.node.dataset.state = 'fallback';
  console.warn('The static portfolio remains available; an effect could not start.', error);
}
function resize(state) {
  const { width, height } = state.node.getBoundingClientRect();
  const size = { width: Math.floor(width), height: Math.floor(height) };
  if (size.width <= 0 || size.height <= 0) return;
  if (state.size?.width === size.width && state.size?.height === size.height) return;
  state.size = size;
  state.effect?.resize?.(size.width, size.height);
}
async function load(state) {
  if (state.loading || state.effect || state.failed || motionReduced) return;
  state.loading = true; state.node.dataset.state = 'loading';
  let effect;
  try {
    if (state.kind === 'hero') {
      const { createHeroEffects } = await import('./effects/hero.js');
      const effects = [];
      const cells = [...state.node.querySelectorAll('[data-effect]')];
      try {
        for (let i = 0; i < cells.length; i++) effects.push(createHeroEffects[i](cells[i]));
        await Promise.all(effects.map(e => e.ready));
      } catch (error) { effects.forEach(e => e.dispose?.()); throw error; }
      effect = {
        resize() { cells.forEach((cell, i) => { const rect = cell.getBoundingClientRect(); effects[i].resize(rect.width, rect.height); }); },
        tick(time) { effects.forEach(e => e.tick(time)); },
        dispose() { effects.forEach(e => e.dispose?.()); }
      };
    } else if (state.kind === 'ken') {
      const { createKen } = await import('./effects/ken.js');
      effect = createKen(state.node);
      await effect.ready;
    } else {
      const { createAvatar } = await import('./effects/avatar.js');
      effect = await createAvatar(state.node);
    }
    if (motionReduced || state.destroyed) { effect.dispose?.(); return; }
    state.effect = effect;
    resize(state);
    effect.resize?.(state.size.width, state.size.height);
    // First frame also establishes size for factories with update/render methods.
    if (effect.render) effect.render(state.size);
    effect.tick?.(0);
    state.node.classList.add('effect-ready');
    state.node.dataset.state = 'ready';
    schedule();
  } catch (error) { if (effect && state.effect !== effect) effect.dispose?.(); fail(state, error); }
  finally { state.loading = false; }
}
export function startEffects() {
  const near = new IntersectionObserver(entries => entries.forEach(({ target, isIntersecting }) => {
    const state = states.find(s => s.node === target);
    state.near = isIntersecting;
    if (isIntersecting) load(state);
  }), { rootMargin: '180px 0px' });
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = states.find(s => s.node === entry.target);
      state.visible = entry.isIntersecting && entry.intersectionRatio > 0;
      clearTimeout(state.releaseTimer);
      if (state.visible) load(state);
      else state.releaseTimer = setTimeout(() => { if (!state.visible) release(state); }, 30000);
    }
    schedule();
  }, { threshold: [0, .01] });
  const sizes = new ResizeObserver(entries => {
    for (const entry of entries) {
      const state = states.find(s => s.node === entry.target);
      if (state) resize(state);
    }
  });
  document.querySelectorAll('[data-effect-group]').forEach(node => {
    const state = { node, kind: node.dataset.effectGroup, effect: null, visible: false, near: false, loading: false, failed: false, time: 0, frames: 0 };
    states.push(state); resize(state); near.observe(node); visible.observe(node); sizes.observe(node);
    node.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      if (state.effect) fail(state, new Error('WebGL context lost'));
    }, true);
  });
  const trackScroll = event => {
    if (!mobile.matches || isEffectDrag(event)) return;
    scrolling = true; schedule(); clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { scrolling = false; schedule(); }, 160);
  };
  window.addEventListener('scroll', trackScroll, { passive: true });
  window.addEventListener('touchmove', trackScroll, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', event => {
    motionReduced = event.matches;
    states.forEach(state => { if (motionReduced) release(state); else if (state.near || state.visible) load(state); });
    schedule();
  });
  window.addEventListener('pagehide', event => {
    cancelAnimationFrame(frame); frame = 0;
    if (!event.persisted) states.forEach(state => { state.destroyed = true; release(state); clearTimeout(state.releaseTimer); });
  });
  window.addEventListener('pageshow', schedule);
  if (new URLSearchParams(location.search).has('perf')) {
    window.__portfolioPerformance = () => states.map(s => ({ kind: s.kind, visible: s.visible, loaded: !!s.effect, frames: s.frames, time: s.time, state: s.node.dataset.state, diagnostics: s.effect?.debug?.() }));
  }
}
