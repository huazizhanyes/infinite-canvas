import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { cacheObjectUrl, revokeCachedObjectUrl } from "@/services/object-url-cache";
import { getCanvasStorageScopeId, getCanvasSessionEpoch } from "@/lib/canvas-account-scope";
import { uploadCanvasMedia } from "@/services/canvas-media";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    mediaId?: string;
    mediaStatus?: "synced" | "failed";
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

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const epoch = getCanvasSessionEpoch();
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `image:u${getCanvasStorageScopeId()}:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = cacheObjectUrl(objectUrls, storageKey, blob);
    const meta = await readImageMeta(url);
    let remote: Awaited<ReturnType<typeof uploadCanvasMedia>> = null;
    try { remote = await uploadCanvasMedia(blob, "image"); } catch { remote = { mediaId: "", mediaStatus: "failed" }; }
    if (epoch !== getCanvasSessionEpoch()) throw new Error("账号已切换，已忽略旧媒体请求");
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType, ...(remote?.mediaId ? { mediaId: remote.mediaId } : {}), ...(remote?.mediaStatus ? { mediaStatus: remote.mediaStatus } : {}) };
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

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    return cacheObjectUrl(objectUrls, storageKey, blob);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
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
