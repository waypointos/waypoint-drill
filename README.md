# waypoint-module-drill

A two-servo sampling drill as a Waypoint no-rebuild module. Built on the
Waypoint module SDK (`github.com/waypointos/waypoint/sdk`): the SDK owns
connect, creds, sd_notify, health, and the stats heartbeat; this repo provides
the drill's own logic (lift axis, auger interlock, homing and calibration) and
publishes the open `drill` component class.

The drill drives two module-owned wheel-mode STS3215 servos: bus id 11 is the
lift screw, bus id 12 is the auger. Core forces wheel mode on both from the
platform descriptor, so the module never writes a servo mode.

## Layout

- `cmd/waypoint-module-drill`: entrypoint on `wpmodule.Run`.
- `internal/servobus`: narrow adapter over the SDK servo client (signed
  velocity, torque, overcurrent ceiling, one raw read).
- `internal/lift`: encoder unwrapping, stall and read-gap detection, the height
  axis, and the home/calibrate step machines.
- `internal/auger`: switch interlock and direction-to-velocity mapping.
- `internal/control`: the 50 Hz command loop and the halt latch.
- `internal/teleop`, `internal/config`, `internal/state`, `internal/store`:
  gamepad mapping, config, telemetry rendering, calibration persistence.

## Subjects

Everything lives in the module sandbox
`waypoint.<rover>.module.drill.`:

| Leaf | Direction | Message |
|---|---|---|
| `drill.state` | publish | `DrillState`, at the component rate |
| `drill.cmd` | subscribe | `DrillCommand` |
| `stats` | publish | `DrillStats` at 5 Hz (shares the leaf with the SDK heartbeat) |
| `calibration` | publish | `CalibrationEvent` |
| `servo.cmd` / `servo.read` | publish / request | agent servo-control broker |
| `input` | subscribe | `GamepadSnapshot` mirror |

## Safety model

- Every stop path writes zero velocity to both servos first, then torque off. A
  wheel-mode STS3215 keeps acting on its latched goal speed after torque is cut,
  so torque-off alone is not a stop.
- The halt latch fires on a stop command, stale teleop input, a servo read gap,
  or an overcurrent trip, and refuses motion until fresh operator input. Fresh
  means a new press: a gamepad button held through a fault is mirrored at 50 Hz
  and must be released before it can arm motion again.
- The gamepad mirror and the tab's `drill.cmd` are separate hold-to-move
  sources. Whichever is asking for motion wins, and each ages on its own
  deadman, so a tab-driven jog has to be repeated faster than `stale_input_ms`
  (150 ms by default) to keep running.
- Height is N/A until the axis is homed, and normalized height is N/A until it
  is calibrated. Absent fields carry a reason, never a sentinel zero.
- Switch rotation runs only when the lift is calibrated and inside the top band.

## Build and test

```
go build ./...
go test ./...
```

The repo uses local `replace` directives pointing at a sibling `../waypoint`
checkout for the SDK and protocol bindings.

## Manual dev loop against a dev rover

In the Waypoint repo, boot a dev rover (real agent and core in sim mode):

```
make dev-rover
```

In this repo, run the module against that rover (dev NATS is open, so no creds
are minted):

```
make dev
```

Confirm `module.drill.drill.state` traffic on the rover's bus. The sim mirrors
zero load and has no lift hard stops, so homing and calibration are hardware
bring-up steps rather than sim-verifiable ones.

## Dashboard

`dashboard/` holds the module's own React UI. It never imports from the
monorepo: tokens and the `Panel` primitive are copied into
`dashboard/src/ui/`, and the generated protobuf bindings are copied into
`dashboard/src/proto/`.

```
cd dashboard
pnpm install
pnpm build
pnpm test
```

pnpm only, never npm or yarn. The build runs one Vite pass per entry and
writes two self-contained ESM bundles that the host loads directly:

| Bundle | Entry | Host surface |
|---|---|---|
| `dashboard/dist/panel.js` | `src/mount.tsx` | rover tab `m-drill`, from `[ui.static]` |
| `dashboard/dist/teleop.js` | `src/teleop.tsx` | teleop window `w-drill`, from `[ui.teleop]` |

Both render purely from `drill.state` and publish only `drill.cmd`.

Hold-to-move buttons in either bundle are a deadman source with the same
150 ms `stale_input_ms` budget as the gamepad mirror, so a held button
re-publishes its command every 50 ms and sends a single zero on release.
That cadence survives two dropped frames. When the daemon reports a halt the
UI cancels the running hold and refuses to publish again until the operator
lifts the pointer and presses anew, matching the fresh-input rule the gamepad
path gets from the daemon.
