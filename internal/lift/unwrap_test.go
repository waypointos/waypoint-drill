package lift

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUnwrapper_FirstUpdateSeedsAtZero(t *testing.T) {
	var u Unwrapper
	require.Equal(t, int64(0), u.Update(3000))
	require.Equal(t, int64(5), u.Update(3005))
}

func TestUnwrapper_ForwardAcrossSeam(t *testing.T) {
	var u Unwrapper
	u.Update(4090)
	require.Equal(t, int64(0), u.Update(4090)) // a repeated tick moves nothing
	require.Equal(t, int64(11), u.Update(5))
	require.Equal(t, int64(21), u.Update(15))
}

func TestUnwrapper_BackwardAcrossSeam(t *testing.T) {
	var u Unwrapper
	u.Update(5)
	require.Equal(t, int64(-11), u.Update(4090))
	require.Equal(t, int64(-21), u.Update(4080))
}

func TestUnwrapper_CumulativeOverManyRevolutions(t *testing.T) {
	var u Unwrapper
	pos := 0
	last := u.Update(uint16(pos))
	for i := 0; i < 40; i++ { // 40 x 300 ticks = 12000, just under three revolutions
		pos = (pos + 300) % TicksPerRev
		last = u.Update(uint16(pos))
	}
	require.Equal(t, int64(12000), last)

	for i := 0; i < 40; i++ {
		pos = (pos - 300 + TicksPerRev) % TicksPerRev
		last = u.Update(uint16(pos))
	}
	require.Equal(t, int64(0), last)
}

func TestUnwrapper_QuarterRevolutionPerReadStillTracked(t *testing.T) {
	const quarter = TicksPerRev / 4
	for _, dir := range []int{1, -1} {
		var u Unwrapper
		pos := 0
		last := u.Update(uint16(pos))
		for i := 0; i < 8; i++ {
			pos = (pos + dir*quarter + TicksPerRev) % TicksPerRev
			last = u.Update(uint16(pos))
		}
		require.Equal(t, int64(dir*8*quarter), last)
	}
}

// Motion beyond half a revolution between reads aliases to the short way round.
// This is the documented failure mode the commanded speed cap prevents.
func TestUnwrapper_BeyondHalfRevolutionAliases(t *testing.T) {
	var u Unwrapper
	u.Update(0)
	require.Equal(t, int64(-1596), u.Update(2500))
}
