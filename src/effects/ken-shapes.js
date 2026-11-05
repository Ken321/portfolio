import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { createGlyphBoxes } from './ken-colliders.js';
export function createLetterAssets(font) {
  return [...'321'].map(ch => {
    const geometry = new TextGeometry(ch, {
      // Full-height numerals need a smaller size to keep the original cluster density.
      font, size: 1.1, depth: .45, curveSegments: 12,
      bevelEnabled: true, bevelThickness: .09, bevelSize: .065, bevelSegments: 4,
    });
    geometry.center();
    geometry.computeBoundingSphere();
    const boxes = createGlyphBoxes(geometry);
    // The sphere is broad-phase only; contact uses the rotated contour boxes.
    const radius = Math.max(...boxes.map(box => Math.hypot(Math.abs(box.center.x) + box.half.x, Math.abs(box.center.y) + box.half.y, Math.abs(box.center.z) + box.half.z)));
    return { geometry, boxes, radius, center: geometry.boundingSphere.center.clone() };
  });
}
