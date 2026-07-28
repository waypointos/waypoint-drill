// Parametric 3D render of the drill head, built from primitives so the module
// ships no mesh assets. Every solid comes from a builder under parts/, and the
// only animated quantities are the auger spin and the lift pinion roll.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { AugerDirection } from '../proto/drill_pb';
import { DrillCanvas } from './DrillCanvas';
import { augerGeometry } from './parts/auger';
import { barrelGeometry } from './parts/barrel';
import { basePlateGeometry } from './parts/basePlate';
import { coreGeometry } from './parts/core';
import { cadDir } from './parts/frame';
import { hopperGeometry } from './parts/hopper';
import { pinionGeometry } from './parts/pinion';
import {
  CORE,
  CORE_CAP,
  CORE_MOUTH_TOP_Y,
  MOTOR,
  PINION,
  SCREW_MOUNT,
  coreOffsetY,
  screwCenterY,
  spinRadPerSec,
} from './geometry';

export type DrillPose = {
  heightNorm: number | null;        // 0 top .. 1 bottom; null = core at top
  heightNaReason: string | null;    // muted hint when heightNorm null
  augerDirection: AugerDirection;
  augerVelocityRaw: number | null;  // scales spin; null non-idle = nominal
  halted: boolean;                  // freezes all animation
};

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// A stylesheet-less DOM (tests) resolves tokens to an empty string, which three
// cannot parse; leaving the prop undefined keeps the material default instead.
const token = (name: string): string | undefined => cssVar(name) || undefined;

const BARREL_OPACITY = 0.28;
const CORE_OPACITY = 0.55;
const HOPPER_OPACITY = 0.4;
// The pinion is built lying in XY, so it yaws onto the radial axis at its azimuth.
const PINION_YAW = THREE.MathUtils.degToRad(PINION.azimuthDeg);
const MOTOR_OFFSET = { x: 0, y: 0, z: MOTOR.d };

// Core assembly at the raised limit; the lift group carries all of it together.
const CORE_REST = {
  center: CORE_MOUTH_TOP_Y + CORE.h / 2,
  screwMount: CORE_MOUTH_TOP_Y + CORE.h - SCREW_MOUNT.h / 2,
  cap: CORE_MOUTH_TOP_Y + CORE.h + CORE_CAP.h / 2,
  motor: CORE_MOUTH_TOP_Y + CORE.h + CORE_CAP.h + MOTOR.h / 2,
  screw: screwCenterY(0),
};

type Palette = { shell?: string; body?: string; screw?: string; core?: string; deck?: string };

function palette(pose: DrillPose): Palette {
  const muted = token('--color-fg-4');
  if (pose.halted) return { shell: muted, body: muted, screw: muted, core: muted, deck: muted };
  const body = token('--color-fg-2');
  const shell = token('--color-fg-3');
  const accent = token('--color-accent');
  return {
    shell,
    body,
    // The hopper reads as background so it does not compete with the column.
    deck: muted,
    // One accent, always on the element the current direction actually drives.
    screw: pose.augerDirection === AugerDirection.DRILL ? accent : body,
    core: pose.augerDirection === AugerDirection.SWITCH ? accent : body,
  };
}

// Advances a group's yaw under frameloop="demand" by self-driving invalidate()
// while the rate is nonzero.
function useSpin(radPerSec: number) {
  const ref = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g || radPerSec === 0) return;
    g.rotation.y += radPerSec * dt;
    invalidate();
  });

  useEffect(() => {
    invalidate();
  }, [radPerSec, invalidate]);

  return ref;
}

// Rolling the pinion off the observed lift delta keeps the drive reading as
// driven without inventing a telemetry field. Unknown height leaves it still,
// consistent with the rest of the N/A treatment.
export function pinionRadPerSec(
  lift: number | null,
  prevLift: number | null,
  dt: number,
): number {
  if (lift == null || prevLift == null || dt <= 0) return 0;
  return (lift - prevLift) / dt / PINION.tipR;
}

// The lift carries the core column, its cap, servo 12 and the auger as one
// body; only the yaw of the driven element differs between DRILL and SWITCH.
function DrillRig({ pose }: { pose: DrillPose }) {
  const invalidate = useThree((s) => s.invalidate);
  const c = palette(pose);
  const rate = spinRadPerSec(pose.augerDirection, pose.augerVelocityRaw, pose.halted);
  const coreRef = useSpin(pose.augerDirection === AugerDirection.SWITCH ? rate : 0);
  const screwRef = useSpin(pose.augerDirection === AugerDirection.DRILL ? rate : 0);
  const pinionRef = useRef<THREE.Mesh>(null);
  const prevLift = useRef<number | null>(null);

  const lift = coreOffsetY(pose.heightNorm);
  const known = pose.heightNorm != null && !pose.halted;

  useFrame((_, dt) => {
    const m = pinionRef.current;
    if (!m) return;
    const rad = pinionRadPerSec(known ? lift : null, prevLift.current, dt);
    prevLift.current = known ? lift : null;
    if (rad === 0) return;
    m.rotation.z += rad * dt;
    invalidate();
  });

  useEffect(() => { invalidate(); }, [invalidate, lift, rate, c.core, c.screw, c.shell, c.body]);

  return (
    <group>
      <mesh geometry={barrelGeometry()}>
        <meshStandardMaterial color={c.shell} side={THREE.DoubleSide}
          transparent opacity={BARREL_OPACITY} depthWrite={false} />
      </mesh>

      <mesh geometry={basePlateGeometry()}>
        <meshStandardMaterial color={c.shell} />
      </mesh>

      <mesh geometry={hopperGeometry()}>
        <meshStandardMaterial color={c.deck} side={THREE.DoubleSide}
          transparent opacity={HOPPER_OPACITY} depthWrite={false} />
      </mesh>

      {/* Servo 11 drives the pinion through the barrel's drive window. */}
      <group position={cadDir(PINION.azimuthDeg).multiplyScalar(PINION.centerR).setY(PINION.centerY)}>
        <mesh ref={pinionRef} geometry={pinionGeometry()} rotation={[0, PINION_YAW, 0]}>
          <meshStandardMaterial color={c.body} />
        </mesh>
        <mesh position={[MOTOR_OFFSET.x, MOTOR_OFFSET.y, MOTOR_OFFSET.z]}>
          <boxGeometry args={[MOTOR.w, MOTOR.h, MOTOR.d]} />
          <meshStandardMaterial color={c.shell} />
        </mesh>
      </group>

      <group position-y={lift}>
        <group ref={coreRef}>
          <mesh position-y={CORE_REST.center} geometry={coreGeometry()}>
            <meshStandardMaterial color={c.core} side={THREE.DoubleSide}
              transparent opacity={CORE_OPACITY} depthWrite={false} />
          </mesh>
          <mesh position-y={CORE_REST.screwMount}>
            <cylinderGeometry args={[SCREW_MOUNT.r, SCREW_MOUNT.r, SCREW_MOUNT.h, 24]} />
            <meshStandardMaterial color={c.body} />
          </mesh>
          <mesh position-y={CORE_REST.cap}>
            <cylinderGeometry args={[CORE_CAP.r, CORE_CAP.r, CORE_CAP.h, 24]} />
            <meshStandardMaterial color={c.body} />
          </mesh>
          {/* Servo 12 rides on the core cap. */}
          <mesh position-y={CORE_REST.motor}>
            <boxGeometry args={[MOTOR.w, MOTOR.h, MOTOR.d]} />
            <meshStandardMaterial color={c.body} />
          </mesh>
          <group ref={screwRef} position-y={CORE_REST.screw}>
            <mesh geometry={augerGeometry()}>
              <meshStandardMaterial color={c.screw} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

export function DrillScene({ pose, variant }: { pose: DrillPose; variant: 'hero' | 'compact' }) {
  return (
    <DrillCanvas variant={variant}>
      <DrillRig pose={pose} />
    </DrillCanvas>
  );
}
