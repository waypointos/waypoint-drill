package loadest

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/waypointos/waypoint-drill/internal/store"
)

type eventRec struct{ phase, detail string }

// clock is a manual test clock; every Observe advances it one 20Hz tick so
// the EMA sees the real cadence.
type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }
func (c *clock) tick()          { c.at = c.at.Add(50 * time.Millisecond) }

func newTest(t *testing.T) (*Estimator, *clock, *[]eventRec, string) {
	t.Helper()
	var evs []eventRec
	ck := &clock{at: time.Unix(1000, 0)}
	path := filepath.Join(t.TempDir(), "loadest.toml")
	e := New(path, func(phase, detail string) { evs = append(evs, eventRec{phase, detail}) }, Config{
		StallTorqueNmm: 30 * 98.0665, // 2941.995
		PinionRadiusMm: 15.9,
		LiftUpSign:     -1, // down is +speed
		AugerDrillSign: -1, // drilling is -speed
		Now:            ck.now,
	})
	return e, ck, &evs, path
}

func observeLiftN(e *Estimator, ck *clock, n int, loadRaw, speedRaw int32) {
	for i := 0; i < n; i++ {
		ck.tick()
		e.ObserveLift(loadRaw, speedRaw, true)
	}
}

func observeAugerN(e *Estimator, ck *clock, n int, loadRaw, speedRaw int32) {
	for i := 0; i < n; i++ {
		ck.tick()
		e.ObserveAuger(loadRaw, speedRaw, true)
	}
}

func TestReadingsNAWithoutObservations(t *testing.T) {
	e, _, _, _ := newTest(t)
	rs := e.Readings()
	require.Len(t, rs, 2)
	require.Equal(t, NameLiftForceEstG, rs[0].Name)
	require.Equal(t, "g", rs[0].Unit)
	require.False(t, rs[0].Ok)
	require.Nil(t, rs[0].Value)
	require.Equal(t, NameAugerTorqueEstNmm, rs[1].Name)
	require.Equal(t, "nmm", rs[1].Unit)
	require.False(t, rs[1].Ok)
}

func TestLiftNAWithoutBaseline(t *testing.T) {
	e, ck, _, _ := newTest(t)
	observeLiftN(e, ck, 40, 200, 400) // driving down, no baseline captured
	require.False(t, e.Readings()[0].Ok)
}

func TestLiftBaselineCaptureRequiresDownDrive(t *testing.T) {
	e, ck, evs, _ := newTest(t)
	// Idle: no valid samples in the window.
	require.Error(t, e.CaptureLiftBaseline())
	require.Equal(t, "refused", (*evs)[0].phase)

	// Moving up (speed sign = LiftUpSign = -1): still refused.
	observeLiftN(e, ck, 40, -100, -400)
	require.Error(t, e.CaptureLiftBaseline())

	// Driving down: captured.
	observeLiftN(e, ck, 40, 100, 400)
	require.NoError(t, e.CaptureLiftBaseline())
	last := (*evs)[len(*evs)-1]
	require.Equal(t, "lift_baseline_set", last.phase)
}

func TestLiftForceNetOfBaselineAndOriented(t *testing.T) {
	e, ck, _, _ := newTest(t)
	// Free-air descent at load 100 (10% of stall), then baseline.
	observeLiftN(e, ck, 60, 100, 400)
	require.NoError(t, e.CaptureLiftBaseline())

	// Soil contact doubles the load in the same (down, +) direction. Run long
	// enough that the EMA converges (tau 250ms, dt 50ms).
	observeLiftN(e, ck, 200, 200, 400)
	r := e.Readings()[0]
	require.True(t, r.Ok)
	// Net torque: (200-100)/1000 * 2941.995 = 294.1995 N-mm.
	// Force: 294.1995 / 15.9 mm = 18.503 N = 1886.6 g. downSign=+1 keeps it +.
	require.InDelta(t, 1886.6, r.GetValue(), 20.0)
}

func TestLiftNAWhenIdleOrMovingUp(t *testing.T) {
	e, ck, _, _ := newTest(t)
	observeLiftN(e, ck, 60, 100, 400)
	require.NoError(t, e.CaptureLiftBaseline())

	observeLiftN(e, ck, 5, 0, 0) // idle
	require.False(t, e.Readings()[0].Ok)

	observeLiftN(e, ck, 5, -100, -400) // moving up
	require.False(t, e.Readings()[0].Ok)
}

func TestEMAResetsAfterInvalidGap(t *testing.T) {
	e, ck, _, _ := newTest(t)
	observeLiftN(e, ck, 60, 100, 400)
	require.NoError(t, e.CaptureLiftBaseline())

	observeLiftN(e, ck, 200, 900, 400) // heavy load, EMA converges high
	high := e.Readings()[0].GetValue()

	observeLiftN(e, ck, 10, 0, 0) // idle gap invalidates

	// One fresh sample at baseline level seeds the EMA anew; stale heavy
	// history must not bleed in.
	observeLiftN(e, ck, 1, 100, 400)
	r := e.Readings()[0]
	require.True(t, r.Ok)
	require.InDelta(t, 0.0, r.GetValue(), 25.0)
	require.Greater(t, high, r.GetValue()+1000)
}

func TestAugerGrossWhenSpinningNetWhenBaselined(t *testing.T) {
	e, ck, _, _ := newTest(t)
	// Drilling: AugerDrillSign -1, so load -300 while speed -2000 reads +.
	observeAugerN(e, ck, 200, -300, -2000)
	r := e.Readings()[1]
	require.True(t, r.Ok)
	// Gross: 300/1000 * 2941.995 = 882.6 N-mm, oriented positive.
	require.InDelta(t, 882.6, r.GetValue(), 10.0)

	require.NoError(t, e.CaptureAugerBaseline())
	observeAugerN(e, ck, 200, -300, -2000)
	require.InDelta(t, 0.0, e.Readings()[1].GetValue(), 10.0)
}

func TestAugerNAWhenIdle(t *testing.T) {
	e, ck, _, _ := newTest(t)
	observeAugerN(e, ck, 200, -300, -2000)
	require.True(t, e.Readings()[1].Ok)
	observeAugerN(e, ck, 5, 0, 0)
	require.False(t, e.Readings()[1].Ok)
}

func TestNotOkReadInvalidates(t *testing.T) {
	e, ck, _, _ := newTest(t)
	observeAugerN(e, ck, 200, -300, -2000)
	require.True(t, e.Readings()[1].Ok)
	ck.tick()
	e.ObserveAuger(0, 0, false)
	require.False(t, e.Readings()[1].Ok)
}

func TestStaleObservationsGoNA(t *testing.T) {
	e, ck, _, _ := newTest(t)
	observeAugerN(e, ck, 200, -300, -2000)
	require.True(t, e.Readings()[1].Ok)
	ck.at = ck.at.Add(2 * time.Second) // read loop stalled
	require.False(t, e.Readings()[1].Ok)
}

func TestBaselinePersistsAcrossRestart(t *testing.T) {
	e, ck, _, path := newTest(t)
	observeLiftN(e, ck, 60, 100, 400)
	require.NoError(t, e.CaptureLiftBaseline())

	cal, ok, err := store.LoadLoadEst(path)
	require.NoError(t, err)
	require.True(t, ok)
	require.True(t, cal.LiftBaselineSet)

	// A fresh estimator on the same path starts baselined.
	e2 := New(path, func(string, string) {}, Config{
		StallTorqueNmm: 30 * 98.0665, PinionRadiusMm: 15.9,
		LiftUpSign: -1, AugerDrillSign: -1, Now: ck.now,
	})
	observeLiftN(e2, ck, 60, 100, 400)
	require.True(t, e2.Readings()[0].Ok)
}
