//go:build !web

package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func emitRuntime(ctx context.Context, event string, data any) {
	runtime.EventsEmit(ctx, event, data)
}

func openImageDialog(ctx context.Context) (string, error) {
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "베이스 이미지 선택",
		Filters: []runtime.FileFilter{
			{DisplayName: "이미지 (*.png;*.jpg;*.jpeg;*.webp)", Pattern: "*.png;*.jpg;*.jpeg;*.webp"},
		},
	})
}

func openDirectoryDialog(ctx context.Context, title string) (string, error) {
	return runtime.OpenDirectoryDialog(ctx, runtime.OpenDialogOptions{Title: title})
}

func openBrowserURL(ctx context.Context, target string) {
	runtime.BrowserOpenURL(ctx, target)
}
