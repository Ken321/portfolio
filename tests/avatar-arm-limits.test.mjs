import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {ARM_LIMITS,limitArmReach,createRotationLimiter} from '../src/effects/avatar-arm-limits.js';
import {createAvatarMotion} from '../src/effects/avatar-motion.js';
const degrees=T.MathUtils.radToDeg;
function angles(q){
 const d=q.clone();if(d.w<0)d.set(-d.x,-d.y,-d.z,-d.w);
 const twist=new T.Quaternion(0,d.y,0,d.w);if(twist.lengthSq()<1e-12)twist.identity();else twist.normalize();
 return {swing:degrees(new T.Quaternion().angleTo(d.clone().multiply(twist.clone().invert()))),twist:degrees(Math.abs(2*Math.atan2(twist.y,twist.w)))};
}
test('reach limits keep a bent elbow for far, near and coincident goals',()=>{
 const shoulder=new T.Vector3(.1,1.3,.05),a=.24,b=.27;
 for(const goal of [shoulder.clone(),new T.Vector3(100,-100,100),shoulder.clone().addScalar(.001),new T.Vector3(.2,1.2,.3)]){
  const distance=limitArmReach(goal,shoulder,a,b);
  const bend=degrees(Math.acos(T.MathUtils.clamp((distance**2-a*a-b*b)/(2*a*b),-1,1)));
  assert.ok(bend>=ARM_LIMITS.elbowMin-1e-6 && bend<=ARM_LIMITS.elbowMax+1e-6);
  assert.ok(goal.toArray().every(Number.isFinite));
 }
});
test('swing/twist limits handle quaternion sign, wraparound and 180 degree poses',()=>{
 const rest=new T.Quaternion().setFromEuler(new T.Euler(.3,.1,-.7)),limit=createRotationLimiter(rest,60,35);
 for(const x of [-180,-90,0,90,180])for(const y of [-179,-90,0,90,179]){
  const input=rest.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),T.MathUtils.degToRad(x))).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),T.MathUtils.degToRad(y)));
  const negative=new T.Quaternion(-input.x,-input.y,-input.z,-input.w);limit(input);limit(negative);
  assert.ok(input.angleTo(negative)<1e-6);
  const result=angles(rest.clone().invert().multiply(input));assert.ok(result.swing<=60.00001 && result.twist<=35.00001);
  const again=input.clone();limit(again);assert.ok(again.angleTo(input)<1e-6,'Limiting is idempotent');
 }
});
test('actual avatar keeps wrist and elbow bounds at extreme click targets',async()=>{
 const bytes=await readFile(new URL('../avatar.glb',import.meta.url));
 for(const x of [-10,10])for(const y of [-10,10]){
  const {scene}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const motion=createAvatarMotion(scene),bone=n=>scene.getObjectByName(T.PropertyBinding.sanitizeNodeName(n));
  const rest=['L','R'].map(s=>bone(`DEF-hand.${s}`).quaternion.clone());
  motion.catchAt(new T.Vector3(x,y,.42));
  for(let i=0;i<350;i++){
   motion.tick(i/60,1/60,'listening',0);
   if(i!==65 && i!==190)continue;
   scene.updateMatrixWorld(true);
   for(const [j,s] of ['L','R'].entries()){
    const a=bone(`DEF-upper_arm.${s}`).getWorldPosition(new T.Vector3()),b=bone(`DEF-forearm.${s}`).getWorldPosition(new T.Vector3()),c=bone(`DEF-hand.${s}`).getWorldPosition(new T.Vector3());
    const bend=degrees(b.clone().sub(a).angleTo(c.clone().sub(b)));
    assert.ok(bend>=4.5 && bend<=145.5,`Elbow bend ${bend}`);
    const wrist=angles(rest[j].clone().invert().multiply(bone(`DEF-hand.${s}`).quaternion));
    assert.ok(wrist.swing<60.1 && wrist.twist<35.1,JSON.stringify(wrist));
   }
  }
  motion.dispose();
 }
});
