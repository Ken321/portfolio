import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createAvatarMotion} from '../src/effects/avatar-motion.js';
import {createMixamoMotion} from '../src/effects/avatar-mixamo-motion.js';

async function rig(){
 const bytes=await readFile(new URL('../assets/avatar-pants-fixed.glb',import.meta.url));
 const {scene}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const bone=n=>scene.getObjectByName(T.PropertyBinding.sanitizeNodeName(n));
 const position=n=>bone(n).getWorldPosition(new T.Vector3());
 return {scene,bone,position};
}
function clearance({scene,bone,position}){
 scene.updateMatrixWorld(true);
 const chest=bone('DEF-spine.003').getWorldQuaternion(new T.Quaternion());
 return Math.min(...['L','R'].map(s=>position(`DEF-forearm.${s}`).sub(position(`DEF-upper_arm.${s}`)).dot(new T.Vector3(s==='L'?1:-1,0,0).applyQuaternion(chest))));
}
test('production rig keeps elbows outside the torso across click directions, voice modes and frame rates',async()=>{
 for(const fps of [30,60,120])for(const [x,y]of [[-.28,1.08],[0,1.45],[.28,1.52]]){
  const r=await rig(),motion=createAvatarMotion(r.scene,{externalIdle:true});
  for(let i=0;i<fps;i++)motion.tick(i/fps,1/fps,'listening',0);
  const feet=['L','R'].map(s=>r.position(`DEF-foot.${s}`));
  motion.catchAt(new T.Vector3(x,y,.42));
  for(let i=0;i<8*fps;i++){
   const mode=i<2*fps?'idle':i<4*fps?'speaking':'listening';
   motion.tick(1+i/fps,1/fps,mode,.6);
   assert.ok(clearance(r)>.045,`Elbow entered torso at ${fps}fps, (${x},${y}), frame ${i}`);
   r.scene.traverse(b=>{if(b.isBone)assert.ok(b.quaternion.toArray().every(Number.isFinite));});
   for(const [j,s]of ['L','R'].entries())assert.ok(r.position(`DEF-foot.${s}`).distanceTo(feet[j])<.0001,`Feet remain planted: ${r.position(`DEF-foot.${s}`).distanceTo(feet[j])} at (${x},${y}), frame ${i}`);
  }
  assert.equal(motion.debug().action,'idle');motion.dispose();
 }
});
test('final head output accelerates, brakes gently, varies diagonally, and overlaps arm recovery',async t=>{
 t.mock.method(Math,'random',()=>.5);
 const r=await rig(),motion=createAvatarMotion(r.scene,{externalIdle:true}),head=r.bone('DEF-spine.006');
 const headRest=head.quaternion.clone().invert();motion.catchAt(new T.Vector3(0,1.45,.42));let previous=head.quaternion.clone(),samples=[],previousYaw=0;
 for(let i=0;i<480;i++){
  motion.tick(i/60,1/60,'listening',0);r.scene.updateMatrixWorld(true);
  const yaw=new T.Euler().setFromQuaternion(headRest.clone().multiply(head.quaternion)).y;
  samples.push({time:(i+1)/60,speed:previous.angleTo(head.quaternion)*60,yawSpeed:Math.abs(yaw-previousYaw)*60,q:head.quaternion.clone(),hand:r.position('DEF-hand.L').y,z:r.position('DEF-hand.L').z});previous.copy(head.quaternion);previousYaw=yaw;
 }
 const at=t=>samples[Math.round(t*60)-1],peak=Math.max(...samples.filter(s=>s.time>3.7&&s.time<4.7).map(s=>s.yawSpeed));
 assert.ok(peak>.7&&at(3.75).yawSpeed<peak*.25,`Head accelerates into the glance: peak ${peak}, start ${at(3.75).yawSpeed}`);
 assert.ok(at(4.9).yawSpeed<peak*.15,'Head slows before holding its glance');
 assert.ok(at(7.35).speed<.08,'Final stop is gentle');
 assert.ok(at(5.6).hand<at(5).hand-.05,'Arms start descending while still looking around');
 assert.ok(at(6.5).hand<.8&&at(6.5).speed>.1,'Hands reach the sides before the head finishes');
 assert.ok(Math.max(...samples.filter(s=>s.time>6.5&&s.time<7.3).map(s=>s.z))-Math.min(...samples.filter(s=>s.time>6.5&&s.time<7.3).map(s=>s.z))>.01,'Lowered hands swing subtly front/back');
 const pitches=[at(4.8),at(6.1)].map(s=>new T.Euler().setFromQuaternion(s.q).x);
 assert.ok(Math.abs(pitches[0]-pitches[1])>.025,'Glances vary up/down');
 motion.dispose();
});
test('repeated catches during real clip interruptions stay finite, bounded and recover during speech',async()=>{
 const r=await rig(),clips=Object.fromEntries(await Promise.all(['wave','bow'].map(async id=>[id,T.AnimationClip.parse(JSON.parse(await readFile(new URL(`../assets/animations/${id}.json`,import.meta.url),'utf8')))])));
 const motion=createMixamoMotion(r.scene,clips),head=r.bone('DEF-spine.006');let previous=head.quaternion.clone();
 for(let i=0;i<1000;i++){
  if([15,40,70,320,350].includes(i))motion.catchAt(new T.Vector3(i%2?.28:-.28,i%2?1.52:1.08,.42));
  motion.tick(i/60,1/60,i<100?'idle':i<650?'speaking':'listening',.65);
  assert.ok(head.quaternion.angleTo(previous)<.10,`Neck snapped at frame ${i}`);previous.copy(head.quaternion);
  r.scene.traverse(b=>{if(b.isBone)assert.ok(b.quaternion.toArray().every(Number.isFinite));});
  if(i>95)assert.ok(clearance(r)>.035,`Retargeting pinched an elbow at frame ${i}`);
 }
 assert.equal(motion.debug().action,'idle');motion.dispose();
});
