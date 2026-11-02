import * as THREE from 'three';

// Conservative rig limits, not medical ranges. Angles are relative to bind pose.
export const ARM_LIMITS=Object.freeze({elbowMin:5,elbowMax:145,forearmTwist:100,wristSwing:60,wristTwist:35});
const radians=THREE.MathUtils.degToRad;

// Clamp the target before solving either segment; otherwise the lower arm still
// aims beyond the reachable point and defeats the elbow limit.
export function limitArmReach(target,shoulder,upperLength,lowerLength){
 const distanceFor=degrees=>Math.sqrt(upperLength**2+lowerLength**2+2*upperLength*lowerLength*Math.cos(radians(degrees)));
 const minimum=distanceFor(ARM_LIMITS.elbowMax),maximum=distanceFor(ARM_LIMITS.elbowMin);
 const distance=target.distanceTo(shoulder);
 if(distance<1e-8)target.copy(shoulder).add(new THREE.Vector3(0,-minimum,0));
 else target.sub(shoulder).multiplyScalar(THREE.MathUtils.clamp(distance,minimum,maximum)/distance).add(shoulder);
 return target.distanceTo(shoulder);
}

export function createRotationLimiter(restQuaternion,maxSwingDegrees,maxTwistDegrees){
 const inverse=restQuaternion.clone().invert(),delta=new THREE.Quaternion(),twist=new THREE.Quaternion(),swing=new THREE.Quaternion();
 const identity=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0);
 const maxSwing=radians(maxSwingDegrees),maxTwist=radians(maxTwistDegrees);
 return quaternion=>{
  delta.copy(inverse).multiply(quaternion).normalize();
  if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
  // Decompose about the bone's longitudinal Y axis, avoiding Euler wraparound.
  twist.set(0,delta.y,0,delta.w);
  if(twist.lengthSq()<1e-12)twist.identity();else twist.normalize();
  swing.copy(delta).multiply(twist.clone().invert());
  const angle=identity.angleTo(swing);
  if(angle>maxSwing)swing.slerpQuaternions(identity,swing,maxSwing/angle);
  const twistAngle=2*Math.atan2(twist.y,twist.w);
  twist.setFromAxisAngle(axis,THREE.MathUtils.clamp(twistAngle,-maxTwist,maxTwist));
  quaternion.copy(restQuaternion).multiply(swing).multiply(twist).normalize();
 };
}
