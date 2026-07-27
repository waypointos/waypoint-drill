// Hold-to-move publisher for the on-screen jog, drill and switch controls.
//
// The daemon ages every hold source on its own deadman (stale_input_ms, 150 ms
// by default) and stops the axis when a source goes quiet, so a held button has
// to keep re-publishing. Releasing sends one zero, which stops without latching
// a halt.
//
// Halt re-arm: the daemon's cmd path has no server-side arming latch, so any
// nonzero command clears the halt. The re-arm is enforced here instead. A halt
// disarms the running hold and the still-down pointer is ignored; only a new
// press moves anything again.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEventHandler } from 'react';
import { useBridge } from './bridge';
import { cmdSubject } from './commands';
import { DrillCommand } from './proto/drill_pb';

/** Re-publish period of an active hold, well inside the 150 ms deadman. */
export const HOLD_PERIOD_MS = 50;

// One hold per axis. Two opposing holds on the same axis (jog up and jog down
// under two fingers) would overwrite each other's command every tick and leave
// the axis alternating; holds on different axes stay independent, so drilling
// while feeding down keeps working.
const activeHolds = new Map<string, { current: () => void }>();

/** Axis a hold owns, read from the command it publishes: jogLift or runAuger. */
function axisOf(zero: Uint8Array): string {
  try {
    return DrillCommand.fromBinary(zero).action.case ?? 'hold';
  } catch {
    return 'hold';
  }
}

export type HoldOptions = {
  /** Encoded command sent on press and on every tick. */
  makeCmd: () => Uint8Array;
  /** Encoded zero of the same command, sent exactly once on release. */
  makeZero: () => Uint8Array;
  halted: boolean;
  disabled?: boolean;
};

export type HoldHandlers = {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onPointerLeave: PointerEventHandler<HTMLElement>;
};

export type Hold = { active: boolean; handlers: HoldHandlers };

export function useHoldCommand({ makeCmd, makeZero, halted, disabled = false }: HoldOptions): Hold {
  const { roverId, publish } = useBridge();
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const armed = useRef(false);

  const subject = cmdSubject(roverId);
  const latest = useRef({ makeCmd, makeZero, publish, subject, disabled });
  useEffect(() => {
    latest.current = { makeCmd, makeZero, publish, subject, disabled };
  });

  // This hold's release, held in a stable box so it doubles as its identity in
  // the per-axis registry above, plus the axis key it claimed on press.
  const releaseRef = useRef<() => void>(() => {});
  const axis = useRef<string | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  // Disarm sends nothing: on a halt the daemon has already zero-written both
  // servos, and a zero here would be indistinguishable from a release.
  const disarm = useCallback(() => {
    stopTimer();
    armed.current = false;
    setActive(false);
    if (axis.current !== null && activeHolds.get(axis.current) === releaseRef) {
      activeHolds.delete(axis.current);
    }
  }, [stopTimer]);

  const release = useCallback(() => {
    if (!armed.current) return;
    disarm();
    latest.current.publish(latest.current.subject, latest.current.makeZero());
  }, [disarm]);
  useEffect(() => {
    releaseRef.current = release;
  }, [release]);

  const press = useCallback(() => {
    const l = latest.current;
    if (l.disabled) return;
    if (axis.current === null) axis.current = axisOf(l.makeZero());
    const held = activeHolds.get(axis.current);
    if (held !== undefined && held !== releaseRef) held.current();
    activeHolds.set(axis.current, releaseRef);
    stopTimer();
    armed.current = true;
    setActive(true);
    l.publish(l.subject, l.makeCmd());
    timer.current = setInterval(() => {
      const tick = latest.current;
      tick.publish(tick.subject, tick.makeCmd());
    }, HOLD_PERIOD_MS);
  }, [stopTimer]);

  useEffect(() => {
    if (!armed.current) return;
    if (halted) {
      disarm();
      return;
    }
    if (disabled) release();
  }, [halted, disabled, disarm, release]);

  useEffect(() => {
    const onBlur = () => release();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [release]);

  // Teardown only stops the cadence; the daemon's deadman stops the axis.
  useEffect(() => () => {
    stopTimer();
    if (axis.current !== null && activeHolds.get(axis.current) === releaseRef) {
      activeHolds.delete(axis.current);
    }
  }, [stopTimer]);

  const handlers = useMemo<HoldHandlers>(() => ({
    onPointerDown: () => press(),
    onPointerUp: () => release(),
    onPointerCancel: () => release(),
    onPointerLeave: () => release(),
  }), [press, release]);

  return { active, handlers };
}
