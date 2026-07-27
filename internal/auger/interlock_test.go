package auger

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/waypointos/waypoint-drill/internal/config"
	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

func TestInterlock_SwitchAllowed(t *testing.T) {
	il := NewInterlock(0.03)
	tests := []struct {
		name       string
		calibrated bool
		norm       float64
		haveNorm   bool
		allowed    bool
		reason     string
	}{
		{name: "uncalibrated", calibrated: false, norm: 0, haveNorm: true, reason: "uncalibrated"},
		{name: "calibrated without a norm", calibrated: true, haveNorm: false, reason: "uncalibrated"},
		{name: "at the top", calibrated: true, norm: 0, haveNorm: true, allowed: true},
		{name: "inside the band", calibrated: true, norm: 0.02, haveNorm: true, allowed: true},
		{name: "exactly at the band edge", calibrated: true, norm: 0.03, haveNorm: true, allowed: true},
		{name: "just past the band edge", calibrated: true, norm: 0.030001, haveNorm: true, reason: "below top band"},
		{name: "at the bottom", calibrated: true, norm: 1, haveNorm: true, reason: "below top band"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			allowed, reason := il.SwitchAllowed(tt.calibrated, tt.norm, tt.haveNorm)
			require.Equal(t, tt.allowed, allowed)
			require.Equal(t, tt.reason, reason)
		})
	}
}

func TestInterlock_ZeroBandAllowsOnlyTheTop(t *testing.T) {
	il := NewInterlock(0)
	allowed, reason := il.SwitchAllowed(true, 0, true)
	require.True(t, allowed)
	require.Empty(t, reason)
	allowed, reason = il.SwitchAllowed(true, 0.001, true)
	require.False(t, allowed)
	require.Equal(t, "below top band", reason)
}

func TestVelocity_SignMatrix(t *testing.T) {
	for _, drillSign := range []int{1, -1} {
		for _, dir := range []string{"ccw", "cw"} {
			t.Run(fmt.Sprintf("drill_sign=%d/switch=%s", drillSign, dir), func(t *testing.T) {
				cfg := &config.Config{AugerDrillSign: drillSign, SwitchDirection: dir, DrillSpeed: 800, SwitchSpeed: 300}
				wantSwitchSign := -drillSign
				if dir == "cw" {
					wantSwitchSign = drillSign
				}
				require.Equal(t, wantSwitchSign, cfg.SwitchSign())
				require.Equal(t, int32(drillSign*800),
					Velocity(drillv1.AugerDirection_AUGER_DIRECTION_DRILL, 1, cfg))
				require.Equal(t, int32(wantSwitchSign*300),
					Velocity(drillv1.AugerDirection_AUGER_DIRECTION_SWITCH, 1, cfg))
			})
		}
	}
}

func TestVelocity_ThrottleScalesAndClamps(t *testing.T) {
	cfg := &config.Config{AugerDrillSign: 1, SwitchDirection: "ccw", DrillSpeed: 800, SwitchSpeed: 300}
	require.Equal(t, int32(400), Velocity(drillv1.AugerDirection_AUGER_DIRECTION_DRILL, 0.5, cfg))
	require.Equal(t, int32(0), Velocity(drillv1.AugerDirection_AUGER_DIRECTION_DRILL, 0, cfg))
	require.Equal(t, int32(-800), Velocity(drillv1.AugerDirection_AUGER_DIRECTION_DRILL, -1, cfg))
	// Throttle is clamped to its documented -1..1 domain.
	require.Equal(t, int32(800), Velocity(drillv1.AugerDirection_AUGER_DIRECTION_DRILL, 4, cfg))
	require.Equal(t, int32(-300), Velocity(drillv1.AugerDirection_AUGER_DIRECTION_SWITCH, 4, cfg))
}

func TestVelocity_IdleAndUnspecifiedAreZero(t *testing.T) {
	cfg := &config.Config{AugerDrillSign: 1, SwitchDirection: "ccw", DrillSpeed: 800, SwitchSpeed: 300}
	require.Equal(t, int32(0), Velocity(drillv1.AugerDirection_AUGER_DIRECTION_IDLE, 1, cfg))
	require.Equal(t, int32(0), Velocity(drillv1.AugerDirection_AUGER_DIRECTION_UNSPECIFIED, 1, cfg))
}

func TestVelocity_ClampsToTheSpeedCap(t *testing.T) {
	cfg := &config.Config{AugerDrillSign: 1, SwitchDirection: "cw", DrillSpeed: config.MaxSpeedRaw, SwitchSpeed: config.MaxSpeedRaw}
	require.Equal(t, config.MaxSpeedRaw, Velocity(drillv1.AugerDirection_AUGER_DIRECTION_DRILL, 1, cfg))
	require.Equal(t, -config.MaxSpeedRaw, Velocity(drillv1.AugerDirection_AUGER_DIRECTION_DRILL, -1, cfg))
}
