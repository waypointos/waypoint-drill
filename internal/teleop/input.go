package teleop

import (
	"log/slog"
	"sync"

	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"
)

// D-pad indices in the W3C standard gamepad layout. The dashboard publisher
// swaps only 4..7 on WebKit, so these stay put across browsers.
const (
	btnUp    = 12
	btnDown  = 13
	btnLeft  = 14
	btnRight = 15
)

// Intent is one frame of operator input: a lift jog rate and an auger request.
type Intent struct {
	LiftJog  float64
	Auger    drillv1.AugerDirection
	Throttle float64
}

// MapInput turns a gamepad snapshot into an Intent. Opposing D-pad pairs cancel
// rather than picking a winner, so a stuck button cannot bias motion.
func MapInput(s *waypointv1.GamepadSnapshot) Intent {
	b := s.GetButtons()
	edges.observe(b)

	in := Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_IDLE}
	up, down := pressed(b, btnUp), pressed(b, btnDown)
	switch {
	case up && !down:
		in.LiftJog = 1
	case down && !up:
		in.LiftJog = -1
	}
	left, right := pressed(b, btnLeft), pressed(b, btnRight)
	switch {
	case left && !right:
		in.Auger, in.Throttle = drillv1.AugerDirection_AUGER_DIRECTION_DRILL, 1
	case right && !left:
		in.Auger, in.Throttle = drillv1.AugerDirection_AUGER_DIRECTION_SWITCH, 1
	}
	return in
}

func pressed(b []bool, i int) bool { return i < len(b) && b[i] }

var edges edgeLog

// edgeLog logs every button that goes high at Debug, so the real controller
// indices can be confirmed on hardware.
type edgeLog struct {
	mu   sync.Mutex
	prev []bool
}

func (e *edgeLog) observe(buttons []bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i := range buttons {
		if buttons[i] && !pressed(e.prev, i) {
			slog.Debug("teleop gamepad button down", "index", i)
		}
	}
	e.prev = append(e.prev[:0], buttons...)
}
