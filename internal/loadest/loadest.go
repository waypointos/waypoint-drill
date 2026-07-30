// Package loadest derives drill load estimates from the servo load registers:
// a lift downforce (grams-force at the pinion mesh) and an auger torque. Both
// are fallback telemetry beside the load cells, never motion inputs.
package loadest

import (
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"

	"github.com/waypointos/waypoint-drill/internal/store"
)

const (
	NameLiftForceEstG     = "lift_force_est_g"
	NameAugerTorqueEstNmm = "auger_torque_est_nmm"
)

const (
	// gramsPerNewton converts mesh force to grams-force (1000 / 9.80665).
	gramsPerNewton = 101.9716
	// emaTau is the smoothing time constant; the load register is noisy at 20Hz.
	emaTau = 250 * time.Millisecond
	// minSpeedRaw is the movement threshold below which a servo counts as idle.
	minSpeedRaw = 20
	// staleAfter bounds observation age, mirroring the weight package.
	staleAfter = time.Second
	// Baseline capture averages the recent valid window; a thin window means
	// the operator was not actually driving.
	baselineWindow     = time.Second
	baselineMinSamples = 10
)

type Config struct {
	StallTorqueNmm float64
	PinionRadiusMm float64
	// Existing config signs: down = -LiftUpSign, drilling-positive = AugerDrillSign.
	LiftUpSign     int
	AugerDrillSign int
	Now            func() time.Time
}

// channel is one servo's smoothed torque stream plus its validity state.
type channel struct {
	ema       float64
	emaAt     time.Time
	valid     bool
	lastAt    time.Time
	window    []sample // recent valid samples for baseline capture
	baseline  float64
	baselined bool
}

type sample struct {
	at        time.Time
	torqueNmm float64
}

type Estimator struct {
	mu        sync.Mutex
	statePath string
	events    func(phase, detail string)
	cfg       Config

	lift  channel
	auger channel
}

func New(statePath string, events func(phase, detail string), cfg Config) *Estimator {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	e := &Estimator{statePath: statePath, events: events, cfg: cfg}
	cal, ok, err := store.LoadLoadEst(statePath)
	switch {
	case err != nil:
		slog.Warn("load estimate baselines load failed", "path", statePath, "err", err)
	case ok:
		e.lift.baseline, e.lift.baselined = cal.LiftBaselineNmm, cal.LiftBaselineSet
		e.auger.baseline, e.auger.baselined = cal.AugerBaselineNmm, cal.AugerBaselineSet
	}
	return e
}

func (e *Estimator) torqueNmm(loadRaw int32) float64 {
	return float64(loadRaw) / 1000 * e.cfg.StallTorqueNmm
}

// ObserveLift folds one lift read in. The estimate is only defined while the
// lift drives downward: a wheel-mode servo holding still exerts no measurable
// torque, so any other state invalidates rather than reading zero.
func (e *Estimator) ObserveLift(loadRaw, speedRaw int32, ok bool) {
	downSign := int32(-e.cfg.LiftUpSign)
	moving := ok && speedRaw*downSign >= minSpeedRaw
	e.observe(&e.lift, e.torqueNmm(loadRaw), moving)
}

// ObserveAuger folds one auger read in; any spin direction counts as active.
func (e *Estimator) ObserveAuger(loadRaw, speedRaw int32, ok bool) {
	spinning := ok && (speedRaw >= minSpeedRaw || speedRaw <= -minSpeedRaw)
	e.observe(&e.auger, e.torqueNmm(loadRaw), spinning)
}

func (e *Estimator) observe(ch *channel, torque float64, active bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.cfg.Now()
	ch.lastAt = now
	if !active {
		// Invalidate and drop the window; the EMA reseeds on the next valid
		// sample so stale history never bleeds into a new engagement.
		ch.valid = false
		ch.window = ch.window[:0]
		return
	}
	if !ch.valid {
		ch.ema = torque
	} else {
		dt := now.Sub(ch.emaAt).Seconds()
		alpha := dt / (emaTau.Seconds() + dt)
		if alpha > 1 {
			alpha = 1
		}
		ch.ema += alpha * (torque - ch.ema)
	}
	ch.valid = true
	ch.emaAt = now

	ch.window = append(ch.window, sample{at: now, torqueNmm: torque})
	cutoff := now.Add(-baselineWindow)
	for len(ch.window) > 0 && ch.window[0].at.Before(cutoff) {
		ch.window = ch.window[1:]
	}
}

// CaptureLiftBaseline averages the recent free-air descent window.
func (e *Estimator) CaptureLiftBaseline() error {
	return e.capture(&e.lift, "lift_baseline_set", "lift baseline", "jog the lift down in free air first")
}

// CaptureAugerBaseline averages the recent free-spin window.
func (e *Estimator) CaptureAugerBaseline() error {
	return e.capture(&e.auger, "auger_baseline_set", "auger baseline", "spin the auger in free air first")
}

func (e *Estimator) capture(ch *channel, phase, what, why string) error {
	e.mu.Lock()
	if !ch.valid || len(ch.window) < baselineMinSamples {
		e.mu.Unlock()
		e.events("refused", what+": "+why)
		return errors.New(why)
	}
	sum := 0.0
	for _, s := range ch.window {
		sum += s.torqueNmm
	}
	ch.baseline = sum / float64(len(ch.window))
	ch.baselined = true
	cal := store.LoadEstCal{
		LiftBaselineNmm: e.lift.baseline, LiftBaselineSet: e.lift.baselined,
		AugerBaselineNmm: e.auger.baseline, AugerBaselineSet: e.auger.baselined,
	}
	baseline := ch.baseline
	e.mu.Unlock()

	// Persist and publish off the mutex, matching the weight package: the
	// read loop takes this lock every cycle.
	if err := store.SaveLoadEst(e.statePath, cal); err != nil {
		e.events(phase, "save failed: "+err.Error())
		return nil
	}
	e.events(phase, fmt.Sprintf("%.1f nmm", baseline))
	return nil
}

// Readings renders the two estimate readings, order: lift force, auger torque.
func (e *Estimator) Readings() []*waypointv1.SensorReading {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.cfg.Now()

	lr := &waypointv1.SensorReading{Name: NameLiftForceEstG, Unit: "g"}
	if e.lift.valid && e.lift.baselined && fresh(e.lift.lastAt, now) {
		netNmm := e.lift.ema - e.lift.baseline
		v := netNmm / e.cfg.PinionRadiusMm * gramsPerNewton * float64(-e.cfg.LiftUpSign)
		lr.Ok = true
		lr.Value = &v
	}

	ar := &waypointv1.SensorReading{Name: NameAugerTorqueEstNmm, Unit: "nmm"}
	if e.auger.valid && fresh(e.auger.lastAt, now) {
		net := e.auger.ema
		if e.auger.baselined {
			net -= e.auger.baseline
		}
		v := net * float64(e.cfg.AugerDrillSign)
		ar.Ok = true
		ar.Value = &v
	}

	return []*waypointv1.SensorReading{lr, ar}
}

func fresh(lastAt, now time.Time) bool {
	return !lastAt.IsZero() && now.Sub(lastAt) <= staleAfter
}
