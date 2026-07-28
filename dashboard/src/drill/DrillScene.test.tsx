import { describe, it, expect } from 'vitest';
import { PINION } from './geometry';
import { pinionRadPerSec } from './DrillScene';

describe('pinionRadPerSec', () => {
  it('is zero when the lift does not move', () => {
    expect(pinionRadPerSec(-0.05, -0.05, 0.016)).toBe(0);
  });

  it('is zero when the height is unknown at either sample', () => {
    expect(pinionRadPerSec(null, -0.05, 0.016)).toBe(0);
    expect(pinionRadPerSec(-0.05, null, 0.016)).toBe(0);
  });

  it('is zero for a non-positive timestep', () => {
    expect(pinionRadPerSec(-0.04, -0.05, 0)).toBe(0);
  });

  it('flips sign with the direction of travel', () => {
    const down = pinionRadPerSec(-0.06, -0.05, 0.1);
    const up = pinionRadPerSec(-0.04, -0.05, 0.1);
    expect(down).toBeLessThan(0);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeCloseTo(-up, 9);
  });

  it('scales with lift speed through the pitch radius', () => {
    const slow = pinionRadPerSec(-0.051, -0.05, 0.1);
    const fast = pinionRadPerSec(-0.052, -0.05, 0.1);
    expect(fast).toBeCloseTo(slow * 2, 9);
    expect(slow).toBeCloseTo(-0.001 / 0.1 / PINION.tipR, 9);
  });
});
