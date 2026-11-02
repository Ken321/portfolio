import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createMixamoMotion} from '../src/effects/avatar-mixamo-motion.js';
test('mixed idle gestures play and yield to speech without corrupting the skin',async()=>{
 const bytes=fs.readFileSync(new URL('../assets/avatar-pants-fixed.glb',import.meta.url));
 const {scene:root}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const clips=Object.fromEntries(['wave','bow','yawn','bored'].map(id=>[id,T.AnimationClip.parse(JSON.parse(fs.readFileSync(new URL(`../assets/animations/${id}.json`,import.meta.url))))]));
 for(const clip of Object.values(clips)){assert.ok(clip.validate());for(const t of clip.tracks)assert.ok(root.getObjectByName(T.PropertyBinding.parseTrackName(t.name).nodeName));}
 delete clips.yawn; // The restored procedural yawn must not need a Mixamo clip.
 const motion=createMixamoMotion(root,clips),seen=new Set();let yawnFrames=0;
 for(let frame=0;frame<45*60;frame++){
  motion.tick(frame/60,1/60,'idle',0);seen.add(motion.debug().action);if(motion.debug().action==='yawn')yawnFrames++;
  if(frame%15===0){root.updateMatrixWorld(true);root.traverse(m=>{if(!m.isSkinnedMesh)return;m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i+=47){const p=m.getVertexPosition(i,new T.Vector3());assert.ok(p.toArray().every(Number.isFinite));assert.ok(p.length()<4);}});}
 }
 assert.ok(yawnFrames>=250 && yawnFrames<=254,'Use the original 4.2-second yawn');
 for(const id of ['wave','bow','yawn','shrug'])assert.ok(seen.has(id),`played ${id}`);
 motion.greet();motion.tick(46,1/60,'idle',0);assert.equal(motion.debug().action,'bow');
 for(let i=0;i<60;i++)motion.tick(46+i/60,1/60,'speaking',.7);
 assert.equal(motion.debug().action,'idle');assert.ok(motion.debug().gesture>.6);
 motion.dispose();
});

test('wave has no rest-pose spike at its endpoint or repeated loop seam',()=>{
 const clip=T.AnimationClip.parse(JSON.parse(fs.readFileSync(new URL('../assets/animations/wave.json',import.meta.url))));
 for(const t of clip.tracks.filter(t=>t.name.endsWith('.quaternion'))){
  const first=new T.Quaternion().fromArray(t.values).normalize();
  const last=new T.Quaternion().fromArray(t.values,t.values.length-4).normalize();
  const before=new T.Quaternion().fromArray(t.values,t.values.length-8).normalize();
  assert.ok(last.angleTo(first)<T.MathUtils.degToRad(2),`loop seam: ${t.name}`);
  assert.ok(last.angleTo(before)<T.MathUtils.degToRad(20),`endpoint: ${t.name}`);
 }
});

test('gesture recovery continues beyond the clip and returns smoothly to idle',async()=>{
 const bytes=fs.readFileSync(new URL('../assets/avatar-pants-fixed.glb',import.meta.url));
 const {scene:root}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const clips=Object.fromEntries(['wave','bow','yawn','bored'].map(id=>[id,T.AnimationClip.parse(JSON.parse(fs.readFileSync(new URL(`../assets/animations/${id}.json`,import.meta.url))))]));
 const motion=createMixamoMotion(root,clips),arm=root.getObjectByName('DEF-upper_armR');let previous=null,maxRecoveryStep=0;
 for(let frame=0;frame<4.6*60;frame++){
  motion.tick(frame/60,1/60,'idle',0);
  if(frame/60>3.5 && frame/60<3.8)assert.equal(motion.debug().action,'wave');
  if(previous && frame/60>3.2)maxRecoveryStep=Math.max(maxRecoveryStep,previous.angleTo(arm.quaternion));
  previous=arm.quaternion.clone();
 }
 assert.equal(motion.debug().action,'idle');
 assert.ok(maxRecoveryStep<T.MathUtils.degToRad(5),`recovery step ${T.MathUtils.radToDeg(maxRecoveryStep)}`);
 motion.dispose();
});

test('bow keeps the right hand at the back of the head and releases it afterwards',async()=>{
 const bytes=fs.readFileSync(new URL('../assets/avatar-pants-fixed.glb',import.meta.url));
 const {scene:root}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const clips=Object.fromEntries(['wave','bow','bored'].map(id=>[id,T.AnimationClip.parse(JSON.parse(fs.readFileSync(new URL(`../assets/animations/${id}.json`,import.meta.url))))]));
 const motion=createMixamoMotion(root,clips),find=n=>root.getObjectByName(T.PropertyBinding.sanitizeNodeName(n));
 const head=find('DEF-spine.006'),hand=find('DEF-hand.R'),left=find('DEF-hand.L');root.updateMatrixWorld(true);
 const clavicle=find('DEF-shoulder.R'),socket=find('DEF-upper_arm.R');
 const clavicleRest=clavicle.quaternion.clone(),parentRest=clavicle.parent.matrixWorld.clone(),socketStart=socket.getWorldPosition(new T.Vector3());
 const anchor=head.worldToLocal(new T.Vector3(-.14,1.55,-.17));motion.greet();
 for(let i=0;i<260;i++){
  motion.tick(i/60,1/60,'idle',0);root.updateMatrixWorld(true);
  if(i===45||i===75||i===115){
   const point=hand.getWorldPosition(new T.Vector3());
   assert.ok(clavicle.quaternion.angleTo(clavicleRest)>.08,'Clavicle must participate in the raised arm');
   const socketInRestBody=socket.getWorldPosition(new T.Vector3()).applyMatrix4(clavicle.parent.matrixWorld.clone().invert()).applyMatrix4(parentRest);
   assert.ok(socketInRestBody.y>socketStart.y+.003,'Shoulder socket must rise with the clavicle');
   assert.ok(point.distanceTo(anchor.clone().applyMatrix4(head.matrixWorld))<.025,'Hand should follow the bowed head');
   assert.ok(left.getWorldPosition(new T.Vector3()).y<point.y-.15,'Only one hand should be raised');
   root.traverse(m=>{for(const name of ['Blink.L','Blink.R']){const index=m.morphTargetDictionary?.[name];if(index!==undefined)assert.ok(m.morphTargetInfluences[index]<.01,'Keep the eyes open during this shallow bow');}});
  }
 }
 assert.equal(motion.debug().action,'idle');assert.ok(hand.getWorldPosition(new T.Vector3()).y<1.1);motion.dispose();
});

test('wave faces forward and opens the thumb at 45 degrees',async()=>{
 const bytes=fs.readFileSync(new URL('../assets/avatar-pants-fixed.glb',import.meta.url));
 const {scene:root}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const clips=Object.fromEntries(['wave','bow','bored'].map(id=>[id,T.AnimationClip.parse(JSON.parse(fs.readFileSync(new URL(`../assets/animations/${id}.json`,import.meta.url))))]));
 const find=n=>root.getObjectByName(T.PropertyBinding.sanitizeNodeName(n));root.updateMatrixWorld(true);
 const body=['DEF-spine','DEF-spine.003','DEF-spine.006'].map(find),rest=body.map(b=>b.getWorldQuaternion(new T.Quaternion()));
 const hand=find('DEF-hand.R'),handInverse=hand.getWorldQuaternion(new T.Quaternion()).invert();
 const lateral=find('DEF-f_index.01.R').getWorldPosition(new T.Vector3()).sub(find('DEF-f_pinky.01.R').getWorldPosition(new T.Vector3())).normalize().applyQuaternion(handInverse);
 const forward=new T.Vector3(0,1,0).applyQuaternion(find('DEF-f_index.01.R').getWorldQuaternion(new T.Quaternion())).applyQuaternion(handInverse).normalize();
 lateral.addScaledVector(forward,-lateral.dot(forward)).normalize();
 const thumbs=['01','02','03'].map(p=>find(`DEF-thumb.${p}.R`)),thumbRest=thumbs.map(b=>b.quaternion.clone());
 const motion=createMixamoMotion(root,clips);
 for(let i=0;i<180;i++){
  motion.tick(i/60,1/60,'idle',0);if(i<40)continue;root.updateMatrixWorld(true);
  body.forEach((b,j)=>assert.ok(b.getWorldQuaternion(new T.Quaternion()).angleTo(rest[j])<.025,'Torso and face stay frontal'));
  const side=lateral.clone().applyQuaternion(hand.getWorldQuaternion(new T.Quaternion()));
  const fingers=forward.clone().applyQuaternion(hand.getWorldQuaternion(new T.Quaternion()));
  thumbs.forEach(b=>{const direction=new T.Vector3(0,1,0).applyQuaternion(b.getWorldQuaternion(new T.Quaternion()));assert.ok(Math.abs(direction.angleTo(fingers)-Math.PI/4)<.02,'Thumb opens 45 degrees from fingers');assert.ok(direction.dot(side)>.68,'Thumb opens towards the outer edge');});
 }
 motion.dispose();thumbs.forEach((b,j)=>assert.deepEqual(b.quaternion.toArray(),thumbRest[j].toArray()));
});

test('all five gestures are separated by four seconds of quiet idle',async()=>{
 const bytes=fs.readFileSync(new URL('../assets/avatar-pants-fixed.glb',import.meta.url));
 const {scene:root}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const clips=Object.fromEntries(['wave','bow','bored'].map(id=>[id,T.AnimationClip.parse(JSON.parse(fs.readFileSync(new URL(`../assets/animations/${id}.json`,import.meta.url))))]));
 const motion=createMixamoMotion(root,clips);let previous='wave',idleStart=null;const seen=['wave'];
 for(let i=0;i<60*60;i++){
  motion.tick(i/60,1/60,'idle',0);const action=motion.debug().action;
  if(action==='idle' && previous!=='idle')idleStart=i;
  if(action!=='idle' && previous==='idle'){
   assert.ok(i-idleStart>=239 && i-idleStart<=242,`Quiet interval: ${(i-idleStart)/60}`);seen.push(action);
  }
  previous=action;
 }
 assert.deepEqual(seen.slice(0,6),['wave','bow','yawn','shrug','scratch','wave']);motion.dispose();
});
