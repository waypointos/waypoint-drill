# Load cell bring-up

Hardware checklist for the three HX711 load cells under the drill plate.
Software side: the module publishes `sensor.state` on its own subtree and
the WEIGHT card in the drill tab shows per-cell grams, the total, and the
calibration controls. The leaf becomes a declared `sensor` component,
with its own 10 Hz rate, once the agent parses more than one component
per module.

## Wiring

Power every HX711 board from 3.3 V, never 5 V: DOUT logic follows the
supply and the Pi's GPIOs are not 5 V tolerant.

| Pi physical pin | Signal | Goes to |
|---|---|---|
| Pin 1 (3.3V) | Power | VCC on all three HX711 boards |
| Pin 29 (GPIO5) | SCK | SCK on all three boards (shared) |
| Pin 31 (GPIO6) | Data cell A | DOUT of board A |
| Pin 33 (GPIO13) | Data cell B | DOUT of board B |
| Pin 37 (GPIO26) | Data cell C | DOUT of board C |
| Pin 30/34/39 (GND) | Ground | GND on all three boards |

Cell to board: E+ red, E- black, A+ green, A- white on typical bar cells;
vendor colors vary. A swapped A+/A- only flips the sign and calibration
absorbs it. Mount each board close to its cell; the long run is the
digital side. Pins are module config (`sck_gpio`, `dout_a_gpio`,
`dout_b_gpio`, `dout_c_gpio`) if the wiring must change.

Sensing never blocks motion: if the GPIO lines cannot be opened at all,
the module logs it, weight stays N/A, and the drill still jogs.

## Checklist

1. **Boards answer.** With the module running, open the drill tab. The
   WEIGHT total reads `N/A` with `uncalibrated · tare, then a known
   mass`, which means all three chips are clocking frames and only the
   scale is missing. `cell not reading` on all three cells means one or
   more boards never went ready: the chips share the clock line and a
   partial ready set is never clocked, so one dead board blanks all
   three. Check power, ground, and the DOUT line on every board, one at
   a time. `sensor feed stale` instead means no frames are arriving at
   all: look at the module rather than the wiring.
2. **Tare.** With the drill at rest and nothing on the plate beyond the
   assembly itself, press Tare. The card reports `tared`. Grams stay
   N/A until a known mass sets the scale.
3. **Known mass.** Place a known mass (500 g or more recommended)
   centered on the plate, press Calibrate, enter its grams, press Apply.
   The card reports `calibrated` and the total should read the entered
   mass. Remove it; the total returns near 0.
4. **Per-corner response.** Press down near each cell in turn and watch
   that cell's grams move while the other two barely change. This
   confirms the A/B/C order matches the physical layout; if two are
   swapped, swap their DOUT pins in module config rather than rewiring.
   The scale is shared, so a per-cell number is only its share of the
   total, not a calibrated corner load.
5. **Episode spot check**, once the `sensor` class can be declared. The
   recorder picks its module channels off the declared component class,
   so weight reaches an episode only then. Start a recording from the
   teleop console, jog the drill briefly, stop, then download the episode
   from the Episodes panel and confirm the `module.drill.sensor.state`
   channel carries the `cell_a_g` / `cell_b_g` / `cell_c_g`, `total_g`,
   and `cell_*_raw` readings.

## Refusals

The daemon refuses calibration rather than storing a bad one, and the
reason lands on the card:

- `a load cell is not reading`: all three cells must be healthy before a
  tare or a calibrate is accepted.
- `tare first, with the plate empty`: a scale needs a zero to measure
  from.
- `mass must be positive grams`: the entered mass was zero or negative.
- `too little count change since tare`: the plate saw next to no load
  between the tare and the calibrate, so any scale derived from it would
  be nonsense. Check the mass is actually resting on the plate and not
  on the frame around it.

Offsets and scale persist in `weight_state_path`
(`/var/lib/waypoint-module-drill/weight.toml` by default), so a restart
keeps the calibration. Re-tare after anything mechanical changes on the
plate.

## Servo load estimate (fallback rail)

The LOAD card estimates drill forces from the servo load registers. It works
with no load cell wiring at all and stays a separate series forever; wire the
cells whenever ready and both rails show side by side.

1. Verify the constants. Measure the lift pinion pitch radius with calipers
   (default 15.9 mm, from the CAD Drive Gear) and set `pinion_radius_mm` in
   the module config if it differs; a non-positive value leaves the lift
   force N/A. `stall_torque_kgcm` stays 30 for the 12V STS3215.
2. Capture the lift baseline: jog the lift DOWN through free air (nothing
   under the bit) and press "Lift baseline" while it is still moving. The
   note shows `lift_baseline_set` with the captured N-mm.
3. Capture the auger baseline: run the auger in free air in the DRILLING
   direction (throttle up, not the carousel switch) and press "Auger
   baseline" while it spins. A switch-direction spin is refused: its load
   reads the other way, so it would store a flipped zero. Until a baseline
   exists the auger lane plots gross torque rather than net.
4. Sanity check: press a hand up against the drill foot during a slow
   descent. The grams lane should rise smoothly and return to zero when
   released; the register is noisy, so expect roughly +-10% of reading.
5. Baselines persist in `loadest_state_path`
   (`/var/lib/waypoint-module-drill/loadest.toml` by default). Recapture
   after any gearing or servo swap.

A capture is refused if the servo was not actually driving the required way
through the second before the press, or if the servo feed went stale since,
and the reason lands on the card as `refused · lift baseline: jog the lift
down in free air first` (or the auger equivalent).

The estimate is N/A whenever it would be dishonest: lift idle or rising
(a wheel-mode servo exerts no holding torque), no baseline captured, servo
not reading, or the feed stale. The reason renders beside the N/A.
