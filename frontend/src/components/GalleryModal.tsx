import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FolderOpen, Images, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import {
  DeleteGalleryImage,
  GetGalleryPath,
  ListFolderImages,
  ListGalleryImages,
  LoadImageFull,
  LoadImageThumb,
  PickFolder,
  RevealInFinder,
} from "../lib/backend";
import { isWebRuntime } from "../lib/backend";
import { useI18n } from "../i18n";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export interface IGalleryImage {
  name: string;
  path: string;
  size: number;
  modTime: number; // Unix 밀리초
}

interface IProps {
  onClose: () => void;
  onError: (msg: string) => void;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// 썸네일 캐시 (경로+수정시각 기준, 모달 재오픈 시 재사용)
const thumbCache = new Map<string, string>();

// 화면에 보일 때만 썸네일을 로드하는 그리드 셀
function Thumb({ item, onClick }: { item: IGalleryImage; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const cacheKey = `${item.path}|${item.modTime}`;
  const [src, setSrc] = useState(() => thumbCache.get(cacheKey) ?? "");

  useEffect(() => {
    if (src || !ref.current) return;
    let alive = true;
    const io = new IntersectionObserver(
      (ents) => {
        if (!ents.some((e) => e.isIntersecting)) return;
        io.disconnect();
        LoadImageThumb(item.path, 220)
          .then((url: string) => {
            if (!url) return;
            thumbCache.set(cacheKey, url);
            if (alive) setSrc(url);
          })
          .catch(() => {});
      },
      { rootMargin: "300px" }
    );
    io.observe(ref.current);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [cacheKey]);

  return (
    <button ref={ref} className="gal-cell checker" onClick={onClick} title={`${item.name} · ${formatSize(item.size)}`}>
      {src ? <img src={src} alt={item.name} className="pixelated" /> : <span className="gal-skel" />}
      <span className="gal-name">{item.name}</span>
    </button>
  );
}

// 갤러리 모달: 생성 이미지 갤러리 + 내 컴퓨터 이미지 뷰어
export default function GalleryModal({ onClose, onError }: IProps) {
  const { t } = useI18n();
  const webRuntime = isWebRuntime();
  const [tab, setTab] = useState<"gallery" | "local">("gallery");
  const [galleryItems, setGalleryItems] = useState<IGalleryImage[]>([]);
  const [localItems, setLocalItems] = useState<IGalleryImage[]>([]);
  const [galleryPath, setGalleryPath] = useState("");
  const [localDir, setLocalDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [viewSrc, setViewSrc] = useState("");

  const items = tab === "gallery" ? galleryItems : localItems;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const refreshGallery = async () => {
    setLoading(true);
    try {
      setGalleryItems(((await ListGalleryImages()) ?? []) as IGalleryImage[]);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadLocal = async (dir: string) => {
    setLoading(true);
    try {
      setLocalItems(((await ListFolderImages(dir)) ?? []) as IGalleryImage[]);
    } catch (e) {
      onError(String(e));
      setLocalItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    GetGalleryPath().then(setGalleryPath).catch(() => {});
    refreshGallery();
  }, []);

  const switchTab = (v: string) => {
    setTab(v as "gallery" | "local");
    setViewIdx(null);
    setLoading(false);
    if (v === "gallery") refreshGallery();
    else if (localDir) loadLocal(localDir);
  };

  const pickLocalDir = async () => {
    try {
      const dir = await PickFolder();
      if (!dir) return;
      setLocalDir(dir);
      setViewIdx(null);
      await loadLocal(dir);
    } catch (e) {
      onError(String(e));
    }
  };

  // 확대 뷰: 선택된 이미지의 원본 로드
  useEffect(() => {
    if (viewIdx == null) {
      setViewSrc("");
      return;
    }
    const it = items[viewIdx];
    if (!it) return;
    let alive = true;
    setViewSrc("");
    LoadImageFull(it.path)
      .then((url: string) => {
        if (alive) setViewSrc(url);
      })
      .catch((e) => onError(String(e)));
    return () => {
      alive = false;
    };
  }, [viewIdx, items]);

  // 뷰어 키보드 내비게이션 (←/→, Esc는 Dialog에서 처리)
  useEffect(() => {
    if (viewIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewIdx]);

  const move = (d: number) => {
    const n = itemsRef.current.length;
    if (n === 0) return;
    setViewIdx((i) => (i == null ? null : (i + d + n) % n));
  };

  const deleteCurrent = async () => {
    if (viewIdx == null || tab !== "gallery") return;
    const it = galleryItems[viewIdx];
    if (!it || !window.confirm(t("gal_delete_confirm", { name: it.name }))) return;
    try {
      await DeleteGalleryImage(it.path);
      const next = galleryItems.filter((_, i) => i !== viewIdx);
      setGalleryItems(next);
      setViewIdx(next.length === 0 ? null : Math.min(viewIdx, next.length - 1));
    } catch (e) {
      onError(String(e));
    }
  };

  const current = viewIdx != null ? items[viewIdx] : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="h-[80vh] w-[900px] max-w-[94vw] gap-3 p-5"
        onEscapeKeyDown={(e) => {
          if (viewIdx != null) {
            e.preventDefault();
            setViewIdx(null);
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-3 pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Images size={14} /> {t("gallery")}
          </DialogTitle>
          <Tabs value={tab} onValueChange={switchTab}>
            <TabsList>
              <TabsTrigger value="gallery">{t("gen_gallery")}</TabsTrigger>
              <TabsTrigger value="local">{t("my_computer")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-1.5">
            {tab === "gallery" ? (
              <>
                <Button variant="ghost" size="sm" onClick={refreshGallery} title={t("refresh")}>
                  <RefreshCw size={12} />
                </Button>
                {!webRuntime && (
                  <Button variant="outline" size="sm" disabled={!galleryPath} onClick={() => RevealInFinder(galleryPath)}>
                    <FolderOpen size={12} /> {t("open_folder")}
                  </Button>
                )}
              </>
            ) : (
              <>
                {localDir && (
                  <Button variant="ghost" size="sm" onClick={() => loadLocal(localDir)} title={t("refresh")}>
                    <RefreshCw size={12} />
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={pickLocalDir}>
                  <FolderOpen size={12} /> {t("pick_folder")}
                </Button>
              </>
            )}
          </div>
        </div>

        {tab === "local" && localDir && (
          <div className="truncate text-[11px] text-muted-foreground" title={localDir}>
            {t("folder_images", { dir: localDir, n: localItems.length })}
          </div>
        )}

        {loading ? (
          <div className="gal-empty">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="gal-empty">
            {tab === "gallery" ? (
              <p>
                {t("gal_empty1")}
                <br />
                {t("gal_empty2")}
              </p>
            ) : localDir ? (
              <p>{t("gal_no_images")}</p>
            ) : (
              <>
                <p>{t("gal_pick_hint")}</p>
                <Button size="sm" onClick={pickLocalDir}>
                  <FolderOpen size={13} /> {t("pick_folder")}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="gal-grid">
            {items.map((it, i) => (
              <Thumb key={`${it.path}|${it.modTime}`} item={it} onClick={() => setViewIdx(i)} />
            ))}
          </div>
        )}

        {current && (
          <div className="gal-viewer" onClick={() => setViewIdx(null)}>
            <div className="gal-viewer-head" onClick={(e) => e.stopPropagation()}>
              <span className="gal-viewer-title" title={current.path}>
                {current.name}
              </span>
              <span className="gal-viewer-meta">
                {viewIdx! + 1} / {items.length} · {formatSize(current.size)}
              </span>
              {tab === "gallery" && (
                <Button variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={deleteCurrent} title={t("delete")}>
                  <Trash2 size={13} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => setViewIdx(null)}
                title={t("close_esc")}
              >
                <X size={14} />
              </Button>
            </div>
            <div className="gal-viewer-stage" onClick={(e) => e.stopPropagation()}>
              {items.length > 1 && (
                <button className="gal-nav" onClick={() => move(-1)} title={t("prev")} aria-label={t("prev_img")}>
                  <ChevronLeft size={22} />
                </button>
              )}
              <div className="gal-viewer-img checker" onClick={() => setViewIdx(null)}>
                {viewSrc ? (
                  <img src={viewSrc} alt={current.name} className="pixelated" onClick={(e) => e.stopPropagation()} />
                ) : (
                  <Loader2 size={24} className="animate-spin text-white/70" />
                )}
              </div>
              {items.length > 1 && (
                <button className="gal-nav" onClick={() => move(1)} title={t("next")} aria-label={t("next_img")}>
                  <ChevronRight size={22} />
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
