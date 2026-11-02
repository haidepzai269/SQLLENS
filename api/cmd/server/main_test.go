package main

import "testing"

func TestPort(t *testing.T) {
	for in, want := range map[string]string{"": "8080", "18080": "18080"} {
		t.Setenv("PORT", in)
		if got, err := port(); err != nil || got != want {
			t.Errorf("%q: %q %v", in, got, err)
		}
	}
	for _, in := range []string{"abc", "0", "70000", "-1", "80 ", "+80", "080"} {
		t.Setenv("PORT", in)
		if _, err := port(); err == nil {
			t.Errorf("%q should fail", in)
		}
	}
}
