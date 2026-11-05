import { Vector3 } from 'three';

// Conservative raster cover of the projected rendered triangles, merged into boxes.
// Empty cells stay empty: the open sides and thin stem do not become a convex hull.
export function createGlyphBoxes(geometry, cellSize = .055) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const nx = Math.ceil((max.x - min.x) / cellSize), ny = Math.ceil((max.y - min.y) / cellSize);
  const dx = (max.x - min.x) / nx, dy = (max.y - min.y) / ny;
  const filled = new Uint8Array(nx * ny), p = geometry.getAttribute('position');
  const index = geometry.index;
  const total = index ? index.count : p.count;
  for (let i = 0; i < total; i += 3) {
    const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
    const xs = ids.map(j => p.getX(j)), ys = ids.map(j => p.getY(j));
    const x0 = Math.max(0, Math.floor((Math.min(...xs) - min.x) / dx));
    const x1 = Math.min(nx - 1, Math.floor((Math.max(...xs) - min.x) / dx));
    const y0 = Math.max(0, Math.floor((Math.min(...ys) - min.y) / dy));
    const y1 = Math.min(ny - 1, Math.floor((Math.max(...ys) - min.y) / dy));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (filled[y * nx + x]) continue;
      const cx = min.x + (x + .5) * dx, cy = min.y + (y + .5) * dy;
      let separated = false;
      for (let e = 0; e < 3; e++) {
        const next = (e + 1) % 3, ax = ys[next] - ys[e], ay = xs[e] - xs[next];
        const dots = xs.map((v, k) => (v - cx) * ax + (ys[k] - cy) * ay);
        const r = Math.abs(ax) * dx / 2 + Math.abs(ay) * dy / 2;
        if (Math.min(...dots) > r + 1e-8 || Math.max(...dots) < -r - 1e-8) { separated = true; break; }
      }
      if (!separated) filled[y * nx + x] = 1;
    }
  }
  const boxes = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!filled[y * nx + x]) continue;
    let w = 1, h = 1;
    while (x + w < nx && filled[y * nx + x + w]) w++;
    outer: while (y + h < ny) {
      for (let j = 0; j < w; j++) if (!filled[(y + h) * nx + x + j]) break outer;
      h++;
    }
    for (let j = 0; j < h; j++) filled.fill(0, (y + j) * nx + x, (y + j) * nx + x + w);
    boxes.push({
      center: new Vector3(min.x + (x + w / 2) * dx, min.y + (y + h / 2) * dy, (min.z + max.z) / 2),
      half: new Vector3(w * dx / 2 + .003, h * dy / 2 + .003, (max.z - min.z) / 2 + .003),
    });
  }
  return boxes;
}

export function createCollider(asset) {
  const boxes = asset.boxes || [{ center: new Vector3(), half: new Vector3().setScalar(asset.radius / Math.sqrt(3)) }];
  return {
    axes: [new Vector3(), new Vector3(), new Vector3()],
    pieces: boxes.map(box => ({ half: box.half, center: box.center, offset: new Vector3(), extent: new Vector3() })),
  };
}

export function updateCollider(body) {
  const { axes, pieces } = body.collider;
  axes[0].set(1, 0, 0).applyQuaternion(body.quaternion);
  axes[1].set(0, 1, 0).applyQuaternion(body.quaternion);
  axes[2].set(0, 0, 1).applyQuaternion(body.quaternion);
  for (const piece of pieces) {
    piece.offset.copy(piece.center).applyQuaternion(body.quaternion);
    const h = piece.half;
    piece.extent.set(
      Math.abs(axes[0].x) * h.x + Math.abs(axes[1].x) * h.y + Math.abs(axes[2].x) * h.z,
      Math.abs(axes[0].y) * h.x + Math.abs(axes[1].y) * h.y + Math.abs(axes[2].y) * h.z,
      Math.abs(axes[0].z) * h.x + Math.abs(axes[1].z) * h.y + Math.abs(axes[2].z) * h.z,
    );
  }
}

// All pieces of a glyph share an orientation. Prepare the 15 OBB separating axes
// once for a body pair, then reject most piece pairs with cheap world AABBs.
const separating = Array.from({ length: 15 }, () => new Vector3());
const projection = new Float64Array(15 * 6);
export function glyphContact(a, b, out) {
  out.depth = 0;
  const px = b.position.x - a.position.x, py = b.position.y - a.position.y, pz = b.position.z - a.position.z;
  if (px * px + py * py + pz * pz >= (a.radius + b.radius) ** 2) return false;
  const aa = a.collider.axes, ba = b.collider.axes;
  let n = 0;
  for (const axis of [...aa, ...ba]) separating[n++].copy(axis);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    separating[n].crossVectors(aa[i], ba[j]);
    if (separating[n].lengthSq() > 1e-10) separating[n++].normalize();
  }
  for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) {
    projection[k * 6 + j] = Math.abs(separating[k].dot(aa[j]));
    projection[k * 6 + 3 + j] = Math.abs(separating[k].dot(ba[j]));
  }
  for (const ac of a.collider.pieces) for (const bc of b.collider.pieces) {
    const dx = px + bc.offset.x - ac.offset.x, dy = py + bc.offset.y - ac.offset.y, dz = pz + bc.offset.z - ac.offset.z;
    if (Math.abs(dx) >= ac.extent.x + bc.extent.x || Math.abs(dy) >= ac.extent.y + bc.extent.y || Math.abs(dz) >= ac.extent.z + bc.extent.z) continue;
    let depth = Infinity, closest = -1, sign = 1;
    const ah = ac.half, bh = bc.half;
    for (let k = 0; k < n; k++) {
      const axis = separating[k], t = k * 6;
      const d = dx * axis.x + dy * axis.y + dz * axis.z;
      const limit = projection[t] * ah.x + projection[t + 1] * ah.y + projection[t + 2] * ah.z
        + projection[t + 3] * bh.x + projection[t + 4] * bh.y + projection[t + 5] * bh.z;
      const overlap = limit - Math.abs(d);
      if (overlap <= 0) { depth = 0; break; }
      if (overlap < depth) { depth = overlap; closest = k; sign = d < 0 ? -1 : 1; }
    }
    if (depth > out.depth) {
      out.depth = depth;
      out.normal.copy(separating[closest]).multiplyScalar(sign);
    }
  }
  return out.depth > 0;
}
