// Simulation time advances only while visible; background wall time is discarded.
export function advanceTime(previous, elapsedMs) {
  return previous + Math.min(50, Math.max(0, elapsedMs)) / 1000;
}
export function frameInterval(mobile) { return 1000 / (mobile ? 30 : 60); }

// Scroll stays animated at 20fps; direct manipulation keeps its usual cadence.
export function effectFrameInterval({mobile, scrolling=false, kind, interacting=false}) {
  if (mobile && scrolling && !interacting) return 1000 / 20;
  return kind === 'ken' ? 1000 / 60 : frameInterval(mobile);
}
