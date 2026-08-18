package main

import "embed"

// assets contains the frontend bundle for both Wails and web builds.
//
//go:embed all:frontend/dist
var assets embed.FS
