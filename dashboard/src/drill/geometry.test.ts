import { describe, it, expect } from 'vitest';
import { AugerDirection } from '../proto/drill_pb';
import {
  CORE_MOUTH_TOP_Y,
  HelixCurve,
  NOMINAL_SPIN_RAD_PER_SEC,
  SCREW,
  SPIN_VEL_RAW_FULL,
  SWITCH_SPIN_RAD_PER_SEC,
  TRAVEL_M,
  coreOffsetY,
  helixPoint,
  screwTipY,
  spinRadPerSec,
} from './geometry';

describe('coreOffsetY', () => {
  it('is zero at the raised limit', () => {
    expect(coreOffsetY(0)).toBeCloseTo(0, 6);
  });

  it('is half of travel at mid height', () => {
    expect(coreOffsetY(0.5)).toBeCloseTo(-TRAVEL_M / 2, 6);
  });

  it('is full travel at the lowered limit', () => {
    expect(coreOffsetY(1)).toBeCloseTo(-TRAVEL_M, 6);
  });

  it('parks at the raised limit when height is unknown', () => {
    expect(coreOffsetY(null)).toBe(0);
  });

  it('clamps out-of-range heights', () => {
    expect(coreOffsetY(-0.4)).toBeCloseTo(0, 6);
    expect(coreOffsetY(2.5)).toBeCloseTo(-TRAVEL_M, 6);
  });
});

describe('screwTipY', () => {
  it('protrudes below the core mouth at the raised limit', () => {
    expect(screwTipY(0)).toBeCloseTo(CORE_MOUTH_TOP_Y - SCREW.tipBelowMouth, 6);
  });

  it('descends with the core', () => {
    expect(screwTipY(1)).toBeCloseTo(screwTipY(0) - TRAVEL_M, 6);
  });

  it('parks at the raised limit when height is unknown', () => {
    expect(screwTipY(null)).toBeCloseTo(screwTipY(0), 6);
  });
});

describe('spinRadPerSec', () => {
  it('is zero when idle or unspecified', () => {
    expect(spinRadPerSec(AugerDirection.IDLE, 800, false)).toBe(0);
    expect(spinRadPerSec(AugerDirection.UNSPECIFIED, 800, false)).toBe(0);
  });

  it('is zero when halted, whatever the direction', () => {
    expect(spinRadPerSec(AugerDirection.DRILL, 800, true)).toBe(0);
    expect(spinRadPerSec(AugerDirection.SWITCH, 800, true)).toBe(0);
  });

  it('flips sign between drill and switch', () => {
    const drill = spinRadPerSec(AugerDirection.DRILL, SPIN_VEL_RAW_FULL, false);
    const swtch = spinRadPerSec(AugerDirection.SWITCH, SPIN_VEL_RAW_FULL, false);
    expect(drill).toBeGreaterThan(0);
    expect(swtch).toBeLessThan(0);
  });

  it('falls back to the nominal rate when the velocity register is absent', () => {
    expect(spinRadPerSec(AugerDirection.DRILL, null, false)).toBeCloseTo(NOMINAL_SPIN_RAD_PER_SEC, 6);
    expect(spinRadPerSec(AugerDirection.SWITCH, null, false)).toBeCloseTo(-SWITCH_SPIN_RAD_PER_SEC, 6);
  });

  it('scales the drill rate by the velocity magnitude', () => {
    const half = spinRadPerSec(AugerDirection.DRILL, SPIN_VEL_RAW_FULL / 2, false);
    expect(half).toBeCloseTo(NOMINAL_SPIN_RAD_PER_SEC / 2, 6);
    expect(spinRadPerSec(AugerDirection.DRILL, -SPIN_VEL_RAW_FULL, false))
      .toBeCloseTo(NOMINAL_SPIN_RAD_PER_SEC, 6);
  });

  it('holds the switch rate fixed, since core yaw is not measured', () => {
    expect(spinRadPerSec(AugerDirection.SWITCH, 50, false))
      .toBeCloseTo(spinRadPerSec(AugerDirection.SWITCH, 900, false), 6);
  });
});

describe('helixPoint', () => {
  it('spans the screw length between its endpoints', () => {
    const a = helixPoint(0);
    const b = helixPoint(1);
    expect(b.y - a.y).toBeCloseTo(SCREW.h, 6);
    expect(a.y).toBeCloseTo(-SCREW.h / 2, 6);
    expect(b.y).toBeCloseTo(SCREW.h / 2, 6);
  });

  it('stays on the flight radius', () => {
    for (const t of [0, 0.13, 0.5, 0.77, 1]) {
      const p = helixPoint(t);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(SCREW.r, 6);
    }
  });

  it('is exposed as a three curve for the tube sweep', () => {
    const c = new HelixCurve();
    const p = c.getPoint(0.25);
    const q = helixPoint(0.25);
    expect(p.x).toBeCloseTo(q.x, 6);
    expect(p.y).toBeCloseTo(q.y, 6);
    expect(p.z).toBeCloseTo(q.z, 6);
  });
});
