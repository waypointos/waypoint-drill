// Base plate: a bored annular body with a raised rim ring. The mounting lugs
// and the washer are omitted because both sit inside the hopper mating face
// where nothing can see them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BASE_PLATE, BASE_PLATE_RIM } from '../geometry';
import { arcSolid } from './shapes';

let cached: THREE.BufferGeometry | null = null;

export function basePlateGeometry(): THREE.BufferGeometry {
  if (cached) return cached;

  const body = arcSolid(
    BASE_PLATE.boreR, BASE_PLATE.outerR, BASE_PLATE.y1 - BASE_PLATE.y0, 0, 360,
  );
  body.translate(0, BASE_PLATE.y0, 0);

  const rim = arcSolid(
    BASE_PLATE_RIM.innerR, BASE_PLATE_RIM.outerR, BASE_PLATE_RIM.y1 - BASE_PLATE_RIM.y0, 0, 360,
  );
  rim.translate(0, BASE_PLATE_RIM.y0, 0);

  cached = mergeGeometries([body, rim], false)!;
  cached.computeVertexNormals();
  body.dispose();
  rim.dispose();
  return cached;
}
