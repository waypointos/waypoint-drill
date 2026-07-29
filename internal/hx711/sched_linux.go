//go:build linux

package hx711

import "golang.org/x/sys/unix"

// ElevateFIFO raises the calling thread to SCHED_FIFO so the 25-pulse frame
// is not preempted mid-clock. The caller must hold runtime.LockOSThread.
// Requires CAP_SYS_NICE; failure is reported, not fatal.
func ElevateFIFO() error {
	attr := unix.SchedAttr{
		Size:     unix.SizeofSchedAttr,
		Policy:   unix.SCHED_FIFO,
		Priority: 10,
	}
	return unix.SchedSetAttr(0, &attr, 0)
}
