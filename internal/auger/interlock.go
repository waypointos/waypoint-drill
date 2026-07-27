package auger

import (
	"math"

	"github.com/waypointos/waypoint-drill/internal/config"
	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

// Interlock gates the switch rotation. Switching engages a ratchet that is only
// reachable near the top of the lift travel, so it needs a calibrated height.
type Interlock struct {
	topBand float64
}

func NewInterlock(topBand float64) *Interlock {
	return &Interlock{topBand: topBand}
}

// SwitchAllowed reports whether switch rotation may run, plus the refusal
// reason ("" when allowed).
func (i *Interlock) SwitchAllowed(calibrated bool, norm float64, haveNorm bool) (bool, string) {
	if !calibrated || !haveNorm {
		return false, "uncalibrated"
	}
	if norm > i.topBand {
		return false, "below top band"
	}
	return true, ""
}

// Velocity is the signed raw ticks/s for an auger direction at a throttle.
// Throttle is clamped to its -1..1 domain; IDLE and UNSPECIFIED are 0.
func Velocity(dir drillv1.AugerDirection, throttle float64, cfg *config.Config) int32 {
	throttle = clamp(throttle, -1, 1)
	var speed int32
	var sign int
	switch dir {
	case drillv1.AugerDirection_AUGER_DIRECTION_DRILL:
		speed, sign = cfg.DrillSpeed, cfg.AugerDrillSign
	case drillv1.AugerDirection_AUGER_DIRECTION_SWITCH:
		speed, sign = cfg.SwitchSpeed, cfg.SwitchSign()
	default:
		return 0
	}
	v := math.Round(float64(sign) * float64(speed) * throttle)
	return int32(clamp(v, float64(-config.MaxSpeedRaw), float64(config.MaxSpeedRaw)))
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
