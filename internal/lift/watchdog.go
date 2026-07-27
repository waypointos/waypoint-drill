package lift

import "time"

// Watchdog reports when servo reads have been failing long enough that a moving
// axis must be halted: without fresh feedback neither stall nor height is known.
type Watchdog struct {
	gap      time.Duration
	lastGood time.Time
}

// NewWatchdog builds a watchdog that fires once reads have failed for gap.
func NewWatchdog(gap time.Duration) *Watchdog { return &Watchdog{gap: gap} }

// Observe folds one read outcome in and returns true when the axis should halt.
func (w *Watchdog) Observe(ok bool, now time.Time) bool {
	if ok || w.lastGood.IsZero() {
		w.lastGood = now
		return false
	}
	return now.Sub(w.lastGood) >= w.gap
}

// Expired reports the same verdict as Observe without folding a read in, so a
// caller on its own clock can halt even while the read path is wedged and
// producing no observations at all.
func (w *Watchdog) Expired(now time.Time) bool {
	if w.lastGood.IsZero() {
		return false
	}
	return now.Sub(w.lastGood) >= w.gap
}

// Reset re-arms the watchdog from now, for use when motion resumes.
func (w *Watchdog) Reset(now time.Time) { w.lastGood = now }
