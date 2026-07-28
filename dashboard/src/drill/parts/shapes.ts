// Solid primitives every drill part is built from. Extrusion runs along +Z and
// is rotated upright, which is what fixes the CAD azimuth convention in
// frame.ts; building sectors any other way puts features on the wrong side.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lathePhi } from './frame';

const ARC_SEGMENTS_PER_DEG = 1 / 6;

/** Weld tolerance in meters, well under the 1 mm smallest measured feature. */
const WELD_TOLERANCE = 1e-6;

/** Solid annular sector from y=0 to y=height, spanning a CAD azimuth range. */
export function arcSolid(
  innerR: number,
  outerR: number,
  height: number,
  fromDeg: number,
  toDeg: number,
  segments?: number,
): THREE.BufferGeometry {
  const a0 = THREE.MathUtils.degToRad(fromDeg);
  const a1 = THREE.MathUtils.degToRad(toDeg);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, a0, a1, false);
  shape.absarc(0, 0, innerR, a1, a0, true);
  shape.closePath();

  const curveSegments = segments
    ?? Math.max(6, Math.ceil((toDeg - fromDeg) * ARC_SEGMENTS_PER_DEG));
  const extruded = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments,
  });
  // ExtrudeGeometry is non-indexed; index it so merges with lathed and
  // cylindrical parts stay index-compatible.
  const g = mergeVertices(extruded, WELD_TOLERANCE);
  extruded.dispose();
  // +Z extrusion becomes +Y; the shape's +Y becomes -Z, which is the CAD
  // azimuth convention cadDir encodes.
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Revolve a (radius, y) polyline through a CAD azimuth range. */
export function sectorLathe(
  profile: Array<[number, number]>,
  fromDeg: number,
  toDeg: number,
  segments = 16,
): THREE.BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(
    points,
    segments,
    lathePhi(fromDeg),
    THREE.MathUtils.degToRad(toDeg - fromDeg),
  );
}
