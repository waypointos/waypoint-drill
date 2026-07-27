package servobus

import (
	"errors"
	"reflect"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"
)

// The module must never rewrite servo modes, so the adapter's method set is
// part of the contract, not just its behavior.
func TestAdapterExposesOnlyTheFourAllowedOps(t *testing.T) {
	typ := reflect.TypeOf(&Adapter{})
	got := make([]string, 0, typ.NumMethod())
	for i := 0; i < typ.NumMethod(); i++ {
		got = append(got, typ.Method(i).Name)
	}
	sort.Strings(got)

	assert.Equal(t, []string{"Read", "SetGoalVelocity", "SetOvercurrentLimit", "SetTorqueEnable"}, got)
	_, hasSetMode := typ.MethodByName("SetMode")
	assert.False(t, hasSetMode, "SetMode must stay absent: core owns servo modes")
}

func TestToServoStateKeepsPresentOptionals(t *testing.T) {
	in := &waypointv1.ServoState{
		ServoId:            99,
		PositionRaw:        proto.Uint32(2048),
		SpeedRaw:           proto.Int32(-400),
		LoadRaw:            proto.Int32(612),
		CurrentRaw:         proto.Uint32(77),
		VoltageDeci:        proto.Uint32(118),
		TemperatureC:       proto.Uint32(41),
		Moving:             true,
		OvercurrentTripped: true,
		Ok:                 true,
	}

	out := toServoState(11, in)

	// The requested id wins over whatever the reply echoed.
	assert.Equal(t, uint32(11), out.ServoId)
	require.NotNil(t, out.PositionRaw)
	assert.Equal(t, uint32(2048), *out.PositionRaw)
	require.NotNil(t, out.SpeedRaw)
	assert.Equal(t, int32(-400), *out.SpeedRaw)
	require.NotNil(t, out.LoadRaw)
	assert.Equal(t, int32(612), *out.LoadRaw)
	require.NotNil(t, out.CurrentRaw)
	assert.Equal(t, uint32(77), *out.CurrentRaw)
	require.NotNil(t, out.VoltageDeci)
	assert.Equal(t, uint32(118), *out.VoltageDeci)
	require.NotNil(t, out.TemperatureC)
	assert.Equal(t, uint32(41), *out.TemperatureC)
	assert.True(t, out.Moving)
	assert.True(t, out.OvercurrentTripped)
	assert.True(t, out.Ok)
}

func TestToServoStateKeepsAbsentOptionalsAbsent(t *testing.T) {
	out := toServoState(12, &waypointv1.ServoState{ServoId: 12, Ok: false})

	assert.Equal(t, uint32(12), out.ServoId)
	assert.False(t, out.Ok)
	assert.Nil(t, out.PositionRaw)
	assert.Nil(t, out.SpeedRaw)
	assert.Nil(t, out.LoadRaw)
	assert.Nil(t, out.CurrentRaw)
	assert.Nil(t, out.VoltageDeci)
	assert.Nil(t, out.TemperatureC)
}

func TestToServoStatePartialReadKeepsOnlyAnsweredFields(t *testing.T) {
	out := toServoState(11, &waypointv1.ServoState{
		ServoId:     11,
		PositionRaw: proto.Uint32(0),
		Ok:          true,
	})

	require.NotNil(t, out.PositionRaw)
	assert.Equal(t, uint32(0), *out.PositionRaw, "a real zero position stays present")
	assert.Nil(t, out.LoadRaw, "an unanswered load must not become 0")
	assert.Nil(t, out.SpeedRaw)
}

type failingClient struct{}

func (failingClient) SetGoalVelocity(uint32, int32) error { return nil }
func (failingClient) SetTorqueEnable(uint32, bool) error  { return nil }
func (failingClient) SetOvercurrentLimit(uint32, uint32) error {
	return nil
}
func (failingClient) Read(uint32) (*waypointv1.ServoState, error) {
	return nil, errors.New("no reply")
}

func TestReadFailureStillIdentifiesTheServo(t *testing.T) {
	a := &Adapter{sv: failingClient{}}

	out, err := a.Read(11)

	require.Error(t, err)
	require.NotNil(t, out, "a failed read must not erase which servo it was")
	assert.Equal(t, uint32(11), out.ServoId)
	assert.False(t, out.Ok)
	assert.Nil(t, out.PositionRaw)
}

func TestToServoStateNilReplyIsNotOK(t *testing.T) {
	out := toServoState(11, nil)

	assert.Equal(t, uint32(11), out.ServoId)
	assert.False(t, out.Ok)
	assert.Nil(t, out.PositionRaw)
}
