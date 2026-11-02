import * as THREE from 'three';
import { createMixamoMotion, loadAvatarClips } from './avatar-mixamo-motion.js';
import { readSpeechLevel } from '../voice-motion.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isMobile, pixelRatio, disposeScene } from './shared.js';
export async function createAvatar(cell) {
  const [gltf, clips] = await Promise.all([new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('./assets/avatar-pants-fixed.glb?v=1'),loadAvatarClips()]);
  const scene = new THREE.Scene();
  // White eyes stay neutral regardless of lighting, tone mapping, or the page color.
  gltf.scene.traverse(mesh=>{
    if(mesh.material?.name==='Eye 3'){
      mesh.material.color.setRGB(1,1,1);
      mesh.material.transparent=false;mesh.material.opacity=1;mesh.material.toneMapped=false;
    }
  });
  scene.add(gltf.scene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d4e3, 2.0));
  scene.add(new THREE.AmbientLight(0xffffff, .35));
  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(2, 3, 4); scene.add(light);
  const fill = new THREE.DirectionalLight(0xffffff, .4);
  fill.position.set(-2, 1, 3); scene.add(fill);
  // Preserve the waist-up framing with a distant, narrow-angle camera.
  // Less perspective magnification keeps the head from swelling during a bow.
  const camera = new THREE.PerspectiveCamera(10, 1, .1, 100);
  const cameraDistanceRatio=Math.tan(THREE.MathUtils.degToRad(15))/Math.tan(THREE.MathUtils.degToRad(5));
  camera.position.set(0, 1.43+.07*cameraDistanceRatio, 1.85*cameraDistanceRatio); camera.lookAt(0, 1.43, 0);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: !isMobile(), alpha: true }); }
  catch (error) { disposeScene(scene); throw error; }
  renderer.setPixelRatio(pixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Let the actual page background show through; do not bake its color into the canvas.
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.touchAction = 'pan-y';
  cell.append(renderer.domElement);
  const motion = createMixamoMotion(gltf.scene,clips);

  const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster();
  const gazePlane=new THREE.Plane(new THREE.Vector3(0,0,1),-1);
  const gazePoint=new THREE.Vector3();
  const catchPlane=new THREE.Plane(new THREE.Vector3(0,0,1),-.42),catchPoint=new THREE.Vector3();
  const catchClick=event=>{
    const rect=cell.getBoundingClientRect();if(!rect.width || !rect.height)return;
    const click=new THREE.Vector2(event.detail===0?0:(event.clientX-rect.left)/rect.width*2-1,event.detail===0?0:1-(event.clientY-rect.top)/rect.height*2);
    camera.updateMatrixWorld();raycaster.setFromCamera(click,camera);
    if(raycaster.ray.intersectPlane(catchPlane,catchPoint))motion.catchAt(catchPoint);
  };
  cell.addEventListener('click',catchClick);
  let pointerActive=false;
  const trackPointer=event=>{
    if(event.pointerType==='touch')return;
    const rect=cell.getBoundingClientRect();
    if(!rect.width || !rect.height)return;
    pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    pointerActive=true;
  };
  const clearPointer=()=>{pointerActive=false;motion.setLookTarget(null);};
  cell.addEventListener('pointermove',trackPointer,{passive:true});
  cell.addEventListener('pointerleave',clearPointer);
  cell.addEventListener('pointercancel',clearPointer);
  window.addEventListener('blur',clearPointer);
  let lastTime = null;
  return {
    resize(width, height) {
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix();
    },
    tick(time) {
      const dt = lastTime === null ? 0 : Math.min(.05, Math.max(0, time - lastTime));
      lastTime = time;
      const mode = cell.dataset.voiceState || 'idle';
      const level = readSpeechLevel(cell, dt);
      if(pointerActive){
        camera.updateMatrixWorld();raycaster.setFromCamera(pointer,camera);
        if(raycaster.ray.intersectPlane(gazePlane,gazePoint))motion.setLookTarget(gazePoint);
      }
      motion.tick(time, dt, mode, level);
      renderer.render(scene, camera);
    },
    debug() { return motion.debug(); },
    dispose() {
      cell.removeEventListener('click',catchClick);
      cell.removeEventListener('pointermove',trackPointer);
      cell.removeEventListener('pointerleave',clearPointer);
      cell.removeEventListener('pointercancel',clearPointer);
      window.removeEventListener('blur',clearPointer);
      motion.dispose();
      disposeScene(scene); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
  };
}
