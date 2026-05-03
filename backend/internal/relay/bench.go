package relay

import (
	_ "embed"
	"net/http"
)

//go:embed bench.html
var benchHTML []byte

//go:embed pentest.html
var pentestHTML []byte

func BenchHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(benchHTML)
	}
}

func PentestHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(pentestHTML)
	}
}
