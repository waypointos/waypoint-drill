// Live telemetry hooks for the drill tab and the teleop window.
//
// Four private module subjects feed the UI:
//   drill.state   20 Hz DrillState, the sole render source
//   stats         5 Hz DrillStats, raw per-servo registers for the MOTORS card
//   calibration   CalibrationEvent progress notes for the HEIGHT and WEIGHT cards
//   sensor.state  SensorReadings at the module's state rate, the load cells
// Every decode is guarded: a frame that does not parse is dropped rather than
// rendered, and absent optionals stay absent so the UI can say N/A with a reason.
import { useEffect, useState } from 'react';
import { useBridge } from './bridge';
import { CalibrationEvent, DrillState, DrillStats, SensorReadings } from './proto/drill_pb';
import { calibrationSubject, sensorStateSubject, stateSubject, statsSubject } from './commands';

export function useDrillState(): { state: DrillState | null; lastAtMs: number | null } {
  const { roverId, subscribe } = useBridge();
  const [state, setState] = useState<DrillState | null>(null);
  const [lastAtMs, setLastAtMs] = useState<number | null>(null);
  useEffect(() => {
    return subscribe(stateSubject(roverId), (b) => {
      let msg: DrillState;
      try { msg = DrillState.fromBinary(b); } catch { return; }
      setState(msg);
      setLastAtMs(Date.now());
    });
  }, [roverId, subscribe]);
  return { state, lastAtMs };
}

export function useDrillStats(): { stats: DrillStats | null; lastAtMs: number | null } {
  const { roverId, subscribe } = useBridge();
  const [stats, setStats] = useState<DrillStats | null>(null);
  const [lastAtMs, setLastAtMs] = useState<number | null>(null);
  useEffect(() => {
    return subscribe(statsSubject(roverId), (b) => {
      // The SDK's ModuleStats heartbeat shares this leaf. Read as DrillStats it
      // either fails outright or yields no servos, and must not blank the card.
      let msg: DrillStats;
      try { msg = DrillStats.fromBinary(b); } catch { return; }
      if (msg.servos.length === 0) return;
      setStats(msg);
      setLastAtMs(Date.now());
    });
  }, [roverId, subscribe]);
  return { stats, lastAtMs };
}

export function useCalibration(): CalibrationEvent | null {
  const { roverId, subscribe } = useBridge();
  const [event, setEvent] = useState<CalibrationEvent | null>(null);
  useEffect(() => {
    return subscribe(calibrationSubject(roverId), (b) => {
      try { setEvent(CalibrationEvent.fromBinary(b)); } catch { /* ignore malformed */ }
    });
  }, [roverId, subscribe]);
  return event;
}

// The lift's end marks and the weight tare/calibrate share one calibration
// leaf, so each card has to ignore the other's events. The phase names split
// them everywhere except "refused", where the daemon's action prefix does.
const WEIGHT_REFUSAL = /^(tare|calibrate):/;

/** True for the weight side of the shared calibration leaf. */
export function isWeightCal(cal: CalibrationEvent | null): cal is CalibrationEvent {
  if (cal === null) return false;
  if (cal.phase === 'tared' || cal.phase === 'calibrated') return true;
  return cal.phase === 'refused' && WEIGHT_REFUSAL.test(cal.detail);
}

const LOADEST_REFUSAL = /^(lift baseline|auger baseline):/;

/** True for the lift side of the shared calibration leaf. */
export function isLiftCal(cal: CalibrationEvent | null): cal is CalibrationEvent {
  if (cal === null) return false;
  if (cal.phase === 'top_set' || cal.phase === 'bottom_set') return true;
  return cal.phase === 'refused'
    && !WEIGHT_REFUSAL.test(cal.detail)
    && !LOADEST_REFUSAL.test(cal.detail);
}

/** True for the load estimate side of the shared calibration leaf. */
export function isLoadEstCal(cal: CalibrationEvent | null): cal is CalibrationEvent {
  if (cal === null) return false;
  if (cal.phase === 'lift_baseline_set' || cal.phase === 'auger_baseline_set') return true;
  return cal.phase === 'refused' && LOADEST_REFUSAL.test(cal.detail);
}

export function useWeight(): { readings: SensorReadings | null; lastAtMs: number | null } {
  const { roverId, subscribe } = useBridge();
  const [readings, setReadings] = useState<SensorReadings | null>(null);
  const [lastAtMs, setLastAtMs] = useState<number | null>(null);
  useEffect(() => {
    return subscribe(sensorStateSubject(roverId), (b) => {
      let msg: SensorReadings;
      try { msg = SensorReadings.fromBinary(b); } catch { return; }
      setReadings(msg);
      setLastAtMs(Date.now());
    });
  }, [roverId, subscribe]);
  return { readings, lastAtMs };
}

/** One sensor.state frame reduced to the named series; null carries N/A. */
export type SensorPoint = { atMs: number; values: Record<string, number | null> };

const HISTORY_CAPACITY = 1200; // ~2 minutes at the sensor component's 10 Hz

/** Ring buffer of named readings for the plot lanes. */
export function useSensorHistory(names: string[], capacity = HISTORY_CAPACITY): SensorPoint[] {
  const { roverId, subscribe } = useBridge();
  const [points, setPoints] = useState<SensorPoint[]>([]);
  // The names array is rebuilt on every render, so the effect keys off its
  // contents rather than its identity.
  const key = names.join(',');
  useEffect(() => {
    setPoints([]);
    return subscribe(sensorStateSubject(roverId), (b) => {
      let msg: SensorReadings;
      try { msg = SensorReadings.fromBinary(b); } catch { return; }
      const values: Record<string, number | null> = {};
      for (const name of key.split(',')) {
        const r = msg.readings.find((x) => x.name === name);
        values[name] = r?.ok && r.value != null ? r.value : null;
      }
      setPoints((prev) => {
        const next = prev.length >= capacity ? prev.slice(prev.length - capacity + 1) : prev.slice();
        next.push({ atMs: Date.now(), values });
        return next;
      });
    });
  }, [roverId, subscribe, key, capacity]);
  return points;
}

/** Finds one named reading; null when absent so callers render N/A. */
export function readingByName(rs: SensorReadings | null, name: string) {
  return rs?.readings.find((r) => r.name === name) ?? null;
}

/** Shown wherever a value is absent because no frame has landed yet. */
export const AWAITING = 'awaiting telemetry';

/** One height cell: a formatted value, or null with the reason it is absent. */
export type HeightReadout = { text: string | null; reason: string };

/**
 * Height precedence, most derived field first: mm needs a tick scale, percent
 * needs a calibrated span, ticks need a home anchor. Nothing present means the
 * axis said why, and that reason is what the operator sees. Panel and teleop
 * window read through here so both surfaces show the same number.
 */
export function readHeight(state: DrillState | null): HeightReadout {
  if (!state) return { text: null, reason: AWAITING };
  if (state.heightMm != null) return { text: `${state.heightMm.toFixed(1)} mm`, reason: '' };
  if (state.heightNorm != null) {
    return { text: `${(state.heightNorm * 100).toFixed(0)} %`, reason: '' };
  }
  if (state.heightTicks != null) return { text: `${state.heightTicks} ticks`, reason: '' };
  return { text: null, reason: state.heightNaReason.trim() || 'reason not reported' };
}

/** Re-renders on a 500 ms tick so feed-age labels stay current between frames. */
export function useAgeMs(lastAtMs: number | null): number | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return lastAtMs === null ? null : Date.now() - lastAtMs;
}
