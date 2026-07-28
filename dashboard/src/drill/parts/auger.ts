// Auger: a helical ribbon flight on a shaft. The flight has two radii and a
// real thickness, so it is swept as a four-sided section rather than as a tube.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  SCREW,
  SCREW_FLIGHT_INNER_R,
  SCREW_FLIGHT_OUTER_R,
  SCREW_FLIGHT_THICKNESS,
  SCREW_SHAFT_R,
  SCREW_TURNS,
} from '../geometry';

const SEGMENTS_PER_TURN = 48;
const HALF_T = SCREW_FLIGHT_THICKNESS / 2;

/** The four section corners of the flight at parameter t, tip to top. */
export function flightRing(t: number): Array<[number, number, number]> {
  const a = t * SCREW_TURNS * Math.PI * 2;
  const y = -SCREW.h / 2 + t * SCREW.h;
  const dx = Math.cos(a);
  const dz = -Math.sin(a);
  const ri = SCREW_FLIGHT_INNER_R;
  const ro = SCREW_FLIGHT_OUTER_R;
  return [
    [ri * dx, y - HALF_T, ri * dz],
    [ro * dx, y - HALF_T, ro * dz],
    [ro * dx, y + HALF_T, ro * dz],
    [ri * dx, y + HALF_T, ri * dz],
  ];
}

let cached: THREE.BufferGeometry | null = null;

export function augerGeometry(): THREE.BufferGeometry {
  if (cached) return cached;

  const steps = Math.round(SCREW_TURNS * SEGMENTS_PER_TURN);
  const position: number[] = [];
  const index: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    for (const [x, y, z] of flightRing(i / steps)) position.push(x, y, z);
  }
  for (let i = 0; i < steps; i += 1) {
    const a = i * 4;
    const b = (i + 1) * 4;
    for (let k = 0; k < 4; k += 1) {
      const k2 = (k + 1) % 4;
      index.push(a + k, b + k, b + k2, a + k, b + k2, a + k2);
    }
  }

  const flight = new THREE.BufferGeometry();
  flight.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  flight.setIndex(index);

  const shaft = new THREE.CylinderGeometry(SCREW_SHAFT_R, SCREW_SHAFT_R, SCREW.h, 16);
  // mergeGeometries needs one attribute set across inputs; the swept flight
  // carries positions only, and normals are recomputed after the merge.
  shaft.deleteAttribute('normal');
  shaft.deleteAttribute('uv');

  cached = mergeGeometries([flight, shaft], false)!;
  cached.computeVertexNormals();
  flight.dispose();
  shaft.dispose();
  return cached;
}
