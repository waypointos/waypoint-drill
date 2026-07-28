import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BridgeProvider } from './bridge';
import { DrillPanel } from './DrillPanel';
import { AugerDirection, CalibrationEvent, DrillCommand, DrillState, DrillStats } from './proto/drill_pb';

const CMD = 'waypoint.r1.module.drill.drill.cmd';

function setup() {
  const publish = vi.fn();
  const deliver = new Map<string, (b: Uint8Array) => void>();
  const subscribe = (subject: string, onBytes: (b: Uint8Array) => void) => {
    deliver.set(subject, onBytes);
    return () => {};
  };
  const view = render(
    <BridgeProvider value={{ roverId: 'r1', subscribe, publish }}>
      <DrillPanel />
    </BridgeProvider>,
  );
  const send = (leaf: string, bytes: Uint8Array) => {
    const fn = deliver.get(`waypoint.r1.module.drill.${leaf}`);
    if (!fn) throw new Error(`no subscriber for ${leaf}`);
    act(() => fn(bytes));
  };
  return { publish, send, view };
}

function cmds(publish: ReturnType<typeof vi.fn>): DrillCommand[] {
  return publish.mock.calls
    .filter((call: unknown[]) => call[0] === CMD)
    .map((call: unknown[]) => DrillCommand.fromBinary(call[1] as Uint8Array));
}

describe('DrillPanel', () => {
  it('renders N/A with awaiting reasons and gates every gated control before telemetry', () => {
    setup();

    expect(screen.getByTestId('panel-m-drill')).toBeInTheDocument();
    expect(screen.getByTestId('hero-height')).toHaveTextContent('N/A');
    expect(screen.getByTestId('hero-height')).toHaveTextContent('awaiting telemetry');
    // Before the first frame nothing has been read, so no cell may claim a
    // register failed; every reason is the same "no frames yet".
    expect(screen.getByTestId('hero-auger')).toHaveTextContent('N/A');
    expect(screen.getByTestId('hero-auger')).toHaveTextContent('awaiting telemetry');
    expect(screen.getByTestId('hero-auger-speed')).toHaveTextContent('awaiting telemetry');
    expect(screen.getByTestId('hero-auger-speed')).not.toHaveTextContent('register');
    expect(screen.getByTestId('auger-load-na')).toHaveTextContent('N/A');
    expect(screen.getByTestId('auger-dir-na').parentElement).toHaveTextContent('awaiting telemetry');
    expect(screen.getByTestId('viewport-height-na')).toHaveTextContent('awaiting telemetry');
    expect(document.querySelector('[data-drill-feed]')!.textContent).toContain('awaiting');

    // Gated controls: goto needs a calibrated span, switch needs the daemon's
    // allowance, the bottom mark needs a top anchor. Jog and the top mark stay open.
    expect(screen.getByTestId('goto-go')).toBeDisabled();
    expect(screen.getByTestId('auger-switch')).toBeDisabled();
    expect(screen.getByTestId('set-bottom')).toBeDisabled();
    expect(screen.getByTestId('jog-up')).toBeEnabled();
    expect(screen.getByTestId('jog-down')).toBeEnabled();
    expect(screen.getByTestId('set-top')).toBeEnabled();
  });

  it('shows the height N/A reason the daemon reported', () => {
    const { send } = setup();
    send('drill.state', new DrillState({ heightNaReason: 'unhomed', phase: 'idle' }).toBinary());

    expect(screen.getByTestId('hero-height')).toHaveTextContent('unhomed');
    expect(screen.getByTestId('height-na')).toHaveTextContent('unhomed');
  });

  it('prefers millimetres over percent and ticks', () => {
    const { send } = setup();
    send('drill.state', new DrillState({
      heightMm: 42.25,
      heightNorm: 0.5,
      heightTicks: 2100n,
    }).toBinary());

    expect(screen.getByTestId('hero-height')).toHaveTextContent('42.3 mm');
    expect(screen.getByTestId('hero-height')).not.toHaveTextContent('%');
  });

  it('keeps goto disabled with its reason while uncalibrated', () => {
    const { send, publish } = setup();
    send('drill.state', new DrillState({ calibrated: false }).toBinary());

    expect(screen.getByTestId('goto-go')).toBeDisabled();
    expect(screen.getByTestId('goto-reason')).toHaveTextContent('uncalibrated');
    fireEvent.click(screen.getByTestId('goto-go'));
    expect(cmds(publish)).toHaveLength(0);
  });

  it('disables the switch hold and shows the refusal reason', () => {
    const { send } = setup();
    send('drill.state', new DrillState({
      switchAllowed: false,
      switchRefusedReason: 'below top band',
    }).toBinary());

    const sw = screen.getByTestId('auger-switch');
    expect(sw).toBeDisabled();
    // The reason rides with the control, and again on the STATUS rail.
    expect(sw.parentElement).toHaveTextContent('below top band');
    expect(screen.getAllByText('below top band').length).toBe(2);
  });

  it('publishes a decodable set_top command on the module cmd subject', () => {
    const { publish } = setup();
    fireEvent.click(screen.getByTestId('set-top'));

    expect(publish).toHaveBeenCalledWith(CMD, expect.any(Uint8Array));
    const sent = cmds(publish);
    expect(sent).toHaveLength(1);
    expect(sent[0].action.case).toBe('setTop');
  });

  it('renders the calibration phase note from the calibration leaf', () => {
    const { send } = setup();
    send('calibration', new CalibrationEvent({
      phase: 'refused',
      detail: 'set_bottom: bottom is not below the top anchor',
      travelTicks: 4200n,
    }).toBinary());

    const note = screen.getByTestId('cal-note');
    expect(note).toHaveTextContent('refused');
    expect(note).toHaveTextContent('bottom is not below the top anchor');
    expect(note).toHaveTextContent('travel 4200 ticks');
  });

  it('renders one MOTORS row per servo off a DrillStats frame', () => {
    const { send } = setup();
    send('stats', new DrillStats({
      servos: [
        { servoId: 11, positionRaw: 1234, speedRaw: 40, loadRaw: 12, voltageDeci: 118, temperatureC: 31, ok: true },
        { servoId: 12, ok: false },
      ],
    }).toBinary());

    const rows = document.querySelectorAll('[data-drill-motor-detail] [data-servo]');
    expect(rows).toHaveLength(2);

    const lift = within(rows[0] as HTMLElement);
    expect(lift.getByText('1234')).toBeInTheDocument();
    expect(lift.getByText('11.8')).toBeInTheDocument();
    expect(lift.getByText('ok')).toBeInTheDocument();

    const auger = within(rows[1] as HTMLElement);
    expect(auger.getByText('no rd')).toBeInTheDocument();
    expect(auger.getAllByText('N/A').length).toBeGreaterThan(0);
  });
});

describe('DrillPanel holds', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-publishes a jog hold inside the daemon deadman and zeroes on release', () => {
    const { publish } = setup();
    fireEvent.pointerDown(screen.getByTestId('jog-up'));
    act(() => { vi.advanceTimersByTime(150); });

    const held = cmds(publish);
    expect(held.length).toBeGreaterThanOrEqual(3);
    for (const c of held) {
      if (c.action.case !== 'jogLift') throw new Error(`expected jogLift, got ${c.action.case}`);
      expect(c.action.value.velocityNorm).toBe(1);
    }

    fireEvent.pointerUp(screen.getByTestId('jog-up'));
    const last = cmds(publish).at(-1)!;
    if (last.action.case !== 'jogLift') throw new Error('expected jogLift');
    expect(last.action.value.velocityNorm).toBe(0);
  });

  it('shows the halt reason and cancels a running hold until the next press', () => {
    const { publish, send } = setup();
    fireEvent.pointerDown(screen.getByTestId('jog-up'));
    act(() => { vi.advanceTimersByTime(100); });

    send('drill.state', new DrillState({
      halted: true,
      haltReason: 'stall detected',
      augerDirection: AugerDirection.IDLE,
    }).toBinary());

    expect(screen.getByTestId('hero-halted')).toHaveTextContent('stall detected');
    expect(document.querySelector('[data-drill-halt-reason]')!.textContent).toContain('stall detected');

    const frozen = cmds(publish).length;
    act(() => { vi.advanceTimersByTime(300); });
    expect(cmds(publish)).toHaveLength(frozen);

    // A still-down pointer stays disarmed; only a fresh press moves again.
    fireEvent.pointerDown(screen.getByTestId('jog-up'));
    act(() => { vi.advanceTimersByTime(50); });
    expect(cmds(publish).length).toBeGreaterThan(frozen);
  });
});
