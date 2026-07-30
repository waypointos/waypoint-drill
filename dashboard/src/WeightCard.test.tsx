import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BridgeProvider } from './bridge';
import { WeightCard } from './drill/WeightCard';
import { CalibrationEvent, DrillCommand, SensorReading, SensorReadings } from './proto/drill_pb';
import { calibrationSubject, cmdSubject, sensorStateSubject } from './commands';

function setup() {
  const publish = vi.fn();
  const deliver = new Map<string, (b: Uint8Array) => void>();
  const subscribe = (subject: string, onBytes: (b: Uint8Array) => void) => {
    deliver.set(subject, onBytes);
    return () => {};
  };
  render(
    <BridgeProvider value={{ roverId: 'r1', subscribe, publish }}>
      <WeightCard />
    </BridgeProvider>,
  );
  const sendTo = (subject: string, bytes: Uint8Array) => {
    const fn = deliver.get(subject);
    if (!fn) throw new Error(`no subscriber for ${subject}`);
    act(() => fn(bytes));
  };
  return {
    publish,
    send: (bytes: Uint8Array) => sendTo(sensorStateSubject('r1'), bytes),
    sendCal: (ev: CalibrationEvent) => sendTo(calibrationSubject('r1'), ev.toBinary()),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

/** A null value is a not-ok reading, the wire shape for N/A. */
function readings(entries: Array<[string, number | null, string]>): Uint8Array {
  return new SensorReadings({
    readings: entries.map(([name, value, unit]) => new SensorReading({
      name,
      unit,
      ok: value !== null,
      value: value ?? undefined,
    })),
  }).toBinary();
}

function cmds(publish: ReturnType<typeof vi.fn>): DrillCommand[] {
  return publish.mock.calls
    .filter((call: unknown[]) => call[0] === cmdSubject('r1'))
    .map((call: unknown[]) => DrillCommand.fromBinary(call[1] as Uint8Array));
}

describe('WeightCard', () => {
  it('renders N/A before any frame and grams after one', () => {
    const { send } = setup();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);

    send(readings([
      ['cell_a_g', 125, 'g'], ['cell_b_g', 125, 'g'], ['cell_c_g', 250, 'g'],
      ['total_g', 500, 'g'],
      ['cell_a_raw', 2000, 'counts'], ['cell_b_raw', 3000, 'counts'], ['cell_c_raw', 5000, 'counts'],
    ]));

    expect(screen.getByTestId('weight-total')).toHaveTextContent('500.0 g');
    expect(screen.getByTestId('weight-cell_a_g')).toHaveTextContent('125.0 g');
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
  });

  it('keeps a not-ok reading N/A even when frames arrive', () => {
    const { send } = setup();
    send(readings([
      ['cell_a_g', null, 'g'], ['cell_b_g', 125, 'g'], ['cell_c_g', 250, 'g'],
      ['total_g', null, 'g'],
      ['cell_a_raw', null, 'counts'], ['cell_b_raw', 3000, 'counts'], ['cell_c_raw', 5000, 'counts'],
    ]));

    expect(screen.getByTestId('weight-total')).toHaveTextContent('N/A');
    expect(screen.getByTestId('weight-cell_a_g')).toHaveTextContent('N/A');
    expect(screen.getByTestId('weight-cell_b_g')).toHaveTextContent('125.0 g');
  });

  it('goes N/A when sensor.state stops arriving', () => {
    vi.useFakeTimers();
    const { send } = setup();
    send(readings([
      ['cell_a_g', 125, 'g'], ['cell_b_g', 125, 'g'], ['cell_c_g', 250, 'g'],
      ['total_g', 500, 'g'],
      ['cell_a_raw', 2000, 'counts'], ['cell_b_raw', 3000, 'counts'], ['cell_c_raw', 5000, 'counts'],
    ]));
    expect(screen.getByTestId('weight-total')).toHaveTextContent('500.0 g');

    act(() => void vi.advanceTimersByTime(3_000));

    expect(screen.getByTestId('weight-total')).toHaveTextContent('N/A');
    expect(screen.getByTestId('weight-total')).toHaveTextContent('sensor feed stale');
    expect(screen.getByTestId('weight-cell_a_g')).toHaveTextContent('sensor feed stale');
  });

  it('notes the weight phases from the shared calibration leaf', () => {
    const { sendCal } = setup();
    sendCal(new CalibrationEvent({ phase: 'tared' }));
    expect(screen.getByTestId('weight-note')).toHaveTextContent('tared');

    sendCal(new CalibrationEvent({ phase: 'refused', detail: 'tare: a load cell is not reading' }));
    expect(screen.getByTestId('weight-note')).toHaveTextContent('a load cell is not reading');
  });

  it('ignores the lift events on the shared calibration leaf', () => {
    const { sendCal } = setup();
    sendCal(new CalibrationEvent({ phase: 'top_set', travelTicks: 4200n }));
    expect(screen.queryByTestId('weight-note')).not.toBeInTheDocument();

    sendCal(new CalibrationEvent({
      phase: 'refused',
      detail: 'set_bottom: bottom is not below the top anchor',
    }));
    expect(screen.queryByTestId('weight-note')).not.toBeInTheDocument();
  });

  it('publishes a tare on the drill cmd leaf', () => {
    const { publish } = setup();
    fireEvent.click(screen.getByTestId('weight-tare'));

    const sent = cmds(publish);
    expect(sent).toHaveLength(1);
    expect(sent[0].action).toEqual({ case: 'tare', value: true });
  });

  it('publishes the entered grams through the calibrate flow', () => {
    const { publish } = setup();
    fireEvent.click(screen.getByTestId('weight-calibrate'));
    fireEvent.change(screen.getByLabelText(/known mass/i), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('weight-apply'));

    expect(cmds(publish).map((c) => c.action)).toEqual([{ case: 'calibrateMassG', value: 500 }]);
  });

  it('holds apply closed until the mass is a positive number', () => {
    const { publish } = setup();
    fireEvent.click(screen.getByTestId('weight-calibrate'));
    expect(screen.getByTestId('weight-apply')).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/known mass/i), { target: { value: '-5' } });
    expect(screen.getByTestId('weight-apply')).toBeDisabled();
    fireEvent.click(screen.getByTestId('weight-apply'));
    expect(cmds(publish)).toHaveLength(0);
  });
});
