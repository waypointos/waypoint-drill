// DrillCommand builders and the module's subject helpers. The tab and the
// teleop window both publish encoded bytes on one leaf, `drill.cmd`.
import { Calibrate, DrillCommand, GotoHeight, JogLift, RunAuger } from './proto/drill_pb';

/** Everything the module may touch sits under this host-enforced prefix. */
export function drillSubject(roverId: string, leaf: string): string {
  return `waypoint.${roverId}.module.drill.${leaf}`;
}

// The component's own leaves are named `drill.*`, so the full subject carries
// the module id twice: waypoint.<rover>.module.drill.drill.state.
export function stateSubject(roverId: string): string {
  return drillSubject(roverId, 'drill.state');
}

export function cmdSubject(roverId: string): string {
  return drillSubject(roverId, 'drill.cmd');
}

export function statsSubject(roverId: string): string {
  return drillSubject(roverId, 'stats');
}

export function calibrationSubject(roverId: string): string {
  return drillSubject(roverId, 'calibration');
}

function encode(action: DrillCommand['action']): Uint8Array {
  return new DrillCommand({ action }).toBinary();
}

/** Hold-to-move lift jog: +1 up, -1 down, 0 stops without latching a halt. */
export function jogLiftCmd(velocityNorm: number): Uint8Array {
  return encode({ case: 'jogLift', value: new JogLift({ velocityNorm }) });
}

/** Hold-to-move auger: +1 drills, -1 switches, 0 stops. */
export function runAugerCmd(throttle: number): Uint8Array {
  return encode({ case: 'runAuger', value: new RunAuger({ throttle }) });
}

/** One-shot move to a normalized height; refused by the daemon unless calibrated. */
export function gotoHeightCmd(norm: number): Uint8Array {
  return encode({ case: 'gotoHeight', value: new GotoHeight({ norm }) });
}

/** Halt latch: zero-writes both servos, cuts torque, refuses motion until fresh input. */
export function stopCmd(): Uint8Array {
  return encode({ case: 'stop', value: true });
}

export function homeCmd(): Uint8Array {
  return encode({ case: 'home', value: true });
}

/** `run` true starts the travel calibration, false aborts a running one. */
export function calibrateCmd(run: boolean): Uint8Array {
  return encode({ case: 'calibrate', value: new Calibrate({ run }) });
}
