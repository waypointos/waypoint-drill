package lift

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func loaded() Obs { return Obs{PositionRaw: 1000, SpeedRaw: 3, LoadRaw: 700, OK: true} }

func TestStallDetector_SustainedLoadFires(t *testing.T) {
	d := NewStallDetector(600, 3, 20, 8)
	require.False(t, d.Observe(loaded(), 1))
	require.False(t, d.Observe(loaded(), 0))
	require.True(t, d.Observe(loaded(), 2))
	require.True(t, d.Observe(loaded(), 0), "stall stays asserted while the evidence holds")
}

func TestStallDetector_SpikeAloneNeverFires(t *testing.T) {
	d := NewStallDetector(600, 3, 20, 8)
	for i := 0; i < 10; i++ {
		require.False(t, d.Observe(loaded(), 0))
		require.False(t, d.Observe(Obs{PositionRaw: 1000, SpeedRaw: 300, LoadRaw: 50, OK: true}, 40))
	}
}

func TestStallDetector_MovingUnderLoadIsNotStalled(t *testing.T) {
	d := NewStallDetector(600, 3, 20, 8)
	spinning := Obs{PositionRaw: 1000, SpeedRaw: 400, LoadRaw: 900, OK: true}
	for i := 0; i < 10; i++ {
		require.False(t, d.Observe(spinning, 20))
	}
}

func TestStallDetector_AdvancingUnderLoadIsNotStalled(t *testing.T) {
	d := NewStallDetector(600, 3, 20, 8)
	creeping := Obs{PositionRaw: 1000, SpeedRaw: 2, LoadRaw: 900, OK: true}
	for i := 0; i < 10; i++ {
		require.False(t, d.Observe(creeping, 30), "tick delta still moving keeps it unstalled")
	}
}

func TestStallDetector_UnloadedStopIsNotStalled(t *testing.T) {
	d := NewStallDetector(600, 3, 20, 8)
	idle := Obs{PositionRaw: 1000, SpeedRaw: 0, LoadRaw: 40, OK: true}
	for i := 0; i < 10; i++ {
		require.False(t, d.Observe(idle, 0))
	}
}

func TestStallDetector_FailedReadClearsTheRun(t *testing.T) {
	d := NewStallDetector(600, 3, 20, 8)
	require.False(t, d.Observe(loaded(), 0))
	require.False(t, d.Observe(loaded(), 0))
	require.False(t, d.Observe(Obs{OK: false}, 0))
	require.False(t, d.Observe(loaded(), 0))
	require.False(t, d.Observe(loaded(), 0))
	require.True(t, d.Observe(loaded(), 0))
}

func TestStallDetector_NegativeLoadAndSpeedUseMagnitude(t *testing.T) {
	d := NewStallDetector(600, 2, 20, 8)
	o := Obs{PositionRaw: 1000, SpeedRaw: -5, LoadRaw: -700, OK: true}
	require.False(t, d.Observe(o, -3))
	require.True(t, d.Observe(o, -3))
}

func TestStallDetector_ResetClearsTheRun(t *testing.T) {
	d := NewStallDetector(600, 2, 20, 8)
	require.False(t, d.Observe(loaded(), 0))
	d.Reset()
	require.False(t, d.Observe(loaded(), 0))
	require.True(t, d.Observe(loaded(), 0))
}

func TestStallDetector_ThresholdsAreInclusive(t *testing.T) {
	d := NewStallDetector(600, 1, 20, 8)
	require.True(t, d.Observe(Obs{PositionRaw: 1, SpeedRaw: 20, LoadRaw: 600, OK: true}, 8))
	d.Reset()
	require.False(t, d.Observe(Obs{PositionRaw: 1, SpeedRaw: 21, LoadRaw: 600, OK: true}, 8))
	require.False(t, d.Observe(Obs{PositionRaw: 1, SpeedRaw: 20, LoadRaw: 599, OK: true}, 8))
	require.False(t, d.Observe(Obs{PositionRaw: 1, SpeedRaw: 20, LoadRaw: 600, OK: true}, 9))
}
