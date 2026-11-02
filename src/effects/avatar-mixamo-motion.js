import * as THREE from 'three';
import { createAvatarMotion } from './avatar-motion.js';
const recoveryDuration=1.1,holdDuration=.18;
const ids=['wave','bow','yawn','bored'];
export async function loadAvatarClips(){
  return Object.fromEntries(await Promise.all(ids.map(async id=>{
    const response=await fetch(`./assets/animations/${id}.json?v=2`);
    if(!response.ok)throw new Error(`Avatar animation ${id}: ${response.status}`);
    return [id,THREE.AnimationClip.parse(await response.json())];
  })));
}
// Sample preconverted clips over the existing speech, gaze and catch controller.
// Buffers and interpolants are allocated once, not in the render loop.
export function createMixamoMotion(root,clips){
  const base=createAvatarMotion(root,{externalIdle:true});
  const rest=new Map(),rotation=new THREE.Quaternion(),position=new THREE.Vector3();
  const motions=Object.fromEntries(ids.map(id=>[id,{duration:clips[id].duration*(id==='wave'?6:1),cycle:clips[id].duration,tracks:clips[id].tracks.map(track=>{
    const {nodeName,propertyName}=THREE.PropertyBinding.parseTrackName(track.name);
    const bone=root.getObjectByName(nodeName);if(!bone)throw new Error(`Missing animation bone ${nodeName}`);
    if(!rest.has(bone))rest.set(bone,{q:bone.quaternion.clone(),p:bone.position.clone()});
    return {bone,property:propertyName,sample:track.createInterpolant()};
  })}]));
  const faces=[];root.traverse(m=>{if(m.morphTargetDictionary)faces.push(m);});
  let current='wave',elapsed=0,cooldown=4,index=1,interruption=null,previousMode='idle';
  const ease=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
  function play(id){current=id;elapsed=0;interruption=null;}
  function interrupt(){if(current && interruption===null)interruption=0;}
  return {
    greet(){play('bow');},
    catchAt(point){interrupt();base.catchAt(point);},
    setLookTarget(point){base.setLookTarget(point);},
    tick(time,dt,mode,level){
      for(const [bone,r] of rest){bone.quaternion.copy(r.q);bone.position.copy(r.p);}
      base.tick(time,dt,mode,level);
      if(mode!=='idle'){interrupt();cooldown=4;}
      if(previousMode!=='idle' && mode==='idle')cooldown=4;
      previousMode=mode;
      if(!current && mode==='idle' && base.debug().action!=='catch'){
        cooldown-=dt;if(cooldown<=0){play(ids[index]);index=(index+1)%ids.length;}
      }
      if(!current)return;
      const motion=motions[current];elapsed+=dt;
      if(interruption!==null)interruption+=dt;
      const weight=ease(elapsed/.5)*(1-ease((elapsed-motion.duration-holdDuration)/recoveryDuration))*(interruption===null?1:1-ease(interruption/.3));
      for(const track of motion.tracks){
        const value=track.sample.evaluate(current==='wave'?Math.min(elapsed,motion.duration)%motion.cycle:Math.min(elapsed,motion.duration));
        if(track.property==='quaternion')track.bone.quaternion.slerp(rotation.fromArray(value).normalize(),weight);
        else if(track.property==='position')track.bone.position.lerp(position.fromArray(value),weight);
      }
      if(current==='yawn' && mode==='idle'){
        const faceWeight=Math.sin(Math.PI*Math.min(1,elapsed/motion.duration))**2*weight;
        for(const mesh of faces)for(const [name,amount] of [['Vowel.A',.55],['Blink.L',.8],['Blink.R',.8]]){
          const i=mesh.morphTargetDictionary[name];if(i!==undefined)mesh.morphTargetInfluences[i]=Math.max(mesh.morphTargetInfluences[i],faceWeight*amount);
        }
      }
      if(elapsed>=motion.duration+holdDuration+recoveryDuration || interruption>=.3){current=null;cooldown=4;}
    },
    debug(){return {...base.debug(),action:current||base.debug().action,mixamo:true,clipTime:elapsed};},
    dispose(){base.dispose();for(const [bone,r] of rest){bone.quaternion.copy(r.q);bone.position.copy(r.p);}}
  };
}
