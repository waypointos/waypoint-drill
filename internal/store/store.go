// Package store persists the drill's lift and load cell calibration across
// restarts.
package store

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

// Calibration is the measured lift travel span in unwrapped encoder ticks.
type Calibration struct {
	TravelTicks int64 `toml:"travel_ticks"`
}

// WeightCal is the load cell zero and shared scale. GramsPerCount 0 means
// tared but not yet scaled by a known mass.
type WeightCal struct {
	OffsetA       int64   `toml:"offset_a"`
	OffsetB       int64   `toml:"offset_b"`
	OffsetC       int64   `toml:"offset_c"`
	GramsPerCount float64 `toml:"grams_per_count"`
}

// LoadEstCal is the servo-derived load estimate's free-air baselines, in
// N-mm of smoothed servo torque. Set flags distinguish "captured at zero"
// from "never captured".
type LoadEstCal struct {
	LiftBaselineNmm  float64 `toml:"lift_baseline_nmm"`
	LiftBaselineSet  bool    `toml:"lift_baseline_set"`
	AugerBaselineNmm float64 `toml:"auger_baseline_nmm"`
	AugerBaselineSet bool    `toml:"auger_baseline_set"`
}

// Save writes the calibration atomically to path, creating parent dirs.
func Save(path string, c Calibration) error {
	return writeTOML(path, c)
}

// Load reads the calibration; a missing file yields ok=false and no error.
func Load(path string) (*Calibration, bool, error) {
	var c Calibration
	ok, err := readTOML(path, &c)
	if !ok || err != nil {
		return nil, false, err
	}
	return &c, true, nil
}

// SaveWeight writes the weight calibration atomically, creating parent dirs.
func SaveWeight(path string, c WeightCal) error {
	return writeTOML(path, c)
}

// LoadWeight reads the weight calibration; a missing file yields ok=false.
func LoadWeight(path string) (*WeightCal, bool, error) {
	var c WeightCal
	ok, err := readTOML(path, &c)
	if !ok || err != nil {
		return nil, false, err
	}
	return &c, true, nil
}

// SaveLoadEst writes the estimate baselines atomically, creating parent dirs.
func SaveLoadEst(path string, c LoadEstCal) error {
	return writeTOML(path, c)
}

// LoadLoadEst reads the estimate baselines; a missing file yields ok=false.
func LoadLoadEst(path string) (*LoadEstCal, bool, error) {
	var c LoadEstCal
	ok, err := readTOML(path, &c)
	if !ok || err != nil {
		return nil, false, err
	}
	return &c, true, nil
}

func writeTOML(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if err := toml.NewEncoder(f).Encode(v); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func readTOML(path string, v any) (bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := toml.Decode(string(data), v); err != nil {
		return false, err
	}
	return true, nil
}
