import { describe, it, expect } from 'vitest';
import { cadDir, lathePhi } from './frame';

describe('cadDir', () => {
  it('puts CAD 0 deg on +X', () => {
    const d = cadDir(0);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('puts CAD 90 deg on -Z, matching the extrusion mapping', () => {
    const d = cadDir(90);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(-1, 6);
  });

  it('is a unit vector at arbitrary azimuths', () => {
    for (const deg of [17, 138, 244, 296, 342]) {
      expect(cadDir(deg).length()).toBeCloseTo(1, 6);
    }
  });
});

describe('lathePhi', () => {
  it('agrees with cadDir, since three lathes sweep sin/cos swapped', () => {
    for (const deg of [0, 42, 138, 270]) {
      const phi = lathePhi(deg);
      const d = cadDir(deg);
      expect(Math.sin(phi)).toBeCloseTo(d.x, 6);
      expect(Math.cos(phi)).toBeCloseTo(d.z, 6);
    }
  });
});
