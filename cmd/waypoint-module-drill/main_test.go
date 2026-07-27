package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestResolveConfigPath(t *testing.T) {
	t.Run("flag wins over env", func(t *testing.T) {
		assert.Equal(t, "/flag/config.toml",
			resolveConfigPath("/flag/config.toml", "/env/config.toml"))
	})

	t.Run("env used when flag absent", func(t *testing.T) {
		assert.Equal(t, "/env/config.toml", resolveConfigPath("", "/env/config.toml"))
	})

	t.Run("both empty means defaults", func(t *testing.T) {
		assert.Equal(t, "", resolveConfigPath("", ""))
	})
}

func TestResolveCredsEnv(t *testing.T) {
	t.Run("flag passed through when env unset", func(t *testing.T) {
		assert.Equal(t, "/run/waypoint/modules/drill/creds.env",
			resolveCredsEnv("/run/waypoint/modules/drill/creds.env", ""))
	})

	t.Run("existing env left alone", func(t *testing.T) {
		assert.Equal(t, "", resolveCredsEnv("/flag/creds.env", "/env/creds.env"))
	})

	t.Run("no flag leaves env alone", func(t *testing.T) {
		assert.Equal(t, "", resolveCredsEnv("", ""))
		assert.Equal(t, "", resolveCredsEnv("", "/env/creds.env"))
	})
}
