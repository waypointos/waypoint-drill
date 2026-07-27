// Package control runs the drill's 50 Hz command loop. It turns operator intent
// and procedure state into signed wheel velocities and owns the halt latch that
// stops both servos.
package control

import (
	"math"
	"sync"
	"time"

	"github.com/waypointos/waypoint-drill/internal/auger"
	"github.com/waypointos/waypoint-drill/internal/config"
	"github.com/waypointos/waypoint-drill/internal/lift"
	"github.com/waypointos/waypoint-drill/internal/teleop"
	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

// Tick period, goto arrival band, and how often a running procedure re-reports
// its phase between transitions.
const (
	tickPeriod  = 20 * time.Millisecond
	gotoBand    = 0.005
	eventPeriod = 200 * time.Millisecond
)

// Loop phases, reported on drill.state.
const (
	phaseIdle        = "idle"
	phaseJog         = "jog"
	phaseGoto        = "goto"
	phaseHoming      = "homing"
	phaseCalibrating = "calibrating"
)

// Halt reasons, reported on drill.state.
const (
	haltStop        = "stop command"
	haltStale       = "input stale"
	haltReadGap     = "read gap"
	haltOvercurrent = "overcurrent"
)

const (
	procHome      = "home"
	procCalibrate = "calibrate"
)

const (
	dirIdle   = drillv1.AugerDirection_AUGER_DIRECTION_IDLE
	dirDrill  = drillv1.AugerDirection_AUGER_DIRECTION_DRILL
	dirSwitch = drillv1.AugerDirection_AUGER_DIRECTION_SWITCH
)

// Bus is the servo surface the loop drives; servobus.Adapter implements it.
// Mode is absent by design: core owns wheel mode for the module joints.
type Bus interface {
	SetGoalVelocity(id uint32, raw int32) error
	SetTorqueEnable(id uint32, on bool) error
}

// Events reports procedure progress. main publishes it on the calibration leaf
// and persists the travel span on the terminal "done" phase.
type Events func(phase string, travel *int64, detail string)

// Status is the loop's outward view, rendered into DrillState.
type Status struct {
	Phase       string
	Halted      bool
	HaltReason  string
	LastRefusal string

	AugerDir drillv1.AugerDirection

	SwitchAllowed bool
	SwitchReason  string

	LiftVelocityCmd  int32
	AugerVelocityCmd int32
}

// source is one hold-to-move input channel. The mirrored gamepad and the tab's
// drill.cmd are tracked apart: the mirror publishes at 50 Hz whether or not a
// button is down, so merging them into one field would let it overwrite tab
// commands and keep refreshing their deadman.
type source struct {
	in teleop.Intent
	at time.Time
}

// pendingEvent is a procedure event queued for dispatch after the mutex drops.
type pendingEvent struct {
	phase  string
	travel *int64
	detail string
}

type Loop struct {
	cfg  *config.Config
	bus  Bus
	axis *lift.Axis
	il   *auger.Interlock
	ev   Events

	mu      sync.Mutex
	pending []pendingEvent

	pad, cmd source
	// padArmed drops on a halt and comes back on the first neutral frame, so a
	// button still held through a fault cannot clear the latch by itself.
	padArmed bool

	halted      bool
	haltReason  string
	lastRefusal string
	phase       string

	proc      *lift.Proc
	procKind  string
	procPhase string
	procSign  int
	stall     *lift.StallDetector
	lastEvent time.Time

	gotoActive bool
	gotoTarget float64

	// Axis view refreshed on every read. The axis itself is folded only in
	// Observe, so the tick never touches it and the reader stays its sole writer.
	homed      bool
	calibrated bool
	heightNorm float64
	haveNorm   bool

	switchAllowed bool
	switchReason  string

	liftVel    int32
	augerVel   int32
	liftTorque bool
	augTorque  bool
	augerDir   drillv1.AugerDirection

	liftDog  *lift.Watchdog
	augerDog *lift.Watchdog
}

func NewLoop(cfg *config.Config, bus Bus, axis *lift.Axis, il *auger.Interlock, ev Events) *Loop {
	neutral := teleop.Intent{Auger: dirIdle}
	l := &Loop{
		cfg: cfg, bus: bus, axis: axis, il: il, ev: ev,
		pad:      source{in: neutral},
		cmd:      source{in: neutral},
		padArmed: true,
		phase:    phaseIdle,
		augerDir: dirIdle,
		liftDog:  lift.NewWatchdog(cfg.ReadGapHalt),
		augerDog: lift.NewWatchdog(cfg.ReadGapHalt),
	}
	l.refreshAxisLocked()
	return l
}

// SetTeleop takes one frame of mirrored gamepad intent. A fresh press clears the
// halt latch and supersedes a running procedure; a held button does neither,
// because the mirror repeats it at 50 Hz for as long as it is down.
func (l *Loop) SetTeleop(in teleop.Intent, at time.Time) {
	l.lock()
	defer l.unlock()

	if !intentActive(in) {
		l.padArmed = true
	}
	if !l.padArmed {
		l.pad = source{in: teleop.Intent{Auger: dirIdle}, at: at}
		return
	}
	prev := l.pad.in
	l.pad = source{in: in, at: at}
	if intentActive(prev) || !intentActive(in) {
		return
	}
	l.releaseLocked(at)
	if in.LiftJog != 0 {
		l.gotoActive = false
		l.abortProcLocked("superseded by jog")
	}
}

// Command applies one DrillCommand. Motion commands clear the halt latch; stop
// sets it.
func (l *Loop) Command(cmd *drillv1.DrillCommand, at time.Time) {
	l.lock()
	defer l.unlock()

	switch a := cmd.GetAction().(type) {
	case *drillv1.DrillCommand_Stop:
		if a.Stop {
			l.haltLocked(haltStop)
		}
	case *drillv1.DrillCommand_JogLift:
		v := clampUnit(a.JogLift.GetVelocityNorm())
		if v != 0 {
			l.releaseLocked(at)
			l.gotoActive = false
			l.abortProcLocked("superseded by jog")
		}
		l.cmd.in.LiftJog, l.cmd.at = v, at
	case *drillv1.DrillCommand_RunAuger:
		t := clampUnit(a.RunAuger.GetThrottle())
		if t != 0 {
			l.releaseLocked(at)
		}
		switch {
		case t > 0:
			l.cmd.in.Auger, l.cmd.in.Throttle = dirDrill, t
		case t < 0:
			l.cmd.in.Auger, l.cmd.in.Throttle = dirSwitch, -t
		default:
			l.cmd.in.Auger, l.cmd.in.Throttle = dirIdle, 0
		}
		l.cmd.at = at
	case *drillv1.DrillCommand_GotoHeight:
		if !l.calibrated || !l.haveNorm {
			l.lastRefusal = "goto_height: uncalibrated"
			return
		}
		l.releaseLocked(at)
		l.abortProcLocked("superseded by goto_height")
		l.cmd.in.LiftJog, l.cmd.at = 0, at
		l.gotoActive, l.gotoTarget = true, clampNorm(a.GotoHeight.GetNorm())
		l.phase = phaseGoto
	case *drillv1.DrillCommand_Home:
		if !a.Home {
			return
		}
		l.releaseLocked(at)
		l.startProcLocked(procHome, lift.NewHome(), lift.PhaseHoming, at)
	case *drillv1.DrillCommand_Calibrate:
		if !a.Calibrate.GetRun() {
			l.abortProcLocked("aborted by operator")
			return
		}
		if !l.homed {
			l.lastRefusal = "calibrate: unhomed"
			return
		}
		l.releaseLocked(at)
		l.startProcLocked(procCalibrate, lift.NewCalibrate(), lift.PhaseRunDown, at)
	}
}

// Observe folds one 20 Hz read pair in: it advances the axis, steps a running
// procedure, and halts on a read gap while either servo is being driven.
func (l *Loop) Observe(liftObs, augerObs lift.Obs) {
	l.lock()
	defer l.unlock()

	now := liftObs.At
	if now.IsZero() {
		now = time.Now()
	}

	delta, _ := l.axis.Observe(liftObs)
	l.refreshAxisLocked()

	if l.proc != nil {
		l.stepProcLocked(liftObs, delta, now)
	}

	liftGap := l.liftDog.Observe(liftObs.OK, now)
	augerGap := l.augerDog.Observe(augerObs.OK, now)
	if (liftGap && l.liftVel != 0) || (augerGap && l.augerVel != 0) {
		l.haltLocked(haltReadGap)
	}
}

// ObserveFaults latches a halt on a servo overcurrent trip. The flag rides on
// the raw ServoState, which lift.Obs does not carry, so it arrives separately.
func (l *Loop) ObserveFaults(liftTripped, augerTripped bool) {
	if !liftTripped && !augerTripped {
		return
	}
	l.lock()
	defer l.unlock()
	if l.halted {
		return
	}
	l.haltLocked(haltOvercurrent)
}

func (l *Loop) Snapshot() Status {
	l.lock()
	defer l.unlock()
	return Status{
		Phase:            l.phase,
		Halted:           l.halted,
		HaltReason:       l.haltReason,
		LastRefusal:      l.lastRefusal,
		AugerDir:         l.augerDir,
		SwitchAllowed:    l.switchAllowed,
		SwitchReason:     l.switchReason,
		LiftVelocityCmd:  l.liftVel,
		AugerVelocityCmd: l.augerVel,
	}
}

// Run drives the loop until stop closes. Leaving is a stop: both servos are
// zeroed and torque-off before the SDK drains the connection.
func (l *Loop) Run(stop <-chan struct{}) {
	t := time.NewTicker(tickPeriod)
	defer t.Stop()
	defer l.shutdown()
	for {
		select {
		case <-stop:
			return
		case now := <-t.C:
			l.tick(now)
		}
	}
}

func (l *Loop) shutdown() {
	l.lock()
	defer l.unlock()
	l.haltWritesLocked()
}

func (l *Loop) tick(now time.Time) {
	l.lock()
	defer l.unlock()

	if l.halted {
		return
	}
	// Deadman: hold-to-move motion needs a live operator. Procedures and
	// goto_height run to their own completion and are not held.
	if l.staleHoldLocked(now) {
		l.haltLocked(haltStale)
		return
	}
	// The read gap is judged on the tick clock, not on read arrivals: a wedged
	// bus stops producing observations, so waiting for the next one is no timeout.
	if (l.liftVel != 0 && l.liftDog.Expired(now)) || (l.augerVel != 0 && l.augerDog.Expired(now)) {
		l.haltLocked(haltReadGap)
		return
	}

	liftV := l.liftVelocityLocked()
	augerV := l.augerVelocityLocked()
	l.phase = l.phaseForLocked(liftV, augerV)
	l.driveLocked(l.cfg.LiftID, liftV, &l.liftVel, &l.liftTorque)
	l.driveLocked(l.cfg.AugerID, augerV, &l.augerVel, &l.augTorque)
}

func (l *Loop) liftVelocityLocked() int32 {
	switch {
	case l.proc != nil:
		return scale(l.procSign, l.cfg.SlowJogSpeed, l.cfg.LiftUpSign)
	case l.gotoActive:
		return l.gotoVelocityLocked()
	}
	speed := l.cfg.JogSpeed
	if !l.homed {
		speed = l.cfg.SlowJogSpeed
	}
	return clampSpeed(int32(math.Round(l.holdLiftLocked() * float64(speed) * float64(l.cfg.LiftUpSign))))
}

// gotoVelocityLocked drives toward the target normalized height; norm grows
// downward, so a target below the current height needs the down sign.
func (l *Loop) gotoVelocityLocked() int32 {
	if !l.haveNorm {
		l.gotoActive = false
		return 0
	}
	d := l.gotoTarget - l.heightNorm
	if math.Abs(d) <= gotoBand {
		l.gotoActive = false
		return 0
	}
	dir := -1
	if d < 0 {
		dir = 1
	}
	return scale(dir, l.cfg.JogSpeed, l.cfg.LiftUpSign)
}

func (l *Loop) augerVelocityLocked() int32 {
	l.refreshSwitchLocked()
	dir, throttle := l.holdAugerLocked()
	if throttle == 0 || (dir != dirDrill && dir != dirSwitch) {
		l.augerDir = dirIdle
		return 0
	}
	if dir == dirSwitch && !l.switchAllowed {
		l.augerDir = dirIdle
		return 0
	}
	v := auger.Velocity(dir, throttle, l.cfg)
	if v == 0 {
		l.augerDir = dirIdle
		return 0
	}
	l.augerDir = dir
	return v
}

func (l *Loop) phaseForLocked(liftV, augerV int32) string {
	switch {
	case l.proc != nil && l.procKind == procHome:
		return phaseHoming
	case l.proc != nil:
		return phaseCalibrating
	case l.gotoActive:
		return phaseGoto
	case liftV != 0 || augerV != 0:
		return phaseJog
	}
	return phaseIdle
}

// driveLocked writes the commanded velocity every tick while a servo moves, and
// exactly one zero on release. Torque is enabled before the first motion write.
func (l *Loop) driveLocked(id uint32, v int32, last *int32, torque *bool) {
	if v != 0 && !*torque {
		_ = l.bus.SetTorqueEnable(id, true)
		*torque = true
	}
	if v == 0 && *last == 0 {
		return
	}
	_ = l.bus.SetGoalVelocity(id, v)
	*last = v
}

func (l *Loop) haltLocked(reason string) {
	l.halted = true
	l.haltReason = reason
	l.cmd = source{in: teleop.Intent{Auger: dirIdle}}
	l.pad.in = teleop.Intent{Auger: dirIdle}
	l.padArmed = false
	l.gotoActive = false
	l.augerDir = dirIdle
	l.abortProcLocked(reason)
	l.phase = phaseIdle
	l.haltWritesLocked()
	l.refreshSwitchLocked()
}

// haltWritesLocked is the only stop sequence: zero velocity on both servos
// first, then torque off. A wheel-mode STS3215 keeps acting on its latched
// GOAL_SPEED after torque is cut, so torque-off alone is never a stop.
func (l *Loop) haltWritesLocked() {
	_ = l.bus.SetGoalVelocity(l.cfg.LiftID, 0)
	_ = l.bus.SetGoalVelocity(l.cfg.AugerID, 0)
	l.liftVel, l.augerVel = 0, 0
	_ = l.bus.SetTorqueEnable(l.cfg.LiftID, false)
	_ = l.bus.SetTorqueEnable(l.cfg.AugerID, false)
	l.liftTorque, l.augTorque = false, false
}

func (l *Loop) releaseLocked(at time.Time) {
	if !l.halted {
		return
	}
	l.halted = false
	l.haltReason = ""
	l.liftDog.Reset(at)
	l.augerDog.Reset(at)
	l.refreshSwitchLocked()
}

// holdLiftLocked and holdAugerLocked merge the two input sources: whichever one
// is actively asking for motion wins, so a neutral mirror frame cannot cancel a
// tab command and a mirrored one cannot overwrite it.
func (l *Loop) holdLiftLocked() float64 {
	if l.pad.in.LiftJog != 0 {
		return l.pad.in.LiftJog
	}
	return l.cmd.in.LiftJog
}

func (l *Loop) holdAugerLocked() (drillv1.AugerDirection, float64) {
	if p := l.pad.in; p.Throttle != 0 && (p.Auger == dirDrill || p.Auger == dirSwitch) {
		return p.Auger, p.Throttle
	}
	return l.cmd.in.Auger, l.cmd.in.Throttle
}

// staleHoldLocked reports a lost operator: each source ages on its own clock, so
// a live gamepad cannot keep a tab command alive and vice versa.
func (l *Loop) staleHoldLocked(now time.Time) bool {
	for _, s := range []source{l.pad, l.cmd} {
		if intentActive(s.in) && now.Sub(s.at) > l.cfg.StaleInput {
			return true
		}
	}
	return false
}

func intentActive(in teleop.Intent) bool {
	if in.LiftJog != 0 {
		return true
	}
	return in.Throttle != 0 && (in.Auger == dirDrill || in.Auger == dirSwitch)
}

func (l *Loop) startProcLocked(kind string, p *lift.Proc, phase string, at time.Time) {
	l.abortProcLocked("superseded by " + kind)
	l.gotoActive = false
	l.cmd.in.LiftJog = 0
	l.proc, l.procKind, l.procPhase = p, kind, phase
	// The procedure drives only once a read has arrived: Step owns the sign.
	l.procSign = 0
	l.stall = lift.NewStallDetector(l.cfg.StallLoad, l.cfg.StallTicks, l.cfg.StallSpeedEps, l.cfg.StallDeltaEps)
	l.phase = phaseHoming
	if kind == procCalibrate {
		l.phase = phaseCalibrating
	}
	l.emitLocked(phase, nil, "", at)
}

func (l *Loop) stepProcLocked(o lift.Obs, delta int64, now time.Time) {
	stalled := l.stall.Observe(o, delta)
	ticks, _ := l.axis.HeightTicks()
	res := l.proc.Step(stalled, ticks)
	l.procSign = res.VelocitySign

	// A finished or aborted leg ends against a hard stop: zero the lift before
	// anything else, including the event that reports it.
	if res.Done || res.Aborted {
		_ = l.bus.SetGoalVelocity(l.cfg.LiftID, 0)
		l.liftVel = 0
	}
	if res.Phase != l.procPhase {
		l.procPhase = res.Phase
		l.stall.Reset() // each leg needs its own run of stall evidence
		l.emitLocked(res.Phase, res.Travel, "", now)
	} else if now.Sub(l.lastEvent) >= eventPeriod {
		l.emitLocked(res.Phase, nil, "", now)
	}
	if !res.Done && !res.Aborted {
		return
	}
	if res.Done {
		if l.procKind == procHome {
			l.axis.AnchorTop()
		}
		if res.Travel != nil {
			l.axis.SetTravel(*res.Travel)
		}
		l.refreshAxisLocked()
	}
	l.proc, l.procSign = nil, 0
	l.phase = phaseIdle
}

func (l *Loop) abortProcLocked(detail string) {
	if l.proc == nil {
		return
	}
	l.proc.Abort()
	l.proc, l.procSign = nil, 0
	l.procPhase = lift.PhaseAborted
	l.phase = phaseIdle
	l.emitLocked(lift.PhaseAborted, nil, detail, time.Now())
}

func (l *Loop) lock() { l.mu.Lock() }

// unlock releases the mutex and only then runs the queued procedure events. The
// Events callback publishes and writes calibration to flash, so running it under
// the lock would stall the tick, and running it inline would let it precede the
// zero-velocity write that caused it.
func (l *Loop) unlock() {
	queued := l.pending
	l.pending = nil
	l.mu.Unlock()
	if l.ev == nil {
		return
	}
	for _, e := range queued {
		l.ev(e.phase, e.travel, e.detail)
	}
}

func (l *Loop) emitLocked(phase string, travel *int64, detail string, at time.Time) {
	l.lastEvent = at
	l.pending = append(l.pending, pendingEvent{phase: phase, travel: travel, detail: detail})
}

func (l *Loop) refreshAxisLocked() {
	l.homed = l.axis.Homed()
	l.calibrated = l.axis.Calibrated()
	l.heightNorm, l.haveNorm = l.axis.HeightNorm()
	l.refreshSwitchLocked()
}

func (l *Loop) refreshSwitchLocked() {
	if l.halted {
		l.switchAllowed, l.switchReason = false, "halted"
		return
	}
	l.switchAllowed, l.switchReason = l.il.SwitchAllowed(l.calibrated, l.heightNorm, l.haveNorm)
}

func scale(sign int, speed int32, upSign int) int32 {
	return clampSpeed(int32(sign*upSign) * speed)
}

func clampSpeed(v int32) int32 {
	if v > config.MaxSpeedRaw {
		return config.MaxSpeedRaw
	}
	if v < -config.MaxSpeedRaw {
		return -config.MaxSpeedRaw
	}
	return v
}

func clampUnit(v float64) float64 {
	if math.IsNaN(v) {
		return 0
	}
	if v > 1 {
		return 1
	}
	if v < -1 {
		return -1
	}
	return v
}

func clampNorm(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
