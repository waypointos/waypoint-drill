//go:build !linux

package hx711

import "errors"

func ElevateFIFO() error {
	return errors.New("hx711: SCHED_FIFO unavailable on this platform")
}
