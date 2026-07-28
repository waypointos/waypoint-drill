import { describe, it, expect } from 'vitest';
import { BASE_PLATE, BASE_PLATE_RIM } from '../geometry';
import { basePlateGeometry } from './basePlate';

describe('basePlateGeometry', () => {
  it('spans the plate body and the raised rim in Y', () => {
    const g = basePlateGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(BASE_PLATE.y0, 5);
    expect(b.max.y).toBeCloseTo(BASE_PLATE_RIM.y1, 5);
  });

  it('reaches the measured outer radius', () => {
    const g = basePlateGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeCloseTo(BASE_PLATE.outerR, 3);
  });

  it('is memoised', () => {
    expect(basePlateGeometry()).toBe(basePlateGeometry());
  });
});
