import { describe, it, expect } from 'vitest';
import {
  CORE,
  CORE_TOOTH_CREST_R,
  CORE_TOOTH_LAND,
  CORE_TOOTH_PITCH,
} from '../geometry';
import { coreGeometry, toothProfile } from './core';

describe('toothProfile', () => {
  it('alternates between the plain radius and the crest', () => {
    const p = toothProfile(CORE_TOOTH_PITCH * 4);
    const radii = new Set(p.map(([r]) => r));
    expect(radii).toEqual(new Set([CORE.r, CORE_TOOTH_CREST_R]));
  });

  it('repeats once per measured pitch', () => {
    const turns = 6;
    const p = toothProfile(CORE_TOOTH_PITCH * turns);
    const crestRuns = p.filter(([r], i, a) =>
      r === CORE_TOOTH_CREST_R && (i === 0 || a[i - 1][0] !== CORE_TOOTH_CREST_R));
    expect(crestRuns.length).toBe(turns);
  });

  it('gives each crest the measured land width', () => {
    const p = toothProfile(CORE_TOOTH_PITCH * 3);
    const crestYs = p.filter(([r]) => r === CORE_TOOTH_CREST_R).map(([, y]) => y);
    expect(crestYs[1] - crestYs[0]).toBeCloseTo(CORE_TOOTH_LAND, 6);
  });

  it('rises monotonically', () => {
    const p = toothProfile(CORE_TOOTH_PITCH * 5);
    for (let i = 1; i < p.length; i += 1) expect(p[i][1]).toBeGreaterThanOrEqual(p[i - 1][1]);
  });
});

describe('coreGeometry', () => {
  it('is centred on y=0 and spans the core height', () => {
    const g = coreGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(-CORE.h / 2, 3);
    expect(b.max.y).toBeCloseTo(CORE.h / 2, 3);
  });

  it('reaches the crest radius but no further', () => {
    // Measured radially, not on +X: no toothed sector spans CAD 0 deg, so the
    // bounding box never touches the crest on an axis.
    const g = coreGeometry();
    const pos = g.getAttribute('position');
    let maxR = 0;
    for (let i = 0; i < pos.count; i += 1) {
      maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    expect(maxR).toBeCloseTo(CORE_TOOTH_CREST_R, 5);
  });

  it('is memoised', () => {
    expect(coreGeometry()).toBe(coreGeometry());
  });
});
