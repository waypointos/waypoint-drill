package config

import (
	"os"
	"time"

	"github.com/BurntSushi/toml"
)

// ReadRateHz is the servo read cadence the control loop runs at.
const ReadRateHz = 20

// MaxSpeedRaw caps every commanded speed so a single read interval can never
// move a servo more than a quarter revolution (1024 of 4096 ticks).
const MaxSpeedRaw int32 = 1024 * ReadRateHz / 2

type Config struct {
	StatePath string

	LiftID  uint32
	AugerID uint32

	// Sign conventions follow the reference drill assembly, which is the same
	// gearing and motor orientation for every build of this module. They stay
	// configurable only so a one-off rebuild can correct itself without a fork.
	LiftUpSign      int
	AugerDrillSign  int
	SwitchDirection string // "ccw" = opposite the drill sign, "cw" = same sign

	JogSpeed     int32
	SlowJogSpeed int32
	DrillSpeed   int32
	SwitchSpeed  int32

	TopBandFraction float64
	MmPerTick       *float64 // nil keeps height_mm N/A

	LiftOvercurrentRaw  uint32
	AugerOvercurrentRaw uint32

	ReadGapHalt time.Duration
	StaleInput  time.Duration
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		StatePath:           "/var/lib/waypoint-module-drill/calibration.toml",
		LiftID:              11,
		AugerID:             12,
		LiftUpSign:          -1,
		AugerDrillSign:      -1,
		SwitchDirection:     "ccw",
		JogSpeed:            400,
		SlowJogSpeed:        150,
		// Ceiling the tab's speed slider scales, not a fixed rate. 3200 raw is
		// roughly the STS3215's own free-run limit at 4096 ticks per revolution.
		DrillSpeed:          3200,
		SwitchSpeed:         300,
		TopBandFraction:     0.03,
		LiftOvercurrentRaw:  500,
		AugerOvercurrentRaw: 500,
		ReadGapHalt:         250 * time.Millisecond,
		StaleInput:          150 * time.Millisecond,
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, nil // config is optional; defaults are fine
	}
	var raw struct {
		StatePath           string   `toml:"state_path"`
		LiftID              *uint32  `toml:"lift_id"`
		AugerID             *uint32  `toml:"auger_id"`
		LiftUpSign          *int     `toml:"lift_up_sign"`
		AugerDrillSign      *int     `toml:"auger_drill_sign"`
		SwitchDirection     string   `toml:"switch_direction"`
		JogSpeed            *int32   `toml:"jog_speed"`
		SlowJogSpeed        *int32   `toml:"slow_jog_speed"`
		DrillSpeed          *int32   `toml:"drill_speed"`
		SwitchSpeed         *int32   `toml:"switch_speed"`
		TopBandFraction     *float64 `toml:"top_band_fraction"`
		MmPerTick           *float64 `toml:"mm_per_tick"`
		LiftOvercurrentRaw  *uint32  `toml:"lift_overcurrent_raw"`
		AugerOvercurrentRaw *uint32  `toml:"auger_overcurrent_raw"`
		ReadGapHaltMs       *int64   `toml:"read_gap_halt_ms"`
		StaleInputMs        *int64   `toml:"stale_input_ms"`
	}
	if _, err := toml.Decode(string(data), &raw); err != nil {
		return nil, err
	}
	if raw.StatePath != "" {
		cfg.StatePath = raw.StatePath
	}
	if raw.LiftID != nil {
		cfg.LiftID = *raw.LiftID
	}
	if raw.AugerID != nil {
		cfg.AugerID = *raw.AugerID
	}
	if raw.LiftUpSign != nil {
		cfg.LiftUpSign = *raw.LiftUpSign
	}
	if raw.AugerDrillSign != nil {
		cfg.AugerDrillSign = *raw.AugerDrillSign
	}
	if raw.SwitchDirection != "" {
		cfg.SwitchDirection = raw.SwitchDirection
	}
	if raw.JogSpeed != nil {
		cfg.JogSpeed = *raw.JogSpeed
	}
	if raw.SlowJogSpeed != nil {
		cfg.SlowJogSpeed = *raw.SlowJogSpeed
	}
	if raw.DrillSpeed != nil {
		cfg.DrillSpeed = *raw.DrillSpeed
	}
	if raw.SwitchSpeed != nil {
		cfg.SwitchSpeed = *raw.SwitchSpeed
	}
	if raw.TopBandFraction != nil {
		cfg.TopBandFraction = *raw.TopBandFraction
	}
	if raw.MmPerTick != nil {
		v := *raw.MmPerTick
		cfg.MmPerTick = &v
	}
	if raw.LiftOvercurrentRaw != nil {
		cfg.LiftOvercurrentRaw = *raw.LiftOvercurrentRaw
	}
	if raw.AugerOvercurrentRaw != nil {
		cfg.AugerOvercurrentRaw = *raw.AugerOvercurrentRaw
	}
	if raw.ReadGapHaltMs != nil {
		cfg.ReadGapHalt = time.Duration(*raw.ReadGapHaltMs) * time.Millisecond
	}
	if raw.StaleInputMs != nil {
		cfg.StaleInput = time.Duration(*raw.StaleInputMs) * time.Millisecond
	}
	clampSpeeds(cfg)
	return cfg, nil
}

func clampSpeeds(cfg *Config) {
	for _, p := range []*int32{&cfg.JogSpeed, &cfg.SlowJogSpeed, &cfg.DrillSpeed, &cfg.SwitchSpeed} {
		if *p > MaxSpeedRaw {
			*p = MaxSpeedRaw
		} else if *p < -MaxSpeedRaw {
			*p = -MaxSpeedRaw
		}
	}
}

// SwitchSign is the raw-velocity sign that engages the switch rotation, derived
// from the drill sign and switch_direction.
func (c *Config) SwitchSign() int {
	if c.SwitchDirection == "cw" {
		return c.AugerDrillSign
	}
	return -c.AugerDrillSign
}
