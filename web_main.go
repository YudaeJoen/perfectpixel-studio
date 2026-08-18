//go:build web

package main

import (
	"fmt"
	"os"
)

func main() {
	if err := runWebServer(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
