import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { fireEvent } from '@testing-library/react';
import teleop from './teleop';
import { AugerDirection, DrillCommand, DrillState, ServoState } from './proto/drill_pb';

const STATE_SUBJECT = 'waypoint.r1.module.drill.drill.state';
const CMD_SUBJECT = 'waypoint.r1.module.drill.drill.cmd';

// Mirrors the host teleop ctx: subscribe callbacks are captured per subject so a
// test can hand the window a DrillState frame, and publish is a spy over bytes.
function mountWindow() {
  const cbs = new Map<string, (b: Uint8Array) => void>();
  const off = vi.fn();
  const publish = vi.fn();
  const subjects: string[] = [];
  const ctx = {
    roverId: 'r1',
    subscribe: (subject: string, onBytes: (b: Uint8Array) => void) => {
      subjects.push(subject);
      cbs.set(subject, onBytes);
      return off;
    },
    publish,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let teardown: () => void = () => {};
  act(() => {
    teardown = teleop.mount(container, ctx as never);
  });
  return {
    subjects,
    off,
    publish,
    container,
    teardown,
    deliver: (state: DrillState) => {
      act(() => { cbs.get(STATE_SUBJECT)?.(state.toBinary()); });
    },
    byTestId: (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!,
    button: (text: string) =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text)!,
  };
}

function cmds(publish: ReturnType<typeof vi.fn>) {
  return publish.mock.calls.map((call: unknown[]) => {
    expect(call[0]).toBe(CMD_SUBJECT);
    return DrillCommand.fromBinary(call[1] as Uint8Array).action;
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('drill teleop window', () => {
  it('subscribes to the state subject and unsubscribes on teardown', () => {
    const { subjects, off, teardown } = mountWindow();
    expect(subjects).toContain(STATE_SUBJECT);
    act(() => teardown());
    expect(off).toHaveBeenCalled();
  });

  it('renders N/A with a reason everywhere before telemetry arrives', () => {
    const { byTestId, teardown } = mountWindow();
    expect(byTestId('teleop-height').textContent).toContain('N/A');
    expect(byTestId('teleop-height').textContent).toContain('awaiting telemetry');
    expect(byTestId('teleop-load').textContent).toContain('N/A');
    act(() => teardown());
  });

  it('shows the height N/A reason reported by the daemon', () => {
    const { byTestId, teardown, deliver } = mountWindow();
    deliver(new DrillState({ phase: 'idle', heightNaReason: 'unhomed' }));
    expect(byTestId('teleop-height').textContent).toContain('N/A');
    expect(byTestId('teleop-height').textContent).toContain('unhomed');
    act(() => teardown());
  });

  it('reads height in millimeters ahead of percent, and load from the auger servo', () => {
    const { byTestId, teardown, deliver } = mountWindow();
    deliver(new DrillState({
      heightMm: 42.4,
      heightNorm: 0.5,
      auger: new ServoState({ servoId: 12, loadRaw: -310 }),
    }));
    expect(byTestId('teleop-height').textContent).toContain('42.4 mm');
    expect(byTestId('teleop-load').textContent).toContain('-310');
    act(() => teardown());
  });

  it('turns the feed pill from awaiting to live once a frame lands', () => {
    const { container, teardown, deliver } = mountWindow();
    const feed = () => container.querySelector('[data-drill-feed]')!.textContent;
    expect(feed()).toContain('awaiting');
    deliver(new DrillState({ phase: 'idle' }));
    expect(feed()).toContain('live');
    act(() => teardown());
  });

  it('renders the d-pad legend for the 12/13/14/15 map', () => {
    const { byTestId, teardown } = mountWindow();
    const legend = byTestId('teleop-dpad-legend').textContent ?? '';
    for (const index of ['12', '13', '14', '15']) expect(legend).toContain(index);
    for (const action of ['lift up', 'lift down', 'drill', 'switch']) {
      expect(legend).toContain(action);
    }
    act(() => teardown());
  });

  it('publishes exactly one decodable stop on the stop button', () => {
    const { byTestId, publish, teardown } = mountWindow();
    act(() => { byTestId('teleop-stop').click(); });
    expect(cmds(publish)).toEqual([{ case: 'stop', value: true }]);
    act(() => teardown());
  });

  it('disables switch with its refusal reason and never publishes from it', () => {
    const { byTestId, publish, teardown, deliver } = mountWindow();
    deliver(new DrillState({ switchAllowed: false, switchRefusedReason: 'below top band' }));
    const btn = byTestId('teleop-hold-switch') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(byTestId('teleop-hold-switch').parentElement?.textContent).toContain('below top band');
    fireEvent.pointerDown(btn);
    expect(publish).not.toHaveBeenCalled();
    act(() => teardown());
  });

  it('enables switch once the daemon allows it', () => {
    const { byTestId, teardown, deliver } = mountWindow();
    deliver(new DrillState({ switchAllowed: true }));
    expect((byTestId('teleop-hold-switch') as HTMLButtonElement).disabled).toBe(false);
    act(() => teardown());
  });

  it('shows the halt reason when the daemon latches a halt', () => {
    const { byTestId, teardown, deliver } = mountWindow();
    deliver(new DrillState({ halted: true, haltReason: 'stale input' }));
    expect(byTestId('teleop-halted').textContent).toContain('stale input');
    act(() => teardown());
  });

  it('switches the viewport between 3d and 2d', () => {
    const { container, button, teardown } = mountWindow();
    act(() => { button('2d').click(); });
    expect(container.querySelector('[data-drill-2d]')).not.toBeNull();
    act(() => { button('3d').click(); });
    act(() => teardown());
  });
});

describe('drill teleop hold controls', () => {
  it('re-publishes a held jog and sends one zero on release', () => {
    vi.useFakeTimers();
    try {
      const { byTestId, publish, teardown } = mountWindow();
      const btn = byTestId('teleop-hold-up');

      fireEvent.pointerDown(btn);
      act(() => { vi.advanceTimersByTime(150); });
      const held = cmds(publish);
      expect(held.length).toBeGreaterThanOrEqual(3);
      for (const action of held) {
        expect(action.case).toBe('jogLift');
        if (action.case === 'jogLift') expect(action.value.velocityNorm).toBe(1);
      }

      publish.mockClear();
      fireEvent.pointerUp(btn);
      expect(cmds(publish)).toEqual([
        { case: 'jogLift', value: expect.objectContaining({ velocityNorm: 0 }) },
      ]);

      act(() => teardown());
    } finally {
      vi.useRealTimers();
    }
  });

  it('disarms a running hold on stop, before the halt shows up in telemetry', () => {
    vi.useFakeTimers();
    try {
      const { byTestId, publish, teardown } = mountWindow();
      const btn = byTestId('teleop-hold-drill');

      fireEvent.pointerDown(btn);
      act(() => { vi.advanceTimersByTime(100); });
      act(() => { byTestId('teleop-stop').click(); });
      publish.mockClear();

      // No drill.state frame has confirmed the halt yet; the still-down pointer
      // must not re-publish, or the daemon's halt latch is cleared again.
      act(() => { vi.advanceTimersByTime(300); });
      expect(publish).not.toHaveBeenCalled();

      act(() => teardown());
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a running hold when a halt lands and re-arms only on a new press', () => {
    vi.useFakeTimers();
    try {
      const { byTestId, publish, teardown, deliver } = mountWindow();
      const btn = byTestId('teleop-hold-drill');

      fireEvent.pointerDown(btn);
      act(() => { vi.advanceTimersByTime(100); });
      expect(publish.mock.calls.length).toBeGreaterThan(0);

      deliver(new DrillState({ halted: true, haltReason: 'operator stop' }));
      publish.mockClear();

      // Pointer is still down; the disarmed hold must stay silent.
      act(() => { vi.advanceTimersByTime(300); });
      fireEvent.pointerUp(btn);
      expect(publish).not.toHaveBeenCalled();

      deliver(new DrillState({ augerDirection: AugerDirection.IDLE }));
      fireEvent.pointerDown(btn);
      const again = cmds(publish);
      expect(again.length).toBe(1);
      expect(again[0].case).toBe('runAuger');

      act(() => teardown());
    } finally {
      vi.useRealTimers();
    }
  });
});
