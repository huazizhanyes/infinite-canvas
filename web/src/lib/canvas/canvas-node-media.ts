import { getMediaBlob, resolveMediaUrl, resolvePersistedMediaUrl } from "@/services/file-storage";
import { resolvePersistedImage, storeImageLocally, type UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

/**
 * 该节点已连接的参考素材中是否存在仍然无法恢复的节点。
 * ctive 只包含已连接的引用；引用一旦重新拿到内容（例如用户手动重新加载成功），拦截会自动解除。
 */
export function hasFailedMediaReference(references: CanvasResourceReference[], failedNodeIds: ReadonlySet<string>) {
    return references.some((reference) => reference.active && reference.source !== "user-asset" && !reference.previewUrl && failedNodeIds.has(reference.nodeId));
}

export type CanvasMediaUrlResolver = (mediaId: string) => Promise<string>;

export type HydrateCanvasMediaOptions = {
    /** 可选的外部媒体解析器（例如管理员代看），内置解析失败后才会调用。 */
    resolveMediaUrl?: CanvasMediaUrlResolver;
};

export type HydratedCanvasMedia = {
    nodes: CanvasNodeData[];
    /** 无法恢复持久化媒体的节点 ID，这些节点保留原值等待用户重新上传或重试。 */
    failedNodeIds: Set<string>;
};

/**
 * 逐节点恢复持久化媒体。单个节点恢复失败时保留其原有内容并记录失败节点，
 * 不再让一个历史坏节点中断整块画布的媒体恢复。
 */
export async function hydrateCanvasNodes(nodes: CanvasNodeData[], options: HydrateCanvasMediaOptions = {}): Promise<HydratedCanvasMedia> {
    const failedNodeIds = new Set<string>();
    const hydrated = await mapWithConcurrency(nodes, 6, async (node) => {
        try {
            return await hydrateCanvasNode(node, options);
        } catch {
            failedNodeIds.add(node.id);
            return node;
        }
    });
    const nodeById = new Map(hydrated.map((node) => [node.id, node]));
    return {
        nodes: hydrated.map((node) => {
            if (!node.metadata?.isBatchRoot) return node;
            const childIds = (node.metadata.batchChildIds || []).filter((id) => nodeById.has(id));
            const selected = nodeById.get(node.metadata.primaryImageId || "");
            const primary = selected?.metadata?.content ? selected : childIds.map((id) => nodeById.get(id)).find((child) => child?.metadata?.content);
            if (!primary) return { ...node, metadata: { ...node.metadata, batchChildIds: childIds } };
            return syncBatchPrimaryNode({ ...node, metadata: { ...node.metadata, batchChildIds: childIds } }, primary);
        }),
        failedNodeIds,
    };
}

async function hydrateCanvasNode(node: CanvasNodeData, options: HydrateCanvasMediaOptions): Promise<CanvasNodeData> {
    const content = node.metadata?.content;
    if (node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) {
        if (node.metadata?.storageKey) {
            const local = await getMediaBlob(node.metadata.storageKey);
            if (local?.size) {
                const localUrl = await resolveMediaUrl(node.metadata.storageKey, content);
                return { ...node, metadata: { ...node.metadata, content: localUrl, mediaStatus: node.metadata.mediaId ? "synced" as const : node.metadata.mediaStatus } };
            }
        }
        if (node.metadata?.mediaId) {
            // 只读调试副本可用管理员身份代看媒体，普通项目这里拿到的仍是空串。
            const remote = await resolvePersistedMediaUrl(node.metadata.mediaId, node.metadata.storageKey, content || "")
                || (options.resolveMediaUrl ? await options.resolveMediaUrl(node.metadata.mediaId) : "");
            if (!remote) throw new Error(`媒体 ${node.metadata.mediaId} 无法恢复`);
            return { ...node, metadata: { ...node.metadata, content: remote, mediaStatus: "synced" as const } };
        }
        if (node.metadata?.storageKey && !content) throw new Error(`本地媒体 ${node.metadata.storageKey} 无法恢复`);
        return node;
    }
    if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.ScriptAsset) return node;
    if (node.metadata?.storageKey || node.metadata?.mediaId) {
        const resolved = await resolvePersistedImage(node.metadata.mediaId, node.metadata.storageKey, content);
        if (resolved.url) return { ...node, metadata: { ...node.metadata, content: resolved.url, storageKey: resolved.storageKey || node.metadata.storageKey, mediaStatus: node.metadata.mediaId ? "synced" as const : node.metadata.mediaStatus } };
        const delegatedUrl = node.metadata.mediaId && options.resolveMediaUrl ? await options.resolveMediaUrl(node.metadata.mediaId) : "";
        if (delegatedUrl) return { ...node, metadata: { ...node.metadata, content: delegatedUrl, storageKey: resolved.storageKey || node.metadata.storageKey, mediaStatus: "synced" as const } };
        if (node.metadata.mediaId) throw new Error(`媒体 ${node.metadata.mediaId} 无法恢复`);
        if (node.metadata.storageKey && !content) throw new Error(`本地媒体 ${node.metadata.storageKey} 无法恢复`);
    }
    if (!content) return node;
    if (!content.startsWith("data:image/")) return node;
    return { ...node, metadata: { ...node.metadata, ...imageMetadata(await storeImageLocally(content)) } };
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, mediaId: image.mediaId, mediaStatus: image.mediaStatus || (image.mediaId ? "synced" : undefined), status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

export function syncBatchPrimaryNode(root: CanvasNodeData, primary: CanvasNodeData): CanvasNodeData {
    const source = primary.metadata || {};
    return {
        ...root,
        width: primary.width,
        height: primary.height,
        metadata: {
            ...root.metadata,
            primaryImageId: primary.id,
            content: source.content,
            storageKey: source.storageKey,
            mediaId: source.mediaId,
            mediaStatus: source.mediaStatus,
            status: source.status,
            naturalWidth: source.naturalWidth,
            naturalHeight: source.naturalHeight,
            bytes: source.bytes,
            mimeType: source.mimeType,
            freeResize: source.freeResize,
        },
    };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
