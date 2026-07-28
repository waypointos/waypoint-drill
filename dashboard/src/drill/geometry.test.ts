import { describe, it, expect } from 'vitest';
import { AugerDirection } from '../proto/drill_pb';
import {
  BARREL_BORE_R,
  BASE_PLATE,
  CORE,
  CORE_MOUTH_TOP_Y,
  CORE_TOOTH_CREST_R,
  CORE_TOOTH_SECTORS,
  HOPPER,
  HOPPER_DIVIDERS_DEG,
  NOMINAL_SPIN_RAD_PER_SEC,
  PINION,
  PINION_WINDOW,
  SAMPLE_WINDOWS,
  SCREW,
  SCREW_FLIGHT_OUTER_R,
  SCREW_PITCH,
  SCREW_TURNS,
  SPIN_VEL_RAW_FULL,
  SWITCH_SPIN_RAD_PER_SEC,
  TRAVEL_M,
  coreOffsetY,
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

describe('measured geometry invariants', () => {
  it('leaves running clearance between core crest and barrel bore', () => {
    expect(BARREL_BORE_R).toBeGreaterThan(CORE_TOOTH_CREST_R);
    expect(BARREL_BORE_R - CORE_TOOTH_CREST_R).toBeCloseTo(0.001, 6);
  });

  it('passes the auger flight through the hopper throat', () => {
    expect(HOPPER.throatR).toBeGreaterThan(SCREW_FLIGHT_OUTER_R);
  });

  it('keeps the hopper bins clear of the base plate', () => {
    expect(HOPPER.y1).toBeLessThan(BASE_PLATE.y0);
  });

  it('meshes the pinion into the core crest', () => {
    const reach = PINION.centerR - PINION.tipR;
    expect(reach).toBeLessThan(CORE_TOOTH_CREST_R);
    expect(reach).toBeGreaterThan(CORE.r);
  });

  it('places the pinion inside its own barrel window', () => {
    expect(PINION.azimuthDeg).toBeGreaterThan(PINION_WINDOW.fromDeg);
    expect(PINION.azimuthDeg).toBeLessThan(PINION_WINDOW.toDeg);
  });

  it('accounts for every degree of the barrel middle band', () => {
    const cut = (PINION_WINDOW.toDeg - PINION_WINDOW.fromDeg)
      + SAMPLE_WINDOWS.reduce((s, w) => s + (w.toDeg - w.fromDeg), 0);
    expect(cut).toBe(160);
    expect(360 - cut).toBe(200);
  });

  it('accounts for every degree of the core circumference', () => {
    const toothed = CORE_TOOTH_SECTORS.reduce((s, t) => s + (t.toDeg - t.fromDeg), 0);
    expect(toothed).toBe(216);
    expect(360 - toothed).toBe(144);
  });

  it('spans 239 deg of bins with 2 dividers inside the span', () => {
    expect(HOPPER.arcToDeg - HOPPER.arcFromDeg).toBe(239);
    for (const d of HOPPER_DIVIDERS_DEG) {
      const rel = (d - HOPPER.arcFromDeg + 360) % 360;
      expect(rel).toBeGreaterThan(0);
      expect(rel).toBeLessThan(239);
    }
  });

  it('derives screw turns from the measured pitch', () => {
    expect(SCREW_TURNS).toBeCloseTo(7.89, 2);
    expect(SCREW_PITCH).toBeCloseTo(0.036, 6);
  });
});
