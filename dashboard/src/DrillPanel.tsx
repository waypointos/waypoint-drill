// The drill tab ([ui.static] surface). Cards in the host dashboard's language:
// a 1fr/320px split with the live render and the controls in the centre column
// and a STATUS rail on the right.
//   center -> DRILL hero (render + readout strip), HEIGHT, AUGER, MOTORS, WEIGHT
//   rail   -> STATUS (feed pill, homed, calibrated, halted, switch, phase)
// Everything renders off the module's private subjects; an absent optional
// shows N/A with the daemon's own reason rather than a fake zero.
import { AugerDirection } from './proto/drill_pb';
import { AugerCard } from './drill/AugerCard';
import type { DrillPose } from './drill/DrillViewport';
import { HeightCard } from './drill/HeightCard';
import { HeroCard } from './drill/HeroCard';
import { MotorsCard } from './drill/MotorsCard';
import { WeightCard } from './drill/WeightCard';
import { Panel } from './ui/Panel';
import {
  AWAITING,
  readHeight,
  useAgeMs,
  useCalibration,
  useDrillState,
  useDrillStats,
} from './useDrillTelemetry';
import styles from './DrillPanel.module.css';

const STALE_AFTER_MS = 2_000;

export function DrillPanel() {
  const { state, lastAtMs } = useDrillState();
  const { stats } = useDrillStats();
  const cal = useCalibration();
  const ageMs = useAgeMs(lastAtMs);

  const halted = state?.halted ?? false;
  const height = readHeight(state);
  const pose: DrillPose = {
    heightNorm: state?.heightNorm ?? null,
    heightNaReason: state ? (state.heightNaReason.trim() || null) : AWAITING,
    augerDirection: state?.augerDirection ?? AugerDirection.UNSPECIFIED,
    augerVelocityRaw: state?.augerVelocityRaw ?? null,
    halted,
  };

  const stale = ageMs !== null && ageMs > STALE_AFTER_MS;
  const feed = ageMs === null
    ? { cls: styles.feedOff, text: AWAITING }
    : stale
      ? { cls: styles.feedStale, text: `stale · ${(ageMs / 1000).toFixed(0)}s` }
      : { cls: styles.feedLive, text: 'live' };

  const na = <span className={styles.na}>N/A</span>;

  return (
    <div className={styles.layout} data-drill-panel data-testid="panel-m-drill">
      <div className={styles.center}>
        <HeroCard
          pose={pose}
          height={height}
          haltReason={state?.haltReason ?? ''}
          awaiting={state === null}
        />
        <HeightCard state={state} height={height} cal={cal} halted={halted} />
        <AugerCard state={state} halted={halted} />
        <MotorsCard stats={stats} />
        <WeightCard />
      </div>

      <aside className={styles.rail}>
        <Panel title="STATUS">
          <div className={styles.status}>
            <div className={styles.statusRow}>
              <span className={styles.statusLbl}>feed</span>
              <span className={`${styles.feed} ${feed.cls}`} data-drill-feed>
                <span className={styles.dot} />{feed.text}
              </span>
            </div>
            <div className={styles.statusRow}>
              <span className={styles.statusLbl}>homed</span>
              {state
                ? <span className={state.homed ? styles.statusVal : styles.warn}>
                    {state.homed ? 'yes' : 'no'}
                  </span>
                : na}
            </div>
            <div className={styles.statusRow}>
              <span className={styles.statusLbl}>calibrated</span>
              {state
                ? <span className={state.calibrated ? styles.statusVal : styles.warn}>
                    {state.calibrated ? 'yes' : 'no'}
                  </span>
                : na}
            </div>
            <div className={styles.statusRow}>
              <span className={styles.statusLbl}>halted</span>
              {state
                ? <span className={state.halted ? styles.fault : styles.statusVal}>
                    {state.halted ? 'yes' : 'no'}
                  </span>
                : na}
            </div>
            {state?.halted ? (
              <p className={styles.note} data-drill-halt-reason>
                {state.haltReason || 'reason not reported'}
              </p>
            ) : null}
            <div className={styles.statusRow}>
              <span className={styles.statusLbl}>switch</span>
              {state
                ? <span className={state.switchAllowed ? styles.statusVal : styles.warn}>
                    {state.switchAllowed ? 'allowed' : 'blocked'}
                  </span>
                : na}
            </div>
            {state && !state.switchAllowed ? (
              <p className={styles.note}>{state.switchRefusedReason || 'reason not reported'}</p>
            ) : null}
            <div className={styles.statusRow}>
              <span className={styles.statusLbl}>phase</span>
              {state ? <span className={styles.statusVal}>{state.phase || 'unknown'}</span> : na}
            </div>
            {state?.lastRefusal ? (
              <div className={styles.statusRow}>
                <span className={styles.statusLbl}>refused</span>
                <span className={styles.note}>{state.lastRefusal}</span>
              </div>
            ) : null}
            {state ? null : <p className={styles.note}>no drill.state frames yet</p>}
          </div>
        </Panel>
      </aside>
    </div>
  );
}
