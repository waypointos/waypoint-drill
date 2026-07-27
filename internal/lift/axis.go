package lift

import "time"

// Obs is one servo read of the lift axis.
type Obs struct {
	PositionRaw uint16
	SpeedRaw    int32
	LoadRaw     int32
	OK          bool
	At          time.Time
}

// Axis is the lift's software height axis over multiple servo revolutions:
// Unhomed -> Homed (top anchored) -> Calibrated (travel span known). Position is
// unwrapped encoder ticks, top anchored at 0 and down positive; which raw
// velocity sign drives up belongs to the control layer, not here.
type Axis struct {
	unwrap  Unwrapper
	pos     int64
	tracked bool
	homed   bool
	anchor  int64
	travel  int64
}

func NewAxis() *Axis { return &Axis{} }

// Observe folds one read in and returns the tick delta since the previous
// tracked read. A failed read is skipped entirely: no delta, no position update.
func (a *Axis) Observe(o Obs) (int64, bool) {
	if !o.OK {
		return 0, false
	}
	prev, first := a.pos, !a.tracked
	a.pos = a.unwrap.Update(o.PositionRaw)
	a.tracked = true
	if first {
		return 0, true
	}
	return a.pos - prev, true
}

// AnchorTop marks the current position as the top of travel, height 0.
func (a *Axis) AnchorTop() {
	a.anchor = a.pos
	a.homed = true
}

// SetTravel records the calibrated travel span; a non-positive span leaves the
// axis uncalibrated.
func (a *Axis) SetTravel(ticks int64) {
	if ticks <= 0 {
		a.travel = 0
		return
	}
	a.travel = ticks
}

func (a *Axis) Homed() bool { return a.homed && a.tracked }

func (a *Axis) Calibrated() bool { return a.travel > 0 }

// HeightTicks returns ticks below the top anchor; absent until homed.
func (a *Axis) HeightTicks() (int64, bool) {
	if !a.Homed() {
		return 0, false
	}
	return a.pos - a.anchor, true
}

// HeightNorm returns 0 at the top and 1 at the bottom; absent until the axis is
// both homed and calibrated.
func (a *Axis) HeightNorm() (float64, bool) {
	ticks, ok := a.HeightTicks()
	if !ok || a.travel <= 0 {
		return 0, false
	}
	n := float64(ticks) / float64(a.travel)
	switch {
	case n < 0:
		n = 0
	case n > 1:
		n = 1
	}
	return n, true
}

// NAReason names the state blocking the most-derived height field.
func (a *Axis) NAReason() string {
	switch {
	case !a.Homed():
		return "unhomed"
	case a.travel <= 0:
		return "uncalibrated"
	}
	return ""
}
