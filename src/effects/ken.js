import * as THREE from 'three';
import { isMobile, fontBold, disposeScene } from './shared.js';
import { createLetterAssets } from './ken-shapes.js';
import { createPhysics, STEP } from './ken-physics.js';
import { createKenMaterial } from './ken-material.js';
export function createKen(cell) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'default'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.1;
  renderer.setClearColor('#deefff',0);
  cell.appendChild(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(40,1,.1,50);
  camera.position.z=5.2;
  const material=createKenMaterial();
  const assets=createLetterAssets(fontBold);
  const count=isMobile()?18:36;
  const meshes=assets.map(asset=>{
    asset.geometry.setAttribute('nearA',new THREE.InstancedBufferAttribute(new Float32Array(count/3*4),4).setUsage(THREE.DynamicDrawUsage));
    asset.geometry.setAttribute('nearB',new THREE.InstancedBufferAttribute(new Float32Array(count/3*4),4).setUsage(THREE.DynamicDrawUsage));
    const mesh=new THREE.InstancedMesh(asset.geometry,material,count/3);
    for(let i=0;i<count/3;i++)mesh.setColorAt(i,new THREE.Color(['#146ef5','#024b9e','#4289e8'][i%3]));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;scene.add(mesh);return mesh;
  });
  const interaction=cell.closest('.contact-play')||cell;
  const pointer=new THREE.Vector3(),targetPointer=new THREE.Vector3(),ndc=new THREE.Vector2();
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),currentRotation=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),matrix=new THREE.Matrix4();
  const previousPositions=Array.from({length:count},()=>new THREE.Vector3());
  const previousRotations=Array.from({length:count},()=>new THREE.Quaternion());
  const simulation=createPhysics(assets,count);
  const renderedPositions=Array.from({length:count},()=>new THREE.Vector3());
  let disposed=false,hovered=false,lastTime=null,accumulator=0,activeTouch=null;
  let rect, width=0,height=0,needsRedraw=true,wasSleeping=false;
  const handleMove=event=>{
    if(event.pointerType==='touch' && event.pointerId!==activeTouch)return;
    rect=cell.getBoundingClientRect();
    ndc.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    targetPointer.set(ndc.x,ndc.y,.5).unproject(camera).sub(camera.position);
    targetPointer.multiplyScalar(-camera.position.z/targetPointer.z).add(camera.position);
    if(!hovered)pointer.copy(targetPointer);
    hovered=true;
  };
  const leave=()=>{
    hovered=false;
    if(activeTouch!==null && interaction.hasPointerCapture(activeTouch))interaction.releasePointerCapture(activeTouch);
    activeTouch=null;
  };
  const down=event=>{
    if(event.target.closest('a,button') || event.pointerType!=='touch' || activeTouch!==null)return;
    activeTouch=event.pointerId;interaction.setPointerCapture(activeTouch);handleMove(event);
  };
  const touchMove=event=>{if(activeTouch!==null && event.touches.length===1)event.preventDefault();};
  interaction.addEventListener('touchmove',touchMove,{passive:false});
  const up=event=>{if(event.pointerId===activeTouch)leave();};
  const pointerLeave=()=>{if(activeTouch===null)leave();};
  interaction.addEventListener('pointerdown',down);
  interaction.addEventListener('pointerup',up);
  interaction.addEventListener('lostpointercapture',leave);
  interaction.addEventListener('pointermove',handleMove,{passive:true});
  interaction.addEventListener('pointerleave',pointerLeave);
  interaction.addEventListener('pointercancel',leave);
  window.addEventListener('blur',leave);
  const copyPrevious=()=>simulation.bodies.forEach((body,i)=>{
    previousPositions[i].copy(body.position);previousRotations[i].copy(body.quaternion);
  });
  function draw(alpha=1){
    if(!simulation)return;
    simulation.bodies.forEach((body,i)=>{
      position.copy(body.position).lerp(previousPositions[i],1-alpha);
      currentRotation.copy(body.quaternion);
      rotation.copy(previousRotations[i]).slerp(currentRotation,alpha);
      renderedPositions[i].copy(position);
      matrix.compose(position,rotation,scale);meshes[i%3].setMatrixAt(Math.floor(i/3),matrix);
    });
    for(let i=0;i<count;i++){
      const p=renderedPositions[i];
      let nearest=-1,next=-1,d1=Infinity,d2=Infinity;
      for(let j=0;j<count;j++){
        if(i===j)continue;
        const distance=p.distanceToSquared(renderedPositions[j]);
        if(distance<d1){next=nearest;d2=d1;nearest=j;d1=distance;}
        else if(distance<d2){next=j;d2=distance;}
      }
      for(const [name,index] of [['nearA',nearest],['nearB',next]]){
        const n=renderedPositions[index];
        meshes[i%3].geometry.getAttribute(name).setXYZW(Math.floor(i/3),n.x,n.y,n.z,simulation.bodies[index].radius*.85);
      }
    }
    meshes.forEach(mesh=>{
      mesh.instanceMatrix.needsUpdate=true;
      mesh.geometry.getAttribute('nearA').needsUpdate=true;mesh.geometry.getAttribute('nearB').needsUpdate=true;
    });
    renderer.render(scene,camera);
  }
  copyPrevious();
  return {
    isInteracting:()=>activeTouch!==null,
    resize(w,h){
      if(w===width&&h===height)return;
      width=w;height=h;needsRedraw=true;renderer.setSize(w,h,false);camera.aspect=w/h;
      camera.position.z=Math.max(5.2,5.2/camera.aspect);
      camera.updateProjectionMatrix();camera.updateMatrixWorld();pointer.cameraZ=camera.position.z;leave();
    },
    tick(time){
      if(disposed||!simulation)return;
      const dt=lastTime===null?0:Math.min(.05,Math.max(0,time-lastTime));lastTime=time;
      pointer.lerp(targetPointer,1-Math.exp(-dt*35));
      accumulator+=dt;
      while(accumulator>=STEP){copyPrevious();simulation.step(hovered?pointer:null);accumulator-=STEP;}
      if(!simulation.sleeping || !wasSleeping || needsRedraw)draw(simulation.sleeping?1:accumulator/STEP);
      wasSleeping=simulation.sleeping;needsRedraw=false;
    },
    debug(){return {drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,bodies:count,colliders:count,contacts:simulation.contactCount,sleeping:simulation.sleeping};},
    dispose(){
      disposed=true;interaction.removeEventListener('touchmove',touchMove);interaction.removeEventListener('pointermove',handleMove);interaction.removeEventListener('pointerleave',pointerLeave);interaction.removeEventListener('pointerdown',down);interaction.removeEventListener('pointerup',up);interaction.removeEventListener('lostpointercapture',leave);interaction.removeEventListener('pointercancel',leave);window.removeEventListener('blur',leave);
      meshes.forEach(mesh=>mesh.dispose());disposeScene(scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
    }
  };
}
