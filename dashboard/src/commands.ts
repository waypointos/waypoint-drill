// DrillCommand builders and the module's subject helpers. The tab and the
// teleop window both publish encoded bytes on one leaf, `drill.cmd`.
import { DrillCommand, GotoHeight, JogLift, RunAuger } from './proto/drill_pb';

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

// The load cells are a second component on the same module, so their state
// rides the sensor class leaf rather than drill.state.
export function sensorStateSubject(roverId: string): string {
  return drillSubject(roverId, 'sensor.state');
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

/** Anchors height 0 where the lift is standing. Moves nothing; refused while it moves. */
export function setTopCmd(): Uint8Array {
  return encode({ case: 'setTop', value: true });
}

/** Records the travel span from the top anchor down to where the lift is standing. */
export function setBottomCmd(): Uint8Array {
  return encode({ case: 'setBottom', value: true });
}

/** Captures the current load cell counts as the weight zero; refused while a cell is down. */
export function tareCmd(): Uint8Array {
  return encode({ case: 'tare', value: true });
}

/** Known mass resting on the plate; the daemon derives the shared scale from it. */
export function calibrateMassCmd(grams: number): Uint8Array {
  return encode({ case: 'calibrateMassG', value: grams });
}

/** Averages the recent free-air descent load as the lift estimate zero. */
export function captureLiftBaselineCmd(): Uint8Array {
  return encode({ case: 'captureLiftBaseline', value: true });
}

/** Averages the recent free-spin load as the auger estimate zero. */
export function captureAugerBaselineCmd(): Uint8Array {
  return encode({ case: 'captureAugerBaseline', value: true });
}
