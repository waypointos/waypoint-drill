// Parametric 3D render of the drill head, built from primitives so the module
// ships no mesh assets. Everything the scene draws comes from geometry.ts, and
// the only animated quantity is the auger spin.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AugerDirection } from '../proto/drill_pb';
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

// Module-level stable references. The scene re-renders at telemetry rate, and
// fresh object literals would make R3F re-reconcile the renderer prefs on every
// frame, which can surface as a lost WebGL context.
const HERO_CAMERA = { position: [0.35, 0.28, 0.35] as const, fov: 45 };
const COMPACT_CAMERA = { position: [0.44, 0.32, 0.44] as const, fov: 45 };
const DPR_RANGE: [number, number] = [1, 1.5];
const GL_PROPS = {
  alpha: true,
  antialias: true,
  powerPreference: 'low-power' as const,
  failIfMajorPerformanceCaveat: false,
  stencil: false,
  depth: true,
  preserveDrawingBuffer: false,
};
const CANVAS_STYLE = { background: 'transparent' as const };
const ORBIT_TARGET: [number, number, number] = [0, BARREL.h / 2, 0];
const LIGHT_POSITION: [number, number, number] = [3, 5, 2];

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

// Treats the GPU as fallible: prevents default on context loss so the browser
// will try to restore, and bumps a generation so the parent remounts the Canvas
// when it comes back.
function CanvasInit({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useEffect(() => {
    camera.lookAt(0, BARREL.h / 2, 0);
  }, [camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (e: Event) => { e.preventDefault(); onLost(); };
    const restored = () => onRestored();
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [gl, onLost, onRestored]);

  return null;
}

export function DrillScene({ pose, variant }: { pose: DrillPose; variant: 'hero' | 'compact' }) {
  // Bumping `generation` remounts Canvas after a context-restored event.
  const [generation, setGeneration] = useState(0);
  const onLost = useCallback(() => {
    if (typeof console !== 'undefined') console.warn('[drill3d] WebGL context lost');
  }, []);
  const onRestored = useCallback(() => {
    if (typeof console !== 'undefined') console.info('[drill3d] WebGL context restored, remounting canvas');
    setGeneration((g) => g + 1);
  }, []);

  return (
    <Canvas
      key={generation}
      camera={variant === 'compact' ? COMPACT_CAMERA : HERO_CAMERA}
      dpr={DPR_RANGE}
      gl={GL_PROPS}
      frameloop="demand"
      style={CANVAS_STYLE}
    >
      <CanvasInit onLost={onLost} onRestored={onRestored} />
      <ambientLight intensity={0.7} />
      <directionalLight position={LIGHT_POSITION} intensity={1.1} />
      <DrillRig pose={pose} />
      <OrbitControls target={ORBIT_TARGET} enableDamping makeDefault />
    </Canvas>
  );
}
