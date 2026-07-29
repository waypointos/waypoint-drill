import { describe, expect, it } from 'vitest';
import {
  calibrateMassCmd,
  calibrationSubject,
  cmdSubject,
  gotoHeightCmd,
  jogLiftCmd,
  runAugerCmd,
  sensorStateSubject,
  setBottomCmd,
  setTopCmd,
  stateSubject,
  statsSubject,
  stopCmd,
  tareCmd,
} from './commands';
import { DrillCommand } from './proto/drill_pb';

function action(bytes: Uint8Array) {
  return DrillCommand.fromBinary(bytes).action;
}

describe('subject helpers', () => {
  it('keeps the drill.drill double leaf on the component subjects', () => {
    expect(stateSubject('r1')).toBe('waypoint.r1.module.drill.drill.state');
    expect(cmdSubject('r1')).toBe('waypoint.r1.module.drill.drill.cmd');
  });

  it('leaves the module-owned leaves single', () => {
    expect(statsSubject('r1')).toBe('waypoint.r1.module.drill.stats');
    expect(calibrationSubject('r1')).toBe('waypoint.r1.module.drill.calibration');
  });

  it('targets the sensor component leaf for load cell readings', () => {
    expect(sensorStateSubject('r1')).toBe('waypoint.r1.module.drill.sensor.state');
  });
});

describe('command builders', () => {
  it('encodes a lift jog in both directions and its zero', () => {
    for (const v of [1, -1, 0]) {
      const a = action(jogLiftCmd(v));
      expect(a.case).toBe('jogLift');
      if (a.case !== 'jogLift') throw new Error('expected jogLift');
      expect(a.value.velocityNorm).toBe(v);
    }
  });

  it('encodes drill as positive throttle and switch as negative', () => {
    const drill = action(runAugerCmd(1));
    const flip = action(runAugerCmd(-1));
    if (drill.case !== 'runAuger' || flip.case !== 'runAuger') throw new Error('expected runAuger');
    expect(drill.value.throttle).toBe(1);
    expect(flip.value.throttle).toBe(-1);
  });

  it('encodes goto height', () => {
    const a = action(gotoHeightCmd(0.42));
    if (a.case !== 'gotoHeight') throw new Error('expected gotoHeight');
    expect(a.value.norm).toBeCloseTo(0.42);
  });

  it('encodes stop and both end marks as true flags', () => {
    expect(action(stopCmd())).toEqual({ case: 'stop', value: true });
    expect(action(setTopCmd())).toEqual({ case: 'setTop', value: true });
    expect(action(setBottomCmd())).toEqual({ case: 'setBottom', value: true });
  });

  it('encodes tare as a true flag', () => {
    expect(action(tareCmd())).toEqual({ case: 'tare', value: true });
  });

  it('encodes the known calibration mass in grams', () => {
    expect(action(calibrateMassCmd(500))).toEqual({ case: 'calibrateMassG', value: 500 });
  });
});
