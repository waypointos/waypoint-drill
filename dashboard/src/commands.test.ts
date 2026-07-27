import { describe, expect, it } from 'vitest';
import {
  calibrateCmd,
  calibrationSubject,
  cmdSubject,
  gotoHeightCmd,
  homeCmd,
  jogLiftCmd,
  runAugerCmd,
  stateSubject,
  statsSubject,
  stopCmd,
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

  it('encodes stop and home as true flags', () => {
    expect(action(stopCmd())).toEqual({ case: 'stop', value: true });
    expect(action(homeCmd())).toEqual({ case: 'home', value: true });
  });

  it('encodes calibrate run and abort', () => {
    const run = action(calibrateCmd(true));
    const abort = action(calibrateCmd(false));
    if (run.case !== 'calibrate' || abort.case !== 'calibrate') throw new Error('expected calibrate');
    expect(run.value.run).toBe(true);
    expect(abort.value.run).toBe(false);
  });
});
