// AUGER card: the two hold-to-move directions plus the load the servo reports
// while turning. Switch is the gated one; the daemon refuses it unless the core
// is calibrated and parked in the top band, and its reason is shown verbatim.
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

export function AugerCard({ state, halted }: { state: DrillState | null; halted: boolean }) {
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
      <div className={styles.head}>
        <span className={styles.lbl}>direction</span>
        {dir ? (
          <span className={styles.chip} data-drill-dir={dir}>{dir}</span>
        ) : (
          <span className={styles.chipNa} data-testid="auger-dir-na">N/A</span>
        )}
        {dir ? null : <span className={styles.reason}>{dirReason}</span>}
      </div>

      <div className={styles.row}>
        <HoldButton
          label="drill"
          makeCmd={() => runAugerCmd(1)}
          makeZero={() => runAugerCmd(0)}
          halted={halted}
          testId="auger-drill"
        />
        <HoldButton
          label="switch"
          makeCmd={() => runAugerCmd(-1)}
          makeZero={() => runAugerCmd(0)}
          halted={halted}
          disabled={!switchAllowed}
          reason={switchReason}
          testId="auger-switch"
        />
      </div>

      <div className={styles.readout}>
        <span className={styles.lbl}>load</span>
        {load == null ? (
          <>
            <span className={styles.na} data-testid="auger-load-na">N/A</span>
            <span className={styles.reason}>{loadReason}</span>
          </>
        ) : (
          <span className={styles.val} data-testid="auger-load">{load} raw</span>
        )}
      </div>
    </Panel>
  );
}
