// Parametric 3D render of the drill head, built from primitives so the module
// ships no mesh assets. Everything the scene draws comes from geometry.ts, and
// the only animated quantity is the auger spin.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { AugerDirection } from '../proto/drill_pb';
import { DrillCanvas } from './DrillCanvas';
import {
  BARREL,
  BARREL_RING_H,
  BARREL_SLOTS,
  BARREL_SLOT_FRACTION,
  CONTAINER,
  CONTAINERS,
  CORE,
  CORE_MOUTH_TOP_Y,
  HelixCurve,
  MOTOR,
  PLATE,
  PLATE_THICKNESS,
  PLATE_TOP_Y,
  SCREW,
  SCREW_FLIGHT_R,
  SCREW_SHAFT_R,
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

const BARREL_OPACITY = 0.22;
const BARREL_RING_OPACITY = 0.5;
const SLOT_SECTOR = (Math.PI * 2) / BARREL_SLOTS;
const WALL_ARC = SLOT_SECTOR * (1 - BARREL_SLOT_FRACTION);
const TUBE_SEGMENTS = 240;

// Core assembly at the raised limit; the lift group carries all three together.
const CORE_REST = {
  center: CORE_MOUTH_TOP_Y + CORE.h / 2,
  cap: CORE_MOUTH_TOP_Y + CORE.h + MOTOR.h / 2,
  screw: screwCenterY(0),
};

const MOTOR_GAP = 0.006;
const BASE_MOTOR_POS: [number, number, number] = [
  BARREL.r + MOTOR.w / 2 + MOTOR_GAP,
  MOTOR.h / 2,
  0,
];

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
    deck: shell,
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

function Barrel({ color }: { color?: string }) {
  return (
    <group position={[0, BARREL.h / 2, 0]}>
      {Array.from({ length: BARREL_SLOTS }, (_, i) => (
        <mesh key={i}>
          <cylinderGeometry
            args={[BARREL.r, BARREL.r, BARREL.h - BARREL_RING_H * 2, 24, 1, true, i * SLOT_SECTOR, WALL_ARC]}
          />
          <meshStandardMaterial
            color={color}
            side={THREE.DoubleSide}
            transparent
            opacity={BARREL_OPACITY}
            depthWrite={false}
          />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, (s * (BARREL.h - BARREL_RING_H)) / 2, 0]}>
          <cylinderGeometry args={[BARREL.r, BARREL.r, BARREL_RING_H, 24, 1, true]} />
          <meshStandardMaterial
            color={color}
            side={THREE.DoubleSide}
            transparent
            opacity={BARREL_RING_OPACITY}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function Screw({ color }: { color?: string }) {
  const flight = useMemo(
    () => new THREE.TubeGeometry(new HelixCurve(), TUBE_SEGMENTS, SCREW_FLIGHT_R, 6, false),
    [],
  );
  useEffect(() => () => flight.dispose(), [flight]);

  return (
    <group>
      <mesh geometry={flight}>
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[SCREW_SHAFT_R, SCREW_SHAFT_R, SCREW.h, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

function ContainerDeck({ color }: { color?: string }) {
  const step = PLATE.w / (CONTAINERS + 1);
  return (
    <group>
      <mesh position={[0, PLATE_TOP_Y - PLATE_THICKNESS / 2, 0]}>
        <boxGeometry args={[PLATE.w, PLATE_THICKNESS, PLATE.d]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {Array.from({ length: CONTAINERS }, (_, i) => (
        <mesh
          key={i}
          position={[(i + 1) * step - PLATE.w / 2, PLATE_TOP_Y + CONTAINER.h / 2, 0]}
        >
          <cylinderGeometry args={[CONTAINER.r, CONTAINER.r, CONTAINER.h, 16, 1, true]} />
          <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

// The lift carries the core column, its cap motor and the screw as one body;
// only the yaw of the driven element differs between DRILL and SWITCH.
function DrillRig({ pose }: { pose: DrillPose }) {
  const invalidate = useThree((s) => s.invalidate);
  const c = palette(pose);
  const rate = spinRadPerSec(pose.augerDirection, pose.augerVelocityRaw, pose.halted);
  const coreRef = useSpin(pose.augerDirection === AugerDirection.SWITCH ? rate : 0);
  const screwRef = useSpin(pose.augerDirection === AugerDirection.DRILL ? rate : 0);

  const lift = coreOffsetY(pose.heightNorm);

  useEffect(() => {
    invalidate();
  }, [invalidate, lift, rate, c.core, c.screw, c.shell, c.body]);

  return (
    <group>
      <Barrel color={c.shell} />

      {/* Servo 11: stationary block at the barrel base. */}
      <mesh position={BASE_MOTOR_POS}>
        <boxGeometry args={[MOTOR.w, MOTOR.h, MOTOR.d]} />
        <meshStandardMaterial color={c.shell} />
      </mesh>

      <group position-y={lift}>
        <group ref={coreRef}>
          <mesh position-y={CORE_REST.center}>
            <cylinderGeometry args={[CORE.r, CORE.r, CORE.h, 24, 1, true]} />
            <meshStandardMaterial color={c.core} side={THREE.DoubleSide} transparent opacity={0.65} />
          </mesh>
          {/* Servo 12: rides on the core cap. */}
          <mesh position-y={CORE_REST.cap}>
            <boxGeometry args={[MOTOR.w, MOTOR.h, MOTOR.d]} />
            <meshStandardMaterial color={c.body} />
          </mesh>
          <group ref={screwRef} position-y={CORE_REST.screw}>
            <Screw color={c.screw} />
          </group>
        </group>
      </group>

      <ContainerDeck color={c.deck} />
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
