//go:build linux

package hx711

import (
	"fmt"

	gpiocdev "github.com/warthog618/go-gpiocdev"
)

// ChipLabel identifies the Pi 5 header GPIO controller. The /dev/gpiochipN
// index has moved between kernel versions, so discovery goes by label.
const ChipLabel = "pinctrl-rp1"

type linuxPort struct {
	sck  *gpiocdev.Line
	dout *gpiocdev.Lines
}

func (p *linuxPort) SetClock(v int) error { return p.sck.SetValue(v) }

func (p *linuxPort) ReadData() ([3]int, error) {
	vals := make([]int, 3)
	if err := p.dout.Values(vals); err != nil {
		return [3]int{}, err
	}
	return [3]int{vals[0], vals[1], vals[2]}, nil
}

// OpenPort finds the GPIO chip by label and requests the four lines.
func OpenPort(chipLabel string, sck, dA, dB, dC int) (Port, func() error, error) {
	name, err := findChip(chipLabel)
	if err != nil {
		return nil, nil, err
	}
	sckLine, err := gpiocdev.RequestLine(name, sck,
		gpiocdev.AsOutput(0), gpiocdev.WithConsumer("waypoint-drill-hx711"))
	if err != nil {
		return nil, nil, fmt.Errorf("request sck gpio %d: %w", sck, err)
	}
	// Pull the data lines up: a missing or unpowered board then reads high, which
	// is "never ready", instead of floating and clocking out a fabricated frame.
	doutLines, err := gpiocdev.RequestLines(name, []int{dA, dB, dC},
		gpiocdev.AsInput, gpiocdev.WithPullUp, gpiocdev.WithConsumer("waypoint-drill-hx711"))
	if err != nil {
		_ = sckLine.Close()
		return nil, nil, fmt.Errorf("request dout gpios %d/%d/%d: %w", dA, dB, dC, err)
	}
	p := &linuxPort{sck: sckLine, dout: doutLines}
	closer := func() error {
		errA := doutLines.Close()
		errB := sckLine.Close()
		if errA != nil {
			return errA
		}
		return errB
	}
	return p, closer, nil
}

func findChip(label string) (string, error) {
	for _, name := range gpiocdev.Chips() {
		c, err := gpiocdev.NewChip(name)
		if err != nil {
			continue
		}
		l := c.Label
		_ = c.Close()
		if l == label {
			return name, nil
		}
	}
	return "", fmt.Errorf("no gpio chip labeled %q", label)
}
