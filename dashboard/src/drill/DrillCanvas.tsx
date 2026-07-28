// Canvas lifecycle for the drill render: camera presets, renderer prefs, lights
// and the context-loss remount. The scene graph is supplied as children.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { BARREL } from './geometry';

// Module-level stable references. The scene re-renders at telemetry rate, and
// fresh object literals would make R3F re-reconcile the renderer prefs on every
// frame, which can surface as a lost WebGL context.
const HERO_CAMERA = { position: [0.56, 0.45, 0.56] as const, fov: 45 };
const COMPACT_CAMERA = { position: [0.70, 0.51, 0.70] as const, fov: 45 };
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
// The assembly now hangs well below y = 0, so the framing centre drops.
const ORBIT_TARGET: [number, number, number] = [0, BARREL.h / 4, 0];
const LIGHT_POSITION: [number, number, number] = [3, 5, 2];

// Treats the GPU as fallible: prevents default on context loss so the browser
// will try to restore, and bumps a generation so the parent remounts the Canvas
// when it comes back.
function CanvasInit({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useEffect(() => {
    camera.lookAt(...ORBIT_TARGET);
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

export function DrillCanvas({
  variant,
  children,
}: {
  variant: 'hero' | 'compact';
  children: ReactNode;
}) {
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
      {children}
      <OrbitControls target={ORBIT_TARGET} enableDamping makeDefault />
    </Canvas>
  );
}
