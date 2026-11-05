import * as THREE from 'three';

// Conservative rig limits, not medical ranges. Angles are relative to bind pose.
export const ARM_LIMITS=Object.freeze({elbowMin:5,elbowMax:145,forearmTwist:100,wristSwing:60,wristTwist:35,catchShoulderMin:12});
const radians=THREE.MathUtils.degToRad;
const catchAxis=new THREE.Vector3(),catchCenter=new THREE.Vector3(),catchOutside=new THREE.Vector3(),catchTangent=new THREE.Vector3(),catchDirection=new THREE.Vector3();

// Keep the upper arm at least 12 degrees away from the side of the torso.
// The lateral axis follows the chest, so a body turn cannot undo the clearance.
// The elbow lies on the two-bone IK circle; rotate its pole toward the outside
// only as far as necessary, preserving both segment lengths and the palm goal.
export function keepElbowOutside(elbow,wrist,shoulder,lateral,upperLength,lowerLength){
 const axis=catchAxis.copy(wrist).sub(shoulder);
 const distance=Math.max(axis.length(),1e-8);axis.multiplyScalar(1/distance);
 const along=(upperLength**2-lowerLength**2+distance**2)/(2*distance);
 const radius=Math.sqrt(Math.max(0,upperLength**2-along**2));
 const center=catchCenter.copy(shoulder).addScaledVector(axis,along);
 const outside=catchOutside.copy(lateral).addScaledVector(axis,-lateral.dot(axis));
 const extent=outside.length();
 const angle=radians(ARM_LIMITS.catchShoulderMin),minimum=upperLength*Math.sin(angle);
 if(catchDirection.copy(elbow).sub(shoulder).dot(lateral)>=minimum)return;
 if(extent>1e-6){
  outside.multiplyScalar(1/extent);
  const needed=(minimum-along*axis.dot(lateral))/(Math.max(radius,1e-8)*extent);
  if(needed<=1){
   const tangent=catchTangent.copy(elbow).sub(center);tangent.addScaledVector(outside,-tangent.dot(outside));
   if(tangent.lengthSq()<1e-10)tangent.crossVectors(axis,outside);
   elbow.copy(center).addScaledVector(outside,radius*THREE.MathUtils.clamp(needed,-1,1)).addScaledVector(tangent.normalize(),radius*Math.sqrt(Math.max(0,1-needed**2)));
   return;
  }
  elbow.copy(center).addScaledVector(outside,radius);
 }
 // A click across the body can be unreachable with the safe shoulder angle.
 // Prefer a nearby reachable palm goal to driving the upper arm into the ribs.
 const direction=catchDirection.copy(elbow).sub(shoulder).normalize();
 direction.addScaledVector(lateral,-direction.dot(lateral));if(direction.lengthSq()<1e-10)direction.copy(axis).addScaledVector(lateral,-axis.dot(lateral));
 if(direction.lengthSq()<1e-10)direction.set(0,-1,0);
 direction.normalize().multiplyScalar(Math.cos(angle)).addScaledVector(lateral,Math.sin(angle));
 elbow.copy(shoulder).addScaledVector(direction,upperLength);
 wrist.sub(elbow).normalize().multiplyScalar(lowerLength).add(elbow);
}

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
