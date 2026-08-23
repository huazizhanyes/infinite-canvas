import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ScriptAsset, ScriptGenerationImage } from "@/services/api/canvas-script";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const ASSET_NODE_WIDTH = 560;
export const ASSET_NODE_HEIGHT = 320;
export const ASSET_NODE_GAP = 36;
export const ASSET_COLUMN_GAP = 56;
export const ASSET_ROW_OFFSET = 96;
export const ASSET_ROWS_PER_COLUMN = 5;

const TYPE_ORDER = { character: 0, scene: 1, prop: 2 } as const;

export function scriptAssetNodeId(assetId: string) {
    return `script-asset-${assetId}`;
}

export function buildAssetExtractionOps(source: CanvasNodeData, assets: ScriptAsset[], nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ops: CanvasAgentOp[] = [];
    const sorted = assets.map((asset, index) => ({ asset, index })).sort((left, right) => TYPE_ORDER[left.asset.type] - TYPE_ORDER[right.asset.type] || left.index - right.index).map((item) => item.asset);
    const managed = nodes.filter((node) => node.type === CanvasNodeType.ScriptAsset && node.metadata?.assetExtractionNodeId === source.id);
    const existingByAssetId = new Map(managed.map((node) => [node.metadata?.scriptAssetId, node]));
    const activeIds = new Set(sorted.map((asset) => asset.id));
    const rowCount = Math.min(ASSET_ROWS_PER_COLUMN, sorted.length);
    const gridHeight = rowCount * ASSET_NODE_HEIGHT + Math.max(0, rowCount - 1) * ASSET_NODE_GAP;
    const startY = source.position.y + (source.height - gridHeight) / 2;

    sorted.forEach((asset, index) => {
        const existing = existingByAssetId.get(asset.id);
        const id = existing?.id || scriptAssetNodeId(asset.id);
        const row = index % ASSET_ROWS_PER_COLUMN;
        const column = Math.floor(index / ASSET_ROWS_PER_COLUMN);
        const position = {
            x: source.position.x + source.width + ASSET_ROW_OFFSET + column * (ASSET_NODE_WIDTH + ASSET_COLUMN_GAP),
            y: startY + row * (ASSET_NODE_HEIGHT + ASSET_NODE_GAP),
        };
        const hasNewImage = Boolean(asset.image?.imageUrl && asset.image?.id && asset.image.id !== existing?.metadata?.scriptAssetImageId);
        const shouldHydrateImage = Boolean(asset.image?.imageUrl && !existing?.metadata?.mediaId && (existing?.metadata?.mediaStatus !== "failed" || hasNewImage));
        const metadata: CanvasNodeMetadata = {
            ...existing?.metadata,
            assetExtractionNodeId: source.id,
            scriptSetId: source.metadata?.scriptSetId,
            scriptSetNodeId: source.id,
            scriptAssetId: asset.id,
            scriptAssetType: asset.type,
            scriptAssetVisualDescription: asset.visualDescription,
            scriptAssetImagePrompt: asset.imagePrompt,
            scriptAssetImageStatus: asset.image?.status || existing?.metadata?.scriptAssetImageStatus || "idle",
            scriptAssetImageId: asset.image?.id || existing?.metadata?.scriptAssetImageId,
            scriptAssetStale: false,
            assetExtractionImageModel: source.metadata?.assetExtractionImageModel,
            assetExtractionAspectRatio: source.metadata?.assetExtractionAspectRatio,
            assetExtractionImageQuality: source.metadata?.assetExtractionImageQuality,
            ...(shouldHydrateImage ? { content: asset.image?.imageUrl, mediaStatus: undefined } : {}),
        };
        if (existing) {
            ops.push({ type: "update_node", id, patch: { title: asset.name, position, width: ASSET_NODE_WIDTH, height: ASSET_NODE_HEIGHT }, metadata });
        } else {
            ops.push({
                type: "add_node",
                id,
                nodeType: CanvasNodeType.ScriptAsset,
                title: asset.name,
                position,
                width: ASSET_NODE_WIDTH,
                height: ASSET_NODE_HEIGHT,
                metadata,
            });
        }
        if (!connections.some((connection) => connection.fromNodeId === source.id && connection.toNodeId === id)) {
            ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: source.id, toNodeId: id });
        }
    });

    managed.filter((node) => node.metadata?.scriptAssetId && !activeIds.has(node.metadata.scriptAssetId)).forEach((node) => ops.push({ type: "update_node", id: node.id, metadata: { scriptAssetStale: true } }));
    return ops;
}

export function generationImageMetadata(image: ScriptGenerationImage, batchId?: string): CanvasNodeMetadata {
    const failed = ["failed", "canceled"].includes(image.status);
    return {
        scriptAssetImageId: image.id,
        scriptAssetImageBatchId: batchId,
        scriptAssetImageTaskId: image.taskId,
        scriptAssetImageStatus: image.status,
        errorDetails: failed ? image.error || "图片生成失败" : undefined,
        ...(image.imageUrl ? { content: image.imageUrl } : {}),
    };
}
