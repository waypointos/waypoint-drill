// Package store persists the drill's lift calibration across restarts.
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

// Save writes the calibration atomically to path, creating parent dirs.
func Save(path string, c Calibration) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if err := toml.NewEncoder(f).Encode(c); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Load reads the calibration; a missing file yields ok=false and no error.
func Load(path string) (*Calibration, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var c Calibration
	if _, err := toml.Decode(string(data), &c); err != nil {
		return nil, false, err
	}
	return &c, true, nil
}
