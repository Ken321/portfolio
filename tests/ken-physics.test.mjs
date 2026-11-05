import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { createLetterAssets } from '../src/effects/ken-shapes.js';
import { createPhysics } from '../src/effects/ken-physics.js';
import { createCollider, glyphContact, updateCollider } from '../src/effects/ken-colliders.js';
import { Vector3, Quaternion } from 'three';
const contact = {depth:0, normal:new Vector3()};
const font=new FontLoader().parse(JSON.parse(await readFile(new URL('../node_modules/three/examples/fonts/helvetiker_bold.typeface.json',import.meta.url),'utf8')));
const assets=createLetterAssets(font);
test('thin digits can approach inside the old sphere while rotated contours still collide',()=>{
  const asset=assets[2];
  const make=()=>({position:new Vector3(),quaternion:new Quaternion(),radius:asset.radius,collider:createCollider(asset)});
  const a=make(),b=make();updateCollider(a);updateCollider(b);
  b.position.x=.65;
  assert.ok(b.position.x<a.radius+b.radius,'Old whole-glyph spheres would leave a large gap');
  assert.ok(!glyphContact(a,b,contact),'Separated stems must be able to approach closely');
  b.position.x=.58;
  assert.ok(glyphContact(a,b,contact),'Visible bases must not pass through each other');
  a.quaternion.setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);
  b.quaternion.copy(a.quaternion);updateCollider(a);updateCollider(b);
  b.position.x=1.25;assert.ok(!glyphContact(a,b,contact));
  b.position.x=1.1;assert.ok(glyphContact(a,b,contact),'The rotated full height must become collision width');
});
test('contour boxes enclose every rendered vertex, including bevels',()=>{
  for(const asset of assets){
    const p=asset.geometry.getAttribute('position');
    for(let i=0;i<p.count;i++){
      const v=new Vector3().fromBufferAttribute(p,i);
      assert.ok(asset.boxes.some(b=>Math.abs(v.x-b.center.x)<=b.half.x+1e-7&&Math.abs(v.y-b.center.y)<=b.half.y+1e-7&&Math.abs(v.z-b.center.z)<=b.half.z+1e-7),'Every rendered vertex must be covered');
      assert.ok(v.length()<asset.radius);
    }
  }
});
for(const count of [9,15,18,21,36])test(`${count} letters remain separated and bounded during 20 seconds of pointer sweeps`,()=>{
  const sim=createPhysics(assets,count);
  let maxOverlap=0;
  for(let step=0;step<2400;step++){
    sim.step({x:Math.sin(step*.1)*3,y:Math.cos(step*.07)*2});
    for(let i=0;i<count;i++){
      const a=sim.bodies[i];
      assert.ok(Number.isFinite(a.position.length()));assert.ok(a.position.length()<12);
      assert.ok(Math.abs(a.quaternion.length()-1)<1e-6);
      for(let j=i+1;j<count;j++){
        const b=sim.bodies[j];
        if(step%12===0&&glyphContact(a,b,contact))maxOverlap=Math.max(maxOverlap,contact.depth);
      }
    }
  }
  assert.ok(sim.contactCount>0);
  assert.ok(maxOverlap<.01,`Excessive contour overlap ${maxOverlap}`);
});
test('hover visibly displaces the gathering cluster',()=>{
  const idle=createPhysics(assets,9),hover=createPhysics(assets,9);
  const start=idle.bodies.map(b=>b.position.clone());
  for(let i=0;i<240;i++){idle.step(null);hover.step({x:0,y:0});}
  assert.ok(idle.bodies.some((b,i)=>b.position.distanceTo(start[i])>.1));
  assert.ok(hover.bodies.some((b,i)=>b.position.distanceTo(idle.bodies[i].position)>.3));
});
test('fast opposing glyphs stay separated, including when they slide around in depth',()=>{
  const sim=createPhysics(assets,2),[a,b]=sim.bodies;
  a.position.set(-2,0,0);b.position.set(2,0,0);
  a.velocity.set(200,0,0);b.velocity.set(-200,0,0);
  for(let i=0;i<100;i++){sim.step(null);assert.ok(!glyphContact(a,b,contact)||contact.depth<.01);}
});

for(const count of [9,15,18,21,36])test(`${count} letters settle, wake on hover, then settle again`,()=>{
  const sim=createPhysics(assets,count);
  for(let i=0;i<1200&&!sim.sleeping;i++)sim.step(null);
  assert.ok(sim.sleeping,'Must settle within ten seconds');
  const positions=sim.bodies.map(b=>b.position.clone()),rotations=sim.bodies.map(b=>b.quaternion.clone());
  for(let i=0;i<240;i++)sim.step(null);
  sim.bodies.forEach((b,i)=>{assert.ok(b.position.equals(positions[i]));assert.ok(b.quaternion.equals(rotations[i]));});
  const front=sim.bodies.reduce((a,b)=>a.position.z>b.position.z?a:b);
  const cameraZ=5.2, factor=cameraZ/(cameraZ-front.position.z);
  const pointer={x:front.position.x*factor+.1,y:front.position.y*factor,cameraZ};
  sim.step(pointer);assert.ok(!sim.sleeping);
  for(let i=0;i<60;i++)sim.step(pointer);
  assert.ok(sim.bodies.some((b,i)=>b.position.distanceTo(positions[i])>.2),'Hovered cluster must visibly react within half a second');
  sim.step(null);
  for(let i=0;i<1200&&!sim.sleeping;i++)sim.step(null);
  assert.ok(sim.sleeping,'Must settle again after leaving');
});

test('a quick swipe produces energetic spin and translation, then settles',()=>{
  const sim=createPhysics(assets,15);
  for(let i=0;i<1200&&!sim.sleeping;i++)sim.step(null);
  const front=sim.bodies.reduce((a,b)=>a.position.z>b.position.z?a:b);
  const factor=5.2/(5.2-front.position.z),x=front.position.x*factor,y=front.position.y*factor;
  let peakSpin=0,peakSpeed=0;
  for(let i=0;i<60;i++){
    sim.step({x:x-1+i/30,y,cameraZ:5.2});
    for(const body of sim.bodies){peakSpin=Math.max(peakSpin,body.angular.length());peakSpeed=Math.max(peakSpeed,body.velocity.length());}
  }
  assert.ok(peakSpin>2,'Swipe must exceed the previous 1.2 rad/s rotation limit');
  assert.ok(peakSpeed>4,'Swipe must exceed the previous translation limit');
  for(let i=0;i<1200&&!sim.sleeping;i++)sim.step(null);
  assert.ok(sim.sleeping,'An energetic swipe must still settle');
});


test('the wider horizontal gathering still returns within one second',()=>{
  const sim=createPhysics([{radius:1}],1),body=sim.bodies[0];
  body.position.set(3,0,0);body.velocity.set(0,0,0);
  let steps=0;
  while(body.position.x>1 && steps<120){sim.step(null);steps++;}
  assert.ok(steps/120>=.45 && steps/120<=1,`Return took ${steps/120}s`);
});

test('only excess rear depth gets extra push while horizontal gathering is gentler',()=>{
  const make=(x,y,z)=>{const sim=createPhysics([{radius:1}],1),b=sim.bodies[0];b.position.set(x,y,z);b.velocity.set(0,0,0);b.angular.set(0,0,0);sim.step(null);return b;};
  const front=make(0,0,1),nearRear=make(0,0,-.4),rear=make(0,0,-1);
  assert.ok(Math.abs(nearRear.velocity.z/.4+front.velocity.z)<1e-10,'The central depth force remains symmetric before the rear boundary');
  assert.ok(rear.velocity.z>Math.abs(front.velocity.z)*2,'Extra force acts on excess rear depth');
  assert.ok(Math.abs(make(1,0,0).velocity.x)<Math.abs(make(0,1,0).velocity.y),'The cluster can spread horizontally more easily');
});

test('settled desktop cluster stays shallow at the rear and spreads sideways',()=>{
  const sim=createPhysics(assets,36);
  for(let i=0;i<1200&&!sim.sleeping;i++)sim.step(null);
  assert.ok(sim.sleeping);
  let left=Infinity,right=-Infinity,rear=Infinity,front=-Infinity;
  for(const b of sim.bodies)for(const p of b.collider.pieces){
    left=Math.min(left,b.position.x+p.offset.x-p.extent.x);right=Math.max(right,b.position.x+p.offset.x+p.extent.x);
    rear=Math.min(rear,b.position.z+p.offset.z-p.extent.z);front=Math.max(front,b.position.z+p.offset.z+p.extent.z);
  }
  assert.ok(rear>-2.15,`Rear is too deep: ${rear}`);
  assert.ok(front>2&&front<3.5,`Front moved too far: ${front}`);
  assert.ok(right-left>(front-rear)*1.1,'The main spread must be horizontal');
});
