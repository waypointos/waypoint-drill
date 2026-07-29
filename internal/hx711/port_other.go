//go:build !linux

package hx711

import "errors"

const ChipLabel = "pinctrl-rp1"

// OpenPort exists off-Linux so dev builds compile; there is no GPIO to open.
func OpenPort(chipLabel string, sck, dA, dB, dC int) (Port, func() error, error) {
	return nil, nil, errors.New("hx711: gpio unavailable on this platform")
}
