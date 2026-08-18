import { useState } from "react";
import { ImagePlus, Loader2, Maximize2, Sparkles, User } from "lucide-react";
import { PickImage, GenerateCharacter } from "../lib/backend";
import { CharacterDef, CELL_SIZES, STYLE_OPTIONS } from "../types";
import { useI18n } from "../i18n";
import { styleLabel } from "../i18n/catalog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

interface IProps {
  character: CharacterDef;
  cellSize: number;
  busy: boolean;
  onChange: (c: CharacterDef) => void;
  onCellSize: (n: number) => void;
  onError: (msg: string) => void;
  onPhotoGenerate: (mode: "face" | "full") => Promise<void>;
}

// 1단계: 캐릭터 입력 패널 (이미지 업로드 또는 AI 생성)
export default function CharacterPanel({ character, cellSize, busy, onChange, onCellSize, onError, onPhotoGenerate }: IProps) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<"upload" | "ai" | "photo">("upload");
  const [dragOver, setDragOver] = useState(false);
  const [genBusy, setGenBusy] = useState(false);

  const set = (patch: Partial<CharacterDef>) => onChange({ ...character, ...patch });

  const pickFile = async () => {
    try {
      const dataURL = await PickImage();
      if (dataURL) set({ image: dataURL, photoSource: dataURL });
    } catch (e) {
      onError(String(e));
    }
  };

  const readDropped = (file: File) => {
    if (!file.type.startsWith("image/")) {
      onError(t("err_image_only"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result);
      set({ image: dataURL, photoSource: dataURL });
    };
    reader.readAsDataURL(file);
  };

  const generateBase = async () => {
    if (!character.description.trim() || genBusy) return;
    setGenBusy(true);
    try {
      const dataURL = await GenerateCharacter({
        description: character.description,
        styleKey: character.styleKey,
        styleCustom: character.styleCustom,
      } as any);
      if (dataURL) set({ image: dataURL, photoSource: null });
    } catch (e) {
      onError(String(e));
    } finally {
      setGenBusy(false);
    }
  };

  const generatePhoto = async (kind: "face" | "full") => {
    if (!character.photoSource || genBusy || busy) return;
    setGenBusy(true);
    try {
      await onPhotoGenerate(kind);
    } catch (e) {
      onError(String(e));
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <>
      <div className="panel-head">
        <span className="step-badge">1</span>
        <span className="panel-title">{t("char_style")}</span>
      </div>

      <div className="panel-body">
      <Tabs value={mode} onValueChange={(v) => setMode(v as "upload" | "ai" | "photo")}>
        <TabsList>
          <TabsTrigger value="upload">{t("upload_image")}</TabsTrigger>
          <TabsTrigger value="ai">{t("ai_generate")}</TabsTrigger>
          <TabsTrigger value="photo">{t("photo_convert")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div
        className={`dropzone checker ${dragOver ? "over" : ""}`}
        onClick={pickFile}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) readDropped(f);
        }}
      >
        {character.image ? (
          <>
            <img src={character.image} alt={t("base_char_alt")} className="pixelated" />
            <Button
              variant="outline"
              size="sm"
              className="dz-replace"
              onClick={(e) => {
                e.stopPropagation();
                pickFile();
              }}
            >
              {t("replace")}
            </Button>
          </>
        ) : (
          <>
            <ImagePlus size={28} className="text-muted-foreground mb-2" />
            <div className="dz-text">
              {t("dropzone_line1")}
              <br />
              {t("dropzone_line2")}
            </div>
          </>
        )}
      </div>

      {mode === "photo" && (
        <>
          <div className="photo-actions">
            <Button
              variant="outline"
              className="photo-action"
              onClick={() => generatePhoto("face")}
              disabled={!character.photoSource || genBusy || busy}
            >
              {genBusy ? <Loader2 size={13} className="animate-spin" /> : <User size={13} />}
              {t("photo_face")}
            </Button>
            <Button
              className="photo-action"
              onClick={() => generatePhoto("full")}
              disabled={!character.photoSource || genBusy || busy}
            >
              {genBusy ? <Loader2 size={13} className="animate-spin" /> : <Maximize2 size={13} />}
              {t("photo_full")}
            </Button>
          </div>
          <p className="hint">{t("photo_save_hint")}</p>
        </>
      )}

      <div className="field">
        <Label>{t("char_name")}</Label>
        <Input
          type="text"
          placeholder={t("char_name_ph")}
          value={character.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="field">
        <Label>{t("char_desc")} {mode === "ai" ? t("char_desc_gen") : t("char_desc_opt")}</Label>
        <Textarea
          placeholder={t("char_desc_ph")}
          value={character.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>

      {mode === "ai" && (
        <Button onClick={generateBase} disabled={genBusy || busy || !character.description.trim()}>
          {genBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {genBusy ? t("generating_char") : t("generate_base")}
        </Button>
      )}

      <div className="sub-title">{t("style")}</div>

      <div className="field">
        <Label>{t("art_style")}</Label>
        <Select value={character.styleKey} onValueChange={(v) => set({ styleKey: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STYLE_OPTIONS.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {styleLabel(o.key, lang, o.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {character.styleKey === "custom" && (
        <div className="field">
          <Label>{t("custom_style_label")}</Label>
          <Textarea
            placeholder={t("custom_style_ph")}
            value={character.styleCustom}
            onChange={(e) => set({ styleCustom: e.target.value })}
          />
        </div>
      )}

      <div className="field">
        <Label>{t("cell_size")}</Label>
        <Select value={String(cellSize)} onValueChange={(v) => onCellSize(Number(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CELL_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} × {n} px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="hint">{t("char_hint")}</p>
      </div>
    </>
  );
}
