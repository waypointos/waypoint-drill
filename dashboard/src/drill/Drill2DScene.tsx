// Canvas schematic of the drill: side elevation built from the same geometry
// constants as the 3D scene. Cheap always-available view, and the fallback the
// viewport switches to when WebGL is unavailable. An unknown height draws the
// core at its raised limit with a muted N/A marker, never at a made-up depth.
import { useEffect, useRef } from 'react';
import { AugerDirection } from '../proto/drill_pb';
import type { DrillPose } from './DrillScene';
import {
  BARREL,
  BARREL_RING_H,
  BARREL_SLOTS,
  CONTAINER,
  CONTAINERS,
  CORE,
  CORE_MOUTH_TOP_Y,
  MOTOR,
  PLATE,
  PLATE_THICKNESS,
  PLATE_TOP_Y,
  SCREW,
  SCREW_TURNS,
  coreMouthY,
  screwTipY,
} from './geometry';
import styles from './Drill2DScene.module.css';

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// World box the elevation fits into, with headroom for the raised core cap.
const VIEW = {
  yMin: PLATE_TOP_Y - PLATE_THICKNESS - 0.02,
  yMax: CORE_MOUTH_TOP_Y + CORE.h + MOTOR.h + 0.02,
  xHalf: PLATE.w / 2 + 0.02,
};
const PAD = 0.9;

function draw(cv: HTMLCanvasElement, pose: DrillPose) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const vw = cv.clientWidth || 1;
  const vh = cv.clientHeight || 1;
  cv.width = Math.max(1, vw * dpr);
  cv.height = Math.max(1, vh * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);

  const C = {
    border: cssVar('--color-border'),
    fg2: cssVar('--color-fg-2'),
    fg3: cssVar('--color-fg-3'),
    fg4: cssVar('--color-fg-4'),
    accent: cssVar('--color-accent'),
  };
  const mono = cssVar('--font-mono') || 'monospace';

  const worldW = VIEW.xHalf * 2;
  const worldH = VIEW.yMax - VIEW.yMin;
  const scale = Math.min(vw / worldW, vh / worldH) * PAD;
  const ox = vw / 2;
  const oy = vh / 2 + ((VIEW.yMax + VIEW.yMin) / 2) * scale;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy - y * scale;

  // Ground grid, faint enough to read as a backdrop.
  ctx.strokeStyle = C.border;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = ox % 26; x < vw; x += 26) { ctx.moveTo(x, 0); ctx.lineTo(x, vh); }
  for (let y = oy % 26; y < vh; y += 26) { ctx.moveTo(0, y); ctx.lineTo(vw, y); }
  ctx.stroke();
  ctx.globalAlpha = 1;

  const halted = pose.halted;
  const bodyColor = halted ? C.fg4 : C.fg2;
  const shellColor = halted ? C.fg4 : C.fg3;
  const screwColor = halted
    ? C.fg4
    : pose.augerDirection === AugerDirection.DRILL ? C.accent : bodyColor;
  const coreColor = halted
    ? C.fg4
    : pose.augerDirection === AugerDirection.SWITCH ? C.accent : bodyColor;

  // Container plate with its container marks.
  ctx.strokeStyle = shellColor;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(
    X(-PLATE.w / 2),
    Y(PLATE_TOP_Y),
    PLATE.w * scale,
    PLATE_THICKNESS * scale,
  );
  const step = PLATE.w / (CONTAINERS + 1);
  ctx.strokeStyle = C.fg4;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < CONTAINERS; i += 1) {
    const cx = (i + 1) * step - PLATE.w / 2;
    ctx.strokeRect(
      X(cx - CONTAINER.r),
      Y(PLATE_TOP_Y + CONTAINER.h),
      CONTAINER.r * 2 * scale,
      CONTAINER.h * scale,
    );
  }

  // Barrel walls, drawn with the sample windows left open.
  const slotTop = BARREL.h - BARREL_RING_H;
  const slotBot = BARREL_RING_H;
  const bandH = (slotTop - slotBot) / BARREL_SLOTS;
  ctx.strokeStyle = shellColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    const wx = X(s * BARREL.r);
    ctx.moveTo(wx, Y(0));
    ctx.lineTo(wx, Y(slotBot));
    for (let i = 0; i < BARREL_SLOTS; i += 1) {
      const gapA = slotBot + i * bandH + bandH * 0.25;
      const gapB = slotBot + i * bandH + bandH * 0.75;
      ctx.moveTo(wx, Y(gapA));
      ctx.lineTo(wx, Y(gapB));
    }
    ctx.moveTo(wx, Y(slotTop));
    ctx.lineTo(wx, Y(BARREL.h));
  }
  ctx.moveTo(X(-BARREL.r), Y(0));
  ctx.lineTo(X(BARREL.r), Y(0));
  ctx.moveTo(X(-BARREL.r), Y(BARREL.h));
  ctx.lineTo(X(BARREL.r), Y(BARREL.h));
  ctx.stroke();

  // Servo 11 block at the barrel base.
  ctx.strokeStyle = shellColor;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(
    X(BARREL.r + 0.006),
    Y(MOTOR.h),
    MOTOR.w * scale,
    MOTOR.h * scale,
  );

  const mouth = coreMouthY(pose.heightNorm);
  const tip = screwTipY(pose.heightNorm);

  // Core column and the servo 12 block riding on its cap.
  ctx.strokeStyle = coreColor;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(X(-CORE.r), Y(mouth + CORE.h), CORE.r * 2 * scale, CORE.h * scale);
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(
    X(-MOTOR.w / 2),
    Y(mouth + CORE.h + MOTOR.h),
    MOTOR.w * scale,
    MOTOR.h * scale,
  );

  // Screw flight, the helix projected onto the elevation plane.
  ctx.strokeStyle = screwColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const steps = SCREW_TURNS * 24;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const px = X(SCREW.r * Math.cos(t * SCREW_TURNS * Math.PI * 2));
    const py = Y(tip + t * SCREW.h);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(X(0), Y(tip));
  ctx.lineTo(X(0), Y(tip + SCREW.h));
  ctx.stroke();

  if (pose.heightNorm == null) {
    ctx.fillStyle = C.fg4;
    ctx.font = `10px ${mono}`;
    ctx.fillText('height N/A', X(CORE.r) + 8, Y(mouth + CORE.h / 2));
  }
}

export function Drill2DScene({ pose }: { pose: DrillPose }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // A resize can arrive long after the last frame, so the observer reads the
  // pose through a ref rather than closing over the one it was created with.
  const posed = useRef(pose);

  useEffect(() => {
    posed.current = pose;
    const cv = ref.current;
    if (!cv) return;
    draw(cv, pose);
  }, [pose]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw(cv, posed.current));
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  return <canvas ref={ref} className={styles.canvas} data-drill-2d />;
}
