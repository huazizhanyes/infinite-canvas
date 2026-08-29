import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { normalizeReferenceMentions } from "@/lib/reference-mentions";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { createCanvasGraphIndex, incomingConnections, outgoingConnections, type CanvasGraphIndex } from "@/lib/canvas/canvas-graph-index";
import { assetPreviewUrl, type Asset } from "@/stores/use-asset-store";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    source?: "canvas" | "user-asset";
    assetId?: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    storageKey?: string;
    mediaId?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
    durationMs?: number;
    active: boolean;
};

/** Restore mention markers for prompts saved by older editor versions. */
export function normalizeCanvasResourceMentions(prompt: string, references: Pick<CanvasResourceReference, "label" | "active">[]) {
    return normalizeReferenceMentions(prompt, references.filter((reference) => reference.active).map((reference) => reference.label));
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], contextNodeId?: string | null, graphIndex?: CanvasGraphIndex) {
    const index = graphIndex || createCanvasGraphIndex(nodes, connections);
    // Hovering a resource node must not make that node its own context.  Doing
    // so re-numbered the badge (for example 图片3 -> 图片1) even though no
    // connection or generation order changed.
    const globalReferences = labelResourceNodes(nodes.filter(isResourceNode), false);
    const contextNode = contextNodeId ? index.nodeById.get(contextNodeId) : undefined;
    const contextNodes = contextNode && !isResourceNode(contextNode) ? getMentionResourceNodes(contextNodeId!, nodes, connections, index) : [];
    if (!contextNodes.length) return globalReferences;
    const activeIds = new Set(contextNodes.map((node) => node.id));
    return globalReferences.map((reference) => ({ ...reference, active: activeIds.has(reference.nodeId) }));
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], graphIndex?: CanvasGraphIndex, assets: Asset[] = []) {
    return [...labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections, graphIndex), true), ...labelUserAssets(assets)];
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], graphIndex?: CanvasGraphIndex) {
    const index = graphIndex || createCanvasGraphIndex(nodes, connections);
    const ownInputs = getContextResourceNodes(nodeId, index);
    if (ownInputs.length) return ownInputs;
    const node = index.nodeById.get(nodeId);
    return node && isResourceNode(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], graphIndex?: CanvasGraphIndex) {
    const index = graphIndex || createCanvasGraphIndex(nodes, connections);
    const ownInputs = getContextResourceNodes(nodeId, index);
    if (ownInputs.length) return ownInputs;
    return [];
}

/**
 * Merge the currently connected resources into the node's stable semantic order.
 * Existing ids (including temporarily disconnected ones) keep their positions;
 * newly connected ids are appended in the current connection order.
 */
export function mergeCanvasReferenceOrder(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], graphIndex?: CanvasGraphIndex) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return [];
    const current = getContextResourceNodes(nodeId, graphIndex || createCanvasGraphIndex(nodes, connections)).map((item) => item.id);
    const existing = node.metadata?.referenceOrder || [];
    if (!existing.length) return current;
    const known = new Set(existing);
    return [...existing, ...current.filter((id) => !known.has(id))];
}

function getContextResourceNodes(nodeId: string, graphIndex: CanvasGraphIndex) {
    const resources = [...incomingConnections(graphIndex, nodeId), ...outgoingConnections(graphIndex, nodeId)]
        .map((connection) => graphIndex.nodeById.get(connection.fromNodeId === nodeId ? connection.toNodeId : connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isResourceNode(node)))
        .filter((node, index, all) => all.findIndex((candidate) => candidate.id === node.id) === index);
    const metadata = graphIndex.nodeById.get(nodeId)?.metadata;
    const explicitOrder = metadata?.referenceOrder?.length ? metadata.referenceOrder : metadata?.references || [];
    if (!explicitOrder.length) return resources;
    const orderByReference = new Map(explicitOrder.map((reference, index) => [reference, index]));
    return resources
        .map((node, index) => ({ node, index, order: resourceReferenceKeys(node).reduce((order, key) => Math.min(order, orderByReference.get(key) ?? Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY) }))
        .sort((left, right) => left.order - right.order || left.index - right.index)
        .map((item) => item.node);
}

function resourceReferenceKeys(node: CanvasNodeData) {
    return [node.metadata?.scriptAssetId, node.id, node.metadata?.storageKey, node.metadata?.content].filter((value): value is string => Boolean(value));
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                source: "canvas",
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.content,
                storageKey: node.metadata?.storageKey,
                mediaId: node.metadata?.mediaId,
                text: resourceText(node),
                active,
            },
        ];
    });
}

function labelUserAssets(assets: Asset[]) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    const titleCounts = new Map<string, number>();
    const seenTitles = new Map<string, number>();
    assets.forEach((asset) => {
        if (asset.kind !== "text" && asset.title) titleCounts.set(asset.title, (titleCounts.get(asset.title) || 0) + 1);
    });
    return assets.flatMap((asset): CanvasResourceReference[] => {
        if (asset.kind === "text") return [];
        const kind = asset.kind as CanvasResourceKind;
        const index = counts[kind]++;
        const titleIndex = (seenTitles.get(asset.title) || 0) + 1;
        seenTitles.set(asset.title, titleIndex);
        const title = asset.title || `${kind === "image" ? "图片" : "视频"}${index + 1}`;
        const previewUrl = assetPreviewUrl(asset);
        return [{
            id: `asset:${asset.id}`,
            nodeId: `asset:${asset.id}`,
            source: "user-asset",
            assetId: asset.id,
            kind,
            label: `资产·${title}${(titleCounts.get(asset.title) || 0) > 1 ? `·${titleIndex}` : ""}`,
            title: asset.title,
            previewUrl,
            storageKey: asset.data.storageKey,
            mimeType: asset.data.mimeType,
            width: asset.data.width,
            height: asset.data.height,
            bytes: asset.data.bytes,
            active: true,
        }];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.ScriptAsset && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    // 插件节点通过 definition.resource 声明可作为输入
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}
