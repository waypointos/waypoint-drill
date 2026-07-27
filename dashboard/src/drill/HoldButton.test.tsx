import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BridgeProvider } from '../bridge';
import { runAugerCmd } from '../commands';
import { DrillCommand } from '../proto/drill_pb';
import { HoldButton } from './HoldButton';

type Props = Parameters<typeof HoldButton>[0];

function setup(overrides: Partial<Props> = {}) {
  const publish = vi.fn();
  const subscribe = vi.fn(() => () => {});
  const props: Props = {
    label: 'switch',
    makeCmd: () => runAugerCmd(-1),
    makeZero: () => runAugerCmd(0),
    halted: false,
    testId: 'hold-switch',
    ...overrides,
  };
  const wrap = (p: Props): ReactNode => (
    <BridgeProvider value={{ roverId: 'r1', subscribe, publish }}>
      <HoldButton {...p} />
    </BridgeProvider>
  );
  const view = render(wrap(props));
  return {
    publish,
    btn: () => screen.getByTestId('hold-switch'),
    set: (next: Partial<Props>) => view.rerender(wrap({ ...props, ...next })),
  };
}

function throttles(publish: ReturnType<typeof vi.fn>): number[] {
  return publish.mock.calls.map((call: unknown[]) => {
    expect(call[0]).toBe('waypoint.r1.module.drill.drill.cmd');
    const a = DrillCommand.fromBinary(call[1] as Uint8Array).action;
    if (a.case !== 'runAuger') throw new Error(`expected runAuger, got ${a.case}`);
    return a.value.throttle;
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HoldButton', () => {
  it('renders its label and is unpressed at rest', () => {
    const { btn } = setup();
    expect(btn()).toHaveTextContent('switch');
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks itself pressed while held and publishes the hold cadence', () => {
    const { publish, btn } = setup();
    fireEvent.pointerDown(btn());
    expect(btn()).toHaveAttribute('aria-pressed', 'true');

    act(() => { vi.advanceTimersByTime(150); });
    const sent = throttles(publish);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent.every((v) => v === -1)).toBe(true);

    fireEvent.pointerUp(btn());
    expect(throttles(publish).at(-1)).toBe(0);
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the muted reason when gated and never publishes', () => {
    const { publish, btn } = setup({ disabled: true, reason: 'below top band' });
    expect(btn()).toBeDisabled();
    expect(screen.getByText('below top band')).toBeInTheDocument();

    fireEvent.pointerDown(btn());
    act(() => { vi.advanceTimersByTime(200); });
    expect(publish).not.toHaveBeenCalled();
  });

  it('hides the reason once the control is allowed again', () => {
    const { btn, set } = setup({ disabled: true, reason: 'uncalibrated' });
    expect(screen.getByText('uncalibrated')).toBeInTheDocument();
    act(() => { set({ disabled: false }); });
    expect(screen.queryByText('uncalibrated')).toBeNull();
    expect(btn()).toBeEnabled();
  });

  it('cancels an active hold when the drill halts', () => {
    const { publish, btn, set } = setup();
    fireEvent.pointerDown(btn());
    act(() => { vi.advanceTimersByTime(100); });
    const held = publish.mock.calls.length;

    act(() => { set({ halted: true }); });
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
    act(() => { vi.advanceTimersByTime(500); });
    expect(publish.mock.calls.length).toBe(held);
  });
});
