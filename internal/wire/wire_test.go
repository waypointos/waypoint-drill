package wire

import (
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"
)

// The panel decodes the platform's sensor.state bytes with the drill-local
// mirror; the mirror must stay field-for-field wire compatible.
func TestSensorReadingsMirror_WireCompatible(t *testing.T) {
	v := 12.5
	src := &waypointv1.SensorReadings{
		Readings: []*waypointv1.SensorReading{
			{Name: "cell_a_g", Value: &v, Unit: "g", Ok: true},
			{Name: "total_g", Unit: "g", Ok: false},
		},
	}
	b, err := proto.Marshal(src)
	require.NoError(t, err)

	var got drillv1.SensorReadings
	require.NoError(t, proto.Unmarshal(b, &got))
	require.Len(t, got.Readings, 2)
	require.Equal(t, "cell_a_g", got.Readings[0].Name)
	require.Equal(t, 12.5, got.Readings[0].GetValue())
	require.Equal(t, "g", got.Readings[0].Unit)
	require.True(t, got.Readings[0].Ok)
	require.False(t, got.Readings[1].Ok)
	require.Nil(t, got.Readings[1].Value)
}

func TestDrillCommand_NewActions(t *testing.T) {
	tare := &drillv1.DrillCommand{Action: &drillv1.DrillCommand_Tare{Tare: true}}
	b, err := proto.Marshal(tare)
	require.NoError(t, err)
	var back drillv1.DrillCommand
	require.NoError(t, proto.Unmarshal(b, &back))
	require.True(t, back.GetTare())

	cal := &drillv1.DrillCommand{Action: &drillv1.DrillCommand_CalibrateMassG{CalibrateMassG: 500}}
	b, err = proto.Marshal(cal)
	require.NoError(t, err)
	require.NoError(t, proto.Unmarshal(b, &back))
	require.Equal(t, 500.0, back.GetCalibrateMassG())
}
