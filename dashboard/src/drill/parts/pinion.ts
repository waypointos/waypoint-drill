// Lift pinion. Teeth are drawn as trapezoids on the measured root and tip
// circles; involute flanks would not read at this scale. Built lying in XY with
// its bore on the Z axis, so the scene rotates it onto the radial axis.
import * as THREE from 'three';
import { PINION } from '../geometry';

const TOOTH_FRACTION = 0.42;

/** Root and tip corners for every tooth, counter-clockwise in the XY plane. */
export function toothShapePoints(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const step = (Math.PI * 2) / PINION.teeth;
  const half = (step * TOOTH_FRACTION) / 2;
  for (let i = 0; i < PINION.teeth; i += 1) {
    const c = i * step;
    for (const [r, a] of [
      [PINION.rootR, c - step / 2 + half],
      [PINION.tipR, c - half],
      [PINION.tipR, c + half],
      [PINION.rootR, c + step / 2 - half],
    ] as const) {
      out.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  return out;
}

let cached: THREE.BufferGeometry | null = null;

export function pinionGeometry(): THREE.BufferGeometry {
  if (cached) return cached;

  const shape = new THREE.Shape();
  const pts = toothShapePoints();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
  shape.closePath();

  const bore = new THREE.Path();
  bore.absarc(0, 0, PINION.boreR, 0, Math.PI * 2, true);
  shape.holes.push(bore);

  cached = new THREE.ExtrudeGeometry(shape, {
    depth: PINION.thickness,
    bevelEnabled: false,
    curveSegments: 12,
  });
  cached.translate(0, 0, -PINION.thickness / 2);
  cached.computeVertexNormals();
  return cached;
}
