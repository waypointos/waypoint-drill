// Barrel tube and base flange. The wall is whatever the windows leave behind,
// so the bands below are expressed as cuts rather than as walls; that is the
// form the CAD was measured in and it keeps the two descriptions in sync.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BARREL,
  BARREL_BORE_R,
  BARREL_FLANGE,
  PINION_WINDOW,
  SAMPLE_WINDOWS,
  SAMPLE_WINDOW_Y,
} from '../geometry';
import { arcSolid } from './shapes';

type Arc = { fromDeg: number; toDeg: number };

/** Wall arcs left over once the given windows are cut out of a full circle. */
export function complementArcs(windows: readonly Arc[]): Arc[] {
  const cuts = windows
    .map((w) => ({ fromDeg: w.fromDeg % 360, toDeg: (w.fromDeg % 360) + (w.toDeg - w.fromDeg) }))
    .flatMap((w) => (w.toDeg <= 360
      ? [w]
      : [{ fromDeg: w.fromDeg, toDeg: 360 }, { fromDeg: 0, toDeg: w.toDeg - 360 }]))
    .sort((a, b) => a.fromDeg - b.fromDeg);

  const out: Arc[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.fromDeg > cursor) out.push({ fromDeg: cursor, toDeg: c.fromDeg });
    cursor = Math.max(cursor, c.toDeg);
  }
  if (cursor < 360) out.push({ fromDeg: cursor, toDeg: 360 });
  return out;
}

const BANDS: Array<{ y0: number; y1: number; cuts: readonly Arc[] }> = [
  { y0: BARREL_FLANGE[1].y1, y1: PINION_WINDOW.y0, cuts: [] },
  { y0: PINION_WINDOW.y0, y1: SAMPLE_WINDOW_Y.y0, cuts: [PINION_WINDOW] },
  { y0: SAMPLE_WINDOW_Y.y0, y1: SAMPLE_WINDOW_Y.y1, cuts: [PINION_WINDOW, ...SAMPLE_WINDOWS] },
  { y0: SAMPLE_WINDOW_Y.y1, y1: PINION_WINDOW.y1, cuts: [PINION_WINDOW] },
];

let cached: THREE.BufferGeometry | null = null;

export function barrelGeometry(): THREE.BufferGeometry {
  if (cached) return cached;

  const parts: THREE.BufferGeometry[] = [];
  for (const band of BANDS) {
    const h = band.y1 - band.y0;
    for (const arc of complementArcs(band.cuts)) {
      const g = arcSolid(BARREL_BORE_R, BARREL.r, h, arc.fromDeg, arc.toDeg);
      g.translate(0, band.y0, 0);
      parts.push(g);
    }
  }
  for (const step of BARREL_FLANGE) {
    const g = arcSolid(BARREL_BORE_R, step.r, step.y1 - step.y0, 0, 360);
    g.translate(0, step.y0, 0);
    parts.push(g);
  }

  cached = mergeGeometries(parts, false)!;
  cached.computeVertexNormals();
  parts.forEach((p) => p.dispose());
  return cached;
}
