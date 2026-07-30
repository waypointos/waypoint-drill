// HEIGHT card: the lift axis. Travel bar plus the four things an operator does
// to it, each gated exactly where the daemon gates it and carrying the reason
// when it is closed: jog is always available, goto needs a calibrated span,
// marking the bottom needs a top anchor.
//
// The lift has no hard stops, so both ends are marked by hand: jog to the end,
// then press the mark. Neither mark commands a servo.
import { useState } from 'react';
import { useBridge } from '../bridge';
import { cmdSubject, gotoHeightCmd, jogLiftCmd, setBottomCmd, setTopCmd } from '../commands';
import type { CalibrationEvent, DrillState } from '../proto/drill_pb';
import { isLiftCal, type HeightReadout } from '../useDrillTelemetry';
import { Panel } from '../ui/Panel';
import { HoldButton } from './HoldButton';
import styles from './HeightCard.module.css';

const GOTO_STEP = 1;

function calNote(cal: CalibrationEvent): string {
  const parts = [cal.phase || 'unknown'];
  if (cal.detail) parts.push(cal.detail);
  if (cal.travelTicks != null) parts.push(`travel ${cal.travelTicks} ticks`);
  return parts.join(' · ');
}

export function HeightCard({ state, height, cal, halted }: {
  state: DrillState | null;
  height: HeightReadout;
  cal: CalibrationEvent | null;
  halted: boolean;
}) {
  const { roverId, publish } = useBridge();
  const [target, setTarget] = useState(0);

  const send = (bytes: Uint8Array) => publish(cmdSubject(roverId), bytes);

  const calibrated = state?.calibrated ?? false;
  const homed = state?.homed ?? false;
  const norm = state?.heightNorm ?? null;
  const pct = norm === null ? null : Math.round(Math.min(1, Math.max(0, norm)) * 100);

  return (
    <Panel title="HEIGHT" note={height.text ?? 'N/A'}>
      <div className={styles.bar} data-testid="height-bar">
        <div className={styles.track}>
          {pct === null ? null : <div className={styles.fill} style={{ width: `${pct}%` }} />}
        </div>
        <div className={styles.scale}>
          <span>top</span>
          <span>bottom</span>
        </div>
        {/* The header note already carries the N/A; this line carries the why. */}
        {height.text === null ? (
          <p className={styles.reason} data-testid="height-na">{height.reason}</p>
        ) : null}
      </div>

      <div className={styles.grid}>
        <span className={styles.rowLabel}>jog</span>
        <div className={styles.controls}>
          <HoldButton
            label="jog up"
            makeCmd={() => jogLiftCmd(1)}
            makeZero={() => jogLiftCmd(0)}
            halted={halted}
            testId="jog-up"
          />
          <HoldButton
            label="jog down"
            makeCmd={() => jogLiftCmd(-1)}
            makeZero={() => jogLiftCmd(0)}
            halted={halted}
            testId="jog-down"
          />
        </div>

        <span className={styles.rowLabel}>goto</span>
        <div className={styles.controls}>
          <label className={styles.slider}>
            <input
              type="range"
              min={0}
              max={100}
              step={GOTO_STEP}
              value={target}
              disabled={!calibrated}
              onChange={(e) => setTarget(Number(e.target.value))}
              data-testid="goto-slider"
            />
            <span className={styles.sliderVal}>{target} %</span>
          </label>
          <button
            type="button"
            className={styles.btn}
            disabled={!calibrated}
            onClick={() => send(gotoHeightCmd(target / 100))}
            data-testid="goto-go"
          >
            Go
          </button>
        </div>
        {calibrated ? null : (
          <p className={`${styles.reason} ${styles.rowReason}`} data-testid="goto-reason">
            uncalibrated · run a travel calibration first
          </p>
        )}

        <span className={styles.rowLabel}>mark</span>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => send(setTopCmd())}
            data-testid="set-top"
          >
            Set top here
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled={!homed}
            onClick={() => send(setBottomCmd())}
            data-testid="set-bottom"
          >
            Set bottom here
          </button>
        </div>
        {!homed ? (
          <p className={`${styles.reason} ${styles.rowReason}`} data-testid="set-bottom-reason">
            unhomed · set the top first
          </p>
        ) : null}
      </div>

      {/* The weight card owns the tare/calibrate events on the shared leaf. */}
      {isLiftCal(cal) ? (
        <p className={styles.calNote} data-testid="cal-note">{calNote(cal)}</p>
      ) : null}
    </Panel>
  );
}
