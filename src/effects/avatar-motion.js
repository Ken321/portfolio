import * as THREE from 'three';
import { createHandContact } from './avatar-bow-head-hold.js';
import { ARM_LIMITS, limitArmReach, createRotationLimiter } from './avatar-arm-limits.js';
import { createCatchMotion } from './avatar-catch-motion.js';
import { createBodyMotion } from './avatar-body-motion.js';

// Procedural motion only: no Blender actions or control-bone constraints required.
export function createAvatarMotion(root,{externalIdle=false}={}) {
  const find = name => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  const names = ['DEF-spine.001','DEF-shoulder.L','DEF-shoulder.R','DEF-spine.002','DEF-spine.003','DEF-spine.006','DEF-upper_arm.L','DEF-upper_arm.L.001','DEF-upper_arm.R','DEF-upper_arm.R.001','DEF-forearm.L','DEF-forearm.R','DEF-hand.R','DEF-hand.L','DEF-eyeball.L','DEF-eyeball.R'];
  const bones = Object.fromEntries(names.map(n => [n,find(n)]));
  root.updateMatrixWorld(true);
  const rest = new Map(Object.values(bones).filter(Boolean).map(b => [b, {local:b.quaternion.clone(),world:b.getWorldQuaternion(new THREE.Quaternion())}]));
  const bodyMotion=createBodyMotion(root);
  const catchMotion=createCatchMotion(root);
  const scratch=createHandContact(root,{anchorBone:'DEF-spine.003',point:[-.10,1.00,.19],finger:[0,-1,-.1],normal:[0,.1,-1],pole:[-1,-.2,.3],curl:.45});
  const eyes=['DEF-eyeball.L','DEF-eyeball.R'].map(n=>bones[n]).filter(Boolean).map(bone=>({bone,x:0,z:0,position:bone.position.clone(),inward:new THREE.Vector3(0,-.001,0).applyQuaternion(bone.quaternion),downward:new THREE.Vector3(0,0,-.0025).applyQuaternion(bone.quaternion)}));
  const lookTarget=new THREE.Vector3(),lookDirection=new THREE.Vector3(),eyePosition=new THREE.Vector3();
  const eyeCenter=new THREE.Vector3(),gazeOrigin=new THREE.Vector3();
  const eyeWorld=new THREE.Quaternion(),eyeDelta=new THREE.Quaternion();
  let hasLookTarget=false,idleSway=0,externalGesture=false;
  const restingOffset=new THREE.Vector3();
  // The white eye surface is fitted to the eyelids, not a complete eyeball.
  // Keep its blink morphs but bind it to the head while the irises turn.
  const fixedEyeSkins=[];
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh || mesh.material?.name!=='Eye 3')return;
    const original=mesh.geometry.getAttribute('skinIndex');
    const headIndex=mesh.skeleton.bones.indexOf(bones['DEF-spine.006']);
    if(!original || headIndex<0)return;
    const indices=original.clone();
    for(let i=0;i<indices.count;i++)for(let j=0;j<4;j++){
      if(eyes.some(eye=>eye.bone===mesh.skeleton.bones[indices.getComponent(i,j)]))indices.setComponent(i,j,headIndex);
    }
    mesh.geometry.setAttribute('skinIndex',indices);
    fixedEyeSkins.push({mesh,original});
  });
  const morphs=[];
  root.traverse(mesh=>{if(mesh.morphTargetDictionary)morphs.push(mesh);});
  // Calibrate the palm from knuckle positions: the hand's local Z is not its palm normal.
  const hand=bones['DEF-hand.R'];
  const index=find('DEF-f_index.01.R'),middle=find('DEF-f_middle.01.R'),pinky=find('DEF-f_pinky.01.R');
  let palmFrameInverse=null,forearmFrameInverse=null;
  if(hand && index && middle && pinky){
    const wrist=hand.getWorldPosition(new THREE.Vector3());
    const toLocal=rest.get(hand).world.clone().invert();
    const finger=middle.getWorldPosition(new THREE.Vector3()).sub(wrist).normalize().applyQuaternion(toLocal);
    const acrossIndex=index.getWorldPosition(new THREE.Vector3()).sub(wrist);
    const acrossPinky=pinky.getWorldPosition(new THREE.Vector3()).sub(wrist);
    const palm=acrossIndex.cross(acrossPinky).normalize().applyQuaternion(toLocal);
    const forearm=bones['DEF-forearm.R'];
    const forearmWorld=rest.get(forearm).world;
    const forearmPalm=palm.clone().applyQuaternion(rest.get(hand).world).applyQuaternion(forearmWorld.clone().invert());
    forearmPalm.y=0;forearmPalm.normalize();
    const forearmY=new THREE.Vector3(0,1,0);
    const forearmSide=new THREE.Vector3().crossVectors(forearmY,forearmPalm).normalize();
    forearmFrameInverse=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forearmSide,forearmY,forearmPalm)).invert();
    const side=new THREE.Vector3().crossVectors(finger,palm).normalize();
    palm.crossVectors(side,finger).normalize();
    palmFrameInverse=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side,finger,palm)).invert();
  }
  const bowAnchor=bones['DEF-spine.002'];
  const bowArms=['L','R'].map(side=>{
    const upper=bones[`DEF-upper_arm.${side}`],lower=bones[`DEF-forearm.${side}`],palmBone=bones[`DEF-hand.${side}`];
    const shoulder=upper.getWorldPosition(new THREE.Vector3()),elbow=lower.getWorldPosition(new THREE.Vector3()),wrist=palmBone.getWorldPosition(new THREE.Vector3());
    const finger=find(`DEF-f_middle.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
    const indexVector=find(`DEF-f_index.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist);
    const pinkyVector=find(`DEF-f_pinky.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist);
    const normal=side==='R'?indexVector.cross(pinkyVector):pinkyVector.cross(indexVector);
    normal.normalize();const across=new THREE.Vector3().crossVectors(finger,normal).normalize();normal.crossVectors(across,finger);
    const frame=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,finger,normal));
    const inverseFrame=frame.premultiply(rest.get(palmBone).world.clone().invert()).invert();
    const sign=side==='L'?1:-1;
    const target=new THREE.Vector3(sign*.055,.86,side==='L'?.235:.215);
    bowAnchor.worldToLocal(target);
    return {side,sign,upper,lower,hand:palmBone,upperLength:shoulder.distanceTo(elbow),lowerLength:elbow.distanceTo(wrist),target,inverseFrame};
  });
  for(const arm of bowArms){
    arm.limitForearm=createRotationLimiter(arm.lower.quaternion.clone(),180,ARM_LIMITS.forearmTwist);
    arm.limitWrist=createRotationLimiter(arm.hand.quaternion.clone(),ARM_LIMITS.wristSwing,ARM_LIMITS.wristTwist);
  }
  const bowShoulder=new THREE.Vector3(),bowTarget=new THREE.Vector3(),bowAxis=new THREE.Vector3(),bowPole=new THREE.Vector3(),bowElbow=new THREE.Vector3();
  const bowFrame=new THREE.Quaternion(),bowOld=new THREE.Quaternion(),bowHeadRotation=new THREE.Quaternion(),bowRestInverse=rest.get(bowAnchor).world.clone().invert();
  function poseBowHands(weight,yawn=false){
    if(weight<=0)return;
    bowAnchor.updateWorldMatrix(true,false);bowAnchor.getWorldQuaternion(bowHeadRotation).multiply(bowRestInverse);
    for(const arm of bowArms){
      if(yawn && arm.side!=='R')continue;
      arm.upper.updateWorldMatrix(true,false);arm.upper.getWorldPosition(bowShoulder);
      bowTarget.copy(arm.target).applyMatrix4(bowAnchor.matrixWorld);
      if(yawn)bowTarget.set(-.10,1.40,.24);
      const distance=limitArmReach(bowTarget,bowShoulder,arm.upperLength,arm.lowerLength);bowAxis.copy(bowTarget).sub(bowShoulder).normalize();
      bowPole.set(arm.sign,-.2,0).applyQuaternion(bowHeadRotation);bowPole.addScaledVector(bowAxis,-bowPole.dot(bowAxis)).normalize();
      const along=(arm.upperLength**2-arm.lowerLength**2+distance**2)/(2*distance);
      bowElbow.copy(bowShoulder).addScaledVector(bowAxis,along).addScaledVector(bowPole,Math.sqrt(Math.max(0,arm.upperLength**2-along**2)));
      direction.copy(bowElbow).sub(bowShoulder);bowOld.copy(arm.upper.quaternion);aim(`DEF-upper_arm.${arm.side}`,direction.x,direction.y,direction.z);bowFrame.copy(arm.upper.quaternion);arm.upper.quaternion.slerpQuaternions(bowOld,bowFrame,weight);
      arm.lower.updateWorldMatrix(true,false);arm.lower.getWorldPosition(bowElbow);
      direction.copy(bowTarget).sub(bowElbow);bowOld.copy(arm.lower.quaternion);aim(`DEF-forearm.${arm.side}`,direction.x,direction.y,direction.z);bowFrame.copy(arm.lower.quaternion);arm.lower.quaternion.slerpQuaternions(bowOld,bowFrame,weight);
      arm.limitForearm(arm.lower.quaternion);
      // Keep the fingers aligned with the actual forearm, not a fixed downward pose.
      arm.hand.updateWorldMatrix(true,false);arm.hand.getWorldPosition(waveY).sub(bowElbow).normalize();
      waveZ.set(0,0,-1).applyQuaternion(bowHeadRotation);
      waveZ.addScaledVector(waveY,-waveZ.dot(waveY)).normalize();
      waveX.crossVectors(waveY,waveZ).normalize();
      bowFrame.setFromRotationMatrix(waveBasis.makeBasis(waveX,waveY,waveZ)).multiply(arm.inverseFrame);
      arm.hand.parent.updateWorldMatrix(true,false);parentQ.copy(arm.hand.parent.getWorldQuaternion(parentQ)).invert();
      bowFrame.premultiply(parentQ);arm.hand.quaternion.slerp(bowFrame,weight);arm.limitWrist(arm.hand.quaternion);
    }
    waveZ.set(0,0,1);
  }
  const waveX=new THREE.Vector3(),waveY=new THREE.Vector3(),waveZ=new THREE.Vector3(0,0,1);
  const waveBasis=new THREE.Matrix4(),waveRotation=new THREE.Quaternion();
  const q=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),direction=new THREE.Vector3(),restDirection=new THREE.Vector3();
  const y=new THREE.Vector3(0,1,0),euler=new THREE.Euler();
  const poseHistory=new Map([...rest].filter(([bone])=>!eyes.some(eye=>eye.bone===bone)).map(([bone])=>[bone,bone.quaternion.clone()]));
  let poseInitialized=false;
  let elapsed=0,bowTime=-1,waveTime=externalIdle?-1:0,nextIdleAt=9.6,gesture=0,blinkTime=0,nextBlink=3.4;
  const idleSequence=['wave','bow','yawn','look'];
  let idleIndex=1,idleKind=null,idleTime=0,autoBow=false;
  function rotate(name,x,y=0,z=0){const b=bones[name];if(b){euler.set(x,y,z);q.setFromEuler(euler);b.quaternion.multiply(q);}}
  const shoulderAxis=new THREE.Vector3(0,0,1),shoulderWorld=new THREE.Quaternion();
  function turnShoulder(name,angle){
    const bone=bones[name];if(!bone)return;
    bone.updateWorldMatrix(true,false);bone.getWorldQuaternion(shoulderWorld);
    q.setFromAxisAngle(shoulderAxis,angle).multiply(shoulderWorld);
    parentQ.copy(bone.parent.getWorldQuaternion(parentQ)).invert();bone.quaternion.copy(parentQ.multiply(q));
  }
  function aim(name,x,yValue,z){
    const b=bones[name];if(!b)return;
    b.parent.updateWorldMatrix(true,false);
    direction.set(x,yValue,z).normalize();restDirection.copy(y).applyQuaternion(rest.get(b).world);
    q.setFromUnitVectors(restDirection,direction).multiply(rest.get(b).world);
    parentQ.copy(b.parent.getWorldQuaternion(parentQ)).invert();b.quaternion.copy(parentQ.multiply(q));
  }
  const upperTarget=new THREE.Quaternion();
  const forearmRestInverse=rest.get(bones['DEF-forearm.R'])?.world.clone().invert();
  function alignUpperArmTwist(weight,angle){
    const upper=bones['DEF-upper_arm.R'];
    if(!upper || !forearmFrameInverse || !forearmRestInverse || weight<=0)return;
    upper.updateWorldMatrix(true,false);
    // Match the upper-arm roll to the forearm, leaving a hinge bend at the elbow.
    // Otherwise independently aimed bones concentrate axial twist at the crease.
    direction.copy(y).applyQuaternion(upper.getWorldQuaternion(q));
    waveY.set(Math.sin(angle),Math.cos(angle),0);
    waveX.crossVectors(waveY,waveZ).normalize();
    waveRotation.setFromRotationMatrix(waveBasis.makeBasis(waveX,waveY,waveZ))
      .multiply(forearmFrameInverse).multiply(forearmRestInverse);
    restDirection.copy(y).applyQuaternion(rest.get(upper).world).applyQuaternion(waveRotation);
    q.setFromUnitVectors(restDirection,direction).multiply(waveRotation).multiply(rest.get(upper).world);
    upperTarget.copy(q);
    parentQ.copy(upper.parent.getWorldQuaternion(parentQ)).invert();
    q.premultiply(parentQ);
    upper.quaternion.slerp(q,weight*.25);
    const distal=bones['DEF-upper_arm.R.001'];
    if(distal){
      distal.parent.updateWorldMatrix(true,false);
      q.copy(rest.get(upper).world).invert();
      upperTarget.multiply(q).multiply(rest.get(distal).world);
      parentQ.copy(distal.parent.getWorldQuaternion(parentQ)).invert();
      upperTarget.premultiply(parentQ);
      distal.quaternion.slerp(upperTarget,weight);
    }
  }
  function orientWaveBone(bone,frameInverse,weight,angle){
    if(!bone || !frameInverse || weight<=0)return;
    bone.parent.updateWorldMatrix(true,false);
    waveY.set(Math.sin(angle),Math.cos(angle),0);
    waveX.crossVectors(waveY,waveZ).normalize();
    waveRotation.setFromRotationMatrix(waveBasis.makeBasis(waveX,waveY,waveZ)).multiply(frameInverse);
    parentQ.copy(bone.parent.getWorldQuaternion(parentQ)).invert();
    waveRotation.premultiply(parentQ);
    bone.quaternion.slerp(waveRotation,weight);
  }
  function morph(name,value){for(const mesh of morphs){const index=mesh.morphTargetDictionary[name];if(index!==undefined)mesh.morphTargetInfluences[index]=value;}}
  const ease=x=>x*x*(3-2*x);
  const softEase=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*x*(x*(x*6-15)+10);};
  return {
    shrug(){idleKind='shrug';idleTime=0;waveTime=-1;bowTime=-1;nextIdleAt=Infinity;},
    scratch(){idleKind='scratch';idleTime=0;waveTime=-1;bowTime=-1;nextIdleAt=Infinity;},
    yawn(){idleKind='yawn';idleTime=0;waveTime=-1;bowTime=-1;nextIdleAt=Infinity;},
    cancelIdle(){idleKind=null;},
    greet(){bowTime=0;waveTime=-1;idleKind=null;autoBow=false;nextIdleAt=Infinity;},
    catchAt(point){if(catchMotion.trigger(point)){bowTime=-1;waveTime=-1;idleKind=null;autoBow=false;nextIdleAt=Infinity;}},
    setExternalGesture(active){externalGesture=active;},
    setLookTarget(target){hasLookTarget=!!target;if(target)lookTarget.copy(target);},
    tick(time,dt,mode,level){
      elapsed+=dt;const active=mode!=='idle';
      for(const [b,r] of rest)b.quaternion.copy(r.local);
      gesture+=(Math.min(1,Math.max(0,active?level:0))-gesture)*(1-Math.exp(-18*dt));
      if(active){waveTime=-1;idleKind=null;if(autoBow)bowTime=-1;autoBow=false;nextIdleAt=elapsed+4;}
      if(!externalIdle && !active && bowTime<0 && waveTime<0 && !catchMotion.active && !idleKind){
        if(nextIdleAt===Infinity)nextIdleAt=elapsed+4;
        if(elapsed>=nextIdleAt){
          const action=idleSequence[idleIndex];idleIndex=(idleIndex+1)%idleSequence.length;nextIdleAt=Infinity;
          if(action==='wave')waveTime=0;
          else if(action==='bow'){bowTime=0;autoBow=true;}
          else {idleKind=action;idleTime=0;}
        }
      }
      let idleWeight=0,yawnWeight=0,lookWeight=0;
      if(idleKind){idleTime+=dt;const duration=idleKind==='shrug'?2.4:idleKind==='scratch'?4.3:4.2;idleWeight=softEase(idleTime/.9)*softEase((duration-idleTime)/1.2);if(idleKind==='yawn')yawnWeight=idleWeight;if(idleKind==='look')lookWeight=idleWeight;if(idleTime>=duration)idleKind=null;}

      let wave=0;
      if(waveTime>=0){waveTime+=dt;wave=softEase((waveTime-.25)/.95)*softEase((4.8-waveTime)/1.3);if(waveTime>=5.6)waveTime=-1;}
      let bow=0,bowHands=0;
      if(bowTime>=0){bowTime+=dt;bowHands=softEase(bowTime/.65)*softEase((3.4-bowTime)/.55);bow=softEase((bowTime-.45)/.75)*softEase((2.9-bowTime)/.9);if(bowTime>=3.4)bowTime=-1;}
      const phase=Math.max(0,waveTime-1.05)*5.2;
      const waveAngle=Math.sin(phase)*.27+Math.sin(phase*.5+.6)*.025;
      const quiet=!active && !externalGesture && waveTime<0 && bowTime<0 && !idleKind && !catchMotion.active;
      idleSway+=((quiet?1:0)-idleSway)*(1-Math.exp(-(quiet?2:8)*Math.max(0,dt)));
      const shrugWeight=idleKind==='shrug'?softEase(idleTime/.8)*(1-softEase((idleTime-1.15)/.55)):0;
      const scratchPhase=idleKind==='scratch'?idleTime:0;
      const scratchWeight=idleKind==='scratch'?idleWeight:0;
      const stroke=.012*Math.sin((scratchPhase-.75)*13)*softEase((scratchPhase-.75)/.3);
      const swayPhase=elapsed*1.55;
      const sway=(Math.sin(swayPhase)+.18*Math.sin(elapsed*.71+.6))*idleSway;
      const armLag=Math.sin(swayPhase-.45)*idleSway;
      // Idle sway pivots above the waist; only deliberate actions translate the hips.
      restingOffset.copy(catchMotion.update(dt));
      const {support,turn,nod}=bodyMotion.update(waveTime,dt,restingOffset);
      rotate('DEF-spine.001',-.012*support,.025*turn,.020*support);
      rotate('DEF-spine.002',bow*.30+.014*turn,.030*turn,.026*turn);
      rotate('DEF-spine.003',bow*.28+Math.sin(time*1.45)*.006,.035*turn,Math.sin(time*2)*gesture*.025+.015*turn);
      rotate('DEF-spine.006',bow*.32+.035*nod+(.04+Math.sin(time*5)*.07)*gesture,Math.sin(time*1.7)*gesture*.06-.045*turn,Math.sin(time*2.9)*gesture*.025-.045*turn);
      rotate('DEF-spine.003',-.06*yawnWeight,.08*lookWeight,0);
      rotate('DEF-spine.006',-.12*yawnWeight,.38*lookWeight*Math.cos((idleTime-.9)*.9),0);
      rotate('DEF-spine.002',0,0,.012*sway);
      rotate('DEF-spine.003',0,.008*armLag,.010*sway);
      // Let the head follow gently, slightly behind the torso.
      rotate('DEF-spine.006',0,.004*Math.sin(swayPhase-.35)*idleSway,.012*Math.sin(swayPhase-.3)*idleSway);
      rotate('DEF-spine.002',.012*scratchWeight,0,-.012*scratchWeight);
      rotate('DEF-spine.003',.018*scratchWeight,-.018*scratchWeight,.003*Math.sin(scratchPhase*13-.3)*scratchWeight);
      rotate('DEF-spine.006',.05*scratchWeight,.025*scratchWeight,0);
      root.updateMatrixWorld(true);
      turnShoulder('DEF-shoulder.R',-.060*turn-.22*shrugWeight);
      turnShoulder('DEF-shoulder.L',.015*turn+.22*shrugWeight);
      // Aim deform bones in world space, preserving the rest-pose twist.
      aim('DEF-upper_arm.L',.25+.03*turn,-.96,.04+.035*turn);
      aim('DEF-forearm.L',.15+.025*turn,-.98,.10-.02*turn);
      rotate('DEF-hand.L',.02*turn,0,.02*turn);
      aim('DEF-upper_arm.R',-.25-.65*wave,-.96+(1.12+.025*Math.sin(phase-.5))*wave,.04+.86*wave);
      aim('DEF-forearm.R',-.15,-.98,.10);
      // Carry the hand with the forearm; avoid twisting only the wrist.

      alignUpperArmTwist(wave,waveAngle);
      orientWaveBone(bones['DEF-forearm.R'],forearmFrameInverse,wave,waveAngle);
      orientWaveBone(hand,palmFrameInverse,wave,waveAngle+.045*Math.sin(phase-.7));
      scratch.pose(scratchWeight,stroke);
      poseBowHands(bowHands);
      poseBowHands(yawnWeight,true);
      catchMotion.pose();
      // Ease into and out of every pose, including interrupted waves and greetings.
      // Keep a small amount of follow-through instead of snapping on mode changes.
      for(const [bone,previous]of poseHistory){
        bone.quaternion.normalize();
        if(poseInitialized){
          const angle=previous.angleTo(bone.quaternion);
          const blend=Math.min(1-Math.exp(-(catchMotion.active?30:9)*Math.max(0,dt)),angle>1e-6?(catchMotion.active?12:3.2)*Math.max(0,dt)/angle:1);
          previous.slerp(bone.quaternion,blend);bone.quaternion.copy(previous);
        }else previous.copy(bone.quaternion);
      }
      poseInitialized=true;
      bodyMotion.plantFeet();
      // Gaze is relative to the current head pose, including bows and speech.
      const lookBlend=1-Math.exp(-10*Math.max(0,dt));
      // Share an eye-centred direction. Only a small fraction of the eye spacing
      // contributes to convergence on this stylized, widely spaced eye rig.
      eyeCenter.set(0,0,0);
      for(const eye of eyes)eyeCenter.add(eye.bone.getWorldPosition(eyePosition));
      eyeCenter.multiplyScalar(1/Math.max(1,eyes.length));
      for(const eye of eyes){
        let targetX=0,targetZ=0;
        if(bowTime>=0){
          targetZ=-.18;
        }else if(lookWeight>0){
          targetX=.12*lookWeight*Math.cos((idleTime-.9)*.9);
        }else if(hasLookTarget || catchMotion.active){
          eye.bone.updateWorldMatrix(true,false);
          eye.bone.getWorldPosition(eyePosition);
          eye.bone.getWorldQuaternion(eyeWorld).invert();
          gazeOrigin.copy(eyeCenter).lerp(eyePosition,.05);
          lookDirection.copy(catchMotion.active?catchMotion.target:lookTarget).sub(gazeOrigin).applyQuaternion(eyeWorld);
          targetX=THREE.MathUtils.clamp(Math.atan2(lookDirection.x,lookDirection.y),-.24,.24);
          targetZ=THREE.MathUtils.clamp(Math.atan2(lookDirection.z,Math.hypot(lookDirection.x,lookDirection.y)),-.18,.14);
        }
        eye.x+=(targetX-eye.x)*lookBlend;eye.z+=(targetZ-eye.z)*lookBlend;
        // Lower the iris with the gaze instead of hiding it behind the upper lid.
        // A small depth inset keeps the curved surface inside the eyelid.
        const downward=THREE.MathUtils.clamp(-eye.z/.18,0,1);
        eye.bone.position.copy(eye.position).addScaledVector(eye.inward,downward).addScaledVector(eye.downward,downward);
        lookDirection.set(Math.tan(eye.x),1,Math.tan(eye.z)).normalize();
        eyeDelta.setFromUnitVectors(y,lookDirection);
        eye.bone.quaternion.multiply(eyeDelta).normalize();
      }
      blinkTime+=dt;
      let blink=0;
      if(blinkTime>=nextBlink){const t=(blinkTime-nextBlink)/.25;blink=Math.sin(Math.min(1,t)*Math.PI);if(t>=1){blinkTime=0;nextBlink=3.5+Math.sin(elapsed)*.7;}}
      const bowEyes=bowTime>=0?softEase((bowTime-.15)/.45)*softEase((2.95-bowTime)/.6):0;
      morph('Blink.L',Math.max(blink,yawnWeight*.85,bowEyes));morph('Blink.R',Math.max(blink,yawnWeight*.85,bowEyes));
      // Audio-amplitude lip movement, not phoneme recognition. Face and cavity match.
      morph('Vowel.A',Math.max(gesture*.72,yawnWeight*.65));morph('Vowel.O',Math.max(gesture*.12,yawnWeight*.20));
      for(const vowel of ['I','U','E'])morph(`Vowel.${vowel}`,0);
    },
    debug(){return {headBone:bones['DEF-spine.006']?.name,gesture,action:catchMotion.active?'catch':bowTime>=0?'bow':waveTime>=0?'wave':idleKind||'idle',procedural:true};},
    dispose(){catchMotion.dispose();bodyMotion.dispose();for(const eye of eyes)eye.bone.position.copy(eye.position);for(const {mesh,original}of fixedEyeSkins)mesh.geometry.setAttribute('skinIndex',original);for(const [b,r]of rest)b.quaternion.copy(r.local);for(const mesh of morphs)mesh.morphTargetInfluences.fill(0);}
  };
}
