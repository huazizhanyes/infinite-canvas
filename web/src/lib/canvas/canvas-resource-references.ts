import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { createCanvasGraphIndex, incomingConnections, type CanvasGraphIndex } from "@/lib/canvas/canvas-graph-index";
import type { Asset } from "@/stores/use-asset-store";

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
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
    durationMs?: number;
    active: boolean;
};

export function buildCanvasResourceReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], contextNodeId?: string | null, graphIndex?: CanvasGraphIndex) {
    const index = graphIndex || createCanvasGraphIndex(nodes, connections);
    const contextNodes = contextNodeId ? getMentionResourceNodes(contextNodeId, nodes, connections, index) : [];
    const globalReferences = labelResourceNodes(nodes.filter(isResourceNode), false);
    const activeByNodeId = new Map(labelResourceNodes(contextNodes, true).map((reference) => [reference.nodeId, reference]));
    return globalReferences.map((reference) => activeByNodeId.get(reference.nodeId) || reference);
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

function getContextResourceNodes(nodeId: string, graphIndex: CanvasGraphIndex) {
    return incomingConnections(graphIndex, nodeId)
        .map((connection) => graphIndex.nodeById.get(connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isResourceNode(node)));
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
        const previewUrl = asset.kind === "image" ? asset.coverUrl || asset.data.dataUrl : asset.data.url;
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
