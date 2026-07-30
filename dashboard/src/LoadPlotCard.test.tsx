import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BridgeProvider } from './bridge';
import { LoadPlotCard } from './drill/LoadPlotCard';
import {
  CalibrationEvent,
  DrillCommand,
  DrillState,
  SensorReading,
  SensorReadings,
  ServoState,
} from './proto/drill_pb';
import { calibrationSubject, cmdSubject, sensorStateSubject } from './commands';

function setup(state: DrillState | null = null) {
  const publish = vi.fn();
  const deliver = new Map<string, (b: Uint8Array) => void>();
  const subscribe = (subject: string, onBytes: (b: Uint8Array) => void) => {
    deliver.set(subject, onBytes);
    return () => {};
  };
  render(
    <BridgeProvider value={{ roverId: 'r1', subscribe, publish }}>
      <LoadPlotCard state={state} />
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

const driving = (speedRaw: number) =>
  new DrillState({
    lift: new ServoState({ servoId: 11, speedRaw, loadRaw: 200, ok: true }),
    auger: new ServoState({ servoId: 12, speedRaw: 0, loadRaw: 0, ok: true }),
  });

describe('LoadPlotCard', () => {
  it('renders both estimates beside their lanes', () => {
    const { send } = setup(driving(400));
    send(readings([
      ['lift_force_est_g', 1886.6, 'g'],
      ['auger_torque_est_nmm', 882.6, 'nmm'],
      ['total_g', null, 'g'],
    ]));

    expect(screen.getByTestId('loadest-lift-val')).toHaveTextContent('1886.6 g');
    expect(screen.getByTestId('loadest-auger-val')).toHaveTextContent('882.6 nmm');
  });

  it('renders N/A with a state-derived reason when the lift is idle', () => {
    const { send } = setup(driving(0));
    send(readings([
      ['lift_force_est_g', null, 'g'],
      ['auger_torque_est_nmm', null, 'nmm'],
    ]));

    expect(screen.getByTestId('loadest-lift-val')).toHaveTextContent('N/A');
    expect(screen.getByTestId('loadest-lift-val')).toHaveTextContent('lift idle');
    expect(screen.getByTestId('loadest-auger-val')).toHaveTextContent('auger idle');
  });

  it.each([400, -400])('keeps both causes in the hint for a lift moving at %i', (speedRaw) => {
    // The panel cannot see lift_up_sign, so the hint must hold under either.
    const { send } = setup(driving(speedRaw));
    send(readings([['lift_force_est_g', null, 'g']]));
    expect(screen.getByTestId('loadest-lift-val')).toHaveTextContent('rising');
    expect(screen.getByTestId('loadest-lift-val')).toHaveTextContent('no baseline');
  });

  it('names an unread servo rather than guessing a cause', () => {
    const { send } = setup(new DrillState({ lift: new ServoState({ servoId: 11 }) }));
    send(readings([['lift_force_est_g', null, 'g']]));
    expect(screen.getByTestId('loadest-lift-val')).toHaveTextContent('not reading');
  });

  it('publishes both baseline captures on the drill cmd leaf', () => {
    const { publish } = setup(driving(400));
    fireEvent.click(screen.getByTestId('loadest-lift-baseline'));
    fireEvent.click(screen.getByTestId('loadest-auger-baseline'));

    const sent = publish.mock.calls
      .filter((call: unknown[]) => call[0] === cmdSubject('r1'))
      .map((call: unknown[]) => DrillCommand.fromBinary(call[1] as Uint8Array).action);
    expect(sent).toEqual([
      { case: 'captureLiftBaseline', value: true },
      { case: 'captureAugerBaseline', value: true },
    ]);
  });

  it('notes the baseline phases from the shared calibration leaf', () => {
    const { sendCal } = setup(driving(400));
    sendCal(new CalibrationEvent({ phase: 'lift_baseline_set', detail: '12.0 nmm' }));
    expect(screen.getByTestId('loadest-note')).toHaveTextContent('lift_baseline_set');
    expect(screen.getByTestId('loadest-note')).toHaveTextContent('12.0 nmm');
  });

  it('ignores the weight and lift events on the shared calibration leaf', () => {
    const { sendCal } = setup(driving(400));
    sendCal(new CalibrationEvent({ phase: 'tared' }));
    expect(screen.queryByTestId('loadest-note')).not.toBeInTheDocument();

    sendCal(new CalibrationEvent({ phase: 'refused', detail: 'tare: a load cell is not reading' }));
    expect(screen.queryByTestId('loadest-note')).not.toBeInTheDocument();
  });
});
