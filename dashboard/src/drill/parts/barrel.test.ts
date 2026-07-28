import { describe, it, expect } from 'vitest';
import { BARREL, BARREL_FLANGE } from '../geometry';
import { barrelGeometry, complementArcs } from './barrel';

describe('complementArcs', () => {
  it('returns the whole circle when nothing is cut', () => {
    expect(complementArcs([])).toEqual([{ fromDeg: 0, toDeg: 360 }]);
  });

  it('cuts a single interior window', () => {
    expect(complementArcs([{ fromDeg: 244, toDeg: 296 }]))
      .toEqual([{ fromDeg: 0, toDeg: 244 }, { fromDeg: 296, toDeg: 360 }]);
  });

  it('cuts a window that wraps past 360', () => {
    expect(complementArcs([{ fromDeg: 342, toDeg: 378 }]))
      .toEqual([{ fromDeg: 18, toDeg: 342 }]);
  });

  it('leaves 200 deg of wall in the middle band', () => {
    const arcs = complementArcs([
      { fromDeg: 244, toDeg: 296 },
      { fromDeg: 72, toDeg: 108 },
      { fromDeg: 162, toDeg: 198 },
      { fromDeg: 342, toDeg: 378 },
    ]);
    const total = arcs.reduce((s, a) => s + (a.toDeg - a.fromDeg), 0);
    expect(total).toBeCloseTo(200, 6);
  });
});

describe('barrelGeometry', () => {
  it('spans the measured flange radius and barrel height', () => {
    const g = barrelGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x).toBeCloseTo(BARREL_FLANGE[0].r, 3);
    expect(b.min.y).toBeCloseTo(0, 4);
    expect(b.max.y).toBeCloseTo(BARREL.h, 3);
  });

  it('is memoised so the scene does not rebuild it per frame', () => {
    expect(barrelGeometry()).toBe(barrelGeometry());
  });
});
