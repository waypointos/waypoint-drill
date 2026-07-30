package weight

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/waypointos/waypoint-drill/internal/hx711"
	"github.com/waypointos/waypoint-drill/internal/store"
	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"
)

type eventRec struct{ phase, detail string }

func newTest(t *testing.T) (*Weight, *[]eventRec, string) {
	t.Helper()
	var evs []eventRec
	path := filepath.Join(t.TempDir(), "weight.toml")
	w := New(path, func(phase, detail string) { evs = append(evs, eventRec{phase, detail}) }, Options{})
	return w, &evs, path
}

func reading(t *testing.T, rs *waypointv1.SensorReadings, name string) *waypointv1.SensorReading {
	t.Helper()
	for _, r := range rs.Readings {
		if r.Name == name {
			return r
		}
	}
	t.Fatalf("reading %q missing", name)
	return nil
}

func allOK(counts [3]int32) hx711.Sample {
	return hx711.Sample{Counts: counts, OK: [3]bool{true, true, true}}
}

func TestState_UncalibratedPublishesRawGramsNA(t *testing.T) {
	w, _, _ := newTest(t)
	w.Observe(allOK([3]int32{1000, 2000, 3000}))

	st := w.State()
	raw := reading(t, st, NameCellARaw)
	require.True(t, raw.Ok)
	require.Equal(t, 1000.0, raw.GetValue())
	require.Equal(t, "counts", raw.Unit)

	g := reading(t, st, NameCellAG)
	require.False(t, g.Ok)
	require.Nil(t, g.Value)
	require.False(t, reading(t, st, NameTotalG).Ok)
}

func TestTareThenCalibrateYieldsGrams(t *testing.T) {
	w, evs, _ := newTest(t)
	w.Observe(allOK([3]int32{1000, 2000, 3000}))
	require.NoError(t, w.Tare())
	require.Equal(t, "tared", (*evs)[0].phase)

	// 500 g adds 4000 counts total: scale = 0.125 g/count.
	w.Observe(allOK([3]int32{2000, 3000, 5000}))
	require.NoError(t, w.Calibrate(500))
	require.Equal(t, "calibrated", (*evs)[1].phase)

	st := w.State()
	require.Equal(t, 125.0, reading(t, st, NameCellAG).GetValue())
	require.Equal(t, 125.0, reading(t, st, NameCellBG).GetValue())
	require.Equal(t, 250.0, reading(t, st, NameCellCG).GetValue())
	require.Equal(t, 500.0, reading(t, st, NameTotalG).GetValue())
}

func TestCalibrateRequiresTare(t *testing.T) {
	w, evs, _ := newTest(t)
	w.Observe(allOK([3]int32{1000, 2000, 3000}))
	require.Error(t, w.Calibrate(500))
	require.Equal(t, "refused", (*evs)[0].phase)
}

func TestTareRefusedWhileCellNotOK(t *testing.T) {
	w, evs, _ := newTest(t)
	w.Observe(hx711.Sample{Counts: [3]int32{1000, 0, 3000}, OK: [3]bool{true, false, true}})
	require.Error(t, w.Tare())
	require.Equal(t, "refused", (*evs)[0].phase)
}

func TestCalibrateRefusesNonPositiveMass(t *testing.T) {
	w, _, _ := newTest(t)
	w.Observe(allOK([3]int32{1000, 2000, 3000}))
	require.NoError(t, w.Tare())
	require.Error(t, w.Calibrate(0))
	require.Error(t, w.Calibrate(-10))
}

func TestCalibrateRefusesTinyCountChange(t *testing.T) {
	w, evs, _ := newTest(t)
	w.Observe(allOK([3]int32{1000, 2000, 3000}))
	require.NoError(t, w.Tare())
	// One count of drift is not a mass resting on the plate.
	w.Observe(allOK([3]int32{1001, 2000, 3000}))
	require.Error(t, w.Calibrate(500))
	require.Equal(t, "refused", (*evs)[1].phase)
	require.Contains(t, (*evs)[1].detail, "too little count change")
}

func TestNewToleratesCorruptStateFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "weight.toml")
	require.NoError(t, os.WriteFile(path, []byte("offset_a = \"not a number\"\n"), 0o644))

	var evs []eventRec
	w := New(path, func(phase, detail string) { evs = append(evs, eventRec{phase, detail}) }, Options{})
	w.Observe(allOK([3]int32{1000, 2000, 3000}))
	require.False(t, reading(t, w.State(), NameCellAG).Ok, "grams stay N/A without a calibration")
	// The dropped file must not read as a tare either.
	require.Error(t, w.Calibrate(500))
	require.Equal(t, "refused", evs[0].phase)
	require.Contains(t, evs[0].detail, "tare first")
}

func TestMissThresholdLatchesNotOK(t *testing.T) {
	w, _, _ := newTest(t)
	w.Observe(allOK([3]int32{1000, 2000, 3000}))
	// Four misses: last good value still reported.
	for i := 0; i < 4; i++ {
		w.Observe(hx711.Sample{Counts: [3]int32{0, 2000, 3000}, OK: [3]bool{false, true, true}})
	}
	require.True(t, reading(t, w.State(), NameCellARaw).Ok)
	// Fifth consecutive miss crosses the default threshold.
	w.Observe(hx711.Sample{OK: [3]bool{false, true, true}})
	require.False(t, reading(t, w.State(), NameCellARaw).Ok)
	// One good read recovers immediately.
	w.Observe(allOK([3]int32{1001, 2000, 3000}))
	require.True(t, reading(t, w.State(), NameCellARaw).Ok)
}

func TestStaleObservationsGoNotOK(t *testing.T) {
	now := time.Unix(0, 0)
	w := New(filepath.Join(t.TempDir(), "w.toml"), func(string, string) {}, Options{
		Now: func() time.Time { return now },
	})
	w.Observe(allOK([3]int32{1000, 2000, 3000}))
	now = now.Add(2 * time.Second)
	require.False(t, reading(t, w.State(), NameCellARaw).Ok)
}

func TestCalibrationPersistsAcrossRestart(t *testing.T) {
	w, _, path := newTest(t)
	w.Observe(allOK([3]int32{1000, 2000, 3000}))
	require.NoError(t, w.Tare())
	w.Observe(allOK([3]int32{2000, 3000, 5000}))
	require.NoError(t, w.Calibrate(500))

	saved, ok, err := store.LoadWeight(path)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, 0.125, saved.GramsPerCount)

	w2 := New(path, func(string, string) {}, Options{})
	w2.Observe(allOK([3]int32{2000, 3000, 5000}))
	require.Equal(t, 500.0, reading(t, w2.State(), NameTotalG).GetValue())
}
