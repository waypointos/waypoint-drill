// Package state renders the drill's outward telemetry: the DrillState the tab
// consumes at the component rate, and the DrillStats register snapshot.
package state

import (
	"os"
	"strconv"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/waypointos/waypoint-drill/internal/control"
	"github.com/waypointos/waypoint-drill/internal/lift"
	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

const (
	defaultRateHz = 20.0
	maxRateHz     = 100.0
)

// RateHz reads the publish rate the agent exports in the unit drop-in.
// Unparsable or out-of-range values fall back to the default.
func RateHz() float64 {
	raw := os.Getenv("WAYPOINT_MODULE_STATE_RATE_HZ")
	if raw == "" {
		return defaultRateHz
	}
	hz, err := strconv.ParseFloat(raw, 64)
	// Written positively so NaN falls back too.
	if err != nil || !(hz > 0 && hz <= maxRateHz) {
		return defaultRateHz
	}
	return hz
}

// Build renders one DrillState. Height fields follow the axis capability
// strictly: ticks need a home anchor, norm needs a calibrated travel span, mm
// additionally needs a configured tick scale.
func Build(
	now time.Time,
	axis *lift.Axis,
	st control.Status,
	liftSt, augerSt *drillv1.ServoState,
	mmPerTick *float64,
) *drillv1.DrillState {
	liftServo := servoOrAbsent(liftSt)
	augerServo := servoOrAbsent(augerSt)

	out := &drillv1.DrillState{
		T:                   timestamppb.New(now),
		Homed:               axis.Homed(),
		Calibrated:          axis.Calibrated(),
		HeightNaReason:      axis.NAReason(),
		LiftVelocityRaw:     liftServo.SpeedRaw,
		AugerDirection:      st.AugerDir,
		AugerVelocityRaw:    augerServo.SpeedRaw,
		SwitchAllowed:       st.SwitchAllowed,
		SwitchRefusedReason: st.SwitchReason,
		Halted:              st.Halted,
		HaltReason:          st.HaltReason,
		Phase:               st.Phase,
		LastRefusal:         st.LastRefusal,
		Lift:                liftServo,
		Auger:               augerServo,
	}

	if ticks, ok := axis.HeightTicks(); ok {
		out.HeightTicks = &ticks
		if mmPerTick != nil {
			mm := float64(ticks) * *mmPerTick
			out.HeightMm = &mm
		}
	}
	if norm, ok := axis.HeightNorm(); ok {
		out.HeightNorm = &norm
	}
	return out
}

// BuildStats wraps the cached reads for the MOTORS card, lift first.
func BuildStats(now time.Time, liftSt, augerSt *drillv1.ServoState) *drillv1.DrillStats {
	return &drillv1.DrillStats{
		T:      timestamppb.New(now),
		Servos: []*drillv1.ServoState{servoOrAbsent(liftSt), servoOrAbsent(augerSt)},
	}
}

// servoOrAbsent keeps a missing read explicit: ok=false with every optional
// absent rather than a zero-valued reading that reads as real telemetry. The
// servo id rides on the read itself, which servobus fills in even on failure.
func servoOrAbsent(st *drillv1.ServoState) *drillv1.ServoState {
	if st == nil {
		return &drillv1.ServoState{}
	}
	return st
}
