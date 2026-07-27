package lift

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestWatchdog_FiresOnlyAfterTheGap(t *testing.T) {
	w := NewWatchdog(250 * time.Millisecond)
	t0 := time.Unix(0, 0)
	require.False(t, w.Observe(true, t0))
	require.False(t, w.Observe(false, t0.Add(50*time.Millisecond)))
	require.False(t, w.Observe(false, t0.Add(240*time.Millisecond)))
	require.True(t, w.Observe(false, t0.Add(250*time.Millisecond)))
	require.True(t, w.Observe(false, t0.Add(400*time.Millisecond)))
}

func TestWatchdog_SuccessResets(t *testing.T) {
	w := NewWatchdog(250 * time.Millisecond)
	t0 := time.Unix(0, 0)
	require.False(t, w.Observe(true, t0))
	require.False(t, w.Observe(false, t0.Add(200*time.Millisecond)))
	require.False(t, w.Observe(true, t0.Add(220*time.Millisecond)))
	require.False(t, w.Observe(false, t0.Add(400*time.Millisecond)), "the gap restarts from the good read")
	require.True(t, w.Observe(false, t0.Add(470*time.Millisecond)))
}

func TestWatchdog_FirstReadFailingSeedsTheClock(t *testing.T) {
	w := NewWatchdog(250 * time.Millisecond)
	t0 := time.Unix(0, 0)
	require.False(t, w.Observe(false, t0))
	require.False(t, w.Observe(false, t0.Add(100*time.Millisecond)))
	require.True(t, w.Observe(false, t0.Add(250*time.Millisecond)))
}

func TestWatchdog_ExpiredJudgesOnTheCallersClock(t *testing.T) {
	w := NewWatchdog(250 * time.Millisecond)
	t0 := time.Unix(0, 0)
	require.False(t, w.Expired(t0), "an unarmed watchdog never fires")
	require.False(t, w.Observe(true, t0))

	require.False(t, w.Expired(t0.Add(240*time.Millisecond)))
	require.True(t, w.Expired(t0.Add(250*time.Millisecond)), "no further read is needed to fire")
	require.False(t, w.Observe(true, t0.Add(260*time.Millisecond)))
	require.False(t, w.Expired(t0.Add(260*time.Millisecond)))
}

func TestWatchdog_ExplicitResetRearms(t *testing.T) {
	w := NewWatchdog(250 * time.Millisecond)
	t0 := time.Unix(0, 0)
	require.False(t, w.Observe(true, t0))
	require.True(t, w.Observe(false, t0.Add(300*time.Millisecond)))
	w.Reset(t0.Add(300 * time.Millisecond))
	require.False(t, w.Observe(false, t0.Add(400*time.Millisecond)))
}
