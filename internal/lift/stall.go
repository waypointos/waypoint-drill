package lift

// StallDetector declares a stall only when the axis is loaded AND not turning
// AND not advancing, for a sustained run of reads. A load spike alone, which a
// direction change or a chunk of debris produces, never qualifies.
type StallDetector struct {
	load     int32
	sustain  int
	speedEps int32
	deltaEps int64
	count    int
}

// NewStallDetector builds a detector from the configured thresholds: abs load at
// or above load, abs speed at or below speedEps, abs tick delta at or below
// deltaEps, for sustain consecutive reads.
func NewStallDetector(load int32, sustain int, speedEps int32, deltaEps int64) *StallDetector {
	if sustain < 1 {
		sustain = 1
	}
	return &StallDetector{load: load, sustain: sustain, speedEps: speedEps, deltaEps: deltaEps}
}

// Observe folds one read in and reports whether the sustained-stall threshold is
// met. A failed read is not stall evidence and clears the run.
func (d *StallDetector) Observe(o Obs, deltaTicks int64) bool {
	if !o.OK || absInt32(o.LoadRaw) < d.load || absInt32(o.SpeedRaw) > d.speedEps || absInt64(deltaTicks) > d.deltaEps {
		d.count = 0
		return false
	}
	if d.count < d.sustain {
		d.count++
	}
	return d.count >= d.sustain
}

// Reset clears the run so a new leg of a procedure starts from no evidence.
func (d *StallDetector) Reset() { d.count = 0 }

func absInt32(v int32) int32 {
	if v < 0 {
		return -v
	}
	return v
}

func absInt64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
