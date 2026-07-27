// Parametric dimensions and pose mapping for the drill render. Every length is
// in meters, taken from the hardware drawing, so the 3D scene and the 2D
// schematic can be built from one source without shipping a mesh.
//
// Frame: +Y up, origin at the barrel base ring, barrel axis on Y.
import * as THREE from 'three';
import { AugerDirection } from '../proto/drill_pb';

export const BARREL = { r: 0.0625, h: 0.216 };
export const CORE = { r: 0.0245, h: 0.250 };
export const SCREW = { r: 0.019, h: 0.284, tipBelowMouth: 0.037 };
export const PLATE = { w: 0.175, d: 0.117 };
export const MOTOR = { w: 0.028, d: 0.035, h: 0.056 };
export const CONTAINERS = 3;

/** Full lift travel between the raised and lowered limits. */
export const TRAVEL_M = 0.14;

/** Y of the core mouth (its lower rim) at the raised limit. */
export const CORE_MOUTH_TOP_Y = 0.02;

/** Top face of the container plate, clear of the screw at full descent. */
export const PLATE_TOP_Y = -0.21;
export const PLATE_THICKNESS = 0.008;
export const CONTAINER = { r: 0.022, h: 0.030 };

/** Sample windows cut into the barrel wall, as wall sectors with gaps. */
export const BARREL_SLOTS = 4;
export const BARREL_SLOT_FRACTION = 0.34;
export const BARREL_RING_H = 0.012;

export const SCREW_TURNS = 9;
export const SCREW_PITCH = SCREW.h / SCREW_TURNS;
export const SCREW_FLIGHT_R = 0.0035;
export const SCREW_SHAFT_R = 0.006;

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

/**
 * Point on the screw flight helix in the screw's own frame, t in 0..1 from the
 * tip to the top. Y spans exactly SCREW.h so the tube centers on the group.
 */
export function helixPoint(t: number): { x: number; y: number; z: number } {
  const a = t * SCREW_TURNS * Math.PI * 2;
  return {
    x: SCREW.r * Math.cos(a),
    y: -SCREW.h / 2 + t * SCREW.h,
    z: SCREW.r * Math.sin(a),
  };
}

/** Curve adapter so TubeGeometry can sweep the flight profile. */
export class HelixCurve extends THREE.Curve<THREE.Vector3> {
  // three types Curve's constructor as protected, so the subclass has to
  // publish its own before callers can instantiate the sweep.
  constructor() {
    super();
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const p = helixPoint(t);
    return target.set(p.x, p.y, p.z);
  }
}
