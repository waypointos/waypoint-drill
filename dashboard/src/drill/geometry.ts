// Parametric dimensions and pose mapping for the drill render. Every length is
// in meters, taken from the hardware drawing, so the 3D scene and the 2D
// schematic can be built from one source without shipping a mesh.
//
// Frame: +Y up, origin at the barrel base ring, barrel axis on Y.
import { AugerDirection } from '../proto/drill_pb';
import { fromCadZ, hopperY } from './parts/frame';

/** Barrel tube. r is the outer radius; the bore is a separate constant. */
export const BARREL = { r: 0.030, h: 0.216 };
export const BARREL_BORE_R = 0.026;
export const BARREL_FLANGE = [
  { r: 0.0624, y0: fromCadZ(10), y1: fromCadZ(14) },
  { r: 0.048, y0: fromCadZ(14), y1: fromCadZ(18) },
] as const;

/** Continuous window the lift pinion reaches the core through. */
export const PINION_WINDOW = { fromDeg: 244, toDeg: 296, y0: fromCadZ(70), y1: fromCadZ(226.4) };

/** Sample windows, cut only through the middle band of the barrel. */
export const SAMPLE_WINDOWS = [
  { fromDeg: 72, toDeg: 108 },
  { fromDeg: 162, toDeg: 198 },
  { fromDeg: 342, toDeg: 378 },
] as const;
export const SAMPLE_WINDOW_Y = { y0: fromCadZ(100), y1: fromCadZ(190) };

/** Core column. r is the plain outer radius, between the toothed sectors. */
export const CORE = { r: 0.0225, h: 0.250 };
export const CORE_BORE_R = 0.020;
export const CORE_TOOTH_CREST_R = 0.025;
export const CORE_TOOTH_PITCH = 0.0042;
export const CORE_TOOTH_LAND = 0.00152;
export const CORE_TOOTH_SECTORS = [
  { fromDeg: 18, toDeg: 72 },
  { fromDeg: 108, toDeg: 162 },
  { fromDeg: 198, toDeg: 252 },
  { fromDeg: 288, toDeg: 342 },
] as const;

export const CORE_CAP = { r: 0.025, h: 0.0075 };
export const SCREW_MOUNT = { r: 0.0196, h: 0.0235 };

export const SCREW = { r: 0.019, h: 0.284, tipBelowMouth: 0.037 };
export const MOTOR = { w: 0.028, d: 0.035, h: 0.056 };

/** Full lift travel between the raised and lowered limits. */
export const TRAVEL_M = 0.14;

/** Y of the core mouth (its lower rim) at the raised limit. */
export const CORE_MOUTH_TOP_Y = 0.02;

/** Auger flight is a ribbon between two radii, not a swept tube. */
export const SCREW_SHAFT_R = 0.00499;
export const SCREW_FLIGHT_INNER_R = 0.005;
export const SCREW_FLIGHT_OUTER_R = 0.019;
export const SCREW_FLIGHT_THICKNESS = 0.00483;
export const SCREW_PITCH = 0.036;
export const SCREW_TURNS = SCREW.h / SCREW_PITCH;

export const BASE_PLATE = {
  boreR: 0.02625,
  outerR: 0.0675,
  y0: fromCadZ(0),
  y1: fromCadZ(8),
};
export const BASE_PLATE_RIM = {
  innerR: 0.06354,
  outerR: 0.0668,
  y0: fromCadZ(8),
  y1: fromCadZ(15),
};

export const PINION = {
  teeth: 26,
  tipR: 0.01708,
  rootR: 0.01434,
  boreR: 0.00384,
  thickness: 0.008,
  centerR: 0.03962,
  centerY: fromCadZ(37.26),
  azimuthDeg: 270,
};

export const HOPPER = {
  outerR: 0.075,
  wallThickness: 0.003,
  coneBottomR: 0.042,
  throatR: 0.027,
  y0: hopperY(122.4),
  y1: hopperY(209.4),
  arcFromDeg: 330,
  arcToDeg: 569,
};
export const HOPPER_DIVIDERS_DEG = [42, 138] as const;
export const HOPPER_DIVIDER_WIDTH_DEG = 3;

/** Full-scale magnitude of the servo speed register, used to scale drill spin. */
export const SPIN_VEL_RAW_FULL = 1023;
/** Spin rate at full drill throttle, chosen to read as motion, not to be exact. */
export const NOMINAL_SPIN_RAD_PER_SEC = 6.0;
/**
 * Fixed rate for the SWITCH rotation. No core-yaw telemetry exists, so this is
 * indicative only and the viewport labels it as not measured.
 */
export const SWITCH_SPIN_RAD_PER_SEC = 1.2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Vertical offset of the whole core assembly. 0 at the raised limit, negative
 * as the drill descends. A null height means the position is unknown, so the
 * assembly draws at the raised limit rather than at a fabricated mid-travel.
 */
export function coreOffsetY(heightNorm: number | null): number {
  if (heightNorm == null || !Number.isFinite(heightNorm)) return 0;
  return -TRAVEL_M * clamp01(heightNorm);
}

/** Y of the core mouth at the given height. */
export function coreMouthY(heightNorm: number | null): number {
  return CORE_MOUTH_TOP_Y + coreOffsetY(heightNorm);
}

/** Y of the screw tip, which protrudes below the core mouth. */
export function screwTipY(heightNorm: number | null): number {
  return coreMouthY(heightNorm) - SCREW.tipBelowMouth;
}

/** Y of the screw midpoint, the anchor the tube geometry is centered on. */
export function screwCenterY(heightNorm: number | null): number {
  return screwTipY(heightNorm) + SCREW.h / 2;
}

/**
 * Signed spin rate of the element the direction drives: the screw in DRILL,
 * the core in SWITCH. Halted freezes everything; IDLE and an unspecified
 * direction never spin. A null raw velocity means the register was not read,
 * so DRILL falls back to the nominal rate instead of reading as stopped.
 */
export function spinRadPerSec(
  dir: AugerDirection,
  velRaw: number | null,
  halted: boolean,
): number {
  if (halted) return 0;
  if (dir === AugerDirection.DRILL) {
    const scale = velRaw == null || !Number.isFinite(velRaw)
      ? 1
      : clamp01(Math.abs(velRaw) / SPIN_VEL_RAW_FULL);
    return NOMINAL_SPIN_RAD_PER_SEC * scale;
  }
  if (dir === AugerDirection.SWITCH) return -SWITCH_SPIN_RAD_PER_SEC;
  return 0;
}
