package lift

// Procedure phases, shared with the calibration event leaf.
const (
	PhaseIdle    = "idle"
	PhaseHoming  = "homing"
	PhaseRunDown = "run_down"
	PhaseRunUp   = "run_up"
	PhaseDone    = "done"
	PhaseAborted = "aborted"
	PhaseFailed  = "failed"
)

// Proc is a pure step machine for the powered procedures. It owns no bus and no
// clock: Step consumes stall evidence and returns the direction the control loop
// should drive until the next read.
type Proc struct {
	phase  string
	bottom int64
	travel *int64
}

// NewHome creeps up until the top hard stop stalls the servo.
func NewHome() *Proc { return &Proc{phase: PhaseHoming} }

// NewCalibrate creeps down to the bottom stop, then back up to the top stop, and
// reports the travel span between them.
func NewCalibrate() *Proc { return &Proc{phase: PhaseRunDown} }

// ProcResult is one step's instruction plus the procedure's public phase.
// VelocitySign is +1 for up, -1 for down and 0 for hold; the control layer scales
// it by the creep speed and the configured up sign.
type ProcResult struct {
	VelocitySign int
	Phase        string
	Done         bool
	Aborted      bool
	Travel       *int64
}

// Step advances the procedure. Each leg needs its own run of stall evidence, so
// the caller resets its stall detector whenever the returned phase changes.
func (p *Proc) Step(stalled bool, heightTicks int64) ProcResult {
	switch p.phase {
	case PhaseHoming:
		if !stalled {
			return ProcResult{VelocitySign: 1, Phase: PhaseHoming}
		}
		p.phase = PhaseDone
	case PhaseRunDown:
		if !stalled {
			return ProcResult{VelocitySign: -1, Phase: PhaseRunDown}
		}
		p.bottom = heightTicks
		p.phase = PhaseRunUp
		return ProcResult{VelocitySign: 1, Phase: PhaseRunUp}
	case PhaseRunUp:
		if !stalled {
			return ProcResult{VelocitySign: 1, Phase: PhaseRunUp}
		}
		span := absInt64(p.bottom - heightTicks)
		p.travel = &span
		p.phase = PhaseDone
	}
	return p.terminal()
}

// Abort ends a running procedure; a finished one keeps its result.
func (p *Proc) Abort() {
	if p.phase == PhaseDone {
		return
	}
	p.phase = PhaseAborted
	p.travel = nil
}

func (p *Proc) terminal() ProcResult {
	if p.phase == PhaseAborted {
		return ProcResult{Phase: PhaseAborted, Aborted: true}
	}
	return ProcResult{Phase: PhaseDone, Done: true, Travel: p.travel}
}
