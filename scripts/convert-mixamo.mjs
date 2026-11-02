import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
const [sourcePath,outputPath,clipName]=process.argv.slice(2);
if(!sourcePath||!outputPath||!clipName)throw Error('Usage: convert-mixamo.mjs source.fbx output.json clipName');
const targetPath='assets/avatar-pants-fixed.glb';
const read=p=>{const b=fs.readFileSync(p);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const manager=new T.LoadingManager();manager.addHandler(/.*/,{load(){return new T.Texture();}});
globalThis.window={URL:globalThis.URL};
const source=new FBXLoader(manager).parse(read(sourcePath),'');
const target=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(read(targetPath),'')).scene;
const bone=(root,n)=>root.getObjectByName(T.PropertyBinding.sanitizeNodeName(n));
const pairs=[['DEF-spine','Hips','DEF-spine.001','Spine'],['DEF-spine.001','Spine','DEF-spine.002','Spine1'],['DEF-spine.002','Spine1','DEF-spine.003','Spine2'],['DEF-spine.003','Spine2','DEF-spine.004','Neck'],['DEF-spine.004','Neck','DEF-spine.006','Head'],['DEF-spine.006','Head']];
for(const [side,label] of [['L','Left'],['R','Right']]){
 for(const [a,b,c,d] of [['shoulder','Shoulder','upper_arm','Arm'],['upper_arm','Arm','forearm','ForeArm'],['forearm','ForeArm','hand','Hand'],['hand','Hand','f_middle.01','HandMiddle1'],['thigh','UpLeg','shin','Leg'],['shin','Leg','foot','Foot']])pairs.push([`DEF-${a}.${side}`,label+b,`DEF-${c}.${side}`,label+d]);
 pairs.push([`DEF-foot.${side}`,label+'Foot']);
 for(const [a,b] of [['thumb','Thumb'],['f_index','Index'],['f_middle','Middle'],['f_ring','Ring'],['f_pinky','Pinky']])for(let n=1;n<=3;n++)pairs.push([`DEF-${a}.0${n}.${side}`,`${label}Hand${b}${n}`,...(n<3?[`DEF-${a}.0${n+1}.${side}`,`${label}Hand${b}${n+1}`]:[])]);
}
source.updateMatrixWorld(true);target.updateMatrixWorld(true);
const pos=b=>b.getWorldPosition(new T.Vector3()),quat=b=>b.getWorldQuaternion(new T.Quaternion());
const mappings=pairs.map(([t,s,tc,sc])=>({t:bone(target,t),s:bone(source,'mixamorig'+s),tc:tc&&bone(target,tc),sc:sc&&bone(source,'mixamorig'+sc)}));
for(const m of mappings)if(!m.t||!m.s)throw Error('Missing mapped bone');
// Traverse target parents first, including its intermediate deform/twist bones.
const order=[];target.traverse(b=>{const m=mappings.find(m=>m.t===b);if(m)order.push(m);});
for(const m of order){
 m.sourceRestInverse=quat(m.s).invert();
 if(m.tc&&m.sc){
  const from=pos(m.tc).sub(pos(m.t)).normalize(),to=pos(m.sc).sub(pos(m.s)).normalize();
  const world=new T.Quaternion().setFromUnitVectors(from,to).multiply(quat(m.t));
  m.t.quaternion.copy(quat(m.t.parent).invert().multiply(world));target.updateMatrixWorld(true);
 }
}
for(const m of order)m.targetReference=quat(m.t);
const hips=mappings[0],sourceHip=pos(hips.s),targetHip=pos(hips.t);
const ratio=(targetHip.y-pos(bone(target,'DEF-foot.R')).y)/(sourceHip.y-pos(bone(source,'mixamorigRightFoot')).y);
const clip=source.animations.find(c=>c.duration>0);if(!clip)throw Error('No source animation');
const mixer=new T.AnimationMixer(source);const action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
const armSpaceRadians=T.MathUtils.degToRad(15);
const armSpaceAxis=new T.Vector3(0,0,1),armDelta=new T.Quaternion();
const sourceArms=[['Left',1],['Right',-1]].map(([side,sign])=>({upper:bone(source,'mixamorig'+side+'Arm'),lower:bone(source,'mixamorig'+side+'ForeArm'),sign}));
const fps=30,frames=Math.ceil(clip.duration*fps)+1,times=[],values=order.map(()=>[]),positions=[];
for(let i=0;i<frames;i++){
 const time=Math.min(i/fps,clip.duration);times.push(time);mixer.setTime(time);source.updateMatrixWorld(true);
 // Widen lowered arms in source world space; descendants inherit the correction.
 // Raised hands retain their intended wave/face targets.
 for(const {upper,lower,sign} of sourceArms){
  const down=Math.max(0,-pos(lower).sub(pos(upper)).normalize().y);
  const world=quat(upper).premultiply(armDelta.setFromAxisAngle(armSpaceAxis,sign*armSpaceRadians*down));
  upper.quaternion.copy(quat(upper.parent).invert().multiply(world));source.updateMatrixWorld(true);
 }
 const worldHip=pos(hips.s).sub(sourceHip).multiplyScalar(ratio).add(targetHip);
 hips.t.position.copy(hips.t.parent.worldToLocal(worldHip));
 for(let j=0;j<order.length;j++){
  const m=order[j],world=quat(m.s).multiply(m.sourceRestInverse).multiply(m.targetReference);
  m.t.quaternion.copy(quat(m.t.parent).invert().multiply(world)).normalize();m.t.updateWorldMatrix(false,true);
  const q=m.t.quaternion;if(!q.toArray().every(Number.isFinite))throw Error('Non-finite rotation');values[j].push(...q.toArray());
 }
 positions.push(...hips.t.position.toArray());
}
const tracks=order.map((m,i)=>new T.QuaternionKeyframeTrack(m.t.name+'.quaternion',times,values[i]));
tracks.push(new T.VectorKeyframeTrack(hips.t.name+'.position',times,positions));
const result=new T.AnimationClip(clipName,clip.duration,tracks).optimize();
if(!result.validate())throw Error('Invalid output clip');
fs.writeFileSync(outputPath,JSON.stringify(T.AnimationClip.toJSON(result),(_,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v));
const report={source:'https://www.mixamo.com/',clipName,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),avatarSha256:crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex'),armSpaceDegrees:15,clampWhenFinished:true,duration:result.duration,fps,frames,bones:order.length,tracks:tracks.length,hipScale:ratio,bytes:fs.statSync(outputPath).size,mapping:order.map(m=>({source:m.s.name,target:m.t.name}))};
fs.writeFileSync(outputPath.replace('.json','.report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,mapping:undefined}));
