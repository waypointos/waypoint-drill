// LOAD card: servo-derived load estimates plotted over the last two minutes.
// Two canvas lanes because the units differ: grams (lift force estimate plus
// the load cell total when live) and N-mm (auger torque estimate). A not-ok
// sample breaks the line; nothing is ever plotted as zero.
import { useEffect, useRef } from 'react';
import { useBridge } from '../bridge';
import { captureAugerBaselineCmd, captureLiftBaselineCmd, cmdSubject } from '../commands';
import type { DrillState } from '../proto/drill_pb';
import {
  AWAITING,
  isLoadEstCal,
  useAgeMs,
  useCalibration,
  useSensorHistory,
  type SensorPoint,
} from '../useDrillTelemetry';
import { Panel } from '../ui/Panel';
import styles from './LoadPlotCard.module.css';

const LIFT = 'lift_force_est_g';
const AUGER = 'auger_torque_est_nmm';
const TOTAL = 'total_g';
const SERIES = [LIFT, AUGER, TOTAL];

// Module-scope so the lanes' redraw effects key off stable identities.
const GRAMS_NAMES = [LIFT, TOTAL];
const GRAMS_TOKENS = ['--color-accent', '--color-fg-4'];
const NMM_NAMES = [AUGER];
const NMM_TOKENS = ['--color-accent'];

const STALE = 'sensor feed stale';
const NOT_READING = 'not reading';
// Below this raw speed a wheel-mode servo counts as standing still, matching
// the daemon's own gate.
const IDLE_SPEED_RAW = 20;

// A live frame can outlive the module that sent it, so the card ages the feed
// itself rather than trusting the last values.
const STALE_AFTER_MS = 2_000;

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Draws one lane: named series against the shared time window. */
function drawLane(
  canvas: HTMLCanvasElement,
  points: SensorPoint[],
  names: string[],
  tokens: string[],
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, w * dpr);
  canvas.height = Math.max(1, h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (points.length < 2) return;

  const t0 = points[0].atMs;
  const t1 = points[points.length - 1].atMs;
  const span = Math.max(t1 - t0, 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    for (const n of names) {
      const v = p.values[n];
      if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  if (!Number.isFinite(lo)) return;
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;

  const X = (t: number) => ((t - t0) / span) * w;
  const Y = (v: number) => h - ((v - lo) / (hi - lo)) * h;

  // Zero rule, so a sign change reads at a glance.
  if (lo < 0 && hi > 0) {
    ctx.strokeStyle = cssVar('--color-border');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Y(0));
    ctx.lineTo(w, Y(0));
    ctx.stroke();
  }

  names.forEach((name, i) => {
    ctx.strokeStyle = cssVar(tokens[i]);
    ctx.lineWidth = 1.5;
    let open = false;
    ctx.beginPath();
    for (const p of points) {
      const v = p.values[name];
      if (v == null) { open = false; continue; } // N/A breaks the line
      if (!open) { ctx.moveTo(X(p.atMs), Y(v)); open = true; } else ctx.lineTo(X(p.atMs), Y(v));
    }
    ctx.stroke();
  });
}

function Lane({ points, names, tokens, testId }: {
  points: SensorPoint[];
  names: string[];
  tokens: string[];
  testId: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // A resize can arrive long after the last frame, so the observer reads the
  // history through a ref rather than closing over the one it was created with.
  const latest = useRef(points);

  useEffect(() => {
    latest.current = points;
    const cv = ref.current;
    if (cv) drawLane(cv, points, names, tokens);
  }, [points, names, tokens]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => drawLane(cv, latest.current, names, tokens));
    ro.observe(cv);
    return () => ro.disconnect();
  }, [names, tokens]);

  return (
    <div className={styles.lane}>
      <canvas ref={ref} className={styles.canvas} data-testid={testId} />
    </div>
  );
}

/**
 * Reason precedence mirrors the daemon's validity rules; the card cannot see
 * which one tripped, so it reports the first plausible cause from state.
 */
function liftReason(state: DrillState | null): string {
  if (!state) return AWAITING;
  const lift = state.lift;
  if (!lift?.ok || lift.loadRaw == null || lift.speedRaw == null) return NOT_READING;
  const speed = lift.speedRaw;
  if (Math.abs(speed) < IDLE_SPEED_RAW) return 'lift idle';
  // Down is -lift_up_sign; the reference assembly's up sign is -1, so down is +.
  if (speed < 0) return 'moving up';
  return 'no baseline · capture during a free-air descent';
}

function augerReason(state: DrillState | null): string {
  if (!state) return AWAITING;
  const auger = state.auger;
  if (!auger?.ok || auger.loadRaw == null || auger.speedRaw == null) return NOT_READING;
  if (Math.abs(auger.speedRaw) < IDLE_SPEED_RAW) return 'auger idle';
  return 'estimate settling';
}

function Readout({ text, reason, testId }: { text: string | null; reason: string; testId: string }) {
  return (
    <div className={styles.val} data-testid={testId}>
      {text !== null
        ? <span className={styles.num}>{text}</span>
        : (
          <>
            <span className={styles.na}>N/A</span>
            <span className={styles.reason}>{reason}</span>
          </>
        )}
    </div>
  );
}

export function LoadPlotCard({ state }: { state: DrillState | null }) {
  const { roverId, publish } = useBridge();
  const points = useSensorHistory(SERIES);
  const last = points.length > 0 ? points[points.length - 1] : null;
  const ageMs = useAgeMs(last?.atMs ?? null);
  const cal = useCalibration();

  const stale = ageMs !== null && ageMs > STALE_AFTER_MS;
  const read = (name: string) => (stale || last === null ? null : last.values[name]);
  const feedReason = last === null ? AWAITING : stale ? STALE : null;
  const lift = read(LIFT);
  const auger = read(AUGER);

  const note = isLoadEstCal(cal) ? [cal.phase, cal.detail].filter(Boolean).join(' · ') : null;

  return (
    <Panel title="LOAD" note="servo estimate">
      <div className={styles.head}>
        <span className={styles.lbl}>lift force</span>
        <Readout
          text={lift != null ? `${lift.toFixed(1)} g` : null}
          reason={feedReason ?? liftReason(state)}
          testId="loadest-lift-val"
        />
      </div>
      <Lane points={points} names={GRAMS_NAMES} tokens={GRAMS_TOKENS} testId="loadest-grams-lane" />
      <p className={styles.legend}>
        <span className={styles.keyEst} />estimate
        <span className={styles.keyCells} />load cells
      </p>

      <div className={styles.head}>
        <span className={styles.lbl}>auger torque</span>
        <Readout
          text={auger != null ? `${auger.toFixed(1)} nmm` : null}
          reason={feedReason ?? augerReason(state)}
          testId="loadest-auger-val"
        />
      </div>
      <Lane points={points} names={NMM_NAMES} tokens={NMM_TOKENS} testId="loadest-nmm-lane" />

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.btn}
          onClick={() => publish(cmdSubject(roverId), captureLiftBaselineCmd())}
          data-testid="loadest-lift-baseline"
        >
          Lift baseline
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => publish(cmdSubject(roverId), captureAugerBaselineCmd())}
          data-testid="loadest-auger-baseline"
        >
          Auger baseline
        </button>
      </div>

      {note ? <p className={styles.calNote} data-testid="loadest-note">{note}</p> : null}
    </Panel>
  );
}
