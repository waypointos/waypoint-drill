import { describe, it, expect } from 'vitest';
import { PINION } from '../geometry';
import { pinionGeometry, toothShapePoints } from './pinion';

describe('toothShapePoints', () => {
  it('emits four points per tooth', () => {
    expect(toothShapePoints().length).toBe(PINION.teeth * 4);
  });

  it('alternates between root and tip radius', () => {
    const radii = toothShapePoints().map(([x, y]) => Math.hypot(x, y));
    expect(Math.min(...radii)).toBeCloseTo(PINION.rootR, 4);
    expect(Math.max(...radii)).toBeCloseTo(PINION.tipR, 4);
  });
});

describe('pinionGeometry', () => {
  it('spans the tip diameter and its thickness', () => {
    const g = pinionGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x).toBeCloseTo(PINION.tipR, 3);
    expect(b.max.z - b.min.z).toBeCloseTo(PINION.thickness, 4);
  });

  it('is memoised', () => {
    expect(pinionGeometry()).toBe(pinionGeometry());
  });
});
