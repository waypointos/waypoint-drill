import { describe, it, expect } from 'vitest';
import { BASE_PLATE, HOPPER, HOPPER_DIVIDERS_DEG } from '../geometry';
import { binSpans, hopperGeometry } from './hopper';

describe('binSpans', () => {
  it('splits the arc into three bins at the dividers', () => {
    const bins = binSpans();
    expect(bins.length).toBe(3);
    expect(bins[0].fromDeg).toBe(HOPPER.arcFromDeg);
    expect(bins[2].toDeg).toBe(HOPPER.arcToDeg);
  });

  it('covers the whole span with no overlap', () => {
    const bins = binSpans();
    const total = bins.reduce((s, b) => s + (b.toDeg - b.fromDeg), 0);
    expect(total).toBe(HOPPER.arcToDeg - HOPPER.arcFromDeg);
    expect(bins[0].toDeg).toBe(bins[1].fromDeg);
    expect(bins[1].toDeg).toBe(bins[2].fromDeg);
  });

  it('puts each divider on a bin boundary', () => {
    const boundaries = binSpans().map((b) => ((b.toDeg % 360) + 360) % 360);
    for (const d of HOPPER_DIVIDERS_DEG) expect(boundaries).toContain(d);
  });
});

describe('hopperGeometry', () => {
  it('sits entirely below the base plate', () => {
    const g = hopperGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeLessThanOrEqual(BASE_PLATE.y0 + 1e-9);
  });

  it('spans the measured bin height and outer radius', () => {
    const g = hopperGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(HOPPER.y0, 4);
    expect(b.max.x).toBeCloseTo(HOPPER.outerR, 3);
  });

  it('is memoised', () => {
    expect(hopperGeometry()).toBe(hopperGeometry());
  });
});
