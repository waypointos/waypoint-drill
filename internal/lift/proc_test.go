package lift

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHome_CreepsUpUntilStall(t *testing.T) {
	p := NewHome()
	for i := 0; i < 5; i++ {
		r := p.Step(false, 0)
		require.Equal(t, 1, r.VelocitySign, "home creeps up")
		require.Equal(t, PhaseHoming, r.Phase)
		require.False(t, r.Done)
		require.False(t, r.Aborted)
	}

	r := p.Step(true, 0)
	require.Equal(t, 0, r.VelocitySign, "the stall stops the creep")
	require.Equal(t, PhaseDone, r.Phase)
	require.True(t, r.Done)
	require.Nil(t, r.Travel, "home yields no travel span")

	r = p.Step(false, 0)
	require.True(t, r.Done, "done is terminal")
	require.Equal(t, 0, r.VelocitySign)
}

func TestHome_AbortStopsWithoutAnchor(t *testing.T) {
	p := NewHome()
	require.Equal(t, 1, p.Step(false, 0).VelocitySign)
	p.Abort()

	r := p.Step(false, 0)
	require.Equal(t, 0, r.VelocitySign)
	require.Equal(t, PhaseAborted, r.Phase)
	require.True(t, r.Aborted)
	require.False(t, r.Done)
	require.Nil(t, r.Travel)
}

func TestCalibrate_DownStallThenUpStallYieldsTravel(t *testing.T) {
	p := NewCalibrate()

	r := p.Step(false, 0)
	require.Equal(t, -1, r.VelocitySign)
	require.Equal(t, PhaseRunDown, r.Phase)

	r = p.Step(false, 1200)
	require.Equal(t, -1, r.VelocitySign)
	require.Equal(t, PhaseRunDown, r.Phase)

	r = p.Step(true, 9600)
	require.Equal(t, 1, r.VelocitySign, "the bottom stop turns the run around")
	require.Equal(t, PhaseRunUp, r.Phase)
	require.False(t, r.Done)

	r = p.Step(false, 4000)
	require.Equal(t, 1, r.VelocitySign)
	require.Equal(t, PhaseRunUp, r.Phase)

	r = p.Step(true, 100)
	require.Equal(t, 0, r.VelocitySign)
	require.Equal(t, PhaseDone, r.Phase)
	require.True(t, r.Done)
	require.NotNil(t, r.Travel)
	require.Equal(t, int64(9500), *r.Travel)

	r = p.Step(false, 100)
	require.True(t, r.Done)
	require.NotNil(t, r.Travel)
	require.Equal(t, int64(9500), *r.Travel, "the result survives further steps")
}

func TestCalibrate_TravelIsASpanMagnitude(t *testing.T) {
	p := NewCalibrate()
	p.Step(false, 0)
	p.Step(true, -9600)
	r := p.Step(true, -100)
	require.True(t, r.Done)
	require.NotNil(t, r.Travel)
	require.Equal(t, int64(9500), *r.Travel)
}

func TestCalibrate_AbortMidRunDownYieldsNoTravel(t *testing.T) {
	p := NewCalibrate()
	require.Equal(t, -1, p.Step(false, 0).VelocitySign)
	p.Abort()

	r := p.Step(true, 9600)
	require.Equal(t, 0, r.VelocitySign)
	require.Equal(t, PhaseAborted, r.Phase)
	require.True(t, r.Aborted)
	require.False(t, r.Done)
	require.Nil(t, r.Travel)
}

func TestCalibrate_AbortMidRunUpYieldsNoTravel(t *testing.T) {
	p := NewCalibrate()
	p.Step(false, 0)
	require.Equal(t, PhaseRunUp, p.Step(true, 9600).Phase)
	p.Abort()

	r := p.Step(true, 0)
	require.Equal(t, PhaseAborted, r.Phase)
	require.True(t, r.Aborted)
	require.Nil(t, r.Travel)
}

func TestProc_AbortAfterDoneKeepsTheResult(t *testing.T) {
	p := NewCalibrate()
	p.Step(false, 0)
	p.Step(true, 9600)
	require.True(t, p.Step(true, 100).Done)

	p.Abort()
	r := p.Step(false, 100)
	require.True(t, r.Done)
	require.False(t, r.Aborted)
	require.NotNil(t, r.Travel)
	require.Equal(t, int64(9500), *r.Travel)
}

func TestHome_ImmediateStallCompletes(t *testing.T) {
	p := NewHome()
	r := p.Step(true, 0)
	require.True(t, r.Done)
	require.Equal(t, 0, r.VelocitySign)
}
