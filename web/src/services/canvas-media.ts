const TOKEN_KEY = "sucai_token";
const API_BASE = import.meta.env.VITE_SUCAI_CANVAS_API_BASE || "";

export type CanvasMediaUpload = { mediaId: string; mediaStatus: "synced" | "failed" };
export type CanvasMediaOwner = { projectId?: string; ownerType?: "asset"; ownerId?: string };
export type CanvasLocation = Pick<Location, "pathname" | "search" | "hash">;

/** Resolve a persisted canvas media record to a short-lived OSS URL. */
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

export async function uploadCanvasMedia(blob: Blob, kind: "image" | "video" | "audio", owner: CanvasMediaOwner | string = {}): Promise<CanvasMediaUpload | null> {
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : "";
    if (!token || !API_BASE) return null;
    const projectId = typeof owner === "string" ? owner : owner.projectId || currentProjectId();
    // `/media/init` persists media under a canvas project. Asset ownership is
    // kept in the asset record, while the media row still needs that project.
    if (!projectId) return null;
    const ownership = typeof owner === "string"
        ? { projectId }
        : { projectId, ...(owner.ownerType && owner.ownerId ? { ownerType: owner.ownerType, ownerId: owner.ownerId } : {}) };
    const sha256 = await digest(blob);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const initResponse = await fetch(`${API_BASE}/v1/media/init`, { method: "POST", headers, body: JSON.stringify({ ...ownership, sha256, kind, mimeType: blob.type, bytes: blob.size }) });
    if (!initResponse.ok) throw new Error("媒体上传初始化失败");
    const init = await initResponse.json();
    const media = init?.data?.media;
    if (!media?.id) throw new Error("媒体上传初始化返回无效");
    if (!init?.data?.deduplicated) {
        const content = await fetch(`${API_BASE}/v1/media/${encodeURIComponent(media.id)}/content`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type || "application/octet-stream" }, body: blob });
        if (!content.ok) throw new Error("媒体内容上传失败");
        const complete = await fetch(`${API_BASE}/v1/media/${encodeURIComponent(media.id)}/complete`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        if (!complete.ok) throw new Error("媒体同步确认失败");
    }
    return { mediaId: String(media.id), mediaStatus: "synced" };
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
