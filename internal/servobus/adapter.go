// Package servobus adapts the waypoint SDK servo client to the drill module's
// needs: signed wheel-mode velocity, torque, the overcurrent ceiling and one
// raw read. It also translates waypoint.v1 servo state into the drill mirror.
package servobus

import (
	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"
	"github.com/waypointos/waypoint/sdk/wpmodule"

	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

// client is the slice of the SDK servo client the adapter uses; naming it keeps
// the adapter's own behavior testable without a live bus.
type client interface {
	SetGoalVelocity(id uint32, raw int32) error
	SetTorqueEnable(id uint32, on bool) error
	SetOvercurrentLimit(id, raw uint32) error
	Read(id uint32) (*waypointv1.ServoState, error)
}

// Adapter wraps the SDK servo client behind the drill module's narrow surface.
// SetMode is deliberately absent: core forces wheel mode on the module joints
// from the platform descriptor, and a rewrite here would fight it.
type Adapter struct{ sv client }

func New(sv *wpmodule.ServoClient) *Adapter { return &Adapter{sv: sv} }

func (a *Adapter) SetGoalVelocity(id uint32, raw int32) error {
	return a.sv.SetGoalVelocity(id, raw)
}

func (a *Adapter) SetTorqueEnable(id uint32, on bool) error {
	return a.sv.SetTorqueEnable(id, on)
}

func (a *Adapter) SetOvercurrentLimit(id uint32, raw uint32) error {
	return a.sv.SetOvercurrentLimit(id, raw)
}

// Read requests one servo's raw state through the broker. A failed read still
// returns an identified state (ok=false, every optional absent) so downstream
// telemetry keeps attributing the reading to the right servo.
func (a *Adapter) Read(id uint32) (*drillv1.ServoState, error) {
	st, err := a.sv.Read(id)
	if err != nil {
		return toServoState(id, nil), err
	}
	return toServoState(id, st), nil
}

// toServoState copies the optional scalars as pointers so a field the servo did
// not answer stays absent (rendered N/A) instead of collapsing to a fake zero.
func toServoState(id uint32, st *waypointv1.ServoState) *drillv1.ServoState {
	if st == nil {
		return &drillv1.ServoState{ServoId: id}
	}
	return &drillv1.ServoState{
		ServoId:            id,
		PositionRaw:        st.PositionRaw,
		SpeedRaw:           st.SpeedRaw,
		LoadRaw:            st.LoadRaw,
		CurrentRaw:         st.CurrentRaw,
		VoltageDeci:        st.VoltageDeci,
		TemperatureC:       st.TemperatureC,
		Moving:             st.GetMoving(),
		OvercurrentTripped: st.GetOvercurrentTripped(),
		Ok:                 st.GetOk(),
	}
}
