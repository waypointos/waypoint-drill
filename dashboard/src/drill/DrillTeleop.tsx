// Teleop window content for the drill. The host owns the frame (title bar,
// drag, resize, close); this fills it at the frame's 620x460 default and stays
// usable at its 320x260 minimum. Renders purely from drill.state and publishes
// only drill.cmd, so the window can be opened next to a live gamepad without
// the two fighting over a private channel.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useBridge } from '../bridge';
import { AugerDirection, type DrillState } from '../proto/drill_pb';
import { cmdSubject, jogLiftCmd, runAugerCmd, stopCmd } from '../commands';
import { AWAITING, readHeight, useAgeMs, useDrillState } from '../useDrillTelemetry';
import { DrillViewport, type DrillPose } from './DrillViewport';
import { HoldButton } from './HoldButton';
import styles from './DrillTeleop.module.css';

const STALE_AFTER_MS = 2_000;

/** Opening auger speed, as a fraction of the configured per-direction ceiling. */
const DEFAULT_SPEED_PCT = 60;

// W3C standard gamepad D-pad indices, the same map the daemon reads
// (internal/teleop/input.go). The legend exists so an operator on a pad can
// see which physical button drives which axis without leaving the window.
const DPAD = [
  { index: 12, glyph: '↑', action: 'lift up' },
  { index: 13, glyph: '↓', action: 'lift down' },
  { index: 14, glyph: '←', action: 'drill' },
  { index: 15, glyph: '→', action: 'switch' },
] as const;

const DIRECTION_LABEL: Record<number, string> = {
  [AugerDirection.IDLE]: 'idle',
  [AugerDirection.DRILL]: 'drill',
  [AugerDirection.SWITCH]: 'switch',
};

type Reading = { text: string | null; reason: string };

function augerReading(state: DrillState | null): Reading {
  if (!state) return { text: null, reason: AWAITING };
  const label = DIRECTION_LABEL[state.augerDirection];
  return label ? { text: label, reason: '' } : { text: null, reason: 'direction not reported' };
}

function speedReading(state: DrillState | null): Reading {
  if (!state) return { text: null, reason: AWAITING };
  if (state.augerVelocityRaw === undefined) return { text: null, reason: 'speed register not read' };
  return { text: `${state.augerVelocityRaw}`, reason: '' };
}

function loadReading(state: DrillState | null): Reading {
  if (!state) return { text: null, reason: AWAITING };
  const load = state.auger?.loadRaw;
  if (load === undefined) return { text: null, reason: 'load register not read' };
  return { text: `${load}`, reason: '' };
}

function Row({ label, reading, sub, testId }: {
  label: string;
  reading: Reading;
  sub?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={styles.row} data-testid={testId}>
      <div className={styles.rowHead}>
        <span className={styles.rowLabel}>{label}</span>
        {reading.text === null
          ? <span className={styles.na}>N/A</span>
          : <span className={styles.value}>{reading.text}</span>}
      </div>
      {reading.text === null ? <span className={styles.hint}>{reading.reason}</span> : null}
      {sub}
    </div>
  );
}

export function DrillTeleop() {
  const { roverId, publish } = useBridge();
  const { state, lastAtMs } = useDrillState();
  const ageMs = useAgeMs(lastAtMs);

  const halted = state?.halted ?? false;
  const switchAllowed = state?.switchAllowed ?? false;
  const switchReason = state
    ? (state.switchRefusedReason.trim() || 'not permitted')
    : AWAITING;

  // The daemon's halt latch is only visible one drill.state frame later, and any
  // nonzero command in that window clears it again. A stop therefore disarms the
  // on-screen holds locally until a frame confirms the halt.
  // Scales only the on-screen holds. The gamepad D-pad is an independent source
  // and stays at full throttle, since a pad operator cannot see this control.
  const [speedPct, setSpeedPct] = useState(DEFAULT_SPEED_PCT);
  const throttle = speedPct / 100;

  const [stopped, setStopped] = useState(false);
  const stop = useCallback(() => {
    setStopped(true);
    publish(cmdSubject(roverId), stopCmd());
  }, [publish, roverId]);
  useEffect(() => {
    if (halted) setStopped(false);
  }, [halted, lastAtMs]);
  const holdsHalted = halted || stopped;

  const heightNorm = state?.heightNorm ?? null;
  const heightNaReason = state ? (state.heightNaReason.trim() || null) : AWAITING;
  const augerDirection = state?.augerDirection ?? AugerDirection.UNSPECIFIED;
  const augerVelocityRaw = state?.augerVelocityRaw ?? null;
  // A fresh DrillState arrives 20 times a second; the scene only needs to
  // re-render when a value it actually draws changes.
  const pose = useMemo<DrillPose>(
    () => ({ heightNorm, heightNaReason, augerDirection, augerVelocityRaw, halted }),
    [heightNorm, heightNaReason, augerDirection, augerVelocityRaw, halted],
  );

  const stale = ageMs !== null && ageMs > STALE_AFTER_MS;
  const feed = ageMs === null
    ? { cls: styles.feedOff, text: 'awaiting' }
    : stale
      ? { cls: styles.feedStale, text: `stale · ${(ageMs / 1000).toFixed(0)}s` }
      : { cls: styles.feedLive, text: 'live' };

  return (
    <div className={styles.window} data-testid="teleop-w-drill">
      <div className={styles.main}>
        <div className={styles.stage}>
          <DrillViewport pose={pose} variant="compact" />
        </div>

        <div className={styles.rail}>
          <div className={styles.strip}>
            <Row label="height" reading={readHeight(state)} testId="teleop-height" />
            <Row
              label="auger"
              reading={augerReading(state)}
              testId="teleop-auger"
              sub={<SubReading label="speed" reading={speedReading(state)} />}
            />
            <Row label="load" reading={loadReading(state)} testId="teleop-load" />
          </div>

          {halted ? (
            <p className={styles.halted} data-testid="teleop-halted">
              halted{state?.haltReason ? ` · ${state.haltReason}` : ''}
            </p>
          ) : null}

          <button type="button" className={styles.stop} onClick={stop} data-testid="teleop-stop">
            STOP
          </button>

          <div className={styles.holds}>
            <HoldButton
              label="lift up"
              makeCmd={() => jogLiftCmd(1)}
              makeZero={() => jogLiftCmd(0)}
              halted={holdsHalted}
              testId="teleop-hold-up"
            />
            <HoldButton
              label="lift down"
              makeCmd={() => jogLiftCmd(-1)}
              makeZero={() => jogLiftCmd(0)}
              halted={holdsHalted}
              testId="teleop-hold-down"
            />
            <HoldButton
              label="drill"
              makeCmd={() => runAugerCmd(throttle)}
              makeZero={() => runAugerCmd(0)}
              halted={holdsHalted}
              testId="teleop-hold-drill"
            />
            <HoldButton
              label="switch"
              makeCmd={() => runAugerCmd(-throttle)}
              makeZero={() => runAugerCmd(0)}
              halted={holdsHalted}
              disabled={!switchAllowed}
              reason={switchReason}
              testId="teleop-hold-switch"
            />
          </div>

          <label className={styles.speed}>
            <span className={styles.speedLbl}>auger speed</span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={speedPct}
              onChange={(e) => setSpeedPct(Number(e.target.value))}
              aria-label="auger speed"
              data-testid="teleop-auger-speed"
            />
            <span className={styles.speedVal}>{speedPct} %</span>
          </label>

          <dl className={styles.legend} data-testid="teleop-dpad-legend">
            <dt className={styles.legendTitle}>d-pad</dt>
            {DPAD.map((b) => (
              <dd key={b.index} className={styles.legendRow}>
                <span className={styles.legendKey}>{b.glyph} {b.index}</span>
                <span className={styles.legendAction}>{b.action}</span>
              </dd>
            ))}
          </dl>
        </div>
      </div>

      <footer className={styles.foot}>
        <span className={`${styles.feed} ${feed.cls}`} data-drill-feed>
          <span className={styles.feedDot} />{feed.text}
        </span>
        <span>phase {state?.phase.trim() || 'N/A'}</span>
        <span className={styles.footSpacer} />
        {state?.lastRefusal ? (
          <span className={styles.refusal}>refused · {state.lastRefusal}</span>
        ) : null}
      </footer>
    </div>
  );
}

function SubReading({ label, reading }: { label: string; reading: Reading }) {
  return (
    <span className={styles.sub}>
      {label}{' '}
      {reading.text === null
        ? <span className={styles.na}>N/A <span className={styles.hint}>{reading.reason}</span></span>
        : <span className={styles.value}>{reading.text}</span>}
    </span>
  );
}
