import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { cacheObjectUrl, revokeCachedObjectUrl } from "@/services/object-url-cache";
import { getCanvasStorageScopeId, getCanvasSessionEpoch } from "@/lib/canvas-account-scope";
import { uploadCanvasMedia } from "@/services/canvas-media";
import { resolveCanvasMediaUrl } from "@/services/canvas-media";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    mediaId?: string;
    mediaStatus?: "uploading" | "synced" | "failed";
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function migrateLegacyImageStorage(userId: string) {
    const mapping = new Map<string, string>();
    const copies: Promise<void>[] = [];
    await store.iterate((value, key) => {
        if (!key.startsWith("image:") || key.startsWith(`image:u${userId}:`)) return;
        const next = `image:u${userId}:${key.slice("image:".length)}`;
        mapping.set(key, next);
        copies.push(store.setItem(next, value as Blob).then(() => undefined));
    });
    await Promise.all(copies);
    return mapping;
}

export async function storeImageLocally(input: string | Blob): Promise<UploadedImage> {
    const epoch = getCanvasSessionEpoch();
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `image:u${getCanvasStorageScopeId()}:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const localUrl = cacheObjectUrl(objectUrls, storageKey, blob);
    const meta = await readImageMeta(localUrl);
    if (epoch !== getCanvasSessionEpoch()) throw new Error("账号已切换，已忽略旧媒体请求");
    return { url: localUrl, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType, mediaStatus: "uploading" };
}

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const epoch = getCanvasSessionEpoch();
    const local = await storeImageLocally(input);
    const blob = await store.getItem<Blob>(local.storageKey);
    if (!blob) throw new Error("本地图片保存失败");
    let remote: Awaited<ReturnType<typeof uploadCanvasMedia>> = null;
    try {
        remote = await uploadCanvasMedia(blob, "image");
    } catch {
        // 本地图片已经保存；媒体同步失败不应阻塞当前生成结果。
        remote = { mediaId: "", mediaStatus: "failed" };
    }
    if (epoch !== getCanvasSessionEpoch()) throw new Error("账号已切换，已忽略旧媒体请求");
    const url = remote?.mediaId ? await resolveCanvasMediaUrl(remote.mediaId, local.url) : local.url;
    return { ...local, url, ...(remote?.mediaId ? { mediaId: remote.mediaId } : {}), mediaStatus: remote?.mediaStatus || "failed" };
}

export async function syncStoredImage(storageKey: string) {
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) throw new Error("本地图片已丢失，请重新上传");
    const remote = await uploadCanvasMedia(blob, "image");
    if (!remote?.mediaId) throw new Error("云端图片同步不可用，请稍后重试");
    const localUrl = await resolveImageUrl(storageKey, "");
    const url = await resolveCanvasMediaUrl(remote.mediaId, localUrl);
    return { url, storageKey, mediaId: remote.mediaId, mediaStatus: "synced" as const };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = cacheObjectUrl(objectUrls, storageKey, blob);
    return url;
}

export async function resolvePersistedImageUrl(mediaId?: string, storageKey?: string, fallback = "") {
    if (mediaId) {
        const remote = await resolveCanvasMediaUrl(mediaId, "");
        if (remote) return remote;
    }
    return resolveImageUrl(storageKey, fallback);
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    return cacheObjectUrl(objectUrls, storageKey, blob);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    // Persisted canvas nodes commonly keep an expired OSS URL in `dataUrl` and
    // the durable browser copy in `storageKey`. Prefer the local copy so an
    // expired remote preview cannot block the edit request indefinitely.
    const localUrl = image.storageKey ? await resolveImageUrl(image.storageKey, "") : "";
    const url = localUrl || image.dataUrl || image.url || "";
    if (!url || url.startsWith("data:")) return url;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        return blobToDataUrl(await (await fetch(url, { signal: controller.signal })).blob());
    } finally {
        clearTimeout(timeout);
    }
}

export async function deleteStoredImages(keys: Iterable<string>) {
    const prefix = imageScopePrefix();
    await Promise.all(
        Array.from(new Set(keys)).filter((key) => key.startsWith(prefix)).map(async (key) => {
            revokeCachedObjectUrl(objectUrls, key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (key.startsWith(imageScopePrefix()) && !usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith(imageScopePrefix())) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function imageScopePrefix() {
    return `image:u${getCanvasStorageScopeId()}:`;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}
