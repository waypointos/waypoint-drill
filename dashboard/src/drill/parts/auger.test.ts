import { describe, it, expect } from 'vitest';
import {
  SCREW,
  SCREW_FLIGHT_INNER_R,
  SCREW_FLIGHT_OUTER_R,
  SCREW_FLIGHT_THICKNESS,
  SCREW_PITCH,
} from '../geometry';
import { augerGeometry, flightRing } from './auger';

describe('flightRing', () => {
  it('spans inner to outer radius at the ribbon thickness', () => {
    const ring = flightRing(0.5);
    const radii = ring.map(([x, , z]) => Math.hypot(x, z));
    expect(Math.min(...radii)).toBeCloseTo(SCREW_FLIGHT_INNER_R, 5);
    expect(Math.max(...radii)).toBeCloseTo(SCREW_FLIGHT_OUTER_R, 5);
    const ys = ring.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(SCREW_FLIGHT_THICKNESS, 6);
  });

  it('runs from the tip to the top of the screw', () => {
    const lo = flightRing(0).map(([, y]) => y);
    const hi = flightRing(1).map(([, y]) => y);
    expect(Math.min(...lo)).toBeCloseTo(-SCREW.h / 2 - SCREW_FLIGHT_THICKNESS / 2, 5);
    expect(Math.max(...hi)).toBeCloseTo(SCREW.h / 2 + SCREW_FLIGHT_THICKNESS / 2, 5);
  });

  it('advances one turn per measured pitch', () => {
    const angle = (t: number) => {
      const [x, , z] = flightRing(t)[0];
      return Math.atan2(-z, x);
    };
    const dt = SCREW_PITCH / SCREW.h;
    expect(Math.abs(angle(0.5) - angle(0.5 + dt))).toBeLessThan(1e-6);
  });
});

describe('augerGeometry', () => {
  it('spans the flight diameter and screw length', () => {
    const g = augerGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x).toBeCloseTo(SCREW_FLIGHT_OUTER_R, 3);
    expect(b.max.y - b.min.y).toBeCloseTo(SCREW.h + SCREW_FLIGHT_THICKNESS, 3);
  });

  it('is memoised', () => {
    expect(augerGeometry()).toBe(augerGeometry());
  });
});
