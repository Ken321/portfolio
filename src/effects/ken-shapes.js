import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
export function createLetterAssets(font) {
  return [...'ken'].map(ch => {
    const geometry = new TextGeometry(ch, {
      font, size: 1.26, depth: .45, curveSegments: 12,
      bevelEnabled: true, bevelThickness: .09, bevelSize: .065, bevelSegments: 4,
    });
    geometry.center();
    geometry.computeBoundingSphere();
    // One conservative sphere covers every vertex, including rounded corners.
    const radius = geometry.boundingSphere.radius + .025;
    return { geometry, radius, center: geometry.boundingSphere.center.clone() };
  });
}
