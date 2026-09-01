import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

export type CanvasConnectionIssue = "missing-node" | "self" | "group" | "media-not-ready" | "incompatible" | "duplicate" | "reverse-duplicate" | "cycle";

export type CanvasConnectionValidation =
    | { ok: true }
    | { ok: false; issue: CanvasConnectionIssue; message: string };

export function orientCanvasConnection(startNodeId: string, otherNodeId: string, startHandleType: "source" | "target") {
    if (!startNodeId || !otherNodeId || startNodeId === otherNodeId) return null;
    return startHandleType === "source"
        ? { fromNodeId: startNodeId, toNodeId: otherNodeId }
        : { fromNodeId: otherNodeId, toNodeId: startNodeId };
}

export function validateCanvasConnection(nodes: CanvasNodeData[], connections: CanvasConnection[], fromNodeId: string, toNodeId: string, options?: { allowIncompatible?: boolean; allowUnavailableMedia?: boolean }): CanvasConnectionValidation {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const from = nodeById.get(fromNodeId);
    const to = nodeById.get(toNodeId);
    if (!from || !to) return invalid("missing-node", "连接节点不存在");
    if (from.id === to.id) return invalid("self", "节点不能连接自身");
    if (from.type === CanvasNodeType.Group || to.type === CanvasNodeType.Group) return invalid("group", "分组节点不能建立数据连接");
    if (!options?.allowUnavailableMedia && from.metadata?.storageKey && from.metadata.mediaStatus !== "synced") return invalid("media-not-ready", "媒体尚未上传完成");

    const duplicate = connections.find((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId);
    if (duplicate) return invalid("duplicate", "这两个节点已经连接");
    const reverse = connections.find((connection) => connection.fromNodeId === toNodeId && connection.toNodeId === fromNodeId);
    if (reverse) return invalid("reverse-duplicate", "这两个节点已经存在反向连接");
    if (!options?.allowIncompatible && !isCompatibleConnection(from, to)) return invalid("incompatible", `${from.title || "上游节点"}不能作为${to.title || "下游节点"}的输入`);
    if (hasDirectedPath(connections, toNodeId, fromNodeId)) return invalid("cycle", "该连接会形成循环依赖");
    return { ok: true };
}

export function appendValidCanvasConnections(nodes: CanvasNodeData[], connections: CanvasConnection[], candidates: CanvasConnection[]) {
    return candidates.reduce<CanvasConnection[]>((current, candidate) => {
        return validateCanvasConnection(nodes, current, candidate.fromNodeId, candidate.toNodeId).ok ? [...current, candidate] : current;
    }, connections);
}

/** Normalize persisted legacy graphs without guessing or reversing ambiguous edges. */
export function normalizePersistedCanvasConnections(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections.reduce<CanvasConnection[]>((current, connection) => {
        return validateCanvasConnection(nodes, current, connection.fromNodeId, connection.toNodeId, { allowIncompatible: true, allowUnavailableMedia: true }).ok ? [...current, connection] : current;
    }, []);
}

function hasDirectedPath(connections: CanvasConnection[], startNodeId: string, targetNodeId: string) {
    const outgoing = new Map<string, string[]>();
    connections.forEach((connection) => {
        const targets = outgoing.get(connection.fromNodeId) || [];
        targets.push(connection.toNodeId);
        outgoing.set(connection.fromNodeId, targets);
    });
    const pending = [startNodeId];
    const visited = new Set<string>();
    while (pending.length) {
        const nodeId = pending.pop()!;
        if (nodeId === targetNodeId) return true;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        pending.push(...(outgoing.get(nodeId) || []));
    }
    return false;
}

function isCompatibleConnection(from: CanvasNodeData, to: CanvasNodeData) {
    if (to.type === CanvasNodeType.ScriptAsset) {
        if (from.type === CanvasNodeType.AssetExtraction) return true;
        return from.type === CanvasNodeType.ScriptAsset && Boolean(from.metadata?.scriptAssetType) && from.metadata?.scriptAssetType === to.metadata?.scriptAssetType;
    }
    return isCompatibleCanvasNodeTypes(from.type, to.type);
}

export function isCompatibleCanvasNodeTypes(fromType: CanvasNodeData["type"], toType: CanvasNodeData["type"]) {
    if (toType === CanvasNodeType.ScriptAsset) return fromType === CanvasNodeType.AssetExtraction || fromType === CanvasNodeType.ScriptAsset;
    const outputKind = knownOutputKind(fromType);
    const acceptedKinds = knownAcceptedKinds(toType);
    return !outputKind || !acceptedKinds || acceptedKinds.includes(outputKind);
}

export function isCompatibleCanvasConnectionFromHandle(startType: CanvasNodeData["type"], otherType: CanvasNodeData["type"], startHandleType: "source" | "target") {
    return startHandleType === "source"
        ? isCompatibleCanvasNodeTypes(startType, otherType)
        : isCompatibleCanvasNodeTypes(otherType, startType);
}

export function canvasConnectionDropPriority(node: CanvasNodeData, point: Position, anchor: Position, scale: number, paddingPx = 32, handleRadiusPx = 16) {
    const safeScale = Math.max(scale, 0.05);
    const padding = paddingPx / safeScale;
    const handleRadius = handleRadiusPx / safeScale;
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const distance = dx * dx + dy * dy;
    const hitsHandle = distance <= handleRadius * handleRadius;
    const hitsInside = point.x >= node.position.x && point.x <= node.position.x + node.width && point.y >= node.position.y && point.y <= node.position.y + node.height;
    const hitsExpanded = point.x >= node.position.x - padding && point.x <= node.position.x + node.width + padding && point.y >= node.position.y - padding && point.y <= node.position.y + node.height + padding;
    if (!hitsExpanded) return null;
    return (hitsHandle ? 0 : hitsInside ? 1 : 2) * 1_000_000_000_000 + distance;
}

function knownOutputKind(type: CanvasNodeData["type"]) {
    if (type === CanvasNodeType.Text) return "text";
    if (type === CanvasNodeType.Image || type === CanvasNodeType.ScriptAsset) return "image";
    if (type === CanvasNodeType.Video) return "video";
    if (type === CanvasNodeType.Audio) return "audio";
    return null;
}

function knownAcceptedKinds(type: CanvasNodeData["type"]): string[] | null {
    if (type === CanvasNodeType.Text) return ["text", "image"];
    if (type === CanvasNodeType.Image) return ["text", "image"];
    if (type === CanvasNodeType.Video) return ["text", "image", "video", "audio"];
    if (type === CanvasNodeType.Audio) return ["text", "audio"];
    if (type === CanvasNodeType.AssetExtraction) return ["text"];
    return null;
}

function invalid(issue: CanvasConnectionIssue, message: string): CanvasConnectionValidation {
    return { ok: false, issue, message };
}
