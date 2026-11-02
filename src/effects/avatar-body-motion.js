import * as THREE from 'three';

// Separate preparation, support, and recovery rather than oscillating the whole body.
function curve(time, keys) {
  if(time<0 || time>=keys.at(-1)[0])return 0;
  for(let i=1;i<keys.length;i++)if(time<=keys[i][0]){
    const [start,a]=keys[i-1],[end,b]=keys[i];
    const t=(time-start)/(end-start),ease=t*t*t*(t*(t*6-15)+10);
    return THREE.MathUtils.lerp(a,b,ease);
  }
  return 0;
}
const SUPPORT=[[0,0],[.65,1],[1.8,.8],[3,1],[4.25,.4],[5.5,0]];
const TURN=[[0,0],[.4,-.18],[1.15,1],[2.6,.85],[3.55,.6],[5.25,0]];
const NOD=[[0,0],[.85,0],[1.3,1],[1.85,0],[4.3,.35],[5.25,0]];
export function createBodyMotion(root) {
  const find=name=>root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  root.updateMatrixWorld(true);
  const hips=find('DEF-spine');
  const hipPosition=hips.position.clone(),hipRotation=hips.quaternion.clone();
  const hipWorld=hips.getWorldPosition(new THREE.Vector3());
  const legs=['L','R'].map(side=>{
    const upper=find(`DEF-thigh.${side}`),lower=find(`DEF-shin.${side}`),foot=find(`DEF-foot.${side}`);
    const hip=upper.getWorldPosition(new THREE.Vector3()),knee=lower.getWorldPosition(new THREE.Vector3()),ankle=foot.getWorldPosition(new THREE.Vector3());
    return {upper,lower,foot,anchor:ankle,upperLength:hip.distanceTo(knee),lowerLength:knee.distanceTo(ankle),rest:new Map([upper,lower,foot].map(b=>[b,{local:b.quaternion.clone(),world:b.getWorldQuaternion(new THREE.Quaternion())}]))};
  });
  const offset=new THREE.Vector3(),targetOffset=new THREE.Vector3(),targetPosition=new THREE.Vector3();
  const hipTarget=new THREE.Quaternion(),euler=new THREE.Euler();
  const hip=new THREE.Vector3(),axis=new THREE.Vector3(),pole=new THREE.Vector3(),knee=new THREE.Vector3(),direction=new THREE.Vector3(),restAxis=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  const q=new THREE.Quaternion(),parentQ=new THREE.Quaternion();
  function aim(bone,worldDirection,reference){
    bone.parent.updateWorldMatrix(true,false);
    restAxis.copy(up).applyQuaternion(reference.world);
    q.setFromUnitVectors(restAxis,worldDirection.normalize()).multiply(reference.world);
    parentQ.copy(bone.parent.getWorldQuaternion(parentQ)).invert();bone.quaternion.copy(parentQ.multiply(q));
  }
  return {
    update(waveTime,dt,impulse=null){
      const support=curve(waveTime,SUPPORT),turn=curve(waveTime,TURN),nod=curve(waveTime,NOD);
      const blend=1-Math.exp(-8*Math.max(0,dt));
      targetOffset.set(.022*support,-.0045*support,0);if(impulse)targetOffset.add(impulse);offset.lerp(targetOffset,blend);
      hips.parent.updateWorldMatrix(true,false);
      targetPosition.copy(hipWorld).add(offset);hips.parent.worldToLocal(targetPosition);hips.position.copy(targetPosition);
      euler.set(.006*support,-.022*turn,-.018*support);
      hipTarget.setFromEuler(euler).premultiply(hipRotation);hips.quaternion.slerp(hipTarget,blend);
      for(const leg of legs)for(const [bone,rest]of leg.rest)bone.quaternion.copy(rest.local);
      return {support,turn,nod};
    },
    plantFeet(){
      for(const leg of legs){
        leg.upper.updateWorldMatrix(true,false);leg.upper.getWorldPosition(hip);
        axis.copy(leg.anchor).sub(hip);
        const distance=THREE.MathUtils.clamp(axis.length(),.01,leg.upperLength+leg.lowerLength-.00001);axis.normalize();
        pole.set(0,0,1).addScaledVector(axis,-axis.z).normalize();
        const along=(leg.upperLength**2-leg.lowerLength**2+distance**2)/(2*distance);
        knee.copy(hip).addScaledVector(axis,along).addScaledVector(pole,Math.sqrt(Math.max(0,leg.upperLength**2-along**2)));
        direction.copy(knee).sub(hip);aim(leg.upper,direction,leg.rest.get(leg.upper));
        leg.lower.updateWorldMatrix(true,false);leg.lower.getWorldPosition(knee);
        direction.copy(leg.anchor).sub(knee);aim(leg.lower,direction,leg.rest.get(leg.lower));
        leg.foot.parent.updateWorldMatrix(true,false);parentQ.copy(leg.foot.parent.getWorldQuaternion(parentQ)).invert();
        leg.foot.quaternion.copy(parentQ.multiply(leg.rest.get(leg.foot).world));
      }
    },
    dispose(){hips.position.copy(hipPosition);hips.quaternion.copy(hipRotation);for(const leg of legs)for(const [bone,rest]of leg.rest)bone.quaternion.copy(rest.local);}
  };
}
