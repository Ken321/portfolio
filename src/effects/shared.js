import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import bold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import regular from 'three/examples/fonts/helvetiker_regular.typeface.json';
export const fontBold = new FontLoader().parse(bold);
export const fontRegular = new FontLoader().parse(regular);
const mobile = matchMedia('(max-width: 900px), (pointer: coarse)');
const hover = matchMedia('(hover: hover) and (pointer: fine)');
export const isMobile = () => mobile.matches;
export const pixelRatio = () => Math.min(devicePixelRatio || 1, isMobile() ? 1 : 1.5);
export const globalPointer = { active: false, nx: 0, ny: 0, cell: null };
window.addEventListener('pointermove', event => {
  if (!hover.matches || event.pointerType === 'touch') return;
  globalPointer.active = true;
  globalPointer.nx = Math.max(-1, Math.min(1, event.clientX / innerWidth * 2 - 1));
  globalPointer.ny = Math.max(-1, Math.min(1, event.clientY / innerHeight * 2 - 1));
  globalPointer.cell = event.target.closest('[data-effect]');
}, { passive: true });
const reset = () => { globalPointer.active = false; globalPointer.cell = null; };
window.addEventListener('blur', reset);
window.addEventListener('pointerout', event => { if (!event.relatedTarget) reset(); }, { passive: true });
export function disposeScene(scene) {
  const disposed = new Set();
  const free = value => { if (value?.dispose && !disposed.has(value)) { disposed.add(value); value.dispose(); } };
  scene.traverse(object => {
    free(object.geometry);
    for (const material of [object.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) free(value);
      for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) free(uniform.value);
      free(material);
    }
    if (object.skeleton) free(object.skeleton);
  });
}
