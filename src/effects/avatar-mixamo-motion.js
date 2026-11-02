import * as THREE from 'three';
import { createBowHeadHold } from './avatar-bow-head-hold.js';
import { createAvatarMotion } from './avatar-motion.js';
const recoveryDuration=1.1,holdDuration=.18;
const ids=['wave','bow','yawn','shrug','scratch'];
const isProcedural=id=>id==='yawn'||id==='scratch'||id==='shrug';
export async function loadAvatarClips(){
  return Object.fromEntries(await Promise.all(ids.filter(id=>!isProcedural(id)).map(async id=>{
    const response=await fetch(`./assets/animations/${id}.json?v=2`);
    if(!response.ok)throw new Error(`Avatar animation ${id}: ${response.status}`);
    return [id,THREE.AnimationClip.parse(await response.json())];
  })));
}
// Sample preconverted clips over the existing speech, gaze and catch controller.
// Buffers and interpolants are allocated once, not in the render loop.
export function createMixamoMotion(root,clips){
  const base=createAvatarMotion(root,{externalIdle:true});
  const headHold=createBowHeadHold(root);
  const rest=new Map(),rotation=new THREE.Quaternion(),position=new THREE.Vector3();
  const motions=Object.fromEntries(ids.filter(id=>!isProcedural(id)).map(id=>[id,{duration:clips[id].duration*(id==='wave'?6:1),cycle:clips[id].duration,tracks:clips[id].tracks.map(track=>{
    const {nodeName,propertyName}=THREE.PropertyBinding.parseTrackName(track.name);
    const bone=root.getObjectByName(nodeName);if(!bone)throw new Error(`Missing animation bone ${nodeName}`);
    if(!rest.has(bone))rest.set(bone,{q:bone.quaternion.clone(),p:bone.position.clone()});
    return {bone,property:propertyName,sample:track.createInterpolant()};
  })}]));
  const find=n=>root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
  root.updateMatrixWorld(true);
  const wavingHand=find('DEF-hand.R');
  const handRest=wavingHand.getWorldQuaternion(new THREE.Quaternion());
  const thumbDirection=find('DEF-f_index.01.R').getWorldPosition(new THREE.Vector3()).sub(find('DEF-f_pinky.01.R').getWorldPosition(new THREE.Vector3())).normalize().applyQuaternion(handRest.clone().invert());
  // Open the thumb halfway between the fingers and the palm's lateral edge (45 degrees).
  const fingerDirection=new THREE.Vector3(0,1,0).applyQuaternion(find('DEF-f_index.01.R').getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(handRest.clone().invert()).normalize();
  thumbDirection.addScaledVector(fingerDirection,-thumbDirection.dot(fingerDirection)).normalize().add(fingerDirection).normalize();
  const thumbs=['01','02','03'].map(part=>{const bone=find(`DEF-thumb.${part}.R`);if(!rest.has(bone))rest.set(bone,{q:bone.quaternion.clone(),p:bone.position.clone()});return {bone,reference:bone.getWorldQuaternion(new THREE.Quaternion())};});
  const thumbQ=new THREE.Quaternion(),thumbParent=new THREE.Quaternion(),thumbBefore=new THREE.Quaternion(),handDelta=new THREE.Quaternion();
  const thumbAxis=new THREE.Vector3(),thumbWorldDirection=new THREE.Vector3();
  function spreadThumb(weight){
    wavingHand.updateWorldMatrix(true,false);
    wavingHand.getWorldQuaternion(handDelta);
    thumbWorldDirection.copy(thumbDirection).applyQuaternion(handDelta);
    handDelta.multiply(handRest.clone().invert());
    for(const {bone,reference} of thumbs){
      thumbBefore.copy(bone.quaternion);
      thumbQ.copy(handDelta).multiply(reference);
      thumbAxis.set(0,1,0).applyQuaternion(thumbQ);
      thumbQ.premultiply(new THREE.Quaternion().setFromUnitVectors(thumbAxis,thumbWorldDirection));
      thumbParent.copy(bone.parent.getWorldQuaternion(thumbParent)).invert();thumbQ.premultiply(thumbParent);
      bone.quaternion.copy(thumbBefore).slerp(thumbQ,weight);bone.updateWorldMatrix(false,true);
    }
  }
  let current='wave',elapsed=0,cooldown=4,index=1,interruption=null,previousMode='idle';
  const ease=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
  function play(id){base.cancelIdle();current=id;elapsed=0;interruption=null;if(id==='yawn')base.yawn();if(id==='scratch')base.scratch();if(id==='shrug')base.shrug();}
  function interrupt(){if(current && interruption===null)interruption=0;}
  return {
    greet(){play('bow');},
    catchAt(point){interrupt();base.catchAt(point);},
    setLookTarget(point){base.setLookTarget(point);},
    tick(time,dt,mode,level){
      for(const [bone,r] of rest){bone.quaternion.copy(r.q);bone.position.copy(r.p);}
      base.setExternalGesture(current!==null);
      base.tick(time,dt,mode,level);
      if(mode!=='idle'){interrupt();cooldown=4;}
      if(previousMode!=='idle' && mode==='idle')cooldown=4;
      previousMode=mode;
      if(!current && mode==='idle' && base.debug().action!=='catch'){
        cooldown-=dt;if(cooldown<=0){play(ids[index]);index=(index+1)%ids.length;}
      }
      if(!current)return;
      if(isProcedural(current)){
        elapsed+=dt;
        if(base.debug().action!==current && elapsed>dt){current=null;cooldown=4;}
        return;
      }
      const motion=motions[current];elapsed+=dt;
      if(interruption!==null)interruption+=dt;
      const weight=ease(elapsed/.5)*(1-ease((elapsed-motion.duration-holdDuration)/recoveryDuration))*(interruption===null?1:1-ease(interruption/.3));
      for(const track of motion.tracks){
        // Keep torso and head in the forward-facing base pose while the arm waves.
        if(current==='wave' && /^DEF-spine/.test(track.bone.name))continue;
        const value=track.sample.evaluate(current==='wave'?Math.min(elapsed,motion.duration)%motion.cycle:Math.min(elapsed,motion.duration));
        if(track.property==='quaternion')track.bone.quaternion.slerp(rotation.fromArray(value).normalize(),weight);
        else if(track.property==='position')track.bone.position.lerp(position.fromArray(value),weight);
      }
      if(current==='wave')spreadThumb(weight);
      if(current==='bow'){
        headHold.pose(weight);
      }
      if(elapsed>=motion.duration+holdDuration+recoveryDuration || interruption>=.3){current=null;cooldown=4;}
    },
    debug(){return {...base.debug(),action:current||base.debug().action,mixamo:true,clipTime:elapsed};},
    dispose(){base.dispose();for(const [bone,r] of rest){bone.quaternion.copy(r.q);bone.position.copy(r.p);}}
  };
}
