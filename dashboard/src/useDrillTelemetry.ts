// Live telemetry hooks for the drill tab and the teleop window.
//
// Four private module subjects feed the UI:
//   drill.state   20 Hz DrillState, the sole render source
//   stats         5 Hz DrillStats, raw per-servo registers for the MOTORS card
//   calibration   CalibrationEvent progress notes for the HEIGHT and WEIGHT cards
//   sensor.state  10 Hz SensorReadings, the load cells for the WEIGHT card
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
