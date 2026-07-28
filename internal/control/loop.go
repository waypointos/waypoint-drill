// Package control runs the drill's 50 Hz command loop. It turns operator intent
// into signed wheel velocities and owns the halt latch that stops both servos.
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

// Tick period and the goto arrival band.
const (
	tickPeriod = 20 * time.Millisecond
	gotoBand   = 0.005
)

// Loop phases, reported on drill.state.
const (
	phaseIdle = "idle"
	phaseJog  = "jog"
	phaseGoto = "goto"
)

// Halt reasons, reported on drill.state.
const (
	haltStop        = "stop command"
	haltStale       = "input stale"
	haltReadGap     = "read gap"
	haltOvercurrent = "overcurrent"
)

// Mark outcomes, reported on the calibration leaf.
const (
	markTopSet    = "top_set"
	markBottomSet = "bottom_set"
	markRefused   = "refused"
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

// Events reports the outcome of one operator mark. main publishes it on the
// calibration leaf and persists the travel span whenever one is reported.
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

// pendingEvent is a mark outcome queued for dispatch after the mutex drops.
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
		l.cmd.in.LiftJog, l.cmd.at = 0, at
		l.gotoActive, l.gotoTarget = true, clampNorm(a.GotoHeight.GetNorm())
		l.phase = phaseGoto
	case *drillv1.DrillCommand_SetTop:
		if a.SetTop {
			l.setTopLocked()
		}
	case *drillv1.DrillCommand_SetBottom:
		if a.SetBottom {
			l.setBottomLocked()
		}
	}
}

// setTopLocked anchors height 0 at wherever the lift is standing. It writes no
// velocity: the operator jogs to the top and marks it there.
func (l *Loop) setTopLocked() {
	if reason, ok := l.markBlockedLocked(); ok {
		l.refuseMarkLocked("set_top", reason)
		return
	}
	l.axis.AnchorTop()
	l.refreshAxisLocked()
	l.emitLocked(markTopSet, nil, "")
}

// setBottomLocked measures the travel span from the top anchor down to wherever
// the lift is standing. A bottom at or above the anchor is refused rather than
// stored as a distance: taking it as one would turn an inverted encoder, or two
// marks made in the wrong order, into a calibration that reads back healthy.
func (l *Loop) setBottomLocked() {
	if reason, ok := l.markBlockedLocked(); ok {
		l.refuseMarkLocked("set_bottom", reason)
		return
	}
	span, homed := l.axis.HeightTicks()
	if !homed {
		l.refuseMarkLocked("set_bottom", "unhomed, mark the top first")
		return
	}
	if !l.axis.SetTravel(span) {
		l.refuseMarkLocked("set_bottom", "bottom is not below the top anchor")
		return
	}
	l.refreshAxisLocked()
	l.emitLocked(markBottomSet, &span, "")
}

// markBlockedLocked names what stops a mark from being trustworthy. Both marks
// read the axis position, so a moving or unread lift would anchor a stale one.
func (l *Loop) markBlockedLocked() (string, bool) {
	switch {
	case l.halted:
		return "halted", true
	case l.liftVel != 0:
		return "lift is moving", true
	case !l.axis.Tracked():
		return "no servo read yet", true
	}
	return "", false
}

func (l *Loop) refuseMarkLocked(cmd, reason string) {
	l.lastRefusal = cmd + ": " + reason
	l.emitLocked(markRefused, nil, l.lastRefusal)
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

	l.axis.Observe(liftObs)
	l.refreshAxisLocked()

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
	if l.gotoActive {
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

func (l *Loop) lock() { l.mu.Lock() }

// unlock releases the mutex and only then runs the queued mark events. The
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

func (l *Loop) emitLocked(phase string, travel *int64, detail string) {
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
