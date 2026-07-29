// Package hx711 reads three HX711 load cell ADCs sharing one clock line.
// The port abstraction keeps the timing-critical logic testable off-target.
package hx711

import "time"

// Port is one shared SCK output plus the three DOUT inputs, read together.
type Port interface {
	SetClock(v int) error
	ReadData() ([3]int, error)
}

// Sample is one synchronized read of all three chips. A false OK means the
// chip was not ready, its frame failed validation, or the cycle was discarded.
type Sample struct {
	Counts [3]int32
	OK     [3]bool
}

type Options struct {
	// ReadyTimeout bounds the wait for DOUT-ready; the chips free-run at 10SPS.
	ReadyTimeout time.Duration
	// SettleAfterJitter is the pause before retrying a jitter-discarded cycle.
	// A >60us SCK-high may have latched a power-down; the chip needs one full
	// conversion after waking before its output is trustworthy.
	SettleAfterJitter time.Duration
	// MaxHigh is the jitter guard threshold on one SCK-high phase.
	MaxHigh time.Duration
	// Now returns monotonic elapsed time; injectable for tests.
	Now func() time.Duration
}

const (
	defaultReadyTimeout = 300 * time.Millisecond
	defaultSettle       = 500 * time.Millisecond
	defaultMaxHigh      = 50 * time.Microsecond
	pulsesPerFrame      = 25 // 24 data bits + 1 pulse selecting channel A gain 128
	readyPollEvery      = time.Millisecond
)

type Reader struct {
	p    Port
	opts Options
}

func NewReader(p Port, o Options) *Reader {
	if o.ReadyTimeout == 0 {
		o.ReadyTimeout = defaultReadyTimeout
	}
	if o.SettleAfterJitter == 0 {
		o.SettleAfterJitter = defaultSettle
	}
	if o.MaxHigh == 0 {
		o.MaxHigh = defaultMaxHigh
	}
	if o.Now == nil {
		base := time.Now()
		o.Now = func() time.Duration { return time.Since(base) }
	}
	return &Reader{p: p, opts: o}
}

// ReadCycle blocks until the chips are ready, clocks one frame out of all
// three, and validates each. One jitter-discarded attempt is retried after a
// settle; a second discard yields an all-false sample.
func (r *Reader) ReadCycle() Sample {
	if !r.waitReady() {
		return Sample{}
	}
	for attempt := 0; attempt < 2; attempt++ {
		raws, clean := r.clockFrame()
		if !clean {
			time.Sleep(r.opts.SettleAfterJitter)
			continue
		}
		var s Sample
		for i, raw := range raws {
			if !validRaw24(raw) {
				continue
			}
			s.Counts[i] = signExtend24(raw)
			s.OK[i] = true
		}
		return s
	}
	return Sample{}
}

// waitReady polls DOUT until all three chips are ready (low) or the timeout
// lapses. A partial ready set is never clocked: pulsing the shared SCK while a
// chip is mid-conversion corrupts its frame, so one unready board takes the
// whole cycle with it.
func (r *Reader) waitReady() bool {
	deadline := r.opts.Now() + r.opts.ReadyTimeout
	for {
		vals, err := r.p.ReadData()
		if err == nil && vals == [3]int{0, 0, 0} {
			return true
		}
		if r.opts.Now() >= deadline {
			return false
		}
		time.Sleep(readyPollEvery)
	}
}

// clockFrame shifts one 25-pulse frame out of all three chips, timing every
// SCK-high phase. clean is false when any high phase exceeded the guard.
func (r *Reader) clockFrame() (raws [3]uint32, clean bool) {
	clean = true
	for pulse := 0; pulse < pulsesPerFrame; pulse++ {
		if r.p.SetClock(1) != nil {
			return raws, false
		}
		// Bracket the high phase only: the surrounding SetClock ioctls are not
		// part of it, and counting them would trip the guard on their own.
		hi := r.opts.Now()
		vals, err := r.p.ReadData()
		high := r.opts.Now() - hi
		lowErr := r.p.SetClock(0)
		if high > r.opts.MaxHigh {
			clean = false
		}
		if err != nil || lowErr != nil {
			return raws, false
		}
		if pulse < 24 {
			for i, v := range vals {
				raws[i] = raws[i]<<1 | uint32(v&1)
			}
		}
	}
	return raws, clean
}

// signExtend24 interprets the 24-bit two's-complement frame.
func signExtend24(raw uint32) int32 {
	return int32(raw<<8) >> 8
}

// validRaw24 rejects stuck-line and saturated frames.
func validRaw24(raw uint32) bool {
	switch raw & 0xFFFFFF {
	case 0x000000, 0xFFFFFF, 0x7FFFFF, 0x800000:
		return false
	}
	return true
}
