// Shared by the lazy voice and avatar bundles; no additional animation loop.
const meters = new WeakMap();
export function speechEnvelope(samples, previous, dt) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  const target = Math.min(1, Math.max(0, (rms - .008) * 9));
  return previous + (target - previous) * (1 - Math.exp(-Math.min(.1, Math.max(0, dt)) * (target > previous ? 24 : 9)));
}
export function connectSpeechMeter(cell, context, stream) {
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser(); analyser.fftSize = 512;
  const silent = context.createGain(); silent.gain.value = 0;
  source.connect(analyser); analyser.connect(silent); silent.connect(context.destination);
  const meter = { analyser, samples: new Float32Array(analyser.fftSize), level: 0 };
  meters.set(cell, meter);
  return () => { source.disconnect(); analyser.disconnect(); silent.disconnect(); if (meters.get(cell) === meter) meters.delete(cell); };
}
export function readSpeechLevel(cell, dt) {
  const meter = meters.get(cell);
  if (!meter) return 0;
  meter.analyser.getFloatTimeDomainData(meter.samples);
  meter.level = speechEnvelope(meter.samples, meter.level, dt);
  return meter.level;
}
