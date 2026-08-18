package sprite

import (
	"strings"
	"testing"
)

func TestBuildPhotoCharacterPromptFraming(t *testing.T) {
	face := BuildPhotoCharacterPrompt("face", "", StylePresets["pixel"])
	if !strings.Contains(face, "ONLY the head and face") || !strings.Contains(face, "face-only") {
		t.Fatal("얼굴 프롬프트가 얼굴 전용 프레이밍을 고정하지 않음")
	}
	if !strings.Contains(face, "Do not show neck, shoulders") {
		t.Fatal("얼굴 프롬프트가 어깨/상반신을 금지하지 않음")
	}

	full := BuildPhotoCharacterPrompt("full", "red hat", StylePresets["pixel"])
	if !strings.Contains(full, "top of the head to the bottoms of both feet") {
		t.Fatal("전신 프롬프트가 머리부터 발끝까지 고정하지 않음")
	}
	if !strings.Contains(full, "red hat") {
		t.Fatal("사진 변환 프롬프트에 선택 설명이 포함되지 않음")
	}
}
