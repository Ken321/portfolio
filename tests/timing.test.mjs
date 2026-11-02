import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTime, frameInterval, effectFrameInterval } from '../src/timing.js';
test('resuming after a long interruption never fast-forwards a simulation', () => {
  assert.equal(advanceTime(10, 120000), 10.05);
  assert.equal(advanceTime(10, -5), 10);
});
test('normal mobile frames preserve real-time animation speed', () => {
  let time = 0;
  for (let i = 0; i < 30; i++) time = advanceTime(time, frameInterval(true));
  assert.ok(Math.abs(time - 1) < 1e-9);
});

test('mobile scroll keeps every visible effect at 20fps without slowing simulation time', () => {
  for(const kind of ['hero','avatar','ken']){
    const interval=effectFrameInterval({mobile:true,scrolling:true,kind});
    assert.equal(interval,50);
    let time=0;for(let i=0;i<20;i++)time=advanceTime(time,interval);
    assert.ok(Math.abs(time-1)<1e-9);
  }
});
test('direct ken drag and desktop retain 60fps; mobile idle restores its normal rate', () => {
  assert.equal(effectFrameInterval({mobile:true,scrolling:true,kind:'ken',interacting:true}),1000/60);
  assert.equal(effectFrameInterval({mobile:true,scrolling:false,kind:'hero'}),1000/30);
  assert.equal(effectFrameInterval({mobile:true,scrolling:false,kind:'ken'}),1000/60);
  assert.equal(effectFrameInterval({mobile:false,scrolling:true,kind:'hero'}),1000/60);
});
