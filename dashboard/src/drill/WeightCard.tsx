// WEIGHT card: the three load cells under the plate and their total, plus the
// tare / known-mass flow that turns raw counts into grams. Values ride the
// sensor component's state leaf; a not-ok reading renders muted N/A with the
// reason, never a zero that reads as a real measurement.
import { Fragment, useState } from 'react';
import { useBridge } from '../bridge';
import { calibrateMassCmd, cmdSubject, tareCmd } from '../commands';
import type { SensorReadings } from '../proto/drill_pb';
import { AWAITING, readingByName, useCalibration, useWeight } from '../useDrillTelemetry';
import { Panel } from '../ui/Panel';
import styles from './WeightCard.module.css';

const CELLS = [
  { label: 'cell A', gram: 'cell_a_g', raw: 'cell_a_raw' },
  { label: 'cell B', gram: 'cell_b_g', raw: 'cell_b_raw' },
  { label: 'cell C', gram: 'cell_c_g', raw: 'cell_c_raw' },
];

const UNCALIBRATED = 'uncalibrated · tare, then a known mass';
const NOT_READING = 'cell not reading';

// The daemon reports weight refusals on the shared calibration leaf, where the
// lift's end marks also land; the action prefix is what tells them apart.
const WEIGHT_REFUSAL = /^(tare|calibrate):/;

function grams(v: number): string {
  return `${v.toFixed(1)} g`;
}

/** Raw counts still arriving while grams do not means the scale, not the cell. */
function reason(readings: SensorReadings | null, ...rawNames: string[]): string {
  if (readings === null) return AWAITING;
  return rawNames.every((n) => readingByName(readings, n)?.ok) ? UNCALIBRATED : NOT_READING;
}

export function WeightCard() {
  const { roverId, publish } = useBridge();
  const { readings } = useWeight();
  const cal = useCalibration();
  const [calOpen, setCalOpen] = useState(false);
  const [massText, setMassText] = useState('');

  const total = readingByName(readings, 'total_g');
  const mass = Number(massText);
  const massValid = massText.trim() !== '' && Number.isFinite(mass) && mass > 0;

  const note = cal && (cal.phase === 'tared' || cal.phase === 'calibrated'
    || (cal.phase === 'refused' && WEIGHT_REFUSAL.test(cal.detail)))
    ? [cal.phase, cal.detail].filter(Boolean).join(' · ')
    : null;

  return (
    <Panel title="WEIGHT" note="load cells">
      <div className={styles.total} data-testid="weight-total">
        {total?.ok && total.value != null
          ? <span className={styles.totalVal}>{grams(total.value)}</span>
          : (
            <>
              <span className={styles.totalNa}>N/A</span>
              <span className={styles.reason}>
                {reason(readings, ...CELLS.map((c) => c.raw))}
              </span>
            </>
          )}
      </div>

      <div className={styles.cells}>
        {CELLS.map((cell) => {
          const r = readingByName(readings, cell.gram);
          return (
            <Fragment key={cell.gram}>
              <span className={styles.lbl}>{cell.label}</span>
              <div className={styles.cellVal} data-testid={`weight-${cell.gram}`}>
                {r?.ok && r.value != null
                  ? <span className={styles.val}>{grams(r.value)}</span>
                  : (
                    <>
                      <span className={styles.na}>N/A</span>
                      <span className={styles.reason}>{reason(readings, cell.raw)}</span>
                    </>
                  )}
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.btn}
          onClick={() => publish(cmdSubject(roverId), tareCmd())}
          data-testid="weight-tare"
        >
          Tare
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => setCalOpen((open) => !open)}
          data-testid="weight-calibrate"
        >
          Calibrate
        </button>
      </div>

      {calOpen ? (
        <div className={styles.calForm}>
          <label className={styles.lbl} htmlFor="weight-known-mass">known mass (g)</label>
          <input
            id="weight-known-mass"
            className={styles.massInput}
            inputMode="decimal"
            value={massText}
            onChange={(e) => setMassText(e.target.value)}
          />
          <button
            type="button"
            className={styles.btn}
            disabled={!massValid}
            onClick={() => {
              publish(cmdSubject(roverId), calibrateMassCmd(mass));
              setCalOpen(false);
              setMassText('');
            }}
            data-testid="weight-apply"
          >
            Apply
          </button>
        </div>
      ) : null}

      {note ? <p className={styles.calNote} data-testid="weight-note">{note}</p> : null}
    </Panel>
  );
}
