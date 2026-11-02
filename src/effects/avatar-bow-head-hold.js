import * as T from 'three';
import {ARM_LIMITS,limitArmReach,createRotationLimiter} from './avatar-arm-limits.js';

// A head-relative hand target follows the authored bow, including its recovery.
export function createBowHeadHold(root){
 return createHandContact(root,{anchorBone:'DEF-spine.006',point:[-.14,1.55,-.17],finger:[.15,1,0],normal:[0,0,1],pole:[-1,.15,-.15],shoulderLift:true});
}

export function createHandContact(root,options){
 const find=n=>root.getObjectByName(T.PropertyBinding.sanitizeNodeName(n));
 const head=find(options.anchorBone),upper=find('DEF-upper_arm.R'),distal=find('DEF-upper_arm.R.001'),lower=find('DEF-forearm.R'),hand=find('DEF-hand.R');
 root.updateMatrixWorld(true);
 const world=b=>b.getWorldQuaternion(new T.Quaternion()),pos=b=>b.getWorldPosition(new T.Vector3());
 const rest=new Map([upper,distal,lower,hand].map(b=>[b,world(b)]));
 const shoulder=pos(upper),elbow=pos(lower),wrist=pos(hand),a=shoulder.distanceTo(elbow),b=elbow.distanceTo(wrist);
 const finger=pos(find('DEF-f_middle.01.R')).sub(wrist).normalize();
 const normal=pos(find('DEF-f_index.01.R')).sub(wrist).cross(pos(find('DEF-f_pinky.01.R')).sub(wrist)).normalize();
 const side=new T.Vector3().crossVectors(finger,normal).normalize();normal.crossVectors(side,finger);
 const inverseFrame=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(side,finger,normal)).premultiply(rest.get(hand).clone().invert()).invert();
 const headRest=world(head).invert();
 const anchor=head.worldToLocal(new T.Vector3(...options.point));
 const headFinger=new T.Vector3(...options.finger).normalize().applyQuaternion(headRest);
 const headNormal=new T.Vector3(...options.normal).applyQuaternion(headRest);
 const up=new T.Vector3(0,1,0),axis=new T.Vector3(),pole=new T.Vector3(),direction=new T.Vector3(),across=new T.Vector3();
 const q=new T.Quaternion(),parent=new T.Quaternion(),headQ=new T.Quaternion(),basis=new T.Matrix4();
 const limitWrist=createRotationLimiter(hand.quaternion.clone(),ARM_LIMITS.wristSwing,ARM_LIMITS.wristTwist);
 function setWorld(bone,rotation){parent.copy(bone.parent.getWorldQuaternion(parent)).invert();bone.quaternion.copy(parent.multiply(rotation));bone.updateWorldMatrix(false,true);}
 function aim(bone,vector){const reference=rest.get(bone);direction.copy(up).applyQuaternion(reference);q.setFromUnitVectors(direction,vector.clone().normalize()).multiply(reference);setWorld(bone,q);}
 const curlBones=options.curl?['index','middle','ring','pinky'].flatMap(name=>['02','03'].map(part=>{const bone=find(`DEF-f_${name}.${part}.R`);return {bone,axis:side.clone().applyQuaternion(world(bone).invert())};})):[];
 const clavicle=find('DEF-shoulder.R');
 const clavicleRest=world(clavicle),clavicleParentInverse=world(clavicle.parent).invert();
 const clavicleQ=new T.Quaternion(),bodyDelta=new T.Quaternion(),clavicleStart=new T.Quaternion();
 const shoulderLift=new T.Quaternion().setFromEuler(new T.Euler(0,.06,-.14,'ZYX'));
 const saved=new Map([upper,distal,lower,hand].map(bone=>[bone,new T.Quaternion()]));
 return {pose(weight,stroke=0){
  if(weight<=0)return;
  // Elevate and protract the clavicle before solving the arm from its new socket.
  if(options.shoulderLift){
   clavicleStart.copy(clavicle.quaternion);
   bodyDelta.copy(world(clavicle.parent)).multiply(clavicleParentInverse);
   clavicleQ.copy(bodyDelta).multiply(shoulderLift).multiply(clavicleRest);
   setWorld(clavicle,clavicleQ);clavicleQ.copy(clavicle.quaternion);
   clavicle.quaternion.copy(clavicleStart).slerp(clavicleQ,weight);
   clavicle.updateWorldMatrix(false,true);
  }
  for(const [bone,rotation]of saved)rotation.copy(bone.quaternion);
  head.updateWorldMatrix(true,false);head.getWorldQuaternion(headQ);
  wrist.copy(anchor).applyMatrix4(head.matrixWorld);wrist.y+=stroke;upper.getWorldPosition(shoulder);
  const distance=limitArmReach(wrist,shoulder,a,b);axis.copy(wrist).sub(shoulder).normalize();
  pole.set(...options.pole);pole.addScaledVector(axis,-pole.dot(axis)).normalize();
  const along=(a*a-b*b+distance*distance)/(2*distance);
  elbow.copy(shoulder).addScaledVector(axis,along).addScaledVector(pole,Math.sqrt(Math.max(0,a*a-along*along)));
  aim(upper,elbow.clone().sub(shoulder));lower.getWorldPosition(elbow);aim(lower,wrist.clone().sub(elbow));
  finger.copy(headFinger).applyQuaternion(headQ);normal.copy(headNormal).applyQuaternion(headQ);
  across.crossVectors(finger,normal).normalize();normal.crossVectors(across,finger).normalize();
  q.setFromRotationMatrix(basis.makeBasis(across,finger,normal)).multiply(inverseFrame);setWorld(hand,q);limitWrist(hand.quaternion);
  for(const [bone,rotation]of saved){q.copy(bone.quaternion);bone.quaternion.copy(rotation).slerp(q,weight);}
  for(const entry of curlBones)entry.bone.quaternion.multiply(q.setFromAxisAngle(entry.axis,(options.curl+stroke*4)*weight));
 }};
}
