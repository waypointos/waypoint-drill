// Core column: a plain tube with annular ring teeth over four sectors. The
// teeth are rings rather than a thread, which is what lets the lift pinion stay
// meshed at any core rotation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CORE,
  CORE_TOOTH_CREST_R,
  CORE_TOOTH_LAND,
  CORE_TOOTH_PITCH,
  CORE_TOOTH_SECTORS,
} from '../geometry';
import { sectorLathe } from './shapes';

/** Saw-tooth (radius, y) polyline over `height`, starting at y = 0. */
export function toothProfile(height: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const count = Math.floor(height / CORE_TOOTH_PITCH);
  for (let i = 0; i < count; i += 1) {
    const base = i * CORE_TOOTH_PITCH;
    out.push([CORE.r, base]);
    out.push([CORE_TOOTH_CREST_R, base]);
    out.push([CORE_TOOTH_CREST_R, base + CORE_TOOTH_LAND]);
    out.push([CORE.r, base + CORE_TOOTH_LAND]);
  }
  out.push([CORE.r, height]);
  return out;
}

const SECTOR_SEGMENTS = 14;

let cached: THREE.BufferGeometry | null = null;

export function coreGeometry(): THREE.BufferGeometry {
  if (cached) return cached;

  const parts: THREE.BufferGeometry[] = [];

  const tube = new THREE.CylinderGeometry(CORE.r, CORE.r, CORE.h, 48, 1, true);
  parts.push(tube);

  const profile = toothProfile(CORE.h);
  for (const sector of CORE_TOOTH_SECTORS) {
    const g = sectorLathe(profile, sector.fromDeg, sector.toDeg, SECTOR_SEGMENTS);
    g.translate(0, -CORE.h / 2, 0);
    parts.push(g);
  }

  cached = mergeGeometries(parts, false)!;
  cached.computeVertexNormals();
  parts.forEach((p) => p.dispose());
  return cached;
}
