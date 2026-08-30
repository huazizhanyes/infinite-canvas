import localforage from "localforage";
import { nanoid } from "nanoid";
import { cacheObjectUrl, revokeCachedObjectUrl } from "@/services/object-url-cache";
import { getCanvasStorageScopeId, getCanvasSessionEpoch } from "@/lib/canvas-account-scope";
import { uploadCanvasMedia } from "@/services/canvas-media";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; mediaId?: string; mediaStatus?: "uploading" | "synced" | "failed" };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function migrateLegacyMediaStorage(userId: string) {
    const mapping = new Map<string, string>();
    const copies: Promise<void>[] = [];
    await store.iterate((value, key) => {
        if (!/^(video|audio|file):/.test(key) || key.includes(`:u${userId}:`)) return;
        const separator = key.indexOf(":");
        const next = `${key.slice(0, separator)}:u${userId}:${key.slice(separator + 1)}`;
        mapping.set(key, next);
        copies.push(store.setItem(next, value as Blob).then(() => undefined));
    });
    await Promise.all(copies);
    return mapping;
}

export async function storeMediaFileLocally(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const epoch = getCanvasSessionEpoch();
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `${prefix}:u${getCanvasStorageScopeId()}:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = cacheObjectUrl(objectUrls, storageKey, blob);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    if (epoch !== getCanvasSessionEpoch()) throw new Error("账号已切换，已忽略旧媒体请求");
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta, mediaStatus: "uploading" };
}

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const epoch = getCanvasSessionEpoch();
    const local = await storeMediaFileLocally(input, prefix);
    const blob = await store.getItem<Blob>(local.storageKey);
    if (!blob) throw new Error("本地媒体保存失败");
    let remote: Awaited<ReturnType<typeof uploadCanvasMedia>> = null;
    const kind = blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : null;
    if (kind) { try { remote = await uploadCanvasMedia(blob, kind); } catch { remote = { mediaId: "", mediaStatus: "failed" }; } }
    if (epoch !== getCanvasSessionEpoch()) throw new Error("账号已切换，已忽略旧媒体请求");
    return { ...local, ...(remote?.mediaId ? { mediaId: remote.mediaId } : {}), mediaStatus: remote?.mediaStatus || (kind ? "failed" : undefined) };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = cacheObjectUrl(objectUrls, storageKey, blob);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    return cacheObjectUrl(objectUrls, storageKey, blob);
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    const prefixes = mediaScopePrefixes();
    await Promise.all(
        Array.from(new Set(keys)).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))).map(async (key) => {
            revokeCachedObjectUrl(objectUrls, key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (mediaScopePrefixes().some((prefix) => key.startsWith(prefix)) && !usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredMedia(unused);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string") {
        const storageKey = value.storageKey;
        if (mediaScopePrefixes().some((prefix) => storageKey.startsWith(prefix))) keys.add(storageKey);
    }
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function mediaScopePrefixes() {
    const scope = `u${getCanvasStorageScopeId()}:`;
    return [`video:${scope}`, `audio:${scope}`, `file:${scope}`];
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
