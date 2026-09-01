import axios from "axios";

const TOKEN_KEY = "sucai_token";
const API_BASE = import.meta.env.VITE_SUCAI_CANVAS_API_BASE || "";
export const MAX_ASSET_IMAGE_BYTES = 20 * 1024 * 1024;

export type CanvasMediaUpload = { mediaId: string; mediaStatus: "synced" | "failed" };
export type CanvasMediaOwner = { projectId?: string; ownerType?: "asset"; ownerId?: string };
export type CanvasMediaUploadStatus = "uploading" | "confirming" | "synced" | "failed";
export type CanvasMediaUploadOptions = {
    signal?: AbortSignal;
    maxAttempts?: number;
    onProgress?: (progress: number) => void;
    onStatus?: (status: CanvasMediaUploadStatus) => void;
};
export type CanvasLocation = Pick<Location, "pathname" | "search" | "hash">;

/** Resolve a persisted canvas media record to its public NAS or OSS URL. */
export async function resolveCanvasMediaUrl(mediaId: string, fallback = "") {
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : "";
    if (!token || !mediaId || !API_BASE) return fallback;
    try {
        const response = await fetch(`${API_BASE}/v1/media/${encodeURIComponent(mediaId)}/url`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return fallback;
        const payload = await response.json();
        return String(payload?.data?.url || fallback);
    } catch {
        return fallback;
    }
}

export async function uploadCanvasMedia(blob: Blob, kind: "image" | "video" | "audio", owner: CanvasMediaOwner | string = {}, options: CanvasMediaUploadOptions = {}): Promise<CanvasMediaUpload | null> {
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : "";
    if (!token || !API_BASE) return null;
    const assetOwner = typeof owner !== "string" && owner.ownerType === "asset";
    if (assetOwner && kind === "image" && blob.size > MAX_ASSET_IMAGE_BYTES) throw new Error("资产图片大小不能超过 20MB");
    const projectId = assetOwner ? "" : typeof owner === "string" ? owner : owner.projectId || currentProjectId();
    // Canvas-node media belongs to a project; library media belongs directly
    // to an asset so it can sync from non-project routes and across devices.
    if (assetOwner && !owner.ownerId) return null;
    if (!assetOwner && !projectId) return null;
    const ownership = assetOwner
        ? { ownerType: "asset" as const, ownerId: owner.ownerId }
        : typeof owner === "string"
        ? { projectId }
        : { projectId };
    const sha256 = await digest(blob);
    const attempts = Math.max(1, Math.min(3, Math.trunc(options.maxAttempts || 3)));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            options.onStatus?.("uploading");
            options.onProgress?.(0);
            const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
            const init = (await axios.post(`${API_BASE}/v1/media/init`, { ...ownership, sha256, kind, mimeType: blob.type, bytes: blob.size }, { headers, signal: options.signal })).data;
            const media = init?.data?.media;
            if (!media?.id) throw new Error("媒体上传初始化返回无效");
            if (!init?.data?.deduplicated) {
                await axios.put(`${API_BASE}/v1/media/${encodeURIComponent(media.id)}/content`, blob, {
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type || "application/octet-stream" },
                    signal: options.signal,
                    onUploadProgress: (event) => {
                        const total = event.total || blob.size;
                        options.onProgress?.(total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0);
                    },
                });
                options.onProgress?.(100);
                options.onStatus?.("confirming");
                await axios.post(`${API_BASE}/v1/media/${encodeURIComponent(media.id)}/complete`, undefined, { headers: { Authorization: `Bearer ${token}` }, signal: options.signal });
            } else {
                options.onProgress?.(100);
            }
            options.onStatus?.("synced");
            return { mediaId: String(media.id), mediaStatus: "synced" };
        } catch (error) {
            if (options.signal?.aborted || attempt >= attempts || !isRetryableUploadError(error)) {
                options.onStatus?.("failed");
                throw new Error(readUploadError(error));
            }
            await delay(500 * 2 ** (attempt - 1), options.signal);
        }
    }
    return null;
}

function isRetryableUploadError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    const status = Number(error.response?.status || 0);
    return !status || status === 408 || status === 429 || status >= 500;
}

function readUploadError(error: unknown) {
    if (axios.isAxiosError(error)) {
        const payload = error.response?.data as any;
        return String(payload?.message || payload?.error?.message || payload?.msg || error.message || "媒体上传失败");
    }
    return error instanceof Error ? error.message : "媒体上传失败";
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}

async function digest(blob: Blob) {
    const bytes = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (item) => item.toString(16).padStart(2, "0")).join("");
}

function currentProjectId() {
    if (typeof window === "undefined") return "";
    return resolveCanvasProjectId(window.location);
}

export function resolveCanvasProjectId(location: CanvasLocation) {
    const queryProjectId = new URLSearchParams(location.search).get("projectId")?.trim();
    if (queryProjectId) return queryProjectId;

    const hashRoute = location.hash.replace(/^#\/?/, "");
    const hashMatch = hashRoute.match(/(?:^|\/)canvas\/(?:project\/)?([^/?#]+)/) || hashRoute.match(/(?:^|\/)project\/([^/?#]+)/);
    if (hashMatch?.[1]) return decodeProjectId(hashMatch[1]);

    const pathMatch = location.pathname.match(/\/canvas\/(?:project\/)?([^/?#]+)/);
    if (!pathMatch?.[1] || CANVAS_NON_PROJECT_ROUTES.has(pathMatch[1])) return "";
    return decodeProjectId(pathMatch[1]);
}

const CANVAS_NON_PROJECT_ROUTES = new Set(["assets", "config", "image", "membership", "prompts", "video"]);

function decodeProjectId(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
