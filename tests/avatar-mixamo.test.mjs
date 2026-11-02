import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createMixamoMotion} from '../src/effects/avatar-mixamo-motion.js';
test('four Mixamo gestures play and yield to speech without corrupting the skin',async()=>{
 const bytes=fs.readFileSync(new URL('../assets/avatar-pants-fixed.glb',import.meta.url));
 const {scene:root}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const clips=Object.fromEntries(['wave','bow','yawn','bored'].map(id=>[id,T.AnimationClip.parse(JSON.parse(fs.readFileSync(new URL(`../assets/animations/${id}.json`,import.meta.url))))]));
 for(const clip of Object.values(clips)){assert.ok(clip.validate());for(const t of clip.tracks)assert.ok(root.getObjectByName(T.PropertyBinding.parseTrackName(t.name).nodeName));}
 const motion=createMixamoMotion(root,clips),seen=new Set();
 for(let frame=0;frame<45*60;frame++){
  motion.tick(frame/60,1/60,'idle',0);seen.add(motion.debug().action);
  if(frame%15===0){root.updateMatrixWorld(true);root.traverse(m=>{if(!m.isSkinnedMesh)return;m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i+=47){const p=m.getVertexPosition(i,new T.Vector3());assert.ok(p.toArray().every(Number.isFinite));assert.ok(p.length()<4);}});}
 }
 for(const id of Object.keys(clips))assert.ok(seen.has(id),`played ${id}`);
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
