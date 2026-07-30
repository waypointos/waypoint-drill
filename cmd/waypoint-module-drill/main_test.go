package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"

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
	motion, w, est := &fakeMotion{}, &fakeWeigher{}, &fakeEstimator{}
	now := time.Now()

	routeCommand(&drillv1.DrillCommand{Action: &drillv1.DrillCommand_Tare{Tare: true}}, motion, w, est, now)
	require.True(t, w.tared)
	require.Nil(t, motion.got)

	routeCommand(&drillv1.DrillCommand{Action: &drillv1.DrillCommand_CalibrateMassG{CalibrateMassG: 250}}, motion, w, est, now)
	require.Equal(t, 250.0, w.mass)
	require.Nil(t, motion.got)

	stop := &drillv1.DrillCommand{Action: &drillv1.DrillCommand_Stop{Stop: true}}
	routeCommand(stop, motion, w, est, now)
	require.Same(t, stop, motion.got)
}

type fakeSensor struct{ names []string }

func (f *fakeSensor) State() *waypointv1.SensorReadings {
	out := &waypointv1.SensorReadings{}
	for _, n := range f.names {
		out.Readings = append(out.Readings, &waypointv1.SensorReading{Name: n})
	}
	return out
}

type fakeReadings struct{ names []string }

func (f *fakeReadings) Readings() []*waypointv1.SensorReading {
	var out []*waypointv1.SensorReading
	for _, n := range f.names {
		out = append(out, &waypointv1.SensorReading{Name: n})
	}
	return out
}

func TestSensorsWith_AppendsEstimatesAfterTheWeightReadings(t *testing.T) {
	srv := sensorsWith(&fakeSensor{names: []string{"a_g", "total_g"}}, &fakeReadings{names: []string{"lift_force_est_g", "auger_torque_est_nmm"}})

	var got []string
	for _, r := range srv.State().GetReadings() {
		got = append(got, r.GetName())
	}
	require.Equal(t, []string{"a_g", "total_g", "lift_force_est_g", "auger_torque_est_nmm"}, got)

	// Each publish rebuilds the list; readings must not accumulate across calls.
	require.Len(t, srv.State().GetReadings(), 4)
}

type fakeEstimator struct{ lift, auger int }

func (f *fakeEstimator) CaptureLiftBaseline() error  { f.lift++; return nil }
func (f *fakeEstimator) CaptureAugerBaseline() error { f.auger++; return nil }

func TestRouteCommand_BaselineCaptures(t *testing.T) {
	motion, w, est := &fakeMotion{}, &fakeWeigher{}, &fakeEstimator{}
	now := time.Now()

	routeCommand(&drillv1.DrillCommand{
		Action: &drillv1.DrillCommand_CaptureLiftBaseline{CaptureLiftBaseline: true},
	}, motion, w, est, now)
	routeCommand(&drillv1.DrillCommand{
		Action: &drillv1.DrillCommand_CaptureAugerBaseline{CaptureAugerBaseline: true},
	}, motion, w, est, now)

	require.Equal(t, 1, est.lift)
	require.Equal(t, 1, est.auger)
	require.Nil(t, motion.got) // baseline captures never reach the motion loop
}

func TestRouteCommand_FalseBaselineCapturesDoNothing(t *testing.T) {
	motion, w, est := &fakeMotion{}, &fakeWeigher{}, &fakeEstimator{}
	now := time.Now()

	routeCommand(&drillv1.DrillCommand{
		Action: &drillv1.DrillCommand_CaptureLiftBaseline{CaptureLiftBaseline: false},
	}, motion, w, est, now)
	routeCommand(&drillv1.DrillCommand{
		Action: &drillv1.DrillCommand_CaptureAugerBaseline{CaptureAugerBaseline: false},
	}, motion, w, est, now)

	require.Zero(t, est.lift)
	require.Zero(t, est.auger)
	require.Nil(t, motion.got)
}

func TestRouteCommand_FalseTareDoesNothing(t *testing.T) {
	motion, w, est := &fakeMotion{}, &fakeWeigher{}, &fakeEstimator{}
	routeCommand(&drillv1.DrillCommand{Action: &drillv1.DrillCommand_Tare{Tare: false}}, motion, w, est, time.Now())
	require.False(t, w.tared)
	require.Nil(t, motion.got)
}
