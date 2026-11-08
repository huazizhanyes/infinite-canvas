import localforage from "localforage";
import { accountScopedKey, getCanvasSessionEpoch, getCanvasStorageScopeId } from "@/lib/canvas-account-scope";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { getImageBlob } from "@/services/image-storage";
const covers = localforage.createInstance({ name: "infinite-canvas", storeName: "project_covers", driver: localforage.INDEXEDDB });
type Cover = { identity: string; blob: Blob };
const requests = new Map<string, number>();
export function firstCanvasCoverNode(nodes: CanvasNodeData[]) {
    return nodes.find(node => (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.ScriptAsset)
        && !["loading", "error"].includes(node.metadata?.status || "")
        && Boolean(node.metadata?.content || node.metadata?.storageKey || node.metadata?.mediaId));
}
export function canvasCoverIdentity(node?: CanvasNodeData) {
    if (!node) return "";
    const metadata = node.metadata;
    return `${node.id}:${metadata?.mediaId || metadata?.storageKey || metadata?.content || ""}`;
}
export async function readCanvasProjectCover(id: string) {
    return (await covers.getItem<Cover>(accountScopedKey(id)))?.blob || null;
}
export async function removeCanvasProjectCover(id: string) {
    const key = accountScopedKey(id); requests.set(key, (requests.get(key) || 0) + 1);
    await covers.removeItem(key);
}
export async function captureCanvasProjectCover(id: string, nodes: CanvasNodeData[]) {
    const scope = getCanvasStorageScopeId(), epoch = getCanvasSessionEpoch(), key = accountScopedKey(id, scope);
    const sequence = (requests.get(key) || 0) + 1; requests.set(key, sequence);
    const current = () => epoch === getCanvasSessionEpoch() && requests.get(key) === sequence;
    const node = firstCanvasCoverNode(nodes), identity = canvasCoverIdentity(node);
    const old = await covers.getItem<Cover>(key);
    if (!current() || old?.identity === identity) return;
    if (!node) {
        // 只有确实没有任何图片节点才清空；生成中/暂时失败时保留旧封面。
        if (!nodes.some(item => item.type === CanvasNodeType.Image || item.type === CanvasNodeType.ScriptAsset)) await covers.removeItem(key);
        return;
    }
    const metadata = node.metadata;
    const blob = metadata?.storageKey ? await getImageBlob(metadata.storageKey) : null;
    let url = blob ? URL.createObjectURL(blob) : metadata?.content || "";
    if (!url) return; // 不为封面另外下载媒体；等待画布自身加载到 content/本地缓存。
    const ownedUrl = Boolean(blob);
    try {
        const source = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image(); image.crossOrigin = "anonymous";
            const timer = window.setTimeout(() => { image.src = ""; reject(new Error("封面读取超时")); }, 10000);
            image.onload = () => { clearTimeout(timer); resolve(image); };
            image.onerror = () => { clearTimeout(timer); reject(new Error("封面暂不可用")); };
            image.src = url;
        });
        if (!current() || !source.naturalWidth || !source.naturalHeight) return;
        const ratio = Math.min(1, 480 / source.naturalWidth, 320 / source.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(source.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(source.naturalHeight * ratio));
        const context = canvas.getContext("2d"); if (!context) return;
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const thumbnail = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.75));
        if (thumbnail && current()) await covers.setItem<Cover>(key, { identity, blob: thumbnail });
    } finally { if (ownedUrl) URL.revokeObjectURL(url); url = ""; }
}
