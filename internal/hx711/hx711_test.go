package hx711

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// fakePort scripts three 24-bit frames. DOUT goes ready immediately; a rising
// clock edge shifts the next bit onto all three data lines.
type fakePort struct {
	frames [3]uint32
	bit    int
	clock  int
	ready  bool
	pulses int
}

func (f *fakePort) SetClock(v int) error {
	if v == 1 && f.clock == 0 {
		f.pulses++
	}
	f.clock = v
	return nil
}

func (f *fakePort) ReadData() ([3]int, error) {
	if f.clock == 0 {
		if f.ready {
			return [3]int{0, 0, 0}, nil // ready = DOUT low
		}
		return [3]int{1, 1, 1}, nil
	}
	var out [3]int
	idx := 23 - f.bit
	if idx >= 0 {
		for i := range out {
			out[i] = int(f.frames[i]>>uint(idx)) & 1
		}
	}
	f.bit++
	return out, nil
}

// fakeNow yields a scripted monotonic clock: each call returns the next value.
func fakeNow(step time.Duration) func() time.Duration {
	var t time.Duration
	return func() time.Duration {
		t += step
		return t
	}
}

func TestSignExtend24(t *testing.T) {
	require.Equal(t, int32(1), signExtend24(0x000001))
	require.Equal(t, int32(-1), signExtend24(0xFFFFFF))
	require.Equal(t, int32(-2), signExtend24(0xFFFFFE))
	require.Equal(t, int32(8388607), signExtend24(0x7FFFFF))
	require.Equal(t, int32(-8388608), signExtend24(0x800000))
}

func TestValidRaw24_RejectsStuckAndSaturated(t *testing.T) {
	for _, bad := range []uint32{0x000000, 0xFFFFFF, 0x7FFFFF, 0x800000} {
		require.False(t, validRaw24(bad), "0x%06X", bad)
	}
	require.True(t, validRaw24(0x123456))
}

func TestReadCycle_DecodesAllThreeChips(t *testing.T) {
	p := &fakePort{frames: [3]uint32{0x000100, 0xFFFFFE, 0x123456}, ready: true}
	r := NewReader(p, Options{Now: fakeNow(time.Microsecond)})
	s := r.ReadCycle()
	require.Equal(t, [3]bool{true, true, true}, s.OK)
	require.Equal(t, int32(256), s.Counts[0])
	require.Equal(t, int32(-2), s.Counts[1])
	require.Equal(t, int32(0x123456), s.Counts[2])
	require.Equal(t, 25, p.pulses, "24 data bits + 1 gain-128 pulse")
}

func TestReadCycle_NeverReadyTimesOutAllNotOK(t *testing.T) {
	// Millisecond-stepped fake clock: the timeout lapses in a handful of
	// poll iterations instead of thousands of real 1ms sleeps.
	p := &fakePort{ready: false}
	r := NewReader(p, Options{ReadyTimeout: 5 * time.Millisecond, Now: fakeNow(time.Millisecond)})
	s := r.ReadCycle()
	require.Equal(t, [3]bool{false, false, false}, s.OK)
}

func TestReadCycle_InvalidFrameNotOK(t *testing.T) {
	p := &fakePort{frames: [3]uint32{0x000000, 0x0000FF, 0xFFFFFF}, ready: true}
	r := NewReader(p, Options{Now: fakeNow(time.Microsecond)})
	s := r.ReadCycle()
	require.False(t, s.OK[0], "stuck-low frame")
	require.True(t, s.OK[1])
	require.False(t, s.OK[2], "stuck-high frame")
}

func TestReadCycle_JitterDiscardsAndRetries(t *testing.T) {
	// 60us per now() call makes every SCK-high measure over the 50us guard, so
	// both attempts of the cycle are discarded.
	p := &fakePort{frames: [3]uint32{0x000100, 0x000100, 0x000100}, ready: true}
	r := NewReader(p, Options{
		SettleAfterJitter: 0,
		Now:               fakeNow(60 * time.Microsecond),
	})
	s := r.ReadCycle()
	require.Equal(t, [3]bool{false, false, false}, s.OK)
	require.Equal(t, 50, p.pulses, "two full attempts, both discarded")
}
