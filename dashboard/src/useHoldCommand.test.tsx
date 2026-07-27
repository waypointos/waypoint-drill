import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BridgeProvider } from './bridge';
import { jogLiftCmd, runAugerCmd } from './commands';
import { useHoldCommand } from './useHoldCommand';
import { DrillCommand } from './proto/drill_pb';

const CMD_SUBJECT = 'waypoint.r1.module.drill.drill.cmd';

function Harness({ halted, disabled }: { halted: boolean; disabled?: boolean }) {
  const { active, handlers } = useHoldCommand({
    makeCmd: () => jogLiftCmd(1),
    makeZero: () => jogLiftCmd(0),
    halted,
    disabled,
  });
  return (
    <button type="button" data-testid="hold" aria-pressed={active} disabled={disabled} {...handlers}>
      up
    </button>
  );
}

function setup(props: { halted: boolean; disabled?: boolean } = { halted: false }) {
  const publish = vi.fn();
  const subscribe = vi.fn(() => () => {});
  const wrap = (children: ReactNode) => (
    <BridgeProvider value={{ roverId: 'r1', subscribe, publish }}>{children}</BridgeProvider>
  );
  const view = render(wrap(<Harness {...props} />));
  return {
    publish,
    btn: () => screen.getByTestId('hold'),
    set: (next: { halted: boolean; disabled?: boolean }) => view.rerender(wrap(<Harness {...next} />)),
    unmount: view.unmount,
  };
}

/** Every publish decoded back through the generated classes, newest last. */
function actions(publish: ReturnType<typeof vi.fn>) {
  return publish.mock.calls.map((call: unknown[]) => {
    expect(call[0]).toBe(CMD_SUBJECT);
    return DrillCommand.fromBinary(call[1] as Uint8Array).action;
  });
}

function jogs(publish: ReturnType<typeof vi.fn>): number[] {
  return actions(publish).map((a) => {
    if (a.case !== 'jogLift') throw new Error(`expected jogLift, got ${a.case}`);
    return a.value.velocityNorm;
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useHoldCommand cadence', () => {
  it('publishes on press then re-publishes every 50 ms', () => {
    const { publish, btn } = setup();
    fireEvent.pointerDown(btn());
    expect(jogs(publish)).toEqual([1]);

    act(() => { vi.advanceTimersByTime(150); });
    const sent = jogs(publish);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent.every((v) => v === 1)).toBe(true);
    expect(btn()).toHaveAttribute('aria-pressed', 'true');
  });

  it('publishes exactly one zero on release and then goes quiet', () => {
    const { publish, btn } = setup();
    fireEvent.pointerDown(btn());
    act(() => { vi.advanceTimersByTime(150); });
    const held = publish.mock.calls.length;

    fireEvent.pointerUp(btn());
    expect(publish.mock.calls.length).toBe(held + 1);
    expect(jogs(publish).at(-1)).toBe(0);
    expect(btn()).toHaveAttribute('aria-pressed', 'false');

    fireEvent.pointerUp(btn());
    act(() => { vi.advanceTimersByTime(500); });
    expect(publish.mock.calls.length).toBe(held + 1);
  });

  it('treats pointercancel as a release', () => {
    const { publish, btn } = setup();
    fireEvent.pointerDown(btn());
    fireEvent.pointerCancel(btn());
    expect(jogs(publish)).toEqual([1, 0]);
    act(() => { vi.advanceTimersByTime(500); });
    expect(jogs(publish)).toEqual([1, 0]);
  });

  it('treats pointerleave as a release', () => {
    const { publish, btn } = setup();
    fireEvent.pointerDown(btn());
    fireEvent.pointerLeave(btn());
    expect(jogs(publish)).toEqual([1, 0]);
  });

  it('treats a window blur as a release', () => {
    const { publish, btn } = setup();
    fireEvent.pointerDown(btn());
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(jogs(publish)).toEqual([1, 0]);
    act(() => { vi.advanceTimersByTime(500); });
    expect(jogs(publish)).toEqual([1, 0]);
  });

  it('stops the cadence when the component unmounts', () => {
    const { publish, btn, unmount } = setup();
    fireEvent.pointerDown(btn());
    const sent = publish.mock.calls.length;
    act(() => unmount());
    act(() => { vi.advanceTimersByTime(500); });
    expect(publish.mock.calls.length).toBe(sent);
  });
});

describe('useHoldCommand halt re-arm', () => {
  it('disarms a running hold when the state turns halted', () => {
    const { publish, btn, set } = setup({ halted: false });
    fireEvent.pointerDown(btn());
    act(() => { vi.advanceTimersByTime(100); });
    const held = publish.mock.calls.length;

    act(() => { set({ halted: true }); });
    expect(publish.mock.calls.length).toBe(held);
    expect(btn()).toHaveAttribute('aria-pressed', 'false');

    act(() => { vi.advanceTimersByTime(500); });
    expect(publish.mock.calls.length).toBe(held);
  });

  it('never resumes for a pointer still held through the halt', () => {
    const { publish, btn, set } = setup({ halted: false });
    fireEvent.pointerDown(btn());
    act(() => { set({ halted: true }); });
    const held = publish.mock.calls.length;

    // The daemon may clear its own halt while the operator is still pressing.
    act(() => { set({ halted: false }); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(publish.mock.calls.length).toBe(held);

    // A release after a halt-disarm sends nothing either; the axis is already stopped.
    fireEvent.pointerUp(btn());
    expect(publish.mock.calls.length).toBe(held);
  });

  it('re-arms on a fresh press after a halt', () => {
    const { publish, btn, set } = setup({ halted: false });
    fireEvent.pointerDown(btn());
    act(() => { set({ halted: true }); });
    publish.mockClear();

    fireEvent.pointerUp(btn());
    fireEvent.pointerDown(btn());
    expect(jogs(publish)).toEqual([1]);
    expect(btn()).toHaveAttribute('aria-pressed', 'true');

    act(() => { vi.advanceTimersByTime(100); });
    expect(publish.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('useHoldCommand arbitration', () => {
  function Trio() {
    const up = useHoldCommand({
      makeCmd: () => jogLiftCmd(1),
      makeZero: () => jogLiftCmd(0),
      halted: false,
    });
    const down = useHoldCommand({
      makeCmd: () => jogLiftCmd(-1),
      makeZero: () => jogLiftCmd(0),
      halted: false,
    });
    const drill = useHoldCommand({
      makeCmd: () => runAugerCmd(1),
      makeZero: () => runAugerCmd(0),
      halted: false,
    });
    return (
      <>
        <button type="button" data-testid="up" aria-pressed={up.active} {...up.handlers}>up</button>
        <button type="button" data-testid="down" aria-pressed={down.active} {...down.handlers}>
          down
        </button>
        <button type="button" data-testid="drill" aria-pressed={drill.active} {...drill.handlers}>
          drill
        </button>
      </>
    );
  }

  function mountTrio() {
    const publish = vi.fn();
    const subscribe = vi.fn(() => () => {});
    render(
      <BridgeProvider value={{ roverId: 'r1', subscribe, publish }}>
        <Trio />
      </BridgeProvider>,
    );
    return publish;
  }

  it('releases the opposing hold on the same axis when a second one is pressed', () => {
    const publish = mountTrio();

    fireEvent.pointerDown(screen.getByTestId('up'));
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.pointerDown(screen.getByTestId('down'));

    // Up yields with its zero, then only down keeps the axis fed.
    expect(jogs(publish).slice(-2)).toEqual([0, -1]);
    expect(screen.getByTestId('up')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('down')).toHaveAttribute('aria-pressed', 'true');

    publish.mockClear();
    act(() => { vi.advanceTimersByTime(150); });
    const after = jogs(publish);
    expect(after.length).toBeGreaterThanOrEqual(3);
    expect(after.every((v) => v === -1)).toBe(true);
  });

  it('keeps a lift hold and an auger hold running together', () => {
    const publish = mountTrio();

    fireEvent.pointerDown(screen.getByTestId('down'));
    fireEvent.pointerDown(screen.getByTestId('drill'));
    expect(screen.getByTestId('down')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('drill')).toHaveAttribute('aria-pressed', 'true');

    // Drilling means feeding down while the auger turns, and the daemon holds
    // both intents on one source clock, so both cadences must keep running.
    publish.mockClear();
    act(() => { vi.advanceTimersByTime(150); });
    const cases = actions(publish).map((a) => a.case);
    expect(cases).toContain('jogLift');
    expect(cases).toContain('runAuger');
  });
});

describe('useHoldCommand gating', () => {
  it('never publishes while disabled', () => {
    const { publish, btn } = setup({ halted: false, disabled: true });
    fireEvent.pointerDown(btn());
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.pointerUp(btn());
    expect(publish).not.toHaveBeenCalled();
  });

  it('stops an active hold when the control is gated mid-press', () => {
    const { publish, btn, set } = setup({ halted: false });
    fireEvent.pointerDown(btn());
    act(() => { set({ halted: false, disabled: true }); });
    expect(jogs(publish)).toEqual([1, 0]);
    act(() => { vi.advanceTimersByTime(500); });
    expect(jogs(publish)).toEqual([1, 0]);
  });
});
