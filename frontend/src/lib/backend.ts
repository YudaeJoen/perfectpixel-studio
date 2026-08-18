import * as WailsApp from "../../wailsjs/go/main/App";
import { EventsOn as WailsEventsOn } from "../../wailsjs/runtime/runtime";

const web = typeof window !== "undefined" && !(window as any).go;
const localFiles = new Map<string, IGalleryImage[]>();

export interface IGalleryImage {
  name: string;
  path: string;
  size: number;
  modTime: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function json<T>(value: T): RequestInit {
  return { method: "POST", body: JSON.stringify(value) };
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽을 수 없습니다"));
    reader.readAsDataURL(file);
  });
}

function pickBrowserFile(directory = false): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    let settled = false;
    let focusTimer: number | undefined;
    const finish = (files: FileList | null) => {
      if (settled) return;
      settled = true;
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
      resolve(files);
      input.remove();
      window.removeEventListener("focus", onFocus);
    };
    const onFocus = () => {
      focusTimer = window.setTimeout(() => finish(null), 250);
    };
    input.type = "file";
    input.accept = directory ? "image/*" : "image/png,image/jpeg,image/webp,image/gif";
    if (directory) input.setAttribute("webkitdirectory", "");
    input.onchange = () => finish(input.files);
    (input as any).oncancel = () => finish(null);
    window.addEventListener("focus", onFocus, { once: true });
    input.click();
  });
}

export function isWebRuntime() {
  return web;
}

export async function CancelGeneration(): Promise<void> {
  if (!web) return WailsApp.CancelGeneration();
  await request("/api/generation/cancel", { method: "POST" });
}

export async function ClearSession(): Promise<void> {
  if (!web) return WailsApp.ClearSession();
  await request("/api/session", { method: "DELETE" });
}

export async function DeleteGalleryImage(path: string): Promise<void> {
  if (!web) return WailsApp.DeleteGalleryImage(path);
  await request(path, { method: "DELETE", headers: {} });
}

export async function ExportProject(args: any): Promise<string> {
  if (!web) return WailsApp.ExportProject(args);
  const response = await fetch("/api/export", {
    ...json(args),
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(await errorText(response));
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${args.character || "character"}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  return "다운로드 폴더";
}

export async function GenerateCharacter(args: any): Promise<string> {
  if (!web) return WailsApp.GenerateCharacter(args);
  return request<string>("/api/character/generate", json(args));
}

export async function GenerateState(args: any): Promise<any> {
  if (!web) return WailsApp.GenerateState(args);
  return request("/api/state/generate", json(args));
}

export async function GetGalleryPath(): Promise<string> {
  if (!web) return WailsApp.GetGalleryPath();
  return request<string>("/api/gallery/path");
}

export async function GetSettings(): Promise<any> {
  if (!web) return WailsApp.GetSettings();
  return request("/api/settings");
}

export async function ListDirections(): Promise<any> {
  if (!web) return WailsApp.ListDirections();
  return request<any>("/api/directions");
}

export async function ListFolderImages(dir: string): Promise<IGalleryImage[]> {
  if (!web) return WailsApp.ListFolderImages(dir) as Promise<IGalleryImage[]>;
  return localFiles.get(dir) ?? [];
}

export async function ListGalleryImages(): Promise<IGalleryImage[]> {
  if (!web) return WailsApp.ListGalleryImages() as Promise<IGalleryImage[]>;
  return request<IGalleryImage[]>("/api/gallery");
}

export async function ListPresets(): Promise<any> {
  if (!web) return WailsApp.ListPresets();
  return request<any>("/api/presets");
}

export async function LoadImageFull(path: string): Promise<string> {
  if (!web) return WailsApp.LoadImageFull(path);
  return path;
}

export async function LoadImageThumb(path: string, maxDim: number): Promise<string> {
  if (!web) return WailsApp.LoadImageThumb(path, maxDim);
  if (path.startsWith("blob:") || path.startsWith("data:")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}thumb=${encodeURIComponent(maxDim)}`;
}

export async function LoadSession(): Promise<string> {
  if (!web) return WailsApp.LoadSession();
  const result = await request<{ data: string }>("/api/session");
  return result.data ?? "";
}

export async function MirrorFrames(frames: string[]): Promise<string[]> {
  if (!web) return WailsApp.MirrorFrames(frames);
  return request<string[]>("/api/frames/mirror", json(frames));
}

export async function PickFolder(): Promise<string> {
  if (!web) return WailsApp.PickFolder();
  const files = await pickBrowserFile(true);
  if (!files || files.length === 0) return "";
  const id = `browser-${Date.now()}`;
  const items: IGalleryImage[] = Array.from(files)
    .filter((file) => file.type.startsWith("image/"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => ({
      name: file.name,
      path: URL.createObjectURL(file),
      size: file.size,
      modTime: file.lastModified,
    }));
  localFiles.set(id, items);
  return id;
}

export async function PickImage(): Promise<string> {
  if (!web) return WailsApp.PickImage();
  const files = await pickBrowserFile(false);
  const file = files?.[0];
  return file ? readFile(file) : "";
}

export async function RevealInFinder(path: string): Promise<void> {
  if (!web) return WailsApp.RevealInFinder(path);
}

export async function SaveProviderKey(provider: string, key: string): Promise<void> {
  if (!web) return WailsApp.SaveProviderKey(provider, key);
  await request("/api/settings/key", json({ provider, key }));
}

export async function SaveProviderModel(provider: string, model: string): Promise<void> {
  if (!web) return WailsApp.SaveProviderModel(provider, model);
  await request("/api/settings/model", json({ provider, model }));
}

export async function SaveSession(data: string): Promise<void> {
  if (!web) return WailsApp.SaveSession(data);
  await request("/api/session", json({ data }));
}

export async function SetProvider(provider: string): Promise<void> {
  if (!web) return WailsApp.SetProvider(provider);
  await request("/api/settings/provider", json({ provider }));
}

export function EventsOn(eventName: string, callback: (...data: any[]) => void): () => void {
  if (!web) return WailsEventsOn(eventName, callback);
  let stopped = false;
  let version = 0;
  const poll = async () => {
    if (stopped) return;
    try {
      const current = await request<{ version: number; data: any }>("/api/progress");
      if (current.version > version) {
        version = current.version;
        callback(current.data);
      }
    } catch {
      // The next poll retries after a transient network error.
    }
    if (!stopped) window.setTimeout(poll, 400);
  };
  void poll();
  return () => {
    stopped = true;
  };
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body?.error) return body.error;
  } catch {
    // Fall through to the status text.
  }
  return `${response.status} ${response.statusText}`;
}
