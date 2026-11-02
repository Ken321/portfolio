// Simulation time advances only while visible; background wall time is discarded.
export function advanceTime(previous, elapsedMs) {
  return previous + Math.min(50, Math.max(0, elapsedMs)) / 1000;
}
export function frameInterval(mobile) { return 1000 / (mobile ? 30 : 60); }
