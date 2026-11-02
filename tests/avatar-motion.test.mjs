import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAvatarMotion } from '../src/effects/avatar-motion.js';
async function loadRig(){const b=await readFile(new URL('../avatar.glb',import.meta.url));return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
test('new GLB: wave raises hand, bow returns upright, speech drives head and mouth without moving feet',async()=>{
 const gltf=await loadRig();const motion=createAvatarMotion(gltf.scene);
 const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
 const pos=n=>{gltf.scene.updateMatrixWorld(true);return bone(n).getWorldPosition(new THREE.Vector3());};
 const feet=pos('DEF-foot.R');
 for(let i=0;i<70;i++)motion.tick(i/60,1/60,'idle',0);
 assert.ok(pos('DEF-hand.R').y>pos('DEF-shoulder.R').y);
 for(let i=0;i<180;i++)motion.tick(i/60,1/60,'idle',0);
 const upright=pos('DEF-spine.006');motion.greet();
 for(let i=0;i<90;i++)motion.tick(i/60,1/60,'idle',0);
 assert.ok(pos('DEF-spine.006').y<upright.y-.03);
 for(let i=0;i<150;i++)motion.tick(i/60,1/60,'idle',0);
 assert.ok(pos('DEF-spine.006').distanceTo(upright)<.02);
 for(let i=0;i<90;i++)motion.tick(i/60,1/60,'speaking',.8);
 let mouths=0;gltf.scene.traverse(m=>{if(m.morphTargetDictionary?.['Vowel.A']!==undefined){mouths++;assert.ok(m.morphTargetInfluences[m.morphTargetDictionary['Vowel.A']]>.4);}});assert.equal(mouths,5); // Four material primitives on the face plus mouth interior.
 assert.ok(pos('DEF-foot.R').distanceTo(feet)<.0001);
 for(let i=0;i<180;i++)motion.tick(i/60,1/60,'listening',0);
 gltf.scene.traverse(m=>{if(m.morphTargetDictionary?.['Vowel.A']!==undefined)assert.ok(m.morphTargetInfluences[m.morphTargetDictionary['Vowel.A']]<.001);});
 motion.dispose();
});


test('wave presents the palm toward the viewer, with fingers up and lateral sway',async()=>{
 const gltf=await loadRig();const motion=createAvatarMotion(gltf.scene);
 const position=name=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)).getWorldPosition(new THREE.Vector3());
 const tips=[],wrists=[],elbows=[];
 for(let i=0;i<220;i++){
  motion.tick(i/60,1/60,'idle',0);gltf.scene.updateMatrixWorld(true);
  if(i<90)continue;
  const wrist=position('DEF-hand.R');
  const index=position('DEF-f_index.01.R').sub(wrist);
  const pinky=position('DEF-f_pinky.01.R').sub(wrist);
  const finger=position('DEF-f_middle.01.R').sub(wrist).normalize();
  const palm=index.clone().cross(pinky).normalize();
  const thumb=position('DEF-thumb.03.R');
  assert.ok(thumb.x>position('DEF-f_pinky.01.R').x,'Thumb must be on the face side');
  const elbow=position('DEF-forearm.R');
  const forearm=wrist.clone().sub(elbow).normalize();
  assert.ok(finger.dot(forearm)>.99,'Hand must follow forearm without a wrist kink');
  wrists.push(wrist.x);elbows.push(elbow.x);
  assert.ok(palm.z>.95,`Palm should face +Z, got ${palm.toArray()}`);
  assert.ok(finger.y>.9,'Fingers should point upward');tips.push(finger.x);
 }
 assert.ok(Math.max(...wrists)-Math.min(...wrists)>.09,'Gentle wave must still move the wrist from the elbow');
 assert.ok(Math.max(...elbows)-Math.min(...elbows)<.025,'Elbow should move subtly while the forearm waves');
 assert.ok(Math.min(...tips)<-.15 && Math.max(...tips)>.15,'Wave should sway sideways');
 motion.dispose();
});


test('eyes track both sides smoothly, stay bounded, and return to neutral alongside speech and blinks',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const eyes=['L','R'].map(side=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`DEF-eyeball.${side}`)));
 const rest=eyes.map(b=>b.quaternion.clone().normalize());
 let white;gltf.scene.traverse(m=>{if(m.material?.name==='Eye 3')white=m;});
 const head=gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('DEF-spine.006'));
 const whitePositions=()=>{
  gltf.scene.updateMatrixWorld(true);white.skeleton.update();
  const inverse=head.matrixWorld.clone().invert();
  const positions=white.geometry.getAttribute('position');
  return Array.from({length:positions.count},(_,i)=>white.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(positions,i)).applyMatrix4(white.matrixWorld).applyMatrix4(inverse));
 };
 const fixedWhite=whitePositions();
 const forward=b=>new THREE.Vector3(0,1,0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()));
 for(const side of [-1,1]){
  motion.setLookTarget(new THREE.Vector3(side*10,1.484,1));
  motion.tick(0,1/60,'speaking',.5);
  for(let i=0;i<90;i++)motion.tick(i/60,1/60,'speaking',.5);
  gltf.scene.updateMatrixWorld(true);
  for(const [i,b]of eyes.entries()){
   assert.ok(forward(b).x*side>.15,'Eyes should follow the target in world space');
   assert.ok(b.quaternion.angleTo(rest[i])<.29,'Eye rotation must remain bounded');
  }
 }
 whitePositions().forEach((v,i)=>assert.ok(v.distanceTo(fixedWhite[i])<.00001,'White eye outline must not move with gaze'));
 motion.setLookTarget(null);
 const before=eyes[0].quaternion.angleTo(rest[0]);motion.tick(2,1/60,'idle',0);
 assert.ok(eyes[0].quaternion.angleTo(rest[0])>0 && eyes[0].quaternion.angleTo(rest[0])<before,'Return should be gradual');
 for(let i=0;i<120;i++)motion.tick(2+i/60,1/60,'idle',0);
 eyes.forEach((b,i)=>assert.ok(b.quaternion.angleTo(rest[i])<.0001));
 motion.dispose();
});

test('starting and repeating a wave cannot rotate either eye out of its gaze range',async()=>{
 for(const target of [null,new THREE.Vector3(.8,1.6,1)]){
  const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
  const eyes=['L','R'].map(side=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`DEF-eyeball.${side}`)));
  const rest=eyes.map(b=>b.quaternion.clone().normalize());
  motion.setLookTarget(target);
  let waveFrames=0;
  for(let i=0;i<960;i++){
   motion.tick(i/60,1/60,'idle',0);
   if(motion.debug().action==='wave')waveFrames++;
   if(motion.debug().action==='wave')eyes.forEach((eye,j)=>assert.ok(eye.quaternion.angleTo(rest[j])<(target?.29:.00001),`Eye ${j} moved unexpectedly during ${motion.debug().action} at frame ${i}`));
  }
  assert.ok(waveFrames>300,'Exercise the full initial wave');
  motion.dispose();
 }
});


test('wave and greeting interruptions settle without abrupt arm rotation',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const names=['DEF-upper_arm.R','DEF-upper_arm.R.001','DEF-forearm.R','DEF-hand.R'];
 const arm=names.map(n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n)));
 motion.tick(0,0,'idle',0);
 let previous=arm.map(b=>b.quaternion.clone());
 for(let i=1;i<=420;i++){
  if(i===160)motion.greet();
  motion.tick(i/60,1/60,i>=100&&i<150?'speaking':'idle',.6);
  arm.forEach((b,j)=>{
   assert.ok(b.quaternion.angleTo(previous[j])<.054,'Arm must not snap when speech or greeting interrupts a wave');
   previous[j].copy(b.quaternion);
  });
 }
 motion.dispose();
});


test('bow gathers hands at the waist and looks down regardless of the mouse target',async()=>{
 const poses=[];
 for(const x of [-10,10]){
  const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
  const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
  motion.setLookTarget(new THREE.Vector3(x,10,1));motion.greet();
  for(let i=0;i<100;i++)motion.tick(i/60,1/60,'idle',0);
  gltf.scene.updateMatrixWorld(true);
  const left=bone('DEF-hand.L').getWorldPosition(new THREE.Vector3()),right=bone('DEF-hand.R').getWorldPosition(new THREE.Vector3());
  assert.ok(left.distanceTo(right)<.15,'Both hands should meet at the waist');
  assert.ok(left.y<1.1 && right.y<1.1 && left.z>.15 && right.z>.15,'Hands should be in front of the lower torso');
  const eyes=['L','R'].map(side=>bone(`DEF-eyeball.${side}`));
  eyes.forEach(eye=>assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(eye.getWorldQuaternion(new THREE.Quaternion())).y<-.3,'Eyes must look down during the bow'));
  gltf.scene.traverse(mesh=>{for(const name of ['Blink.L','Blink.R']){const index=mesh.morphTargetDictionary?.[name];if(index!==undefined)assert.ok(mesh.morphTargetInfluences[index]>.999,'Close both eyes fully while bowing');}});
  poses.push(eyes.map(b=>b.quaternion.clone()));
  for(let i=100;i<250;i++)motion.tick(i/60,1/60,'idle',0);
  gltf.scene.updateMatrixWorld(true);
  eyes.forEach(eye=>assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(eye.getWorldQuaternion(new THREE.Quaternion())).x*Math.sign(x)>.15,'Mouse tracking should resume after standing up'));
  assert.ok(bone('DEF-hand.L').getWorldPosition(new THREE.Vector3()).distanceTo(bone('DEF-hand.R').getWorldPosition(new THREE.Vector3()))>.3,'Hands should return to the sides');
  motion.dispose();
 }
 poses[0].forEach((q,i)=>assert.ok(q.angleTo(poses[1][i])<.001,'Mouse position must not affect bow gaze'));
});

test('wave shifts weight through hips and torso while keeping both feet planted',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
 gltf.scene.updateMatrixWorld(true);
 const feet=['L','R'].map(side=>bone(`DEF-foot.${side}`));
 const anchors=feet.map(b=>b.getWorldPosition(new THREE.Vector3()));
 const orientations=feet.map(b=>b.getWorldQuaternion(new THREE.Quaternion()).normalize());
 const hips=bone('DEF-spine'),chest=bone('DEF-spine.003'),head=bone('DEF-spine.006');
 const hipStart=hips.position.clone(),chestStart=chest.quaternion.clone().normalize(),headStart=head.quaternion.clone().normalize();
 let hipTravel=0,chestTurn=0,headMotion=0;
 for(let i=0;i<420;i++){
  motion.tick(i/60,1/60,'idle',0);gltf.scene.updateMatrixWorld(true);
  hipTravel=Math.max(hipTravel,hips.position.distanceTo(hipStart));
  chestTurn=Math.max(chestTurn,chest.quaternion.angleTo(chestStart));headMotion=Math.max(headMotion,head.quaternion.angleTo(headStart));
  feet.forEach((foot,j)=>{
   assert.ok(foot.getWorldPosition(new THREE.Vector3()).distanceTo(anchors[j])<.0001,'Feet must not slide during weight transfer');
   assert.ok(foot.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(orientations[j])<.001,'Soles must stay level');
  });
 }
 assert.ok(hipTravel>.015 && hipTravel<.035,'Weight transfer should be visible but small');
 assert.ok(chestTurn>.035 && headMotion>.03,'Torso and head must participate');
 assert.ok(hips.position.distanceTo(hipStart)<.0001,'Weight should settle after the wave');
 motion.dispose();
});

test('downward gaze recesses both irises gently and restores their positions on neutral and disposal',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const eyes=['L','R'].map(side=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`DEF-eyeball.${side}`)));
 const rest=eyes.map(b=>({position:b.position.clone(),rotation:b.quaternion.clone()}));
 for(const x of [0,-10,10]){
  motion.setLookTarget(new THREE.Vector3(x,-5,1));
  for(let i=0;i<120;i++){
   const before=eyes.map(b=>b.position.clone());motion.tick(i/60,1/60,'listening',0);
   eyes.forEach((b,j)=>assert.ok(b.position.distanceTo(before[j])<.0006,'Eye depth must change smoothly'));
  }
  eyes.forEach((b,j)=>{
   const delta=rest[j].rotation.clone().invert().multiply(b.quaternion);
   const forward=new THREE.Vector3(0,1,0).applyQuaternion(delta);
   assert.ok(forward.z<-.16 && forward.z>-.181,'Downward rotation remains within the eyelid-safe range');
   const inset=b.position.clone().sub(rest[j].position).applyQuaternion(rest[j].rotation.clone().invert());
   assert.ok(inset.y<-.00099 && inset.y>=-.00101,'Iris is recessed only slightly');
   assert.ok(Math.abs(inset.x)<1e-8 && inset.z<-.00249 && inset.z>=-.00251);
  });
 }
 motion.setLookTarget(null);for(let i=0;i<120;i++)motion.tick(i/60,1/60,'listening',0);
 eyes.forEach((b,j)=>assert.ok(b.position.distanceTo(rest[j].position)<1e-8));
 motion.greet();for(let i=0;i<90;i++)motion.tick(i/60,1/60,'listening',0);
 eyes.forEach((b,j)=>assert.ok(b.position.distanceTo(rest[j].position)>.0019));
 motion.dispose();eyes.forEach((b,j)=>assert.ok(b.position.equals(rest[j].position)));
});


test('bow keeps both wrists straight while gathering, holding and releasing the hands',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
 for(let i=0;i<120;i++)motion.tick(i/60,1/60,'listening',0);
 motion.greet();
 for(let i=0;i<240;i++){
  motion.tick(2+i/60,1/60,'listening',0);gltf.scene.updateMatrixWorld(true);
  for(const side of ['L','R']){
   const wrist=bone(`DEF-hand.${side}`).getWorldPosition(new THREE.Vector3());
   const forearm=wrist.clone().sub(bone(`DEF-forearm.${side}`).getWorldPosition(new THREE.Vector3())).normalize();
   const fingers=bone(`DEF-f_middle.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
   assert.ok(forearm.dot(fingers)>.985,`Wrist ${side} bends at bow frame ${i}: ${forearm.dot(fingers)}`);
  }
 }
 motion.dispose();
});

test('catch converges on clicked targets and recovers without leaving a pose behind',async()=>{
 for(const target of [new THREE.Vector3(0,1.45,.42),new THREE.Vector3(-.2,1.25,.42),new THREE.Vector3(.2,1.52,.42)]){
  const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
  const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
  const pos=n=>bone(n).getWorldPosition(new THREE.Vector3());
  for(let i=0;i<120;i++)motion.tick(i/60,1/60,'listening',0);
  gltf.scene.updateMatrixWorld(true);const hips=pos('DEF-spine'),initialHands=['L','R'].map(s=>pos(`DEF-hand.${s}`));
  motion.catchAt(target);let widest=0,nearest=Infinity,maxShift=0;
  for(let i=0;i<510;i++){
   motion.tick(2+i/60,1/60,'listening',0);gltf.scene.updateMatrixWorld(true);
   const left=pos('DEF-f_middle.01.L'),right=pos('DEF-f_middle.01.R'),gap=left.distanceTo(right);
   maxShift=Math.max(maxShift,pos('DEF-spine').distanceTo(hips));
   if(i<25)widest=Math.max(widest,gap);
   if(i>=35&&i<=44){nearest=Math.min(nearest,gap);assert.ok(left.clone().add(right).multiplyScalar(.5).distanceTo(target)<.12,'Clap must land near the requested point');}
   gltf.scene.traverse(b=>{if(b.isBone)assert.ok(b.quaternion.toArray().every(Number.isFinite));});
  }
  assert.ok(widest>.3 && nearest<.10,'Hands must approach each other from opposite sides');
  assert.ok(maxShift>.06,'The body must lunge with the hands');
  assert.equal(motion.debug().action,'idle');assert.ok(pos('DEF-spine').distanceTo(hips)<.001);
  ['L','R'].forEach((s,i)=>assert.ok(pos(`DEF-hand.${s}`).distanceTo(initialHands[i])<.005,'Recover the resting arm pose'));
  motion.dispose();
 }
});


test('idle cycles through four gestures in order and yields to voice and click',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);const actions=[];let last='idle';
 for(let i=0;i<3600;i++){
  motion.tick(i/60,1/60,'idle',0);const action=motion.debug().action;
  if(action!==last && action!=='idle')actions.push(action);last=action;
 }
 assert.deepEqual(actions.slice(0,5),['wave','bow','yawn','look','wave']);
 for(let i=0;i<600;i++){motion.tick(60+i/60,1/60,'listening',0);assert.equal(motion.debug().action,'idle');}
 motion.catchAt(new THREE.Vector3(0,1.4,.28));motion.tick(70,1/60,'idle',0);assert.equal(motion.debug().action,'catch');
 motion.dispose();
});

test('raised upper arms travel diagonally forward during waves',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const pos=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n)).getWorldPosition(new THREE.Vector3());
 for(let i=0;i<=110;i++){
  motion.tick(i/60,1/60,'idle',0);
  if(i!==110)continue;
  gltf.scene.updateMatrixWorld(true);
  for(const side of ['R']){
   const upper=pos(`DEF-forearm.${side}`).sub(pos(`DEF-upper_arm.${side}`)).normalize();
   assert.ok(upper.z>Math.abs(upper.x)*.65 && upper.z<Math.abs(upper.x)*1.55,`Upper arm ${side} should rise diagonally forward: ${upper.toArray()}`);
  }
 }
 motion.dispose();
});

test('catch extends fingers parallel and keeps the contact in front of the face',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
 const fingers=['L','R'].flatMap(side=>['index','middle','ring','pinky'].flatMap(name=>['01','02','03'].map(part=>bone(`DEF-f_${name}.${part}.${side}`))));
 const rest=fingers.map(b=>b.quaternion.clone());
 motion.catchAt(new THREE.Vector3(.14,1.45,.42));
 for(let i=0;i<43;i++)motion.tick(i/60,1/60,'idle',0);
 gltf.scene.updateMatrixWorld(true);
 for(const b of fingers){const axis=new THREE.Vector3(0,1,0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()));const side=b.name.endsWith('L')?'L':'R';const direction=bone(`DEF-hand.${side}`).getWorldPosition(new THREE.Vector3()).sub(bone(`DEF-forearm.${side}`).getWorldPosition(new THREE.Vector3())).normalize();assert.ok(axis.dot(direction)>.6,`Wrist extension must remain moderate: ${b.name}`);}
 const elbows=['L','R'].map(side=>bone(`DEF-forearm.${side}`).getWorldPosition(new THREE.Vector3()));
 assert.ok(elbows[0].distanceTo(elbows[1])>.22,'Elbows must stay separated while the palms meet');
 const wrists=['L','R'].map(side=>bone(`DEF-hand.${side}`).getWorldPosition(new THREE.Vector3()));
 wrists.forEach(p=>assert.ok(p.z>.30,'Wrists must remain in front of the face'));
 const palms=['L','R'].map(side=>bone(`DEF-f_middle.01.${side}`).getWorldPosition(new THREE.Vector3()));const normals=['L','R'].map(side=>{
  const wrist=bone(`DEF-hand.${side}`).getWorldPosition(new THREE.Vector3());
  const index=bone(`DEF-f_index.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist),pinky=bone(`DEF-f_pinky.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist);
  return (side==='R'?index.cross(pinky):pinky.cross(index)).normalize();
 });
 assert.ok(normals[0].dot(normals[1])<-.98,'Palms must face each other');
 assert.ok(palms[0].clone().sub(palms[1]).dot(normals[1])>.03,'Palms must stay on opposite sides of the contact plane');
 motion.dispose();fingers.forEach((b,i)=>assert.ok(b.quaternion.equals(rest[i])));
});


test('a click during catch recovery immediately retargets without snapping the arms',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
 const arms=['L','R'].flatMap(s=>['upper_arm','forearm','hand'].map(n=>bone(`DEF-${n}.${s}`)));
 motion.catchAt(new THREE.Vector3(-.2,1.25,.42));
 for(let i=0;i<390;i++)motion.tick(i/60,1/60,'idle',0);
 const before=arms.map(b=>b.quaternion.clone());
 const target=new THREE.Vector3(.2,1.5,.42);motion.catchAt(target);
 motion.tick(100/60,1/60,'idle',0);
 assert.equal(motion.debug().action,'catch');
 arms.forEach((b,i)=>assert.ok(b.quaternion.angleTo(before[i])<=.201,'Retargeting must respect the per-frame rotation limit'));
 for(let i=1;i<43;i++)motion.tick((100+i)/60,1/60,'idle',0);
 gltf.scene.updateMatrixWorld(true);
 const tips=['L','R'].map(s=>bone(`DEF-f_middle.03.${s}`).getWorldPosition(new THREE.Vector3()));
 assert.ok(tips[0].clone().add(tips[1]).multiplyScalar(.5).distanceTo(target)<.12,'Hands must reach the new click');
 for(let i=43;i<510;i++)motion.tick((100+i)/60,1/60,'idle',0);
 assert.equal(motion.debug().action,'idle');motion.dispose();
});

test('catch pauses, inspects upward palms, searches both sides, then settles',async()=>{
 const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
 const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
 const pos=n=>bone(n).getWorldPosition(new THREE.Vector3());
 motion.catchAt(new THREE.Vector3(0,1.45,.42));
 const heads=[];
 for(let i=0;i<490;i++){
  motion.tick(i/60,1/60,'listening',0);gltf.scene.updateMatrixWorld(true);
  if(i===65)assert.ok(pos('DEF-f_middle.01.L').distanceTo(pos('DEF-f_middle.01.R'))<.10,'Keep palms together during the pause');
  if(i===180){
   for(const side of ['L','R']){
    const wrist=pos(`DEF-hand.${side}`),index=pos(`DEF-f_index.01.${side}`).sub(wrist),pinky=pos(`DEF-f_pinky.01.${side}`).sub(wrist);
    const normal=(side==='R'?index.cross(pinky):pinky.cross(index)).normalize();
    assert.ok(normal.y>.7,'Open palms upward for inspection');
    assert.ok(wrist.y<1.25,'Bring the hands down from the catch point');
   }
  }
  if(i===275||i===345)heads.push(bone('DEF-spine.006').getWorldQuaternion(new THREE.Quaternion()));
 }
 assert.ok(heads[0].angleTo(heads[1])>.7,'Search in two distinct directions');
 assert.equal(motion.debug().action,'idle');motion.dispose();
});

test('palm inspection lowers gaze toward the hands without strong convergence',async()=>{
 for(const x of [-.2,0,.2]){
  const gltf=await loadRig(),motion=createAvatarMotion(gltf.scene);
  const bone=n=>gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
  motion.setLookTarget(new THREE.Vector3(10,4,1));
  motion.catchAt(new THREE.Vector3(x,1.45,.42));
  for(let i=0;i<200;i++)motion.tick(i/60,1/60,'listening',0);
  gltf.scene.updateMatrixWorld(true);
  const eyes=['L','R'].map(s=>bone(`DEF-eyeball.${s}`));
  const center=eyes.reduce((sum,b)=>sum.add(b.getWorldPosition(new THREE.Vector3())),new THREE.Vector3()).multiplyScalar(.5);
  const palms=['L','R'].map(s=>bone(`DEF-f_middle.01.${s}`).getWorldPosition(new THREE.Vector3()));
  const direction=palms[0].add(palms[1]).multiplyScalar(.5).sub(center).normalize();
  const gaze=eyes.map(b=>new THREE.Vector3(0,1,0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())));
  gaze.forEach(d=>assert.ok(d.angleTo(direction)<.10,'Eyes must look down toward the lowered palms, independently of the mouse'));
  assert.ok(gaze[0].angleTo(gaze[1])<.04,'Eye directions must remain nearly parallel');
  motion.dispose();
 }
});
