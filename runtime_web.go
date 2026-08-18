//go:build web

package main

import (
	"context"
	"errors"
)

func emitRuntime(context.Context, string, any) {}

func openImageDialog(context.Context) (string, error) {
	return "", errors.New("파일 선택은 웹 브라우저에서 사용하세요")
}

func openDirectoryDialog(context.Context, string) (string, error) {
	return "", errors.New("폴더 선택은 웹 브라우저에서 사용하세요")
}

func openBrowserURL(context.Context, string) {}
