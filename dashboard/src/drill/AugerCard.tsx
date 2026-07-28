// AUGER card: speed, the two hold-to-move directions, and the load the servo
// reports while turning. Switch is the gated one; the daemon refuses it unless
// the core is calibrated and parked in the top band, and its reason is shown
// verbatim.
//
// Speed is a fraction of the configured per-direction ceiling (drill_speed,
// switch_speed), so switch stays gentle at 100% while drill does not. A hold
// re-publishes every 50 ms, so dragging the slider mid-hold takes effect.
import { useState } from 'react';
import { AugerDirection, type DrillState } from '../proto/drill_pb';
import { runAugerCmd } from '../commands';
import { AWAITING } from '../useDrillTelemetry';
import { Panel } from '../ui/Panel';
import { HoldButton } from './HoldButton';
import styles from './AugerCard.module.css';

const DIR_LABEL: Record<AugerDirection, string> = {
  [AugerDirection.UNSPECIFIED]: '',
  [AugerDirection.IDLE]: 'idle',
  [AugerDirection.DRILL]: 'drill',
  [AugerDirection.SWITCH]: 'switch',
};

/** Opening speed, low enough to be a safe default on an unfamiliar hole. */
const DEFAULT_SPEED_PCT = 60;

export function AugerCard({ state, halted }: { state: DrillState | null; halted: boolean }) {
  const [speedPct, setSpeedPct] = useState(DEFAULT_SPEED_PCT);
  const throttle = speedPct / 100;
  const dir = state ? DIR_LABEL[state.augerDirection] : '';
  const switchAllowed = state?.switchAllowed ?? false;
  const switchReason = state
    ? state.switchRefusedReason || 'not allowed'
    : AWAITING;
  const dirReason = state ? 'direction not reported' : AWAITING;
  const load = state?.auger?.loadRaw;
  const loadReason = state ? 'load register not read' : AWAITING;

  return (
    <Panel title="AUGER" note="hold to turn">
      <div className={styles.grid}>
        <span className={styles.lbl}>direction</span>
        <div className={styles.controls}>
          {dir ? (
            <span className={styles.chip} data-drill-dir={dir}>{dir}</span>
          ) : (
            <>
              <span className={styles.chipNa} data-testid="auger-dir-na">N/A</span>
              <span className={styles.reason}>{dirReason}</span>
            </>
          )}
        </div>

        <span className={styles.lbl}>speed</span>
        <div className={styles.controls}>
          <label className={styles.slider}>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={speedPct}
              onChange={(e) => setSpeedPct(Number(e.target.value))}
              aria-label="auger speed"
              data-testid="auger-speed"
            />
            <span className={styles.sliderVal}>{speedPct} %</span>
          </label>
        </div>

        <span className={styles.lbl}>run</span>
        <div className={styles.controls}>
          <HoldButton
            label="drill"
            makeCmd={() => runAugerCmd(throttle)}
            makeZero={() => runAugerCmd(0)}
            halted={halted}
            testId="auger-drill"
          />
          <HoldButton
            label="switch"
            makeCmd={() => runAugerCmd(-throttle)}
            makeZero={() => runAugerCmd(0)}
            halted={halted}
            disabled={!switchAllowed}
            reason={switchReason}
            testId="auger-switch"
          />
        </div>

        <span className={styles.lbl}>load</span>
        <div className={styles.controls}>
          {load == null ? (
            <>
              <span className={styles.na} data-testid="auger-load-na">N/A</span>
              <span className={styles.reason}>{loadReason}</span>
            </>
          ) : (
            <span className={styles.val} data-testid="auger-load">{load} raw</span>
          )}
        </div>
      </div>
    </Panel>
  );
}
