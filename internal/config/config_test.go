package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.toml")
	require.NoError(t, os.WriteFile(path, []byte(body), 0o600))
	return path
}

func TestLoad_MissingFileReturnsDefaults(t *testing.T) {
	cfg, err := Load(filepath.Join(t.TempDir(), "absent.toml"))
	require.NoError(t, err)
	require.Equal(t, &Config{
		StatePath:           "/var/lib/waypoint-module-drill/calibration.toml",
		LiftID:              11,
		AugerID:             12,
		LiftUpSign:          -1,
		AugerDrillSign:      -1,
		SwitchDirection:     "ccw",
		JogSpeed:            400,
		SlowJogSpeed:        150,
		DrillSpeed:          3200,
		SwitchSpeed:         300,
		TopBandFraction:     0.03,
		LiftOvercurrentRaw:  500,
		AugerOvercurrentRaw: 500,
		ReadGapHalt:         250 * time.Millisecond,
		StaleInput:          150 * time.Millisecond,
	}, cfg)
	require.Nil(t, cfg.MmPerTick)
}

func TestLoad_EmptyFileKeepsDefaults(t *testing.T) {
	cfg, err := Load(writeConfig(t, ""))
	require.NoError(t, err)
	def, err := Load(filepath.Join(t.TempDir(), "absent.toml"))
	require.NoError(t, err)
	require.Equal(t, def, cfg)
}

func TestLoad_PartialOverrideLeavesTheRestAtDefaults(t *testing.T) {
	cfg, err := Load(writeConfig(t, `
lift_up_sign = 1
jog_speed = 250
switch_direction = "cw"
stale_input_ms = 400
`))
	require.NoError(t, err)
	require.Equal(t, 1, cfg.LiftUpSign)
	require.Equal(t, int32(250), cfg.JogSpeed)
	require.Equal(t, "cw", cfg.SwitchDirection)
	require.Equal(t, 400*time.Millisecond, cfg.StaleInput)
	// Untouched keys keep their defaults.
	require.Equal(t, -1, cfg.AugerDrillSign)
	require.Equal(t, int32(150), cfg.SlowJogSpeed)
	require.Equal(t, 250*time.Millisecond, cfg.ReadGapHalt)
	require.Equal(t, "/var/lib/waypoint-module-drill/calibration.toml", cfg.StatePath)
}

func TestLoad_FullOverride(t *testing.T) {
	cfg, err := Load(writeConfig(t, `
state_path = "/tmp/drill/calibration.toml"
lift_id = 21
auger_id = 22
lift_up_sign = 1
auger_drill_sign = 1
switch_direction = "cw"
jog_speed = 401
slow_jog_speed = 151
drill_speed = 801
switch_speed = 301
top_band_fraction = 0.05
mm_per_tick = 0.125
lift_overcurrent_raw = 700
auger_overcurrent_raw = 0
read_gap_halt_ms = 300
stale_input_ms = 200
`))
	require.NoError(t, err)
	require.Equal(t, "/tmp/drill/calibration.toml", cfg.StatePath)
	require.Equal(t, uint32(21), cfg.LiftID)
	require.Equal(t, uint32(22), cfg.AugerID)
	require.Equal(t, 1, cfg.LiftUpSign)
	require.Equal(t, 1, cfg.AugerDrillSign)
	require.Equal(t, "cw", cfg.SwitchDirection)
	require.Equal(t, int32(401), cfg.JogSpeed)
	require.Equal(t, int32(151), cfg.SlowJogSpeed)
	require.Equal(t, int32(801), cfg.DrillSpeed)
	require.Equal(t, int32(301), cfg.SwitchSpeed)
	require.InDelta(t, 0.05, cfg.TopBandFraction, 1e-9)
	require.NotNil(t, cfg.MmPerTick)
	require.InDelta(t, 0.125, *cfg.MmPerTick, 1e-9)
	require.Equal(t, uint32(700), cfg.LiftOvercurrentRaw)
	require.Equal(t, uint32(0), cfg.AugerOvercurrentRaw)
	require.Equal(t, 300*time.Millisecond, cfg.ReadGapHalt)
	require.Equal(t, 200*time.Millisecond, cfg.StaleInput)
}

func TestLoad_ZeroValuedOverridesApply(t *testing.T) {
	cfg, err := Load(writeConfig(t, `
lift_up_sign = 0
top_band_fraction = 0
lift_overcurrent_raw = 0
read_gap_halt_ms = 0
`))
	require.NoError(t, err)
	require.Equal(t, 0, cfg.LiftUpSign)
	require.Zero(t, cfg.TopBandFraction)
	require.Equal(t, uint32(0), cfg.LiftOvercurrentRaw)
	require.Equal(t, time.Duration(0), cfg.ReadGapHalt)
}

func TestLoad_MmPerTickAbsentStaysNil(t *testing.T) {
	cfg, err := Load(writeConfig(t, "jog_speed = 300\n"))
	require.NoError(t, err)
	require.Nil(t, cfg.MmPerTick)
}

func TestLoad_SpeedsClampToTheCap(t *testing.T) {
	cfg, err := Load(writeConfig(t, `
jog_speed = 99999
slow_jog_speed = -99999
drill_speed = 99999
switch_speed = 99999
`))
	require.NoError(t, err)
	require.Equal(t, MaxSpeedRaw, cfg.JogSpeed)
	require.Equal(t, -MaxSpeedRaw, cfg.SlowJogSpeed)
	require.Equal(t, MaxSpeedRaw, cfg.DrillSpeed)
	require.Equal(t, MaxSpeedRaw, cfg.SwitchSpeed)
	require.Equal(t, int32(10240), MaxSpeedRaw)
}

func TestLoad_MalformedTomlErrors(t *testing.T) {
	cfg, err := Load(writeConfig(t, "jog_speed = "))
	require.Error(t, err)
	require.Nil(t, cfg)
}

func TestSwitchSign_Matrix(t *testing.T) {
	tests := []struct {
		drillSign int
		direction string
		want      int
	}{
		{drillSign: 1, direction: "ccw", want: -1},
		{drillSign: 1, direction: "cw", want: 1},
		{drillSign: -1, direction: "ccw", want: 1},
		{drillSign: -1, direction: "cw", want: -1},
	}
	for _, tt := range tests {
		cfg := &Config{AugerDrillSign: tt.drillSign, SwitchDirection: tt.direction}
		require.Equal(t, tt.want, cfg.SwitchSign())
	}
}
