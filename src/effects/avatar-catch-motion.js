import * as THREE from 'three';
import { ARM_LIMITS, limitArmReach, keepElbowOutside, createRotationLimiter } from './avatar-arm-limits.js';
const ease=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*x*(x*(x*6-15)+10);};
const slowStop=x=>ease(1-Math.pow(1-THREE.MathUtils.clamp(x,0,1),1.4));
function curve(t,keys,easing=ease){for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const [a,x]=keys[i-1],[b,y]=keys[i];return THREE.MathUtils.lerp(x,y,easing((t-a)/(b-a)));}return keys.at(-1)[1];}

// Two hands converge on one reachable point, then separate to recover balance.
export function createCatchMotion(root){
 const find=n=>root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
 root.updateMatrixWorld(true);
 const arms=['L','R'].map(side=>{
  const upper=find(`DEF-upper_arm.${side}`),distal=find(`DEF-upper_arm.${side}.001`),lower=find(`DEF-forearm.${side}`),hand=find(`DEF-hand.${side}`);
  const shoulder=upper.getWorldPosition(new THREE.Vector3()),elbow=lower.getWorldPosition(new THREE.Vector3()),wrist=hand.getWorldPosition(new THREE.Vector3());
  const finger=find(`DEF-f_middle.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
  const index=find(`DEF-f_index.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist);
  const pinky=find(`DEF-f_pinky.01.${side}`).getWorldPosition(new THREE.Vector3()).sub(wrist);
  const normal=(side==='R'?index.cross(pinky):pinky.cross(index)).normalize();
  const across=new THREE.Vector3().crossVectors(finger,normal).normalize();normal.crossVectors(across,finger);
  const frame=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,finger,normal));
  const inverseFrame=frame.premultiply(hand.getWorldQuaternion(new THREE.Quaternion()).invert()).invert();
  const lowerNormal=normal.clone().applyQuaternion(lower.getWorldQuaternion(new THREE.Quaternion()).invert());
  lowerNormal.y=0;lowerNormal.normalize();
  const lowerUp=new THREE.Vector3(0,1,0),lowerSide=new THREE.Vector3().crossVectors(lowerUp,lowerNormal).normalize();
  const lowerFrameInverse=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lowerSide,lowerUp,lowerNormal)).invert();
  const fingers=['index','middle','ring','pinky'].flatMap(name=>['01','02','03'].map(part=>find(`DEF-f_${name}.${part}.${side}`))).filter(Boolean).map(bone=>({bone,local:bone.quaternion.clone()}));
  return {limitForearm:createRotationLimiter(lower.quaternion.clone(),180,ARM_LIMITS.forearmTwist),limitWrist:createRotationLimiter(hand.quaternion.clone(),ARM_LIMITS.wristSwing,ARM_LIMITS.wristTwist),lowerFrameInverse,fingers,side,sign:side==='L'?1:-1,upper,distal,lower,hand,a:shoulder.distanceTo(elbow),b:elbow.distanceTo(wrist),inverseFrame,rest:new Map([upper,distal,lower].filter(Boolean).map(b=>[b,b.getWorldQuaternion(new THREE.Quaternion())]))};
 });
 const target=new THREE.Vector3(),offset=new THREE.Vector3();let time=-1,weight=0,lunge=0,spread=0,inspect=0,open=0,scan=0,down=0,pitch=0,tilt=0,swing=0;
 let yawKeys=[],pitchKeys=[],tiltKeys=[];
 const poseTarget=new THREE.Vector3(),gazeTarget=new THREE.Vector3(),palmNormal=new THREE.Vector3(),inspectNormal=new THREE.Vector3();
 const shoulder=new THREE.Vector3(),wrist=new THREE.Vector3(),axis=new THREE.Vector3(),pole=new THREE.Vector3(),elbow=new THREE.Vector3(),dir=new THREE.Vector3();
 const finger=new THREE.Vector3(),normal=new THREE.Vector3(),across=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),restAxis=new THREE.Vector3();
 const q=new THREE.Quaternion(),parent=new THREE.Quaternion(),basis=new THREE.Matrix4();
 const commonFinger=new THREE.Vector3(),commonNormal=new THREE.Vector3();
 const lowerWorld=new THREE.Quaternion(),rollDelta=new THREE.Quaternion(),upperWorld=new THREE.Quaternion(),distalWorld=new THREE.Quaternion();
 const upperAxis=new THREE.Vector3(),rolledAxis=new THREE.Vector3();
 const lateral=new THREE.Vector3(),chestRotation=new THREE.Quaternion();
 const swingRotation=new THREE.Quaternion();
 const headAngles=new THREE.Vector3(),headVelocity=new THREE.Vector3(),headGoal=new THREE.Vector3();
 const spine=find('DEF-spine.003'),head=find('DEF-spine.006');
 function distributeElbowRoll(arm){
  arm.lower.updateWorldMatrix(true,false);arm.lower.getWorldQuaternion(lowerWorld);
  rollDelta.copy(lowerWorld).multiply(arm.rest.get(arm.lower).clone().invert());
  arm.upper.getWorldQuaternion(upperWorld);upperAxis.copy(up).applyQuaternion(upperWorld);
  upperWorld.copy(rollDelta).multiply(arm.rest.get(arm.upper));rolledAxis.copy(up).applyQuaternion(upperWorld);
  q.setFromUnitVectors(rolledAxis,upperAxis);upperWorld.premultiply(q);
  parent.copy(arm.upper.parent.getWorldQuaternion(parent)).invert();q.copy(parent).multiply(upperWorld);
  arm.upper.quaternion.slerp(q,weight*.25);
  if(arm.distal){
   distalWorld.copy(upperWorld).multiply(arm.rest.get(arm.upper).clone().invert()).multiply(arm.rest.get(arm.distal));
   arm.distal.parent.updateWorldMatrix(true,false);parent.copy(arm.distal.parent.getWorldQuaternion(parent)).invert();q.copy(parent).multiply(distalWorld);
   arm.distal.quaternion.slerp(q,weight);
  }
  // Preserve the forearm's world pose after changing its ancestors' axial rotation.
  arm.lower.parent.updateWorldMatrix(true,false);parent.copy(arm.lower.parent.getWorldQuaternion(parent)).invert();arm.lower.quaternion.copy(parent.multiply(lowerWorld));
 }

 function chooseCommonDirection(){
  // Upright fingers leave room for the wider elbows without extending the wrists.
  commonFinger.set(target.x*.1,1,0).normalize();
  commonFinger.lerp(new THREE.Vector3(0,.20,1).normalize(),inspect).normalize();
  commonNormal.set(1,0,0).addScaledVector(commonFinger,-commonFinger.x).normalize();
 }

 function aim(bone,direction,reference){bone.parent.updateWorldMatrix(true,false);restAxis.copy(up).applyQuaternion(reference);q.setFromUnitVectors(restAxis,direction.normalize()).multiply(reference);parent.copy(bone.parent.getWorldQuaternion(parent)).invert();q.premultiply(parent);bone.quaternion.slerp(q,weight);}
 return {
  trigger(point){
   // Stay inside the framed, reachable area with the new shoulder clearance.
   target.set(THREE.MathUtils.clamp(point.x,-.20,.20),THREE.MathUtils.clamp(point.y,1.08,1.52),.42);gazeTarget.copy(target);time=0;
   // Sample once per click, never per frame: coherent, slightly diagonal glances.
   const firstEnd=4.42+Math.random()*.12,secondEnd=5.78+Math.random()*.14;
   const first=-.46-Math.random()*.06,second=.48+Math.random()*.06;
   const direction=Math.random()<.5?-1:1;
   const up=direction*(.035+Math.random()*.035),down=-direction*(.025+Math.random()*.05);
   const keys=(a,b)=>[[0,0],[3.7,0],[firstEnd,a],[4.82,a],[secondEnd,b],[6.08,b],[7.3,0]];
   yawKeys=keys(first,second);pitchKeys=keys(up,down);tiltKeys=keys(-first*.045,-second*.045);
   return true;
  },
  get active(){return time>=0;},get target(){return gazeTarget;},get weight(){return weight;},
  update(dt){
   for(const arm of arms)for(const {bone,local}of arm.fingers)bone.quaternion.copy(local);
   if(time<0){offset.set(0,0,0);return offset;}
   time+=Math.max(0,dt);
   // Contact -> stillness -> inspect open palms -> search -> settle.
   weight=curve(time,[[0,0],[.28,1],[5.05,1],[6.4,0],[7.6,0]]);
   lunge=curve(time,[[0,0],[.2,-.18],[.47,1],[1.2,1],[2.3,.12],[3.2,0],[7.6,0]]);
   inspect=curve(time,[[0,0],[1.25,0],[2.65,1],[7.6,1]]);
   open=curve(time,[[0,0],[1.75,0],[2.9,1],[7.6,1]]);
   down=curve(time,[[0,0],[1.35,0],[2.45,1],[3.5,1],[4.2,0],[7.6,0]]);
   scan=curve(time,yawKeys,slowStop);pitch=curve(time,pitchKeys,slowStop);tilt=curve(time,tiltKeys,slowStop);
   // A critically damped follow keeps velocity continuous even when another
   // click interrupts a glance, softening changes before the final pose filter.
   headGoal.set(-.06*lunge+.68*down+pitch,scan,tilt);
   const step=Math.max(0,dt),frequency=14,decay=Math.exp(-frequency*step);
   for(const key of ['x','y','z']){
    const delta=headAngles[key]-headGoal[key],travel=(headVelocity[key]+frequency*delta)*step;
    headAngles[key]=headGoal[key]+(delta+travel)*decay;
    headVelocity[key]=(headVelocity[key]-frequency*travel)*decay;
   }
   const settling=ease((time-5.9)/.35)*(1-ease((time-6.1)/1.5));
   swing=.085*Math.sin((time-5.9)*7)*settling;
   spread=curve(time,[[0,.24],[.28,.27],[.55,.028],[1.75,.028],[2.9,.13],[7.6,.13]]);
   poseTarget.copy(target).lerp(new THREE.Vector3(0,1.16,.36),inspect);
   gazeTarget.copy(poseTarget);
   const search=curve(time,[[0,0],[3.65,0],[4.25,1],[7.6,1]]);
   const eyeScan=curve(time+.13,yawKeys,slowStop),eyePitch=curve(time+.13,pitchKeys,slowStop);
   gazeTarget.lerp(new THREE.Vector3(eyeScan*2,1.55-eyePitch*1.2,1.2),search);
   // Follow a side click with the body, adding knee room for the planted feet.
   offset.set(target.x*lunge,-(.035+1.3*target.x**2)*Math.abs(lunge),.16*lunge);
   if(time>=7.6){time=-1;weight=0;offset.set(0,0,0);}return offset;
  },
  pose(){
   if(time<0)return;
   spine.rotateX(.10*lunge);spine.rotateZ(-target.x*.32*lunge);spine.rotateY(headAngles.y*.16);head.rotateX(headAngles.x);head.rotateY(headAngles.y);head.rotateZ(headAngles.z);
   spine.getWorldQuaternion(chestRotation);
   chooseCommonDirection();
   for(const arm of arms){
    // As the hands arrive at the sides, carry a small damped front/back swing
    // through the whole arm while the head is still finishing its last glance.
    lateral.set(arm.sign,0,0).applyQuaternion(chestRotation);
    arm.upper.getWorldQuaternion(q);q.premultiply(swingRotation.setFromAxisAngle(lateral,swing*arm.sign*(1-weight)));
    parent.copy(arm.upper.parent.getWorldQuaternion(parent)).invert();arm.upper.quaternion.copy(parent.multiply(q));
    if(weight<=0)continue;
    arm.upper.updateWorldMatrix(true,false);arm.upper.getWorldPosition(shoulder);
    // Solve each elbow near the common palm axis, allowing a gentle wrist extension.
    wrist.copy(poseTarget).addScaledVector(commonNormal,arm.sign*spread).addScaledVector(commonFinger,-.08);
    const distance=limitArmReach(wrist,shoulder,arm.a,arm.b);axis.copy(wrist).sub(shoulder).normalize();
    pole.set(arm.sign*.45,-.8,0);pole.addScaledVector(axis,-pole.dot(axis));
    pole.normalize();const along=(arm.a**2-arm.b**2+distance**2)/(2*distance);
    elbow.copy(shoulder).addScaledVector(axis,along).addScaledVector(pole,Math.sqrt(Math.max(0,arm.a**2-along**2)));
    keepElbowOutside(elbow,wrist,shoulder,lateral,arm.a,arm.b);
    dir.copy(elbow).sub(shoulder);aim(arm.upper,dir,arm.rest.get(arm.upper));
    arm.lower.updateWorldMatrix(true,false);arm.lower.getWorldPosition(elbow);dir.copy(wrist).sub(elbow);aim(arm.lower,dir,arm.rest.get(arm.lower));
    // Share palm rotation with the forearm rather than wringing the wrist.
    arm.hand.updateWorldMatrix(true,false);arm.hand.getWorldPosition(finger).sub(elbow).normalize();
    palmNormal.copy(commonNormal).multiplyScalar(-arm.sign);
    inspectNormal.set(0,1,-.20).normalize();
    palmNormal.lerp(inspectNormal,open).normalize();
    palmNormal.addScaledVector(commonFinger,-palmNormal.dot(commonFinger)).normalize();
    normal.copy(palmNormal);normal.addScaledVector(finger,-normal.dot(finger)).normalize();
    across.crossVectors(finger,normal).normalize();
    q.setFromRotationMatrix(basis.makeBasis(across,finger,normal)).multiply(arm.lowerFrameInverse);
    arm.lower.parent.updateWorldMatrix(true,false);parent.copy(arm.lower.parent.getWorldQuaternion(parent)).invert();q.premultiply(parent);arm.lower.quaternion.slerp(q,weight);
    distributeElbowRoll(arm);
    arm.limitForearm(arm.lower.quaternion);
    finger.copy(commonFinger);normal.copy(palmNormal);
    across.crossVectors(finger,normal).normalize();
    q.setFromRotationMatrix(basis.makeBasis(across,finger,normal)).multiply(arm.inverseFrame);
    arm.hand.parent.updateWorldMatrix(true,false);parent.copy(arm.hand.parent.getWorldQuaternion(parent)).invert();q.premultiply(parent);arm.hand.quaternion.slerp(q,weight);
    arm.limitWrist(arm.hand.quaternion);
    // Extend the four fingers in the palm plane instead of retaining the curled rest pose.
    arm.hand.updateWorldMatrix(true,false);
    finger.set(0,1,0).applyQuaternion(arm.inverseFrame.clone().invert()).applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion())).normalize();
    for(const {bone}of arm.fingers){
     bone.updateWorldMatrix(true,false);const reference=bone.getWorldQuaternion(new THREE.Quaternion());
     aim(bone,finger.clone(),reference);
    }
   }
  },
  dispose(){for(const arm of arms)for(const {bone,local}of arm.fingers)bone.quaternion.copy(local);}
 };
}
