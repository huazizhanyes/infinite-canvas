import type { Asset, ImageAsset, VideoAsset } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { accountScopedKey, getCanvasSessionEpoch, getCanvasStorageScopeId } from "@/lib/canvas-account-scope";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { uploadCanvasMedia, resolveCanvasMediaUrl } from "@/services/canvas-media";
import { canvasAssetsApi, type CanvasAssetConnection } from "@/services/api/canvas-assets";
import { localForageStorage } from "@/lib/localforage-storage";
import { nanoid } from "nanoid";

const SAVE_DEBOUNCE = 2500;
const RETRY_DELAY = 10000;

let initialized = false;
let connection: CanvasAssetConnection | null = null;
let unsubscribe: (() => void) | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<boolean> | null = null;
let applyingRemoteState = false;
let previousAssets = new Map<string, Asset>();
let pendingAssets = new Map<string, Asset>();
let pendingDeletes = new Set<string>();
const OUTBOX_KEY = "canvas_asset_sync_outbox";

export async function initializeCanvasAssetSync(nextConnection: CanvasAssetConnection) {
    if (initialized && connection?.token === nextConnection.token && connection?.baseUrl === nextConnection.baseUrl) return;
    if (initialized) await stopCanvasAssetSync();
    initialized = true;
    connection = nextConnection;
    await restoreOutbox();
    await waitForAssetHydration();
    const epoch = getCanvasSessionEpoch();
    const localAssets = useAssetStore.getState().assets;
    let remoteAssets: Array<ImageAsset | VideoAsset> = [];
    try {
        remoteAssets = (await canvasAssetsApi.list(nextConnection)).filter(isSyncableAsset);
    } catch (error) {
        console.warn("[CanvasAssetSync] load failed; keeping local assets", error);
    }
    if (epoch !== getCanvasSessionEpoch()) return;

    const merged = mergeAssets(localAssets, await hydrateRemoteAssets(remoteAssets));
    applyingRemoteState = true;
    useAssetStore.getState().replaceAssets(merged);
    applyingRemoteState = false;
    previousAssets = new Map(merged.map((asset) => [asset.id, asset]));

    const remoteById = new Map(remoteAssets.map((asset) => [asset.id, asset]));
    merged.filter(isSyncableAsset).forEach((asset) => {
        const remote = remoteById.get(asset.id);
        if (!remote || assetTime(asset) > assetTime(remote)) pendingAssets.set(asset.id, asset);
    });

    unsubscribe = useAssetStore.subscribe((state) => {
        if (applyingRemoteState) return;
        const next = new Map(state.assets.map((asset) => [asset.id, asset]));
        previousAssets.forEach((_asset, id) => {
            if (!next.has(id)) {
                pendingAssets.delete(id);
                pendingDeletes.add(id);
            }
        });
        next.forEach((asset, id) => {
            if (!isSyncableAsset(asset)) return;
            const previous = previousAssets.get(id);
            if (!previous || previous.updatedAt !== asset.updatedAt) {
                pendingDeletes.delete(id);
                pendingAssets.set(id, asset);
            }
        });
        previousAssets = next;
        scheduleFlush(SAVE_DEBOUNCE);
    });
    if (pendingAssets.size) scheduleFlush(SAVE_DEBOUNCE);
}

export async function stopCanvasAssetSync() {
    const saved = await flushCanvasAssetSync();
    await persistOutbox();
    unsubscribe?.();
    unsubscribe = null;
    initialized = false;
    connection = null;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    return saved;
}

export async function flushCanvasAssetSync(): Promise<boolean> {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (!connection || (!pendingAssets.size && !pendingDeletes.size)) return true;
    if (flushPromise) return flushPromise;
    flushPromise = flushPendingAssets();
    try {
        return await flushPromise;
    } finally {
        flushPromise = null;
    }
}

async function flushPendingAssets() {
    if (!connection) return false;
    const currentConnection = connection;
    const assets = [...pendingAssets.values()];
    const deletes = [...pendingDeletes];
    assets.forEach((asset) => pendingAssets.delete(asset.id));
    deletes.forEach((id) => pendingDeletes.delete(id));
    let saved = true;

    await Promise.all([
        ...deletes.map(async (id) => {
            try {
                await canvasAssetsApi.remove(currentConnection, id);
            } catch (error) {
                saved = false;
                if (!useAssetStore.getState().assets.some((asset) => asset.id === id)) pendingDeletes.add(id);
                console.warn("[CanvasAssetSync] delete failed", { id, error });
            }
        }),
        ...assets.map(async (asset) => {
            try {
                const prepared = await prepareAssetForUpload(asset);
                await canvasAssetsApi.save(currentConnection, toRemoteAsset(prepared));
                if (prepared !== asset) applyPreparedAsset(prepared);
            } catch (error) {
                saved = false;
                const current = useAssetStore.getState().assets.find((item) => item.id === asset.id);
                if (current) {
                    pendingAssets.set(current.id, current);
                    if (isSyncableAsset(current)) useAssetStore.getState().updateAsset(current.id, { data: { ...current.data, mediaStatus: "failed" } });
                }
                console.warn("[CanvasAssetSync] save failed", { id: asset.id, error });
            }
        }),
    ]);
    if (pendingAssets.size || pendingDeletes.size) scheduleFlush(RETRY_DELAY);
    await persistOutbox();
    return saved;
}

async function prepareAssetForUpload(asset: Asset) {
    if (!isSyncableAsset(asset)) return asset;
    if (asset.data.mediaId && asset.data.mediaOwner === "asset") return asset;
    const blob = await readAssetBlob(asset);
    if (!blob?.size) throw new Error("资产媒体文件不存在，无法同步");
    const remote = await uploadCanvasMedia(blob, asset.kind, { ownerType: "asset", ownerId: asset.id });
    if (!remote?.mediaId) throw new Error("资产媒体上传不可用，请稍后重试");
    if (asset.kind === "image") {
        return { ...asset, data: { ...asset.data, mediaId: remote.mediaId, mediaOwner: "asset", mediaStatus: "synced" } } as ImageAsset;
    }
    return { ...asset, data: { ...asset.data, mediaId: remote.mediaId, mediaOwner: "asset", mediaStatus: "synced" } } as VideoAsset;
}

async function readAssetBlob(asset: ImageAsset | VideoAsset) {
    if (asset.data.storageKey) return asset.kind === "image" ? getImageBlob(asset.data.storageKey) : getMediaBlob(asset.data.storageKey);
    const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
    if (!url) return null;
    return fetch(url).then((response) => response.ok ? response.blob() : null).catch(() => null);
}

function applyPreparedAsset(asset: Asset) {
    const current = useAssetStore.getState().assets;
    applyingRemoteState = true;
    useAssetStore.getState().replaceAssets(current.map((item) => item.id === asset.id ? asset : item));
    applyingRemoteState = false;
    previousAssets.set(asset.id, asset);
}

function toRemoteAsset(asset: Asset): Asset {
    if (asset.kind === "text") return asset;
    const coverUrl = isBrowserOnlyUrl(asset.coverUrl) ? "" : asset.coverUrl;
    if (asset.kind === "image") {
        const { storageKey: _storageKey, ...data } = asset.data;
        return { ...asset, coverUrl, data: { ...data, dataUrl: "" } };
    }
    const { storageKey: _storageKey, ...data } = asset.data;
    return { ...asset, coverUrl, data: { ...data, url: "" } };
}

function isBrowserOnlyUrl(value?: string) {
    return !value || value.startsWith("blob:") || value.startsWith("data:");
}

async function hydrateRemoteAssets(assets: Array<ImageAsset | VideoAsset>) {
    return Promise.all(assets.map(async (asset) => {
        if (!asset.data.mediaId) return asset;
        const fallback = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const remoteUrl = await resolveCanvasMediaUrl(asset.data.mediaId, fallback);
        if (!remoteUrl) return asset;
        const storageKey = asset.data.storageKey || `${asset.kind}:u${getCanvasStorageScopeId()}:${nanoid()}`;
        const existing = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (!existing) {
            const response = await fetch(remoteUrl).catch(() => null);
            if (response?.ok) {
                const blob = await response.blob();
                if (blob.size) {
                    if (asset.kind === "image") await setImageBlob(storageKey, blob);
                    else await setMediaBlob(storageKey, blob);
                }
            }
        }
        if (asset.kind === "image") {
            const localUrl = await resolveImageUrl(storageKey, remoteUrl);
            return { ...asset, coverUrl: localUrl, data: { ...asset.data, storageKey, dataUrl: localUrl, mediaOwner: "asset", mediaStatus: "synced" } } as ImageAsset;
        }
        const localUrl = await resolveMediaUrl(storageKey, remoteUrl);
        return { ...asset, coverUrl: localUrl, data: { ...asset.data, storageKey, url: localUrl, mediaOwner: "asset", mediaStatus: "synced" } } as VideoAsset;
    }));
}

function mergeAssets(local: Asset[], remote: Asset[]) {
    const result = new Map<string, Asset>();
    local.filter((asset) => !isSyncableAsset(asset)).forEach((asset) => result.set(asset.id, asset));
    remote.forEach((asset) => result.set(asset.id, asset));
    local.filter(isSyncableAsset).forEach((asset) => {
        const remoteAsset = result.get(asset.id);
        if (!remoteAsset || assetTime(asset) >= assetTime(remoteAsset)) result.set(asset.id, asset);
    });
    return [...result.values()].sort((left, right) => assetTime(right) - assetTime(left));
}

function isSyncableAsset(asset: Asset): asset is ImageAsset | VideoAsset {
    return asset.kind === "image" || asset.kind === "video";
}

function assetTime(asset: Asset) {
    return Date.parse(asset.updatedAt) || 0;
}

function scheduleFlush(delay: number) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushCanvasAssetSync();
    }, delay);
}

function waitForAssetHydration() {
    if (useAssetStore.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const stop = useAssetStore.subscribe((state) => {
            if (!state.hydrated) return;
            stop();
            resolve();
        });
    });
}

async function persistOutbox() {
    await localForageStorage.setItem(accountScopedKey(OUTBOX_KEY), JSON.stringify({ assets: [...pendingAssets.values()], deletes: [...pendingDeletes] }));
}

async function restoreOutbox() {
    const raw = await localForageStorage.getItem(accountScopedKey(OUTBOX_KEY));
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw) as { assets?: Asset[]; deletes?: string[] };
        (parsed.assets || []).filter(isSyncableAsset).forEach((asset) => pendingAssets.set(asset.id, asset));
        (parsed.deletes || []).forEach((id) => pendingDeletes.add(id));
    } catch {
        await localForageStorage.removeItem(accountScopedKey(OUTBOX_KEY));
    }
}
