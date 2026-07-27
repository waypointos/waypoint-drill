// MOTORS card: the raw register snapshot off the stats leaf, one row per servo
// in the order the daemon publishes them (lift first, auger second). A register
// the bus did not return renders muted N/A, never a zero that reads as a real
// measurement.
import type { DrillStats, ServoState } from '../proto/drill_pb';
import { Panel } from '../ui/Panel';
import styles from './MotorsCard.module.css';

// Default STS3215 ids; a frame that carries its own id wins, since a failed
// read can arrive with the id field unset.
const ROWS = [
  { slot: 'lift', fallbackId: 11 },
  { slot: 'auger', fallbackId: 12 },
];

function Num({ v }: { v: number | undefined }) {
  return v == null ? <span className={styles.na}>N/A</span> : <>{v}</>;
}

function Volts({ v }: { v: number | undefined }) {
  return v == null ? <span className={styles.na}>N/A</span> : <>{(v / 10).toFixed(1)}</>;
}

function StatusCell({ s }: { s: ServoState | undefined }) {
  if (!s || !s.ok) return <span className={styles.stOff}>no rd</span>;
  if (s.overcurrentTripped) return <span className={styles.stFault}>OC!</span>;
  if (s.moving) return <span className={styles.stMove}>mov</span>;
  return <span className={styles.stOk}>ok</span>;
}

function busVolts(servos: ServoState[]): string {
  for (const s of servos) {
    if (s.voltageDeci != null) return `${(s.voltageDeci / 10).toFixed(1)} V`;
  }
  return 'N/A';
}

export function MotorsCard({ stats }: { stats: DrillStats | null }) {
  const servos = stats?.servos ?? [];
  const live = servos.filter((s) => s.ok).length;
  const note = stats === null ? 'awaiting stats' : `${live}/${ROWS.length} live · STS3215`;

  return (
    <Panel title="MOTORS" note={note}>
      <table className={styles.detail} data-drill-motor-detail>
        <thead>
          <tr>
            <th>ID</th>
            <th>Pos</th>
            <th>Spd</th>
            <th>Load</th>
            <th>I</th>
            <th>V</th>
            <th>°C</th>
            <th>st</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, i) => {
            const s = servos[i];
            const id = s && s.servoId ? s.servoId : row.fallbackId;
            return (
              <tr key={row.slot} data-servo={id} data-slot={row.slot}>
                <td className={styles.detailId}>
                  {String(id).padStart(2, '0')} · {row.slot}
                </td>
                <td><Num v={s?.positionRaw} /></td>
                <td><Num v={s?.speedRaw} /></td>
                <td><Num v={s?.loadRaw} /></td>
                <td><Num v={s?.currentRaw} /></td>
                <td><Volts v={s?.voltageDeci} /></td>
                <td><Num v={s?.temperatureC} /></td>
                <td className={styles.st}><StatusCell s={s} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={8} className={styles.detailFoot}>
              Bus: {busVolts(servos)} · pos/spd/load/I raw ticks · V volts · °C
            </td>
          </tr>
          <tr>
            <td colSpan={8} className={styles.detailFoot}>
              {stats === null
                ? 'no stats frames yet'
                : 'N/A cells: the register was not returned by the bus'}
            </td>
          </tr>
        </tfoot>
      </table>
    </Panel>
  );
}
