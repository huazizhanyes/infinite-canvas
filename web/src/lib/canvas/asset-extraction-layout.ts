import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ScriptAsset, ScriptGenerationImage } from "@/services/api/canvas-script";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const ASSET_NODE_WIDTH = 560;
export const ASSET_NODE_HEIGHT = 320;
export const ASSET_NODE_GAP = 36;
export const ASSET_COLUMN_GAP = 56;
export const ASSET_ROW_OFFSET = 96;
export const ASSET_ROWS_PER_COLUMN = 4;
export const ASSET_COLUMNS_PER_BLOCK = 4;
export const ASSET_BLOCK_GAP = 96;

const TYPE_ORDER = { character: 0, scene: 1, prop: 2 } as const;

export type AssetGenerationTarget = { assetId: string; variantId?: string };

export function buildAssetGenerationTargets(assets: ScriptAsset[], episodeId?: string, includeAll = false): AssetGenerationTarget[] {
    const targets: AssetGenerationTarget[] = [];
    assets.forEach((asset) => {
        if (includeAll) {
            if (!asset.image?.imageUrl) targets.push({ assetId: asset.id });
            asset.variants.filter((variant) => !variant.image?.imageUrl).forEach((variant) => targets.push({ assetId: asset.id, variantId: variant.id }));
            return;
        }
        const occurrence = asset.occurrences?.find((item) => item.episodeId === episodeId);
        if (!occurrence) return;
        if (occurrence.variantId) {
            const variant = asset.variants.find((item) => item.id === occurrence.variantId);
            if (!variant?.image?.imageUrl) targets.push({ assetId: asset.id, variantId: occurrence.variantId });
        } else if (!asset.image?.imageUrl) {
            targets.push({ assetId: asset.id });
        }
    });
    return targets;
}

export function scriptAssetNodeId(assetId: string) {
    return `script-asset-${assetId}`;
}

export function buildAssetExtractionOps(source: CanvasNodeData, assets: ScriptAsset[], nodes: CanvasNodeData[], connections: CanvasConnection[], options: { repack?: boolean } = {}) {
    const ops: CanvasAgentOp[] = [];
    const sorted = assets
        .map((asset, index) => ({ asset, index }))
        .sort((left, right) => TYPE_ORDER[left.asset.type] - TYPE_ORDER[right.asset.type] || left.index - right.index)
        .map((item) => item.asset);
    const managed = nodes.filter((node) => node.type === CanvasNodeType.ScriptAsset && node.metadata?.assetExtractionNodeId === source.id);
    const existingByAssetId = new Map(managed.map((node) => [node.metadata?.scriptAssetId, node]));
    const activeIds = new Set(sorted.map((asset) => asset.id));
    const usedSlots = new Set(managed.map((node) => node.metadata?.scriptAssetLayoutSlot).filter((slot): slot is number => Number.isInteger(slot) && Number(slot) >= 0));
    const claimedSlots = new Set<number>();
    let nextSlot = 0;
    const takeSlot = () => {
        while (usedSlots.has(nextSlot)) nextSlot += 1;
        const slot = nextSlot;
        usedSlots.add(slot);
        nextSlot += 1;
        return slot;
    };
    const slotByNodeId = new Map<string, number>();
    managed.forEach((node) => {
        const slot = node.metadata?.scriptAssetLayoutSlot;
        const validSlot = Number.isInteger(slot) && Number(slot) >= 0 && !claimedSlots.has(Number(slot));
        const assignedSlot = validSlot ? Number(slot) : takeSlot();
        claimedSlots.add(assignedSlot);
        slotByNodeId.set(node.id, assignedSlot);
    });

    sorted.forEach((asset) => {
        const existing = existingByAssetId.get(asset.id);
        const id = existing?.id || scriptAssetNodeId(asset.id);
        const occurrence = asset.occurrences?.find((item) => item.episodeId === source.metadata?.assetExtractionEpisodeId);
        const displayVariant = occurrence?.variantId ? asset.variants.find((variant) => variant.id === occurrence.variantId) : undefined;
        const displayImage = displayVariant?.image || asset.image;
        const slot = existing ? slotByNodeId.get(existing.id)! : takeSlot();
        const blockSize = ASSET_ROWS_PER_COLUMN * ASSET_COLUMNS_PER_BLOCK;
        const block = Math.floor(slot / blockSize);
        const slotInBlock = slot % blockSize;
        const row = slotInBlock % ASSET_ROWS_PER_COLUMN;
        const column = Math.floor(slotInBlock / ASSET_ROWS_PER_COLUMN);
        const blockHeight = ASSET_ROWS_PER_COLUMN * ASSET_NODE_HEIGHT + (ASSET_ROWS_PER_COLUMN - 1) * ASSET_NODE_GAP;
        const position = {
            x: source.position.x + source.width + ASSET_ROW_OFFSET + column * (ASSET_NODE_WIDTH + ASSET_COLUMN_GAP),
            y: source.position.y + block * (blockHeight + ASSET_BLOCK_GAP) + row * (ASSET_NODE_HEIGHT + ASSET_NODE_GAP),
        };
        const hasNewImage = Boolean(displayImage?.imageUrl && displayImage?.id && displayImage.id !== existing?.metadata?.scriptAssetImageId);
        const shouldHydrateImage = Boolean(displayImage?.imageUrl && (!existing?.metadata?.mediaId || hasNewImage) && (existing?.metadata?.mediaStatus !== "failed" || hasNewImage));
        const metadata: CanvasNodeMetadata = {
            ...existing?.metadata,
            assetExtractionNodeId: source.id,
            scriptSetId: source.metadata?.scriptSetId,
            scriptSetNodeId: source.id,
            scriptAssetId: asset.id,
            scriptVariantId: displayVariant?.id,
            scriptAssetLayoutSlot: slot,
            scriptAssetEpisodeIds: asset.episodeIds || [],
            scriptAssetOccurrences: asset.occurrences || [],
            scriptAssetType: asset.type,
            scriptAssetVisualDescription: displayVariant?.visualDescription || asset.visualDescription,
            scriptAssetImagePrompt: displayVariant?.imagePrompt || asset.imagePrompt,
            scriptAssetImageStatus: displayImage?.status || existing?.metadata?.scriptAssetImageStatus || "idle",
            scriptAssetImageId: displayImage?.id || existing?.metadata?.scriptAssetImageId,
            scriptAssetStale: false,
            assetExtractionImageModel: source.metadata?.assetExtractionImageModel,
            assetExtractionAspectRatio: source.metadata?.assetExtractionAspectRatio,
            assetExtractionImageQuality: source.metadata?.assetExtractionImageQuality,
            ...(shouldHydrateImage ? { content: displayImage?.imageUrl, mediaId: undefined, storageKey: undefined, mediaStatus: undefined } : {}),
        };
        if (existing) {
            ops.push({ type: "update_node", id, patch: { title: asset.name, ...(options.repack ? { position, width: ASSET_NODE_WIDTH, height: ASSET_NODE_HEIGHT } : {}) }, metadata });
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

    const activeByNameAndType = new Map(sorted.map((asset) => [`${asset.type}:${normalizedAssetName(asset.name)}`, asset.id]));
    const staleNodes = managed.filter((node) => node.metadata?.scriptAssetId && !activeIds.has(node.metadata.scriptAssetId));
    const duplicateNodeIds = staleNodes
        .filter((node) => {
            const replacementId = activeByNameAndType.get(`${node.metadata?.scriptAssetType || ""}:${normalizedAssetName(node.title)}`);
            return Boolean(replacementId && replacementId !== node.metadata?.scriptAssetId);
        })
        .map((node) => node.id);
    if (duplicateNodeIds.length) ops.push({ type: "delete_node", ids: duplicateNodeIds });
    staleNodes.filter((node) => !duplicateNodeIds.includes(node.id)).forEach((node) => ops.push({ type: "update_node", id: node.id, metadata: { scriptAssetStale: true } }));
    return ops;
}

function normalizedAssetName(value: string) {
    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function generationImageMetadata(image: ScriptGenerationImage, batchId?: string): CanvasNodeMetadata {
    const failed = ["failed", "canceled"].includes(image.status);
    return {
        scriptAssetImageId: image.id,
        scriptVariantId: image.variantId,
        scriptAssetImageBatchId: batchId,
        scriptAssetImageTaskId: image.taskId,
        scriptAssetImageStatus: image.status,
        errorDetails: failed ? image.error || "图片生成失败" : undefined,
        ...(image.imageUrl ? { content: image.imageUrl } : {}),
    };
}
