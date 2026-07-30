package store

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStore_RoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "calibration.toml")
	require.NoError(t, Save(path, Calibration{TravelTicks: 9500}))

	got, ok, err := Load(path)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, int64(9500), got.TravelTicks)
}

func TestStore_SaveCreatesParentDirs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "deeper", "calibration.toml")
	require.NoError(t, Save(path, Calibration{TravelTicks: 42}))

	got, ok, err := Load(path)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, int64(42), got.TravelTicks)
}

func TestStore_SaveOverwritesAndLeavesNoTempFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "calibration.toml")
	require.NoError(t, Save(path, Calibration{TravelTicks: 100}))
	require.NoError(t, Save(path, Calibration{TravelTicks: 200}))

	got, ok, err := Load(path)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, int64(200), got.TravelTicks)

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, "calibration.toml", entries[0].Name())
}

func TestLoad_MissingFileIsNotAnError(t *testing.T) {
	got, ok, err := Load(filepath.Join(t.TempDir(), "none.toml"))
	require.NoError(t, err)
	require.False(t, ok)
	require.Nil(t, got)
}

func TestLoad_MalformedFileErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "calibration.toml")
	require.NoError(t, os.WriteFile(path, []byte("travel_ticks = \"nope\""), 0o644))

	got, ok, err := Load(path)
	require.Error(t, err)
	require.False(t, ok)
	require.Nil(t, got)
}

func TestWeightStore_RoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "weight.toml")
	in := WeightCal{OffsetA: 81234, OffsetB: -222, OffsetC: 40000, GramsPerCount: 0.00125}
	require.NoError(t, SaveWeight(path, in))

	got, ok, err := LoadWeight(path)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, in, *got)
}

func TestWeightStore_MissingFileIsNotError(t *testing.T) {
	got, ok, err := LoadWeight(filepath.Join(t.TempDir(), "absent.toml"))
	require.NoError(t, err)
	require.False(t, ok)
	require.Nil(t, got)
}

func TestLoadEstCalRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "loadest.toml")

	_, ok, err := LoadLoadEst(path)
	require.NoError(t, err)
	require.False(t, ok)

	in := LoadEstCal{
		LiftBaselineNmm: -412.5, LiftBaselineSet: true,
		AugerBaselineNmm: 88.25, AugerBaselineSet: true,
	}
	require.NoError(t, SaveLoadEst(path, in))

	out, ok, err := LoadLoadEst(path)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, in, *out)
}
