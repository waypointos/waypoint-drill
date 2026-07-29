package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

func TestResolveConfigPath(t *testing.T) {
	t.Run("flag wins over env", func(t *testing.T) {
		assert.Equal(t, "/flag/config.toml",
			resolveConfigPath("/flag/config.toml", "/env/config.toml"))
	})

	t.Run("env used when flag absent", func(t *testing.T) {
		assert.Equal(t, "/env/config.toml", resolveConfigPath("", "/env/config.toml"))
	})

	t.Run("both empty means defaults", func(t *testing.T) {
		assert.Equal(t, "", resolveConfigPath("", ""))
	})
}

func TestResolveCredsEnv(t *testing.T) {
	t.Run("flag passed through when env unset", func(t *testing.T) {
		assert.Equal(t, "/run/waypoint/modules/drill/creds.env",
			resolveCredsEnv("/run/waypoint/modules/drill/creds.env", ""))
	})

	t.Run("existing env left alone", func(t *testing.T) {
		assert.Equal(t, "", resolveCredsEnv("/flag/creds.env", "/env/creds.env"))
	})

	t.Run("no flag leaves env alone", func(t *testing.T) {
		assert.Equal(t, "", resolveCredsEnv("", ""))
		assert.Equal(t, "", resolveCredsEnv("", "/env/creds.env"))
	})
}

type fakeMotion struct{ got *drillv1.DrillCommand }

func (f *fakeMotion) Command(c *drillv1.DrillCommand, _ time.Time) { f.got = c }

type fakeWeigher struct {
	tared bool
	mass  float64
}

func (f *fakeWeigher) Tare() error               { f.tared = true; return nil }
func (f *fakeWeigher) Calibrate(m float64) error { f.mass = m; return nil }

func TestRouteCommand_SplitsWeightActionsOffMotion(t *testing.T) {
	motion, w := &fakeMotion{}, &fakeWeigher{}
	now := time.Now()

	routeCommand(&drillv1.DrillCommand{Action: &drillv1.DrillCommand_Tare{Tare: true}}, motion, w, now)
	require.True(t, w.tared)
	require.Nil(t, motion.got)

	routeCommand(&drillv1.DrillCommand{Action: &drillv1.DrillCommand_CalibrateMassG{CalibrateMassG: 250}}, motion, w, now)
	require.Equal(t, 250.0, w.mass)
	require.Nil(t, motion.got)

	stop := &drillv1.DrillCommand{Action: &drillv1.DrillCommand_Stop{Stop: true}}
	routeCommand(stop, motion, w, now)
	require.Same(t, stop, motion.got)
}

func TestRouteCommand_FalseTareDoesNothing(t *testing.T) {
	motion, w := &fakeMotion{}, &fakeWeigher{}
	routeCommand(&drillv1.DrillCommand{Action: &drillv1.DrillCommand_Tare{Tare: false}}, motion, w, time.Now())
	require.False(t, w.tared)
	require.Nil(t, motion.got)
}
