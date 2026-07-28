package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"sync"
	"time"

	natsgo "github.com/nats-io/nats.go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"
	"github.com/waypointos/waypoint/sdk/wpmodule"

	"github.com/waypointos/waypoint-drill/internal/auger"
	"github.com/waypointos/waypoint-drill/internal/config"
	"github.com/waypointos/waypoint-drill/internal/control"
	"github.com/waypointos/waypoint-drill/internal/lift"
	"github.com/waypointos/waypoint-drill/internal/servobus"
	"github.com/waypointos/waypoint-drill/internal/state"
	"github.com/waypointos/waypoint-drill/internal/store"
	"github.com/waypointos/waypoint-drill/internal/teleop"
	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

const (
	readPeriod  = time.Second / config.ReadRateHz
	statsPeriod = 200 * time.Millisecond
	// Bounded wait for core and the servo broker to come up at boot.
	startupAttempts = 10
	startupBackoff  = 500 * time.Millisecond
	// Bounded wait for the control loop's stop sequence at shutdown.
	haltGrace = 2 * time.Second
)

func main() {
	// The systemd unit passes --config/--creds/--rover; local runs pass none and
	// rely on the environment the SDK already reads.
	configFlag := flag.String("config", "", "path to config.toml (overrides WAYPOINT_MODULE_CONFIG)")
	credsFlag := flag.String("creds", "", "path to creds.env (used when WAYPOINT_MODULE_CREDS is unset)")
	_ = flag.String("rover", "", "rover id (accepted and ignored; the SDK reads WAYPOINT_ROVER_ID)")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	configPath := resolveConfigPath(*configFlag, os.Getenv("WAYPOINT_MODULE_CONFIG"))
	if creds := resolveCredsEnv(*credsFlag, os.Getenv("WAYPOINT_MODULE_CREDS")); creds != "" {
		if err := os.Setenv("WAYPOINT_MODULE_CREDS", creds); err != nil {
			slog.Error(err.Error())
			os.Exit(1)
		}
	}

	var mod *wpmodule.M
	var halted <-chan struct{}
	err := wpmodule.Run(context.Background(), wpmodule.Options{ID: "drill"}, func(m *wpmodule.M) error {
		mod = m
		var setupErr error
		halted, setupErr = setup(m, configPath)
		return setupErr
	})
	// The process must not exit while the servos are still latched: a wheel-mode
	// STS3215 keeps acting on its goal speed with no daemon left to zero it.
	awaitHalt(mod, halted)
	if err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}

// resolveConfigPath picks the config.toml path: the flag when set, else the
// environment the agent's drop-in may export, else empty for built-in defaults.
func resolveConfigPath(flagVal, env string) string {
	if flagVal != "" {
		return flagVal
	}
	return env
}

// resolveCredsEnv returns the value WAYPOINT_MODULE_CREDS should be set to, or
// empty to leave it alone. The SDK reads only the environment, and an already
// exported value wins so the agent's drop-in stays authoritative.
func resolveCredsEnv(flagVal, env string) string {
	if env != "" {
		return ""
	}
	return flagVal
}

// awaitHalt blocks until the control loop's stop sequence has been written and
// flushed to the bus. The SDK offers no pre-drain hook, so the wait sits here.
func awaitHalt(m *wpmodule.M, halted <-chan struct{}) {
	if halted == nil {
		return
	}
	select {
	case <-halted:
	case <-time.After(haltGrace):
		slog.Warn("shutdown stop sequence did not finish", "grace", haltGrace)
	}
	if m != nil {
		_ = m.NC().FlushTimeout(haltGrace)
	}
}

// setup wires the drill module on the SDK runtime. The SDK owns connect, creds,
// sd_notify, health, and the ModuleStats heartbeat; this adds the drill's own
// surfaces: the command subject, teleop input, the control loop, the state and
// stats publishers, and the calibration event leaf. Goroutines started here stop
// on m.Done(). The returned channel closes once the control loop has finished
// its stop sequence; main waits on it so the servos are zeroed before exit.
func setup(m *wpmodule.M, configPath string) (<-chan struct{}, error) {
	cfg, err := config.Load(configPath)
	if err != nil {
		return nil, err
	}

	sv := servobus.New(m.Servo())
	axis := lift.NewAxis()
	if cal, ok, err := store.Load(cfg.StatePath); err != nil {
		slog.Warn("calibration load failed", "path", cfg.StatePath, "err", err)
	} else if ok {
		axis.SetTravel(cal.TravelTicks)
		slog.Info("lift calibration loaded", "travel_ticks", cal.TravelTicks)
	}

	// Mark outcomes go to the calibration leaf; a marked bottom persists its
	// travel span so the axis stays calibrated across restarts.
	calSubject := m.Subject("calibration")
	events := func(phase string, travel *int64, detail string) {
		ev := &drillv1.CalibrationEvent{T: timestamppb.Now(), Phase: phase, TravelTicks: travel, Detail: detail}
		if b, err := proto.Marshal(ev); err == nil {
			_ = m.Publish(calSubject, b)
		}
		if travel == nil {
			return
		}
		if err := store.Save(cfg.StatePath, store.Calibration{TravelTicks: *travel}); err != nil {
			slog.Warn("calibration save failed", "path", cfg.StatePath, "err", err)
		}
	}

	loop := control.NewLoop(cfg, sv, axis, auger.NewInterlock(cfg.TopBandFraction), events)

	// The agent names the open component class in the unit drop-in; its leaves
	// are <class>.state and <class>.cmd.
	class := os.Getenv("WAYPOINT_MODULE_COMPONENT")
	if class == "" {
		class = "drill"
	}

	if _, err := m.Subscribe(m.Subject(class+".cmd"), func(msg *natsgo.Msg) {
		var cmd drillv1.DrillCommand
		if proto.Unmarshal(msg.Data, &cmd) != nil {
			return
		}
		loop.Command(&cmd, time.Now())
	}); err != nil {
		return nil, err
	}

	if _, err := m.TeleopInput(func(s *waypointv1.GamepadSnapshot) {
		loop.SetTeleop(teleop.MapInput(s), time.Now())
	}); err != nil {
		return nil, err
	}

	reads := &readCache{}
	go applyOvercurrentCeilings(m, sv, cfg)
	go readLoop(m, sv, cfg, axis, loop, reads, m.Subject(class+".state"))
	go statsLoop(m, reads, m.Subject("stats"))

	halted := make(chan struct{})
	go func() {
		defer close(halted)
		loop.Run(m.Done())
	}()
	return halted, nil
}

// readCache holds the last read of each servo so the 5 Hz stats publisher costs
// no extra bus traffic.
type readCache struct {
	mu          sync.Mutex
	lift, auger *drillv1.ServoState
}

func (c *readCache) set(liftSt, augerSt *drillv1.ServoState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lift, c.auger = liftSt, augerSt
}

func (c *readCache) get() (*drillv1.ServoState, *drillv1.ServoState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lift, c.auger
}

// readLoop is the module's sensor path: it reads both servos at the fixed read
// rate, feeds the control loop, and publishes drill.state at the component rate.
// State is published from this goroutine so the lift axis keeps a single owner.
func readLoop(
	m *wpmodule.M,
	sv *servobus.Adapter,
	cfg *config.Config,
	axis *lift.Axis,
	loop *control.Loop,
	reads *readCache,
	stateSubject string,
) {
	t := time.NewTicker(readPeriod)
	defer t.Stop()
	publishEvery := time.Duration(float64(time.Second) / state.RateHz())
	// Accumulating deadline, not elapsed-since-last: at equal read and publish
	// rates, ordinary ticker jitter makes an elapsed test drop every other tick.
	var nextPublish time.Time

	for {
		select {
		case <-m.Done():
			return
		case <-t.C:
			liftSt, liftErr := sv.Read(cfg.LiftID)
			augerSt, augerErr := sv.Read(cfg.AugerID)
			// Stamp the pair when it completes, not when the tick fired: a read
			// blocks for its full timeout, and the read-gap deadman ages from here.
			now := time.Now()
			reads.set(liftSt, augerSt)

			loop.ObserveFaults(liftSt.GetOvercurrentTripped(), augerSt.GetOvercurrentTripped())
			loop.Observe(obsFrom(liftSt, liftErr, now), obsFrom(augerSt, augerErr, now))

			if now.Before(nextPublish) {
				continue
			}
			nextPublish = nextPublish.Add(publishEvery)
			if nextPublish.Before(now) {
				nextPublish = now.Add(publishEvery)
			}
			st := state.Build(now, axis, loop.Snapshot(), liftSt, augerSt, cfg.MmPerTick)
			if b, err := proto.Marshal(st); err == nil {
				_ = m.Publish(stateSubject, b)
			}
		}
	}
}

func statsLoop(m *wpmodule.M, reads *readCache, statsSubject string) {
	t := time.NewTicker(statsPeriod)
	defer t.Stop()
	for {
		select {
		case <-m.Done():
			return
		case now := <-t.C:
			liftSt, augerSt := reads.get()
			if b, err := proto.Marshal(state.BuildStats(now, liftSt, augerSt)); err == nil {
				_ = m.Publish(statsSubject, b)
			}
		}
	}
}

// obsFrom renders one servo read for the lift axis. A failed read, or one whose
// position the servo did not answer, is not an observation: the axis must never
// fold in a fabricated position. Speed and load are optional on the wire, and an
// absent one reads as a real zero downstream, so their absence fails the read
// rather than passing a fake value on.
func obsFrom(st *drillv1.ServoState, err error, now time.Time) lift.Obs {
	o := lift.Obs{At: now}
	if err != nil || !st.GetOk() || st.PositionRaw == nil || st.SpeedRaw == nil || st.LoadRaw == nil {
		return o
	}
	o.OK = true
	o.PositionRaw = uint16(st.GetPositionRaw())
	o.SpeedRaw = st.GetSpeedRaw()
	o.LoadRaw = st.GetLoadRaw()
	return o
}

// applyOvercurrentCeilings waits until the servo bus answers a read (core and
// the servo broker are up), then writes each servo's overcurrent ceiling. A
// configured 0 leaves the servo's existing limit alone.
func applyOvercurrentCeilings(m *wpmodule.M, sv *servobus.Adapter, cfg *config.Config) {
	limits := []struct {
		id  uint32
		raw uint32
	}{
		{cfg.LiftID, cfg.LiftOvercurrentRaw},
		{cfg.AugerID, cfg.AugerOvercurrentRaw},
	}
	for attempt := 0; attempt < startupAttempts; attempt++ {
		if _, err := sv.Read(cfg.LiftID); err == nil {
			for _, l := range limits {
				if l.raw == 0 {
					continue
				}
				if err := sv.SetOvercurrentLimit(l.id, l.raw); err != nil {
					slog.Warn("overcurrent limit write failed", "id", l.id, "err", err)
				}
			}
			slog.Info("overcurrent ceilings applied", "lift", cfg.LiftOvercurrentRaw, "auger", cfg.AugerOvercurrentRaw)
			return
		}
		select {
		case <-m.Done():
			return
		case <-time.After(startupBackoff):
		}
	}
	slog.Warn("overcurrent ceilings skipped: bus not reachable at startup")
}
