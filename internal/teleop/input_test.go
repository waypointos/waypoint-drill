package teleop

import (
	"bytes"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"
	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"
)

func snapshot(indices ...int) *waypointv1.GamepadSnapshot {
	buttons := make([]bool, 16)
	for _, i := range indices {
		buttons[i] = true
	}
	return &waypointv1.GamepadSnapshot{Buttons: buttons}
}

func TestMapInput_DpadMapping(t *testing.T) {
	tests := []struct {
		name    string
		snap    *waypointv1.GamepadSnapshot
		want    Intent
		pressed []int
	}{
		{name: "idle", snap: snapshot(), want: Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_IDLE}},
		{name: "up jogs the lift up", snap: snapshot(btnUp), want: Intent{LiftJog: 1, Auger: drillv1.AugerDirection_AUGER_DIRECTION_IDLE}},
		{name: "down jogs the lift down", snap: snapshot(btnDown), want: Intent{LiftJog: -1, Auger: drillv1.AugerDirection_AUGER_DIRECTION_IDLE}},
		{
			name: "left drills",
			snap: snapshot(btnLeft),
			want: Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_DRILL, Throttle: 1},
		},
		{
			name: "right switches",
			snap: snapshot(btnRight),
			want: Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_SWITCH, Throttle: 1},
		},
		{
			name: "up and down cancel",
			snap: snapshot(btnUp, btnDown),
			want: Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_IDLE},
		},
		{
			name: "left and right cancel",
			snap: snapshot(btnLeft, btnRight),
			want: Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_IDLE},
		},
		{
			name: "lift and auger combine",
			snap: snapshot(btnUp, btnRight),
			want: Intent{LiftJog: 1, Auger: drillv1.AugerDirection_AUGER_DIRECTION_SWITCH, Throttle: 1},
		},
		{
			name: "conflicting lift leaves the auger alone",
			snap: snapshot(btnUp, btnDown, btnLeft),
			want: Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_DRILL, Throttle: 1},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, MapInput(tt.snap))
		})
	}
}

func TestMapInput_ShortAndMissingButtonArrays(t *testing.T) {
	idle := Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_IDLE}
	require.Equal(t, idle, MapInput(&waypointv1.GamepadSnapshot{}))
	require.Equal(t, idle, MapInput(&waypointv1.GamepadSnapshot{Buttons: make([]bool, 4)}))
	// A 15-slot array covers up/down/left but not right.
	short := &waypointv1.GamepadSnapshot{Buttons: make([]bool, 15)}
	short.Buttons[btnLeft] = true
	require.Equal(t, Intent{Auger: drillv1.AugerDirection_AUGER_DIRECTION_DRILL, Throttle: 1}, MapInput(short))
}

func TestEdgeLog_LogsOnlyRisingIndices(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)

	var e edgeLog
	e.observe([]bool{false, true, false, false})
	require.Contains(t, buf.String(), "index=1")
	require.NotContains(t, buf.String(), "index=2")

	buf.Reset()
	e.observe([]bool{false, true, true, false}) // 1 still held, 2 rises
	require.NotContains(t, buf.String(), "index=1")
	require.Contains(t, buf.String(), "index=2")

	buf.Reset()
	e.observe([]bool{false, false, false, false}) // releases log nothing
	require.Empty(t, buf.String())

	buf.Reset()
	e.observe([]bool{false, true, false, false}) // re-press logs again
	require.Contains(t, buf.String(), "index=1")
}

func TestEdgeLog_ShorterArrayDoesNotRetainStaleState(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)

	var e edgeLog
	e.observe([]bool{true, true, true})
	buf.Reset()
	e.observe([]bool{true}) // shrunk array: index 0 still held, nothing new
	require.Empty(t, buf.String())
	buf.Reset()
	e.observe([]bool{true, true})
	require.Contains(t, buf.String(), "index=1")
}
