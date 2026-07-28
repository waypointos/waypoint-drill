// Canvas schematic of the drill: side elevation built from the same geometry
// constants as the 3D scene. Cheap always-available view, and the fallback the
// viewport switches to when WebGL is unavailable. An unknown height draws the
// core at its raised limit with a muted N/A marker, never at a made-up depth.
import { useEffect, useRef } from 'react';
import { AugerDirection } from '../proto/drill_pb';
import type { DrillPose } from './DrillScene';
import { binSpans } from './parts/hopper';
import {
  BARREL,
  BASE_PLATE,
  BASE_PLATE_RIM,
  CORE,
  CORE_CAP,
  CORE_MOUTH_TOP_Y,
  HOPPER,
  MOTOR,
  PINION,
  SAMPLE_WINDOW_Y,
  SCREW,
  SCREW_FLIGHT_OUTER_R,
  SCREW_SHAFT_R,
  SCREW_TURNS,
  coreMouthY,
  screwTipY,
} from './geometry';
import styles from './Drill2DScene.module.css';

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** World box the elevation fits into, from the hopper floor to the raised cap. */
export function elevationBounds() {
  return {
    yMin: HOPPER.y0 - 0.01,
    yMax: CORE_MOUTH_TOP_Y + CORE.h + CORE_CAP.h + MOTOR.h + 0.02,
    xHalf: HOPPER.outerR + 0.01,
  };
}

const PAD = 0.9;
const BIN_TICK_H = 0.006;

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

  const view = elevationBounds();
  const worldW = view.xHalf * 2;
  const worldH = view.yMax - view.yMin;
  const scale = Math.min(vw / worldW, vh / worldH) * PAD;
  const ox = vw / 2;
  const oy = vh / 2 + ((view.yMax + view.yMin) / 2) * scale;
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
  // The hopper reads as background so it does not compete with the column.
  const deckColor = C.fg4;

  // Sample hopper: conical throat, outer walls, and one tick per bin.
  const hopperH = HOPPER.y1 - HOPPER.y0;
  ctx.strokeStyle = deckColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(X(s * HOPPER.coneBottomR), Y(HOPPER.y0));
    ctx.lineTo(X(s * HOPPER.throatR), Y(HOPPER.y1));
  }
  ctx.moveTo(X(-HOPPER.outerR), Y(HOPPER.y0));
  ctx.lineTo(X(HOPPER.outerR), Y(HOPPER.y0));
  ctx.stroke();
  for (const s of [-1, 1]) {
    const outer = s * HOPPER.outerR;
    const inner = s * (HOPPER.outerR - HOPPER.wallThickness);
    ctx.strokeRect(
      X(Math.min(outer, inner)),
      Y(HOPPER.y1),
      Math.abs(outer - inner) * scale,
      hopperH * scale,
    );
  }
  ctx.beginPath();
  const binR = (HOPPER.coneBottomR + HOPPER.outerR) / 2;
  for (const span of binSpans()) {
    const mid = ((span.fromDeg + span.toDeg) / 2) * Math.PI / 180;
    const bx = X(binR * Math.cos(mid));
    ctx.moveTo(bx, Y(HOPPER.y0));
    ctx.lineTo(bx, Y(HOPPER.y0 + BIN_TICK_H));
  }
  ctx.stroke();

  // Base plate the column stands on, body and rim as one section.
  ctx.strokeStyle = shellColor;
  ctx.lineWidth = 1.2;
  for (const s of [-1, 1]) {
    const a = s * BASE_PLATE.boreR;
    const b = s * BASE_PLATE.outerR;
    ctx.strokeRect(
      X(Math.min(a, b)),
      Y(BASE_PLATE_RIM.y1),
      Math.abs(b - a) * scale,
      (BASE_PLATE_RIM.y1 - BASE_PLATE.y0) * scale,
    );
  }

  // Barrel walls, broken where the sample windows cross the elevation plane.
  ctx.strokeStyle = shellColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    const wx = X(s * BARREL.r);
    ctx.moveTo(wx, Y(0));
    ctx.lineTo(wx, Y(SAMPLE_WINDOW_Y.y0));
    ctx.moveTo(wx, Y(SAMPLE_WINDOW_Y.y1));
    ctx.lineTo(wx, Y(BARREL.h));
  }
  ctx.moveTo(X(-BARREL.r), Y(0));
  ctx.lineTo(X(BARREL.r), Y(0));
  ctx.moveTo(X(-BARREL.r), Y(BARREL.h));
  ctx.lineTo(X(BARREL.r), Y(BARREL.h));
  ctx.stroke();

  // Lift pinion, on the left because its CAD azimuth is 270 deg.
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(X(-PINION.centerR), Y(PINION.centerY), PINION.tipR * scale, 0, Math.PI * 2);
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

  // Core column, its cap, and the servo 12 block riding on top.
  ctx.strokeStyle = coreColor;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(X(-CORE.r), Y(mouth + CORE.h), CORE.r * 2 * scale, CORE.h * scale);
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(
    X(-CORE_CAP.r),
    Y(mouth + CORE.h + CORE_CAP.h),
    CORE_CAP.r * 2 * scale,
    CORE_CAP.h * scale,
  );
  ctx.strokeRect(
    X(-MOTOR.w / 2),
    Y(mouth + CORE.h + CORE_CAP.h + MOTOR.h),
    MOTOR.w * scale,
    MOTOR.h * scale,
  );

  // Auger flight envelope: both ribbon edges plus the shaft, so it reads as a
  // flight rather than a single wire.
  ctx.strokeStyle = screwColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const steps = Math.ceil(SCREW_TURNS * 24);
  for (const s of [-1, 1]) {
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const px = X(s * SCREW_FLIGHT_OUTER_R * Math.cos(t * SCREW_TURNS * Math.PI * 2));
      const py = Y(tip + t * SCREW.h);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }
  for (const s of [-1, 1]) {
    ctx.moveTo(X(s * SCREW_SHAFT_R), Y(tip));
    ctx.lineTo(X(s * SCREW_SHAFT_R), Y(tip + SCREW.h));
  }
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
