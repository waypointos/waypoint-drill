// Package weight turns raw HX711 samples into the drill's sensor.state:
// tare/known-mass calibration, per-cell health, and SensorReadings rendering.
package weight

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/waypointos/waypoint-drill/internal/hx711"
	"github.com/waypointos/waypoint-drill/internal/store"
	waypointv1 "github.com/waypointos/waypoint/protocol/gen/go/messages"
)

const (
	NameCellAG   = "cell_a_g"
	NameCellBG   = "cell_b_g"
	NameCellCG   = "cell_c_g"
	NameTotalG   = "total_g"
	NameCellARaw = "cell_a_raw"
	NameCellBRaw = "cell_b_raw"
	NameCellCRaw = "cell_c_raw"
)

var (
	gramNames = [3]string{NameCellAG, NameCellBG, NameCellCG}
	rawNames  = [3]string{NameCellARaw, NameCellBRaw, NameCellCRaw}
)

const (
	defaultMissThreshold = 5
	defaultStaleAfter    = time.Second
)

type Options struct {
	// MissThreshold is how many consecutive missed reads latch a cell not-ok.
	MissThreshold int
	// StaleAfter bounds how long the last observation may age before all
	// cells report not-ok (covers a stalled read loop).
	StaleAfter time.Duration
	Now        func() time.Time
}

type Weight struct {
	mu        sync.Mutex
	statePath string
	events    func(phase, detail string)
	opts      Options

	counts [3]int32
	good   [3]bool
	misses [3]int
	lastAt time.Time

	cal   store.WeightCal
	tared bool
}

func New(statePath string, events func(phase, detail string), opts Options) *Weight {
	if opts.MissThreshold == 0 {
		opts.MissThreshold = defaultMissThreshold
	}
	if opts.StaleAfter == 0 {
		opts.StaleAfter = defaultStaleAfter
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	w := &Weight{statePath: statePath, events: events, opts: opts}
	if cal, ok, err := store.LoadWeight(statePath); err == nil && ok {
		w.cal, w.tared = *cal, true
	}
	return w
}

// Observe folds one sample in. A missed read keeps the last good count until
// the miss threshold latches the cell not-ok; one good read recovers it.
func (w *Weight) Observe(s hx711.Sample) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastAt = w.opts.Now()
	for i := range s.OK {
		if s.OK[i] {
			w.counts[i] = s.Counts[i]
			w.good[i] = true
			w.misses[i] = 0
			continue
		}
		w.misses[i]++
		if w.misses[i] >= w.opts.MissThreshold {
			w.good[i] = false
		}
	}
}

// Tare captures the current counts as the zero. The existing scale survives
// so a plain re-zero keeps grams meaningful.
func (w *Weight) Tare() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.allGoodLocked() {
		return w.refuseLocked("tare", "a load cell is not reading")
	}
	w.cal.OffsetA, w.cal.OffsetB, w.cal.OffsetC = int64(w.counts[0]), int64(w.counts[1]), int64(w.counts[2])
	w.tared = true
	w.persistLocked("tared", "")
	return nil
}

// Calibrate derives the shared scale from a known mass resting on the plate.
// One centered mass cannot yield honest per-cell factors, so a single factor
// anchored to the summed delta serves all three cells.
func (w *Weight) Calibrate(massG float64) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.allGoodLocked() {
		return w.refuseLocked("calibrate", "a load cell is not reading")
	}
	if !w.tared {
		return w.refuseLocked("calibrate", "tare first, with the plate empty")
	}
	if massG <= 0 {
		return w.refuseLocked("calibrate", "mass must be positive grams")
	}
	sum := float64(int64(w.counts[0])-w.cal.OffsetA) +
		float64(int64(w.counts[1])-w.cal.OffsetB) +
		float64(int64(w.counts[2])-w.cal.OffsetC)
	if sum == 0 {
		return w.refuseLocked("calibrate", "no count change since tare")
	}
	w.cal.GramsPerCount = massG / sum
	w.persistLocked("calibrated", fmt.Sprintf("%.6g g/count", w.cal.GramsPerCount))
	return nil
}

// State renders SensorReadings; the SDK stamps and publishes it.
func (w *Weight) State() *waypointv1.SensorReadings {
	w.mu.Lock()
	defer w.mu.Unlock()
	stale := w.staleLocked()
	offsets := [3]int64{w.cal.OffsetA, w.cal.OffsetB, w.cal.OffsetC}
	scaled := w.tared && w.cal.GramsPerCount != 0

	// Reading order: three grams, total, three raws.
	out := &waypointv1.SensorReadings{}
	totalOK := !stale && scaled
	total := 0.0
	for i := 0; i < 3; i++ {
		ok := w.good[i] && !stale
		g := &waypointv1.SensorReading{Name: gramNames[i], Unit: "g", Ok: ok && scaled}
		if g.Ok {
			v := float64(int64(w.counts[i])-offsets[i]) * w.cal.GramsPerCount
			g.Value = &v
			total += v
		}
		totalOK = totalOK && ok
		out.Readings = append(out.Readings, g)
	}
	tr := &waypointv1.SensorReading{Name: NameTotalG, Unit: "g", Ok: totalOK}
	if totalOK {
		tr.Value = &total
	}
	out.Readings = append(out.Readings, tr)
	for i := 0; i < 3; i++ {
		ok := w.good[i] && !stale
		r := &waypointv1.SensorReading{Name: rawNames[i], Unit: "counts", Ok: ok}
		if ok {
			v := float64(w.counts[i])
			r.Value = &v
		}
		out.Readings = append(out.Readings, r)
	}
	return out
}

func (w *Weight) staleLocked() bool {
	return w.lastAt.IsZero() || w.opts.Now().Sub(w.lastAt) > w.opts.StaleAfter
}

func (w *Weight) allGoodLocked() bool {
	return !w.staleLocked() && w.good[0] && w.good[1] && w.good[2]
}

func (w *Weight) refuseLocked(what, why string) error {
	w.events("refused", what+": "+why)
	return errors.New(why)
}

func (w *Weight) persistLocked(phase, detail string) {
	if err := store.SaveWeight(w.statePath, w.cal); err != nil {
		w.events(phase, "save failed: "+err.Error())
		return
	}
	w.events(phase, detail)
}
