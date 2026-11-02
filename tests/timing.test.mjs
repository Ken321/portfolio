import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTime, frameInterval } from '../src/timing.js';
test('resuming after a long interruption never fast-forwards a simulation', () => {
  assert.equal(advanceTime(10, 120000), 10.05);
  assert.equal(advanceTime(10, -5), 10);
});
test('normal mobile frames preserve real-time animation speed', () => {
  let time = 0;
  for (let i = 0; i < 30; i++) time = advanceTime(time, frameInterval(true));
  assert.ok(Math.abs(time - 1) < 1e-9);
});
