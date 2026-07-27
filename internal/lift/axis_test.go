package lift

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func read(pos uint16) Obs { return Obs{PositionRaw: pos, OK: true} }

func TestAxis_FreshAxisIsUnhomed(t *testing.T) {
	a := NewAxis()
	require.False(t, a.Homed())
	require.False(t, a.Calibrated())
	_, ok := a.HeightTicks()
	require.False(t, ok)
	_, ok = a.HeightNorm()
	require.False(t, ok)
	require.Equal(t, "unhomed", a.NAReason())
}

func TestAxis_FailedReadIsNotTracked(t *testing.T) {
	a := NewAxis()
	delta, tracked := a.Observe(Obs{PositionRaw: 900, OK: false})
	require.False(t, tracked)
	require.Equal(t, int64(0), delta)

	delta, tracked = a.Observe(read(1000))
	require.True(t, tracked)
	require.Equal(t, int64(0), delta, "the first tracked read only seeds the reference")

	delta, tracked = a.Observe(read(1050))
	require.True(t, tracked)
	require.Equal(t, int64(50), delta)

	delta, tracked = a.Observe(Obs{PositionRaw: 4000, OK: false})
	require.False(t, tracked)
	require.Equal(t, int64(0), delta, "a dropped read never fakes a jump")

	_, _ = a.Observe(read(1060))
	a.AnchorTop()
	ticks, ok := a.HeightTicks()
	require.True(t, ok)
	require.Equal(t, int64(0), ticks)
}

func TestAxis_HomedGivesTicksButNotNorm(t *testing.T) {
	a := NewAxis()
	a.Observe(read(2000))
	a.AnchorTop()
	require.True(t, a.Homed())
	require.Equal(t, "uncalibrated", a.NAReason())

	a.Observe(read(2500))
	ticks, ok := a.HeightTicks()
	require.True(t, ok)
	require.Equal(t, int64(500), ticks)
	_, ok = a.HeightNorm()
	require.False(t, ok)
}

func TestAxis_HeightTicksUnwrapAcrossTheSeam(t *testing.T) {
	a := NewAxis()
	a.Observe(read(4000))
	a.AnchorTop()
	a.Observe(read(4090))
	a.Observe(read(80))
	ticks, ok := a.HeightTicks()
	require.True(t, ok)
	require.Equal(t, int64(176), ticks)
}

func TestAxis_CalibratedGivesNorm(t *testing.T) {
	a := NewAxis()
	a.Observe(read(0))
	a.AnchorTop()
	a.SetTravel(2 * TicksPerRev)
	require.True(t, a.Calibrated())
	require.Equal(t, "", a.NAReason())

	norm, ok := a.HeightNorm()
	require.True(t, ok)
	require.InDelta(t, 0.0, norm, 1e-9)

	a.Observe(read(2000))
	a.Observe(read(4000 - 1))
	a.Observe(read(0))
	ticks, _ := a.HeightTicks()
	require.Equal(t, int64(TicksPerRev), ticks, "one full revolution down")
	norm, ok = a.HeightNorm()
	require.True(t, ok)
	require.InDelta(t, 0.5, norm, 1e-9)
}

func TestAxis_NormClampsOutsideTheCalibratedSpan(t *testing.T) {
	a := NewAxis()
	a.Observe(read(0))
	a.AnchorTop()
	a.SetTravel(1000)

	a.Observe(read(2000))
	norm, ok := a.HeightNorm()
	require.True(t, ok)
	require.InDelta(t, 1.0, norm, 1e-9)

	a.Observe(read(0))
	a.Observe(read(4000))
	norm, ok = a.HeightNorm()
	require.True(t, ok)
	require.InDelta(t, 0.0, norm, 1e-9, "above the anchor still reports the top")
}

func TestAxis_TravelWithoutHomingStaysUnhomed(t *testing.T) {
	a := NewAxis()
	a.SetTravel(8000)
	a.Observe(read(1200))
	require.True(t, a.Calibrated())
	require.False(t, a.Homed())
	require.Equal(t, "unhomed", a.NAReason(), "a stored span cannot substitute for a top anchor")
	_, ok := a.HeightNorm()
	require.False(t, ok)
}

func TestAxis_NonPositiveTravelIsNotCalibrated(t *testing.T) {
	a := NewAxis()
	a.Observe(read(10))
	a.AnchorTop()
	a.SetTravel(0)
	require.False(t, a.Calibrated())
	require.Equal(t, "uncalibrated", a.NAReason())

	a.SetTravel(-500)
	require.False(t, a.Calibrated())
}

func TestAxis_AnchorTopRebasesHeight(t *testing.T) {
	a := NewAxis()
	a.Observe(read(500))
	a.AnchorTop()
	a.Observe(read(1500))
	ticks, _ := a.HeightTicks()
	require.Equal(t, int64(1000), ticks)

	a.AnchorTop()
	ticks, _ = a.HeightTicks()
	require.Equal(t, int64(0), ticks)
}
