// DRILL hero card: the live render as the tab's lead, over a readout strip of
// the three numbers an operator watches while jogging. Height follows the wire
// precedence (mm, then percent, then ticks); anything absent stays absent and
// carries the reason the daemon gave.
import { AugerDirection } from '../proto/drill_pb';
import { AWAITING, type HeightReadout } from '../useDrillTelemetry';
import { Panel } from '../ui/Panel';
import { DrillViewport, type DrillPose } from './DrillViewport';
import styles from './HeroCard.module.css';

const DIR_LABEL: Record<AugerDirection, string> = {
  [AugerDirection.UNSPECIFIED]: '',
  [AugerDirection.IDLE]: 'idle',
  [AugerDirection.DRILL]: 'drill',
  [AugerDirection.SWITCH]: 'switch',
};

function Cell({ label, value, reason, testId }: {
  label: string;
  value: string | null;
  reason: string;
  testId?: string;
}) {
  return (
    <div className={styles.cell} data-testid={testId}>
      <span className={styles.cellLbl}>{label}</span>
      {value === null ? (
        <>
          <span className={styles.na}>N/A</span>
          <span className={styles.reason}>{reason}</span>
        </>
      ) : (
        <span className={styles.val}>{value}</span>
      )}
    </div>
  );
}

export function HeroCard({ pose, height, haltReason, awaiting }: {
  pose: DrillPose;
  height: HeightReadout;
  haltReason: string;
  /** True until the first drill.state frame; separates silence from a bad read. */
  awaiting: boolean;
}) {
  const dir = DIR_LABEL[pose.augerDirection] || null;
  const speed = pose.augerVelocityRaw;

  return (
    <Panel title="DRILL" note="live render">
      <DrillViewport pose={pose} variant="hero" />

      <div className={styles.strip}>
        <Cell
          label="height"
          value={height.text}
          reason={height.reason}
          testId="hero-height"
        />
        <Cell
          label="auger"
          value={dir}
          reason={awaiting ? AWAITING : 'direction not reported'}
          testId="hero-auger"
        />
        <Cell
          label="auger speed"
          value={speed == null ? null : `${speed} raw`}
          reason={awaiting ? AWAITING : 'speed register not read'}
          testId="hero-auger-speed"
        />
      </div>

      {pose.halted ? (
        <p className={styles.halted} data-testid="hero-halted">
          HALTED · {haltReason || 'reason not reported'}
        </p>
      ) : null}
    </Panel>
  );
}
