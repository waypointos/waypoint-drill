// Package lift tracks the drill lift axis: encoder unwrapping, stall and
// read-gap detection, axis state, and the home/calibrate step machines.
package lift

// TicksPerRev is the STS3215 encoder resolution.
const TicksPerRev = 4096

// Unwrapper turns wrapping 0..4095 encoder ticks into a cumulative count. The
// zero value is ready to use; the first Update seeds the reference and yields 0.
type Unwrapper struct {
	started bool
	last    uint16
	total   int64
}

// Update folds one raw reading in and returns the cumulative tick count.
// Motion beyond half a revolution between reads aliases to the short way round,
// which the commanded speed cap exists to prevent.
func (u *Unwrapper) Update(posRaw uint16) int64 {
	if !u.started {
		u.started = true
		u.last = posRaw
		return u.total
	}
	d := (int64(posRaw) - int64(u.last) + TicksPerRev/2) % TicksPerRev
	if d < 0 {
		d += TicksPerRev
	}
	u.total += d - TicksPerRev/2
	u.last = posRaw
	return u.total
}
