package protocol

import (
	"testing"

	"google.golang.org/protobuf/proto"

	drillv1 "github.com/waypointos/waypoint-drill/protocol/gen/go"
)

// Round-trips the two baseline capture actions so a regen that drops or
// renumbers them fails here rather than at the command router.
func TestDrillCommandBaselineCaptureRoundTrip(t *testing.T) {
	for _, cmd := range []*drillv1.DrillCommand{
		{Action: &drillv1.DrillCommand_CaptureLiftBaseline{CaptureLiftBaseline: true}},
		{Action: &drillv1.DrillCommand_CaptureAugerBaseline{CaptureAugerBaseline: true}},
	} {
		b, err := proto.Marshal(cmd)
		if err != nil {
			t.Fatal(err)
		}
		var got drillv1.DrillCommand
		if err := proto.Unmarshal(b, &got); err != nil {
			t.Fatal(err)
		}
		if got.GetAction() == nil {
			t.Fatal("action lost in round trip")
		}
	}
}
