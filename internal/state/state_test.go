package state

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	"github.com/waypointos/waypoint-drill/internal/control"
	"github.com/waypointos/waypoint-drill/internal/lift"
	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

var testNow = time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)

func observe(t *testing.T, a *lift.Axis, pos uint16) {
	t.Helper()
	a.Observe(lift.Obs{PositionRaw: pos, OK: true, At: testNow})
}

func homedAxis(t *testing.T) *lift.Axis {
	t.Helper()
	a := lift.NewAxis()
	observe(t, a, 1000)
	a.AnchorTop()
	return a
}

func TestBuildUnhomedLeavesEveryHeightFieldAbsent(t *testing.T) {
	scale := 0.5

	out := Build(testNow, lift.NewAxis(), control.Status{}, nil, nil, &scale)

	assert.False(t, out.Homed)
	assert.False(t, out.Calibrated)
	assert.Nil(t, out.HeightTicks)
	assert.Nil(t, out.HeightNorm)
	assert.Nil(t, out.HeightMm)
	assert.Equal(t, "unhomed", out.HeightNaReason)
	assert.Nil(t, out.LiftVelocityRaw)
	assert.Nil(t, out.AugerVelocityRaw)
	assert.Equal(t, testNow.UTC(), out.T.AsTime())
}

func TestBuildHomedShowsTicksButNotNorm(t *testing.T) {
	axis := homedAxis(t)

	out := Build(testNow, axis, control.Status{}, nil, nil, nil)

	assert.True(t, out.Homed)
	assert.False(t, out.Calibrated)
	require.NotNil(t, out.HeightTicks)
	assert.Equal(t, int64(0), *out.HeightTicks)
	assert.Nil(t, out.HeightNorm)
	assert.Nil(t, out.HeightMm)
	assert.Equal(t, "uncalibrated", out.HeightNaReason)
}

func TestBuildCalibratedShowsNormAndClearsTheReason(t *testing.T) {
	axis := homedAxis(t)
	axis.SetTravel(2000)

	out := Build(testNow, axis, control.Status{}, nil, nil, nil)

	assert.True(t, out.Calibrated)
	require.NotNil(t, out.HeightTicks)
	require.NotNil(t, out.HeightNorm)
	assert.Equal(t, 0.0, *out.HeightNorm)
	assert.Equal(t, "", out.HeightNaReason)
	assert.Nil(t, out.HeightMm, "mm stays absent without a configured tick scale")
}

func TestBuildHeightMmNeedsBothTicksAndScale(t *testing.T) {
	axis := homedAxis(t)
	observe(t, axis, 1200)
	ticks, ok := axis.HeightTicks()
	require.True(t, ok)
	require.NotZero(t, ticks)
	scale := 0.25

	withScale := Build(testNow, axis, control.Status{}, nil, nil, &scale)
	withoutScale := Build(testNow, axis, control.Status{}, nil, nil, nil)

	require.NotNil(t, withScale.HeightMm)
	assert.InDelta(t, float64(ticks)*scale, *withScale.HeightMm, 1e-9)
	assert.Nil(t, withoutScale.HeightMm)
}

func TestBuildHeightMmAbsentWhileUnhomedEvenWithScale(t *testing.T) {
	scale := 0.25

	out := Build(testNow, lift.NewAxis(), control.Status{}, nil, nil, &scale)

	assert.Nil(t, out.HeightMm)
}

func TestBuildCopiesControlStatus(t *testing.T) {
	st := control.Status{
		Phase:         "goto",
		Halted:        true,
		HaltReason:    "input stale",
		LastRefusal:   "goto_height: uncalibrated",
		AugerDir:      drillv1.AugerDirection_AUGER_DIRECTION_DRILL,
		SwitchAllowed: false,
		SwitchReason:  "below top band",
	}

	out := Build(testNow, lift.NewAxis(), st, nil, nil, nil)

	assert.Equal(t, "goto", out.Phase)
	assert.True(t, out.Halted)
	assert.Equal(t, "input stale", out.HaltReason)
	assert.Equal(t, "goto_height: uncalibrated", out.LastRefusal)
	assert.Equal(t, drillv1.AugerDirection_AUGER_DIRECTION_DRILL, out.AugerDirection)
	assert.False(t, out.SwitchAllowed)
	assert.Equal(t, "below top band", out.SwitchRefusedReason)
}

func TestBuildNilReadsRenderAsNotOK(t *testing.T) {
	out := Build(testNow, lift.NewAxis(), control.Status{}, nil, nil, nil)

	require.NotNil(t, out.Lift)
	require.NotNil(t, out.Auger)
	assert.False(t, out.Lift.Ok)
	assert.False(t, out.Auger.Ok)
	assert.Nil(t, out.Lift.PositionRaw)
	assert.Nil(t, out.Auger.PositionRaw)
}

func TestBuildVelocitiesComeFromTheLastRead(t *testing.T) {
	liftSt := &drillv1.ServoState{ServoId: 11, SpeedRaw: proto.Int32(-320), Ok: true}
	augerSt := &drillv1.ServoState{ServoId: 12, Ok: true}

	out := Build(testNow, lift.NewAxis(), control.Status{}, liftSt, augerSt, nil)

	require.NotNil(t, out.LiftVelocityRaw)
	assert.Equal(t, int32(-320), *out.LiftVelocityRaw)
	assert.Nil(t, out.AugerVelocityRaw, "an unanswered speed must not become 0")
	assert.Same(t, liftSt, out.Lift)
	assert.Same(t, augerSt, out.Auger)
}

func TestBuildStatsOrdersLiftThenAuger(t *testing.T) {
	liftSt := &drillv1.ServoState{ServoId: 11, PositionRaw: proto.Uint32(42), Ok: true}
	augerSt := &drillv1.ServoState{ServoId: 12, Ok: true}

	out := BuildStats(testNow, liftSt, augerSt)

	require.Len(t, out.Servos, 2)
	assert.Same(t, liftSt, out.Servos[0])
	assert.Same(t, augerSt, out.Servos[1])
	assert.Equal(t, testNow.UTC(), out.T.AsTime())
}

func TestBuildStatsWrapsNilReadsAsNotOK(t *testing.T) {
	out := BuildStats(testNow, nil, nil)

	require.Len(t, out.Servos, 2)
	for _, s := range out.Servos {
		require.NotNil(t, s)
		assert.False(t, s.Ok)
		assert.Nil(t, s.PositionRaw)
		assert.Nil(t, s.LoadRaw)
		assert.Nil(t, s.CurrentRaw)
		assert.Nil(t, s.VoltageDeci)
		assert.Nil(t, s.TemperatureC)
	}
}

// A failed read still carries its servo id from servobus, and both renderers
// must pass it through: the id is what the panel keys lift and auger off.
func TestFailedReadsKeepTheirServoIds(t *testing.T) {
	liftSt := &drillv1.ServoState{ServoId: 11}
	augerSt := &drillv1.ServoState{ServoId: 12}

	st := Build(testNow, lift.NewAxis(), control.Status{}, liftSt, augerSt, nil)
	assert.Equal(t, uint32(11), st.Lift.ServoId)
	assert.Equal(t, uint32(12), st.Auger.ServoId)
	assert.False(t, st.Lift.Ok)

	stats := BuildStats(testNow, liftSt, augerSt)
	require.Len(t, stats.Servos, 2)
	assert.Equal(t, uint32(11), stats.Servos[0].ServoId)
	assert.Equal(t, uint32(12), stats.Servos[1].ServoId)
}

func TestRateHzDefaultsWhenUnset(t *testing.T) {
	t.Setenv("WAYPOINT_MODULE_STATE_RATE_HZ", "")

	assert.Equal(t, 20.0, RateHz())
}

func TestRateHzAcceptsInBoundsValues(t *testing.T) {
	for _, tc := range []struct {
		env  string
		want float64
	}{
		{"1", 1},
		{"20", 20},
		{"7.5", 7.5},
		{"100", 100},
		{"0.5", 0.5},
	} {
		t.Setenv("WAYPOINT_MODULE_STATE_RATE_HZ", tc.env)
		assert.Equal(t, tc.want, RateHz(), "env %q", tc.env)
	}
}

func TestRateHzFallsBackOnOutOfBoundsOrGarbage(t *testing.T) {
	for _, env := range []string{"0", "-5", "100.1", "1000", "fast", "20hz", "NaN"} {
		t.Setenv("WAYPOINT_MODULE_STATE_RATE_HZ", env)
		assert.Equal(t, 20.0, RateHz(), "env %q", env)
	}
}
