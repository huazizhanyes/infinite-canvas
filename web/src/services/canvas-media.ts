const TOKEN_KEY = "sucai_token";
const API_BASE = import.meta.env.VITE_SUCAI_CANVAS_API_BASE || "";

export type CanvasMediaUpload = { mediaId: string; mediaStatus: "synced" | "failed" };

export async function uploadCanvasMedia(blob: Blob, kind: "image" | "video" | "audio", projectId = currentProjectId()): Promise<CanvasMediaUpload | null> {
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : "";
    if (!token || !projectId || !API_BASE) return null;
    const sha256 = await digest(blob);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const initResponse = await fetch(`${API_BASE}/v1/media/init`, { method: "POST", headers, body: JSON.stringify({ projectId, sha256, kind, mimeType: blob.type, bytes: blob.size }) });
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
    const match = window.location.pathname.match(/\/canvas(?:\/project)?\/([^/]+)/);
    return match?.[1] || new URLSearchParams(window.location.search).get("projectId") || "";
}
