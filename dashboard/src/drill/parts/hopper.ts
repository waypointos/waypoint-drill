// Sample hopper: a conical throat the auger passes through, ringed by three
// bins across a 239 deg arc. The open sector clears the lift servo. The drill
// column seats on the top face of this assembly.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HOPPER, HOPPER_DIVIDERS_DEG, HOPPER_DIVIDER_WIDTH_DEG } from '../geometry';
import { arcSolid, sectorLathe } from './shapes';

const FLOOR_THICKNESS = 0.003;

/** The three bin spans, in CAD azimuth degrees across the 360 wrap. */
export function binSpans(): Array<{ fromDeg: number; toDeg: number }> {
  const cuts = HOPPER_DIVIDERS_DEG.map((d) => {
    const rel = ((d - HOPPER.arcFromDeg) % 360 + 360) % 360;
    return HOPPER.arcFromDeg + rel;
  }).sort((a, b) => a - b);

  const edges = [HOPPER.arcFromDeg, ...cuts, HOPPER.arcToDeg];
  return edges.slice(0, -1).map((fromDeg, i) => ({ fromDeg, toDeg: edges[i + 1] }));
}

let cached: THREE.BufferGeometry | null = null;

export function hopperGeometry(): THREE.BufferGeometry {
  if (cached) return cached;

  const height = HOPPER.y1 - HOPPER.y0;
  const parts: THREE.BufferGeometry[] = [];

  // Conical throat, wide at the bottom and narrowing to the base plate bore.
  parts.push(sectorLathe(
    [[HOPPER.coneBottomR, HOPPER.y0], [HOPPER.throatR, HOPPER.y1]],
    0, 360, 48,
  ));

  const floor = arcSolid(
    HOPPER.coneBottomR, HOPPER.outerR, FLOOR_THICKNESS,
    HOPPER.arcFromDeg, HOPPER.arcToDeg,
  );
  floor.translate(0, HOPPER.y0, 0);
  parts.push(floor);

  const wall = arcSolid(
    HOPPER.outerR - HOPPER.wallThickness, HOPPER.outerR, height,
    HOPPER.arcFromDeg, HOPPER.arcToDeg,
  );
  wall.translate(0, HOPPER.y0, 0);
  parts.push(wall);

  // Radial dividers plus the two arc end walls, all the same section.
  const radials = [HOPPER.arcFromDeg, ...HOPPER_DIVIDERS_DEG, HOPPER.arcToDeg];
  for (const deg of radials) {
    const g = arcSolid(
      HOPPER.coneBottomR, HOPPER.outerR, height,
      deg - HOPPER_DIVIDER_WIDTH_DEG / 2, deg + HOPPER_DIVIDER_WIDTH_DEG / 2,
    );
    g.translate(0, HOPPER.y0, 0);
    parts.push(g);
  }

  cached = mergeGeometries(parts, false)!;
  cached.computeVertexNormals();
  parts.forEach((p) => p.dispose());
  return cached;
}
