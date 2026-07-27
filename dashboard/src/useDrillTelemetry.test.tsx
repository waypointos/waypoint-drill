import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BridgeProvider } from './bridge';
import { calibrationSubject, stateSubject, statsSubject } from './commands';
import {
  useAgeMs,
  useCalibration,
  useDrillState,
  useDrillStats,
} from './useDrillTelemetry';
import {
  CalibrationEvent,
  DrillState,
  DrillStats,
  ServoState,
} from './proto/drill_pb';

// Hand-encoded SDK ModuleStats frames (field 1 Stamp, field 2 uint64 uptime_s).
// They share the stats leaf with DrillStats and must never reach the card.
const HEARTBEAT_WITH_UPTIME = new Uint8Array([0x0a, 0x00, 0x10, 0x07]);
const HEARTBEAT_IDLE = new Uint8Array([0x0a, 0x00]);

function harness() {
  const feeds = new Map<string, (b: Uint8Array) => void>();
  const unsub = vi.fn();
  const subscribe = vi.fn((subject: string, onBytes: (b: Uint8Array) => void) => {
    feeds.set(subject, onBytes);
    return () => {
      feeds.delete(subject);
      unsub();
    };
  });
  const publish = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BridgeProvider value={{ roverId: 'r1', subscribe, publish }}>{children}</BridgeProvider>
  );
  const feed = (subject: string, bytes: Uint8Array) => {
    const cb = feeds.get(subject);
    if (!cb) throw new Error(`no subscriber for ${subject}`);
    act(() => cb(bytes));
  };
  return { subscribe, unsub, wrapper, feed };
}

const sample = () =>
  new DrillStats({
    servos: [
      new ServoState({ servoId: 11, positionRaw: 1200, ok: true }),
      new ServoState({ servoId: 12, loadRaw: -40, ok: true }),
    ],
  }).toBinary();

describe('useDrillState', () => {
  it('subscribes to the double-leaf state subject and decodes frames', () => {
    const { subscribe, wrapper, feed } = harness();
    const { result } = renderHook(() => useDrillState(), { wrapper });
    expect(subscribe).toHaveBeenCalledWith('waypoint.r1.module.drill.drill.state', expect.any(Function));
    expect(result.current.state).toBeNull();
    expect(result.current.lastAtMs).toBeNull();

    feed(stateSubject('r1'), new DrillState({ phase: 'jog', heightNorm: 0.5, homed: true }).toBinary());
    expect(result.current.state?.phase).toBe('jog');
    expect(result.current.state?.heightNorm).toBe(0.5);
    expect(result.current.lastAtMs).not.toBeNull();
  });

  it('keeps absent optionals absent instead of zeroing them', () => {
    const { wrapper, feed } = harness();
    const { result } = renderHook(() => useDrillState(), { wrapper });
    feed(stateSubject('r1'), new DrillState({ heightNaReason: 'unhomed' }).toBinary());
    expect(result.current.state?.heightNorm).toBeUndefined();
    expect(result.current.state?.heightTicks).toBeUndefined();
    expect(result.current.state?.heightNaReason).toBe('unhomed');
  });

  it('drops a malformed frame and keeps the last good one', () => {
    const { wrapper, feed } = harness();
    const { result } = renderHook(() => useDrillState(), { wrapper });
    feed(stateSubject('r1'), new DrillState({ phase: 'idle' }).toBinary());
    feed(stateSubject('r1'), new Uint8Array([0xff, 0xff, 0xff]));
    expect(result.current.state?.phase).toBe('idle');
  });

  it('unsubscribes on unmount', () => {
    const { unsub, wrapper } = harness();
    const { unmount } = renderHook(() => useDrillState(), { wrapper });
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});

describe('useDrillStats', () => {
  it('decodes a DrillStats frame', () => {
    const { subscribe, wrapper, feed } = harness();
    const { result } = renderHook(() => useDrillStats(), { wrapper });
    expect(subscribe).toHaveBeenCalledWith('waypoint.r1.module.drill.stats', expect.any(Function));
    feed(statsSubject('r1'), sample());
    expect(result.current.stats?.servos.map((s) => s.servoId)).toEqual([11, 12]);
  });

  it('ignores the SDK heartbeat without clearing the last good frame', () => {
    const { wrapper, feed } = harness();
    const { result } = renderHook(() => useDrillStats(), { wrapper });
    feed(statsSubject('r1'), sample());
    const before = result.current.lastAtMs;

    feed(statsSubject('r1'), HEARTBEAT_WITH_UPTIME);
    feed(statsSubject('r1'), HEARTBEAT_IDLE);

    expect(result.current.stats?.servos).toHaveLength(2);
    expect(result.current.lastAtMs).toBe(before);
  });

  it('never surfaces a servo-less frame as data', () => {
    const { wrapper, feed } = harness();
    const { result } = renderHook(() => useDrillStats(), { wrapper });
    feed(statsSubject('r1'), new DrillStats().toBinary());
    expect(result.current.stats).toBeNull();
    expect(result.current.lastAtMs).toBeNull();
  });
});

describe('useCalibration', () => {
  it('surfaces the latest phase and drops malformed frames', () => {
    const { wrapper, feed } = harness();
    const { result } = renderHook(() => useCalibration(), { wrapper });
    expect(result.current).toBeNull();

    feed(calibrationSubject('r1'), new CalibrationEvent({ phase: 'run_down' }).toBinary());
    expect(result.current?.phase).toBe('run_down');

    feed(calibrationSubject('r1'), new Uint8Array([0xff, 0xff, 0xff]));
    expect(result.current?.phase).toBe('run_down');

    feed(calibrationSubject('r1'), new CalibrationEvent({ phase: 'done', travelTicks: 4096n }).toBinary());
    expect(result.current?.phase).toBe('done');
    expect(result.current?.travelTicks).toBe(4096n);
  });
});

describe('useAgeMs', () => {
  it('is null without a frame and ticks upward once fed', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ at }: { at: number | null }) => useAgeMs(at), {
        initialProps: { at: null as number | null },
      });
      expect(result.current).toBeNull();

      rerender({ at: Date.now() });
      expect(result.current).toBe(0);

      act(() => { vi.advanceTimersByTime(1_000); });
      expect(result.current).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
