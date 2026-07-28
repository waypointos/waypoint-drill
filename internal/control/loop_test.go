package control

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/waypointos/waypoint-drill/internal/auger"
	"github.com/waypointos/waypoint-drill/internal/config"
	"github.com/waypointos/waypoint-drill/internal/lift"
	"github.com/waypointos/waypoint-drill/internal/teleop"
	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

var t0 = time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)

// haltOps is the frozen stop sequence: zero velocity on both servos, then
// torque off on both.
var haltOps = []string{"velocity 11=0", "velocity 12=0", "torque 11=off", "torque 12=off"}

type recBus struct {
	mu     sync.Mutex
	writes []string
	lastV  map[uint32]int32
}

func (b *recBus) SetGoalVelocity(id uint32, raw int32) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.writes = append(b.writes, fmt.Sprintf("velocity %d=%d", id, raw))
	if b.lastV == nil {
		b.lastV = map[uint32]int32{}
	}
	b.lastV[id] = raw
	return nil
}

func (b *recBus) SetTorqueEnable(id uint32, on bool) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	state := "off"
	if on {
		state = "on"
	}
	b.writes = append(b.writes, fmt.Sprintf("torque %d=%s", id, state))
	return nil
}

// mark interleaves a non-bus step into the recorded order, so tests can assert
// what happens before or after a servo write.
func (b *recBus) mark(s string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.writes = append(b.writes, s)
}

func (b *recBus) ops() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.writes...)
}

func (b *recBus) reset() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.writes = nil
}

func (b *recBus) velocity(id uint32) int32 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.lastV[id]
}

type event struct {
	Phase  string
	Travel *int64
	Detail string
}

type fixture struct {
	loop *Loop
	bus  *recBus
	axis *lift.Axis
	cfg  *config.Config

	mu     sync.Mutex
	events []event
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	cfg, err := config.Load("")
	require.NoError(t, err)
	// Pin both wiring signs positive so a velocity assertion below reads in the
	// same direction as the intent that produced it. The shipped defaults are
	// the reference assembly's, and config_test covers those.
	cfg.LiftUpSign, cfg.AugerDrillSign = 1, 1
	return newFixtureWith(t, cfg)
}

func newFixtureWith(t *testing.T, cfg *config.Config) *fixture {
	t.Helper()
	f := &fixture{bus: &recBus{}, axis: lift.NewAxis(), cfg: cfg}
	f.loop = NewLoop(cfg, f.bus, f.axis, auger.NewInterlock(cfg.TopBandFraction), func(phase string, travel *int64, detail string) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.events = append(f.events, event{Phase: phase, Travel: travel, Detail: detail})
	})
	return f
}

func (f *fixture) phases() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.events))
	for _, e := range f.events {
		out = append(out, e.Phase)
	}
	return out
}

func (f *fixture) lastEvent(t *testing.T) event {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	require.NotEmpty(t, f.events)
	return f.events[len(f.events)-1]
}

func (f *fixture) jog(v float64, at time.Time) {
	f.loop.SetTeleop(teleop.Intent{LiftJog: v, Auger: dirIdle}, at)
}

func (f *fixture) runAuger(dir drillv1.AugerDirection, throttle float64, at time.Time) {
	f.loop.SetTeleop(teleop.Intent{Auger: dir, Throttle: throttle}, at)
}

// observe feeds one read pair; the auger read always answers so only the lift
// drives the axis.
func (f *fixture) observe(pos uint16, load, speed int32, at time.Time) {
	f.loop.Observe(
		lift.Obs{PositionRaw: pos, LoadRaw: load, SpeedRaw: speed, OK: true, At: at},
		lift.Obs{OK: true, At: at},
	)
}

func (f *fixture) observeFailed(at time.Time) {
	f.loop.Observe(lift.Obs{At: at}, lift.Obs{At: at})
}

// anchorTop homes the axis at the current raw position and refreshes the loop's
// cached view of it.
func (f *fixture) anchorTop(pos uint16, at time.Time) {
	f.observe(pos, 0, 0, at)
	f.axis.AnchorTop()
	f.observe(pos, 0, 0, at)
}

func stopCmd(v bool) *drillv1.DrillCommand {
	return &drillv1.DrillCommand{Action: &drillv1.DrillCommand_Stop{Stop: v}}
}

func setTopCmd(v bool) *drillv1.DrillCommand {
	return &drillv1.DrillCommand{Action: &drillv1.DrillCommand_SetTop{SetTop: v}}
}

func setBottomCmd(v bool) *drillv1.DrillCommand {
	return &drillv1.DrillCommand{Action: &drillv1.DrillCommand_SetBottom{SetBottom: v}}
}

func jogCmd(v float64) *drillv1.DrillCommand {
	return &drillv1.DrillCommand{Action: &drillv1.DrillCommand_JogLift{JogLift: &drillv1.JogLift{VelocityNorm: v}}}
}

func gotoCmd(norm float64) *drillv1.DrillCommand {
	return &drillv1.DrillCommand{Action: &drillv1.DrillCommand_GotoHeight{GotoHeight: &drillv1.GotoHeight{Norm: norm}}}
}

func augerCmd(throttle float64) *drillv1.DrillCommand {
	return &drillv1.DrillCommand{Action: &drillv1.DrillCommand_RunAuger{RunAuger: &drillv1.RunAuger{Throttle: throttle}}}
}

// ---- halt matrix ----

func TestStopCommandZeroesBothServosBeforeTorqueOff(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	require.NotEmpty(t, f.bus.ops())
	f.bus.reset()

	f.loop.Command(stopCmd(true), t0)

	assert.Equal(t, haltOps, f.bus.ops())
	st := f.loop.Snapshot()
	assert.True(t, st.Halted)
	assert.Equal(t, "stop command", st.HaltReason)
	assert.Equal(t, "idle", st.Phase)
}

func TestStaleTeleopInputHaltsWithZeroWritesFirst(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	f.bus.reset()

	f.loop.tick(t0.Add(200 * time.Millisecond))

	assert.Equal(t, haltOps, f.bus.ops())
	st := f.loop.Snapshot()
	assert.True(t, st.Halted)
	assert.Equal(t, "input stale", st.HaltReason)
}

func TestFreshInsideTheStaleWindowKeepsMoving(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)

	f.loop.tick(t0.Add(100 * time.Millisecond))

	assert.False(t, f.loop.Snapshot().Halted)
	assert.Equal(t, int32(150), f.bus.velocity(11))
}

func TestReadGapHaltsAMovingAxisWithZeroWritesFirst(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	f.observe(0, 0, 150, t0)
	f.bus.reset()

	f.observeFailed(t0.Add(300 * time.Millisecond))

	assert.Equal(t, haltOps, f.bus.ops())
	st := f.loop.Snapshot()
	assert.True(t, st.Halted)
	assert.Equal(t, "read gap", st.HaltReason)
}

func TestReadGapIsIgnoredWhileIdle(t *testing.T) {
	f := newFixture(t)
	f.observe(0, 0, 0, t0)

	f.observeFailed(t0.Add(300 * time.Millisecond))

	assert.False(t, f.loop.Snapshot().Halted)
	assert.Empty(t, f.bus.ops())
}

// A wedged servo bus produces no observations at all, so the read-gap deadline
// has to be judged on the loop's own clock.
func TestReadGapHaltsWithoutAnyFurtherObservation(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	f.observe(0, 0, 150, t0)
	f.bus.reset()

	at := t0
	for i := 0; i < 20 && !f.loop.Snapshot().Halted; i++ {
		at = at.Add(20 * time.Millisecond)
		f.jog(1, at)
		f.loop.tick(at)
	}

	st := f.loop.Snapshot()
	assert.True(t, st.Halted)
	assert.Equal(t, "read gap", st.HaltReason)
	assert.Equal(t, haltOps, f.bus.ops()[len(f.bus.ops())-len(haltOps):])
	assert.LessOrEqual(t, at.Sub(t0), 300*time.Millisecond, "the halt must not wait for a read that never comes")
}

func TestOvercurrentHaltsWithZeroWritesFirst(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	f.bus.reset()

	f.loop.ObserveFaults(false, true)

	assert.Equal(t, haltOps, f.bus.ops())
	st := f.loop.Snapshot()
	assert.True(t, st.Halted)
	assert.Equal(t, "overcurrent", st.HaltReason)
}

func TestNoMotionAfterHaltUntilFreshInput(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	f.loop.Command(stopCmd(true), t0)
	f.bus.reset()

	f.loop.tick(t0.Add(20 * time.Millisecond))
	f.loop.tick(t0.Add(40 * time.Millisecond))
	assert.Empty(t, f.bus.ops(), "a latched halt refuses every tick")

	// Letting go and pressing again is the fresh input; the release alone is not.
	f.jog(0, t0.Add(60*time.Millisecond))
	at := t0.Add(80 * time.Millisecond)
	f.jog(1, at)
	f.loop.tick(at)

	assert.Equal(t, []string{"torque 11=on", "velocity 11=150"}, f.bus.ops())
	assert.False(t, f.loop.Snapshot().Halted)
}

// The dashboard mirrors a connected pad at 50 Hz whether or not a button is
// down, so a button held through a fault must not keep clearing the latch.
func TestAHeldGamepadButtonDoesNotClearTheLatch(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	f.loop.ObserveFaults(false, true)
	require.True(t, f.loop.Snapshot().Halted)
	f.bus.reset()

	at := t0
	for i := 0; i < 10; i++ {
		at = at.Add(20 * time.Millisecond)
		f.jog(1, at) // still held
		f.loop.tick(at)
	}

	assert.Empty(t, f.bus.ops(), "a held button re-arms nothing")
	st := f.loop.Snapshot()
	assert.True(t, st.Halted)
	assert.Equal(t, "overcurrent", st.HaltReason)
}

func TestMotionCommandAlsoClearsTheLatch(t *testing.T) {
	f := newFixture(t)
	f.loop.Command(stopCmd(true), t0)
	f.bus.reset()

	at := t0.Add(20 * time.Millisecond)
	f.loop.Command(jogCmd(-1), at)
	f.loop.tick(at)

	assert.False(t, f.loop.Snapshot().Halted)
	assert.Equal(t, int32(-150), f.bus.velocity(11))
}

func TestStopFalseIsNotAHalt(t *testing.T) {
	f := newFixture(t)

	f.loop.Command(stopCmd(false), t0)

	assert.False(t, f.loop.Snapshot().Halted)
	assert.Empty(t, f.bus.ops())
}

// ---- jog, goto, hold-to-move ----

func TestUnhomedJogCreepsAtSlowSpeed(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)

	f.loop.tick(t0)

	assert.Equal(t, int32(150), f.bus.velocity(11))
	assert.Equal(t, "jog", f.loop.Snapshot().Phase)
}

func TestHomedJogUsesTheFullJogSpeed(t *testing.T) {
	f := newFixture(t)
	f.anchorTop(0, t0)

	at := t0.Add(50 * time.Millisecond)
	f.jog(1, at)
	f.loop.tick(at)

	assert.Equal(t, int32(400), f.bus.velocity(11))
}

func TestJogSignFollowsLiftUpSign(t *testing.T) {
	cfg, err := config.Load("")
	require.NoError(t, err)
	cfg.LiftUpSign = -1
	f := newFixtureWith(t, cfg)
	f.jog(1, t0)

	f.loop.tick(t0)

	assert.Equal(t, int32(-150), f.bus.velocity(11))
}

func TestMovingRewritesTheVelocityEveryTick(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	f.bus.reset()

	f.loop.tick(t0.Add(20 * time.Millisecond))
	f.loop.tick(t0.Add(40 * time.Millisecond))

	assert.Equal(t, []string{"velocity 11=150", "velocity 11=150"}, f.bus.ops())
}

func TestHoldToMoveReleaseWritesZeroOnce(t *testing.T) {
	f := newFixture(t)
	f.jog(1, t0)
	f.loop.tick(t0)
	f.bus.reset()

	at := t0.Add(20 * time.Millisecond)
	f.jog(0, at)
	f.loop.tick(at)
	assert.Equal(t, []string{"velocity 11=0"}, f.bus.ops())

	f.bus.reset()
	f.loop.tick(t0.Add(40 * time.Millisecond))
	assert.Empty(t, f.bus.ops(), "a released axis is not rewritten")
	assert.Equal(t, "idle", f.loop.Snapshot().Phase)
}

func TestGotoRefusedWhileUncalibrated(t *testing.T) {
	f := newFixture(t)

	f.loop.Command(gotoCmd(0.5), t0)
	f.loop.tick(t0)

	assert.Equal(t, "goto_height: uncalibrated", f.loop.Snapshot().LastRefusal)
	assert.Empty(t, f.bus.ops())
}

func TestGotoDrivesDownThenStopsInsideTheBand(t *testing.T) {
	f := newFixture(t)
	f.anchorTop(0, t0)
	f.axis.SetTravel(1000)
	f.observe(0, 0, 0, t0)

	f.loop.Command(gotoCmd(0.5), t0)
	f.loop.tick(t0)
	assert.Equal(t, int32(-400), f.bus.velocity(11), "norm grows downward, so down is the negative up sign")
	assert.Equal(t, "goto", f.loop.Snapshot().Phase)

	at := t0.Add(100 * time.Millisecond)
	f.observe(500, 0, -400, at)
	f.bus.reset()
	f.loop.tick(at)

	assert.Equal(t, []string{"velocity 11=0"}, f.bus.ops())
	assert.Equal(t, "idle", f.loop.Snapshot().Phase)
}

func TestGotoIsNotSubjectToTheInputDeadman(t *testing.T) {
	f := newFixture(t)
	f.anchorTop(0, t0)
	f.axis.SetTravel(1000)
	f.observe(0, 0, 0, t0)
	f.loop.Command(gotoCmd(1), t0)

	f.loop.tick(t0.Add(2 * time.Second))

	assert.False(t, f.loop.Snapshot().Halted)
	assert.Equal(t, int32(-400), f.bus.velocity(11))
}

// ---- the two input sources ----

func TestNeutralMirrorFramesDoNotCancelATabJog(t *testing.T) {
	f := newFixture(t)
	f.loop.Command(jogCmd(1), t0)

	at := t0
	for i := 0; i < 5; i++ {
		at = at.Add(20 * time.Millisecond)
		f.loop.Command(jogCmd(1), at) // the tab repeats its hold
		f.jog(0, at)                  // a connected pad mirrors an idle frame
		f.loop.tick(at)
	}

	assert.Equal(t, int32(150), f.bus.velocity(11))
	assert.False(t, f.loop.Snapshot().Halted)
}

func TestATabJogGoesStaleEvenWhileTheMirrorIsLive(t *testing.T) {
	f := newFixture(t)
	f.loop.Command(jogCmd(1), t0)
	f.loop.tick(t0)
	f.bus.reset()

	at := t0.Add(200 * time.Millisecond)
	f.jog(0, at) // the pad is alive but idle; it must not refresh the tab deadman
	f.loop.tick(at)

	assert.Equal(t, haltOps, f.bus.ops())
	assert.Equal(t, "input stale", f.loop.Snapshot().HaltReason)
}

func TestGamepadJogCancelsAGoto(t *testing.T) {
	f := newFixture(t)
	f.anchorTop(0, t0)
	f.axis.SetTravel(1000)
	f.observe(0, 0, 0, t0)
	f.loop.Command(gotoCmd(1), t0)
	f.loop.tick(t0)
	require.Equal(t, int32(-400), f.bus.velocity(11))

	at := t0.Add(20 * time.Millisecond)
	f.jog(1, at)
	f.loop.tick(at)

	assert.Equal(t, int32(400), f.bus.velocity(11), "the pad takes the axis back")
	assert.Equal(t, "jog", f.loop.Snapshot().Phase)
}

// ---- auger and the switch interlock ----

func TestAugerDrillRunsWithoutCalibration(t *testing.T) {
	f := newFixture(t)
	f.runAuger(dirDrill, 1, t0)

	f.loop.tick(t0)

	assert.Equal(t, int32(800), f.bus.velocity(12))
	assert.Equal(t, dirDrill, f.loop.Snapshot().AugerDir)
}

func TestSwitchRefusedWhileUncalibrated(t *testing.T) {
	f := newFixture(t)
	f.runAuger(dirSwitch, 1, t0)

	f.loop.tick(t0)

	st := f.loop.Snapshot()
	assert.False(t, st.SwitchAllowed)
	assert.Equal(t, "uncalibrated", st.SwitchReason)
	assert.Equal(t, dirIdle, st.AugerDir)
	assert.Empty(t, f.bus.ops())
}

func TestSwitchRefusedBelowTheTopBand(t *testing.T) {
	f := newFixture(t)
	f.anchorTop(0, t0)
	f.axis.SetTravel(1000)
	f.observe(500, 0, 0, t0)

	at := t0.Add(50 * time.Millisecond)
	f.runAuger(dirSwitch, 1, at)
	f.loop.tick(at)

	st := f.loop.Snapshot()
	assert.False(t, st.SwitchAllowed)
	assert.Equal(t, "below top band", st.SwitchReason)
	assert.Equal(t, dirIdle, st.AugerDir)
	assert.Empty(t, f.bus.ops())
}

func TestSwitchRunsInsideTheTopBand(t *testing.T) {
	f := newFixture(t)
	f.anchorTop(0, t0)
	f.axis.SetTravel(1000)
	f.observe(10, 0, 0, t0)

	at := t0.Add(50 * time.Millisecond)
	f.runAuger(dirSwitch, 1, at)
	f.loop.tick(at)

	st := f.loop.Snapshot()
	assert.True(t, st.SwitchAllowed)
	assert.Equal(t, "", st.SwitchReason)
	assert.Equal(t, dirSwitch, st.AugerDir)
	assert.Equal(t, int32(-300), f.bus.velocity(12), "switch_direction ccw is the sign opposite the drill")
}

func TestSwitchReasonIsHaltedWhileLatched(t *testing.T) {
	f := newFixture(t)
	f.anchorTop(0, t0)
	f.axis.SetTravel(1000)
	f.observe(0, 0, 0, t0)

	f.loop.Command(stopCmd(true), t0)

	st := f.loop.Snapshot()
	assert.False(t, st.SwitchAllowed)
	assert.Equal(t, "halted", st.SwitchReason)
}

func TestRunAugerNegativeThrottleIsTheSwitchDirection(t *testing.T) {
	f := newFixture(t)
	f.anchorTop(0, t0)
	f.axis.SetTravel(1000)
	f.observe(0, 0, 0, t0)

	at := t0.Add(50 * time.Millisecond)
	f.loop.Command(augerCmd(-0.5), at)
	f.loop.tick(at)

	assert.Equal(t, dirSwitch, f.loop.Snapshot().AugerDir)
	assert.Equal(t, int32(-150), f.bus.velocity(12))
}

func TestAugerReleaseWritesZero(t *testing.T) {
	f := newFixture(t)
	f.loop.Command(augerCmd(1), t0)
	f.loop.tick(t0)
	require.Equal(t, int32(800), f.bus.velocity(12))
	f.bus.reset()

	at := t0.Add(20 * time.Millisecond)
	f.loop.Command(augerCmd(0), at)
	f.loop.tick(at)

	assert.Equal(t, []string{"velocity 12=0"}, f.bus.ops())
	assert.Equal(t, dirIdle, f.loop.Snapshot().AugerDir)
}

func TestGamepadAugerReleaseWritesZero(t *testing.T) {
	f := newFixture(t)
	f.runAuger(dirDrill, 1, t0)
	f.loop.tick(t0)
	f.bus.reset()

	at := t0.Add(20 * time.Millisecond)
	f.runAuger(dirIdle, 0, at)
	f.loop.tick(at)

	assert.Equal(t, []string{"velocity 12=0"}, f.bus.ops())
	assert.Equal(t, dirIdle, f.loop.Snapshot().AugerDir)
}

// ---- end marks ----

func TestSetTopAnchorsHeightZeroWhereTheLiftStands(t *testing.T) {
	f := newFixture(t)
	f.observe(1500, 0, 0, t0)

	f.loop.Command(setTopCmd(true), t0)

	assert.True(t, f.axis.Homed())
	ticks, ok := f.axis.HeightTicks()
	require.True(t, ok)
	assert.Equal(t, int64(0), ticks)
	assert.Equal(t, []string{"top_set"}, f.phases())
	assert.Nil(t, f.lastEvent(t).Travel)
	assert.Empty(t, f.bus.ops(), "a mark commands no servo")
	assert.Equal(t, "idle", f.loop.Snapshot().Phase)
}

func TestSetBottomMeasuresTheSpanBelowTheTopAnchor(t *testing.T) {
	f := newFixture(t)
	f.observe(1000, 0, 0, t0)
	f.loop.Command(setTopCmd(true), t0)

	at := t0.Add(time.Second)
	f.observe(1900, 0, 0, at)
	f.loop.Command(setBottomCmd(true), at)

	assert.True(t, f.axis.Calibrated())
	assert.Equal(t, []string{"top_set", "bottom_set"}, f.phases())
	done := f.lastEvent(t)
	require.NotNil(t, done.Travel)
	assert.Equal(t, int64(900), *done.Travel)
	assert.Empty(t, f.bus.ops())
}

func TestSetBottomRefusedWhileUnhomed(t *testing.T) {
	f := newFixture(t)
	f.observe(1000, 0, 0, t0)

	f.loop.Command(setBottomCmd(true), t0)

	assert.False(t, f.axis.Calibrated())
	assert.Equal(t, "set_bottom: unhomed, mark the top first", f.loop.Snapshot().LastRefusal)
	assert.Equal(t, []string{"refused"}, f.phases())
}

// An inverted encoder, or the two marks made in the wrong order, puts the
// bottom at or above the anchor. That is refused rather than stored as an
// absolute span, which would read as a healthy calibration.
func TestSetBottomRefusesASpanThatIsNotBelowTheAnchor(t *testing.T) {
	f := newFixture(t)
	f.observe(1000, 0, 0, t0)
	f.loop.Command(setTopCmd(true), t0)

	at := t0.Add(time.Second)
	f.observe(600, 0, 0, at)
	f.loop.Command(setBottomCmd(true), at)

	assert.False(t, f.axis.Calibrated())
	assert.Equal(t, "set_bottom: bottom is not below the top anchor", f.loop.Snapshot().LastRefusal)
	assert.Equal(t, []string{"top_set", "refused"}, f.phases())
}

func TestMarksRefusedWhileTheLiftIsMoving(t *testing.T) {
	f := newFixture(t)
	f.observe(1000, 0, 0, t0)
	f.jog(1, t0)
	f.loop.tick(t0)
	require.NotZero(t, f.bus.velocity(11))

	f.loop.Command(setTopCmd(true), t0)

	assert.False(t, f.axis.Homed())
	assert.Equal(t, "set_top: lift is moving", f.loop.Snapshot().LastRefusal)
	assert.Equal(t, []string{"refused"}, f.phases())
}

func TestMarksRefusedBeforeTheFirstServoRead(t *testing.T) {
	f := newFixture(t)

	f.loop.Command(setTopCmd(true), t0)

	assert.False(t, f.axis.Homed())
	assert.Equal(t, "set_top: no servo read yet", f.loop.Snapshot().LastRefusal)
	assert.Equal(t, []string{"refused"}, f.phases())
}

// Re-marking the top keeps a stored span: the encoder loses its reference on
// every restart, so marking the top is routine and re-measuring the span is not.
func TestSetTopKeepsAStoredTravelSpan(t *testing.T) {
	f := newFixture(t)
	f.observe(1000, 0, 0, t0)
	f.loop.Command(setTopCmd(true), t0)
	at := t0.Add(time.Second)
	f.observe(1900, 0, 0, at)
	f.loop.Command(setBottomCmd(true), at)
	require.True(t, f.axis.Calibrated())

	at = at.Add(time.Second)
	f.observe(1000, 0, 0, at)
	f.loop.Command(setTopCmd(true), at)

	assert.True(t, f.axis.Calibrated())
	assert.True(t, f.axis.Homed())
}

// The events callback publishes and writes calibration to flash, so it must not
// run under the loop's mutex.
func TestMarkEventRunsOutsideTheLoopMutex(t *testing.T) {
	cfg, err := config.Load("")
	require.NoError(t, err)
	bus := &recBus{}
	axis := lift.NewAxis()
	var loop *Loop
	loop = NewLoop(cfg, bus, axis, auger.NewInterlock(cfg.TopBandFraction), func(phase string, _ *int64, _ string) {
		bus.mark("event " + phase)
		loop.Snapshot() // deadlocks if the callback still holds the loop mutex
	})

	loop.Observe(lift.Obs{PositionRaw: 100, OK: true, At: t0}, lift.Obs{OK: true, At: t0})
	loop.Command(setTopCmd(true), t0)

	assert.Equal(t, []string{"event top_set"}, bus.ops())
}

// ---- shutdown ----

func TestRunExitPerformsTheHaltWrites(t *testing.T) {
	f := newFixture(t)
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		f.loop.Run(stop)
		close(done)
	}()

	close(stop)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return")
	}

	ops := f.bus.ops()
	require.GreaterOrEqual(t, len(ops), len(haltOps))
	assert.Equal(t, haltOps, ops[len(ops)-len(haltOps):])
}
