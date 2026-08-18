import { useState } from "react";
import { Compass, FlipHorizontal2, Loader2, Plus, Sparkles, X, Zap } from "lucide-react";
import { DirectionInfo, PresetInfo, StateDef, presetInfoToState, selectedFrames } from "../types";
import { useI18n } from "../i18n";
import { composeStateLabel, directionName } from "../i18n/catalog";
import PresetPicker from "./PresetPicker";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface IProps {
  states: StateDef[];
  directions: DirectionInfo[];
  presets: PresetInfo[];
  selectedId: string | null;
  canGenerate: boolean;
  hasImage: boolean;
  busy: boolean;
  onStates: (s: StateDef[]) => void;
  onSelect: (id: string) => void;
  onGenerate: (id: string) => void;
  onGenerateAll: () => void;
  onAddCustomBatch: (count: number) => void;
  onGenerateDirectionSet: (id: string) => void;
}

// 3단계: 애니메이션 상태 구성 패널
export default function StatesPanel({
  states,
  directions,
  presets,
  selectedId,
  canGenerate,
  hasImage,
  busy,
  onStates,
  onSelect,
  onGenerate,
  onGenerateAll,
  onAddCustomBatch,
  onGenerateDirectionSet,
}: IProps) {
  const { t, lang } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customCount, setCustomCount] = useState(1);

  const addPresetInfo = (p: PresetInfo) => {
    const st = presetInfoToState(p);
    onStates([...states, st]);
    onSelect(st.id);
  };

  const addCustom = () => {
    onAddCustomBatch(Math.max(1, Math.min(10, customCount)));
  };

  const update = (id: string, patch: Partial<StateDef>) => {
    onStates(states.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const remove = (id: string) => {
    onStates(states.filter((s) => s.id !== id));
  };

  const usedNames = new Set(states.map((s) => s.name));
  const pendingCount = states.filter((s) => s.status !== "done").length;
  const pendingAI = states.filter((s) => s.status !== "done" && !s.mirrorOf).length;
  // 미생성에 AI 상태가 있으면 API 키 필요, 미러 상태만 남았으면 즉시 가능
  const canGenerateAll = pendingAI > 0 ? canGenerate : hasImage;
  // 방향 선택지: AI로 생성 가능한 5방향만 (미러 방향은 8방향 세트로만 생성)
  const aiDirections = directions.filter((d) => !d.mirrorOf);

  return (
    <>
      <div className="panel-head">
        <span className="step-badge">2</span>
        <span className="panel-title">{t("animation")}</span>
        {states.length > 0 && <span className="hint">{t("items_count", { n: states.length })}</span>}
      </div>

      <div className="panel-body">
      <div className="preset-chips">
        <Button size="sm" variant="default" className="add-anim-btn" onClick={() => setPickerOpen(true)}>
          <Plus size={13} /> {t("add_animation")}
        </Button>
        <button className="chip" onClick={addCustom} disabled={busy}>
          + {customCount > 1 ? t("custom_n", { n: customCount }) : t("custom")}
        </button>
        <div className="custom-batch">
          <label>{t("count_label")}</label>
          <Input
            type="number"
            className="h-7"
            min={1}
            max={10}
            disabled={busy}
            value={customCount}
            onChange={(e) => setCustomCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            title={t("custom_count_tip")}
          />
        </div>
      </div>

      {states.length === 0 && (
        <p className="hint">{t("states_empty_hint", { n: presets.length || 100 })}</p>
      )}

      {pickerOpen && (
        <PresetPicker
          presets={presets}
          usedNames={usedNames}
          onAdd={addPresetInfo}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div className="state-list">
        {states.map((s) => {
          const sel = selectedFrames(s).length;
          const isStatic = s.kind === "static";
          return (
            <div
              key={s.id}
              className={`state-card ${selectedId === s.id ? "active" : ""}`}
              onClick={() => onSelect(s.id)}
            >
              <div className="state-card-head">
                <span className={`status-dot ${s.status}`} />
                <span className="state-name">{composeStateLabel(s, lang, t("custom"))}</span>
                <span className="state-sub">{s.name}</span>
                {s.facing && (
                  <span
                    className="state-sub"
                    title={s.mirrorOf ? t("mirror_of_tip", { dir: directionName(s.mirrorOf, lang) }) : t("facing_tip", { dir: directionName(s.facing, lang) })}
                  >
                    {s.mirrorOf ? (
                      <FlipHorizontal2 size={9} style={{ display: "inline" }} />
                    ) : (
                      <Compass size={9} style={{ display: "inline" }} />
                    )}{" "}
                    {directionName(s.facing, lang)}
                  </span>
                )}
                <span className="spacer" />
                {s.status === "done" && <span className="state-sub">{t("n_frames", { n: sel })}</span>}
                <Button
                  variant="destructive-ghost"
                  size="icon-sm"
                  title={s.status === "generating" ? t("del_disabled") : t("delete")}
                  disabled={s.status === "generating"}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(s.id);
                  }}
                >
                  <X size={11} />
                </Button>
              </div>

              {selectedId === s.id && (
                <>
                  {!isStatic && <>
                  <div className="state-card-controls" onClick={(e) => e.stopPropagation()}>
                    <div className="mini-field">
                      <label>{t("frames_count")}</label>
                      <Input
                        type="number"
                        className="h-7"
                        min={1}
                        max={10}
                        value={s.frames}
                        onChange={(e) => update(s.id, { frames: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                      />
                    </div>
                    <div className="mini-field">
                      <label>FPS</label>
                      <Input
                        type="number"
                        className="h-7"
                        min={1}
                        max={30}
                        value={s.fps}
                        onChange={(e) => update(s.id, { fps: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                      />
                    </div>
                    <div className="mini-field">
                      <label>{t("loop_label")}</label>
                      <Select value={s.loop ? "1" : "0"} onValueChange={(v) => update(s.id, { loop: v === "1" })}>
                        <SelectTrigger className="h-7">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">{t("loop")}</SelectItem>
                          <SelectItem value="0">{t("once")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {!s.mirrorOf && (
                    <div className="mini-field" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                      <label>{t("action_label")}</label>
                      <Input
                        type="text"
                        className="h-7"
                        placeholder={t("action_ph")}
                        value={s.action}
                        onChange={(e) => update(s.id, { action: e.target.value })}
                      />
                    </div>
                  )}
                  {!s.dirBase && (
                    <div className="mini-field" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                      <label>{t("facing_label")}</label>
                      <Select
                        value={s.facing ?? "none"}
                        onValueChange={(v) => update(s.id, { facing: v === "none" ? undefined : v })}
                      >
                        <SelectTrigger className="h-7">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("facing_none")}</SelectItem>
                          {aiDirections.map((d) => (
                            <SelectItem key={d.key} value={d.key}>
                              {directionName(d.key, lang, d.label)} ({d.short})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={(!s.mirrorOf && !canGenerate) || busy}
                      onClick={() => onGenerate(s.id)}
                    >
                      {s.status === "generating" ? (
                        <>
                          <Loader2 size={12} className="animate-spin" /> {t("generating")}
                        </>
                      ) : s.status === "done" ? (
                        t("regenerate")
                      ) : (
                        <>
                          <Sparkles size={12} /> {t("generate")}
                        </>
                      )}
                    </Button>
                    {!s.mirrorOf && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canGenerate || busy}
                        title={t("dir8_tip")}
                        onClick={() => onGenerateDirectionSet(s.id)}
                      >
                        <Compass size={12} /> {t("dir8")}
                      </Button>
                    )}
                  </div>
                  </>}
                  {isStatic && <p className="hint" style={{ marginTop: 8 }}>{t("photo_static_hint")}</p>}
                </>
              )}

              {s.status === "done" && s.items.length > 0 && (
                <div className="state-thumbs checker">
                  {s.items.slice(0, 8).map((f) => (
                    <img key={f.id} src={f.png} className="pixelated" alt="" style={{ opacity: f.selected ? 1 : 0.3 }} />
                  ))}
                </div>
              )}

              {s.status === "error" && s.error && <div className="state-error">{s.error}</div>}
              {s.warnings.map((w, i) => (
                <div key={i} className="state-warn">
                  {w}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      </div>

      {states.length > 0 && (
        <div className="panel-foot">
          <Button className="w-full" disabled={!canGenerateAll || busy || pendingCount === 0} onClick={onGenerateAll}>
            {busy ? (
              <>
                <Loader2 size={13} className="animate-spin" /> {t("generating_progress")}
              </>
            ) : (
              <>
                <Zap size={13} /> {t("generate_all_pending", { n: pendingCount })}
              </>
            )}
          </Button>
        </div>
      )}
    </>
  );
}
