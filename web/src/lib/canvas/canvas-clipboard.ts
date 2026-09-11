import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

const PASTE_LAYOUT_GAP = 48;
const PASTE_COLLISION_GAP = 24;

export function prepareCanvasNodeForClipboard(node: CanvasNodeData): CanvasNodeData {
    const metadata = node.metadata ? { ...node.metadata } : undefined;
    if (metadata?.status !== "loading") {
        return {
            ...node,
            position: { ...node.position },
            metadata: metadata ? {
                ...metadata,
                generationRequestId: undefined,
                imageTaskId: undefined,
                imageTaskStatus: undefined,
                imageTaskProgress: undefined,
                imageTaskStartedAt: undefined,
                imageTaskUpdatedAt: undefined,
                imageTaskTargetIds: undefined,
                imageErrorCode: undefined,
                imageErrorMessage: undefined,
            } : undefined,
        };
    }
    return {
        ...node,
        position: { ...node.position },
        metadata: {
            ...metadata,
            content: undefined,
            status: "idle",
            errorDetails: undefined,
            generationRequestId: undefined,
            imageTaskId: undefined,
            imageTaskStatus: undefined,
            imageTaskProgress: undefined,
            imageTaskStartedAt: undefined,
            imageTaskUpdatedAt: undefined,
            imageTaskTargetIds: undefined,
            imageErrorCode: undefined,
            imageErrorMessage: undefined,
            videoTaskId: undefined,
            videoProvider: undefined,
            serverStorageKey: undefined,
            videoProgress: undefined,
            videoProgressStartedAt: undefined,
            videoProgressEstimateMs: undefined,
            videoProgressSampleCount: undefined,
            videoPhase: undefined,
            videoCanCancel: undefined,
            videoQueuePosition: undefined,
            estimatedCostCredits: undefined,
            chargedCredits: undefined,
            videoBalanceAfter: undefined,
            videoBillingStatus: undefined,
            videoRouteLabel: undefined,
            pricingVersion: undefined,
            audioTaskId: undefined,
            storageKey: undefined,
            mediaId: undefined,
            mediaStatus: undefined,
            mimeType: undefined,
            bytes: undefined,
            durationMs: undefined,
            naturalWidth: undefined,
            naturalHeight: undefined,
            referenceSlots: undefined,
            submittedReferenceOrder: undefined,
            submittedReferenceLabelMap: undefined,
            submittedImageReferences: undefined,
            submissionPrompt: undefined,
        },
    };
}

export function prepareCanvasNodeForDuplicate(node: CanvasNodeData): CanvasNodeData {
    if (node.type !== CanvasNodeType.Video || !node.metadata) return prepareCanvasNodeForClipboard(node);

    return {
        ...node,
        position: { ...node.position },
        metadata: {
            ...node.metadata,
            content: undefined,
            status: "idle",
            errorDetails: undefined,
            generationRequestId: undefined,
            imageTaskId: undefined,
            imageTaskStatus: undefined,
            imageTaskProgress: undefined,
            imageTaskStartedAt: undefined,
            imageTaskUpdatedAt: undefined,
            imageTaskTargetIds: undefined,
            imageErrorCode: undefined,
            imageErrorMessage: undefined,
            videoTaskId: undefined,
            videoProvider: undefined,
            videoResultUrl: undefined,
            videoServerStorageKey: undefined,
            videoCompletedAt: undefined,
            regenerationError: undefined,
            serverStorageKey: undefined,
            videoProgress: undefined,
            videoProgressStartedAt: undefined,
            videoProgressEstimateMs: undefined,
            videoProgressSampleCount: undefined,
            videoPhase: undefined,
            videoErrorCode: undefined,
            videoErrorMessage: undefined,
            videoCanCancel: undefined,
            videoQueuePosition: undefined,
            estimatedCostCredits: undefined,
            chargedCredits: undefined,
            videoBalanceAfter: undefined,
            videoBillingStatus: undefined,
            videoRouteLabel: undefined,
            pricingVersion: undefined,
            storageKey: undefined,
            mediaId: undefined,
            mediaStatus: undefined,
            mimeType: undefined,
            bytes: undefined,
            durationMs: undefined,
        },
    };
}

export function selectCanvasClipboardConnections(connections: CanvasConnection[], selectedNodeIds: ReadonlySet<string>) {
    return connections.filter((connection) => selectedNodeIds.has(connection.fromNodeId) || selectedNodeIds.has(connection.toNodeId));
}

export function remapCanvasClipboardConnections(connections: CanvasConnection[], nodeIdMap: ReadonlyMap<string, string>, createId: () => string) {
    return connections.map((connection) => ({
        ...connection,
        id: createId(),
        fromNodeId: nodeIdMap.get(connection.fromNodeId) ?? connection.fromNodeId,
        toNodeId: nodeIdMap.get(connection.toNodeId) ?? connection.toNodeId,
    }));
}

/** Keep pasted groups readable and move repeated pastes away from existing nodes. */
export function arrangePastedCanvasNodes(nodes: CanvasNodeData[], existingNodes: CanvasNodeData[], center: Position) {
    if (!nodes.length) return nodes;
    const laidOutNodes = hasOverlappingNodes(nodes) ? arrangeOverlappingNodes(nodes, center) : nodes;
    const bounds = nodeBounds(laidOutNodes);
    const groupCenter = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
    const stepX = Math.max(bounds.right - bounds.left + PASTE_LAYOUT_GAP, PASTE_LAYOUT_GAP * 2);
    const stepY = Math.max(bounds.bottom - bounds.top + PASTE_LAYOUT_GAP, PASTE_LAYOUT_GAP * 2);

    for (let radius = 0; radius <= 20; radius += 1) {
        const offsets = pasteSpiralOffsets(radius);
        for (const offset of offsets) {
            const dx = center.x + offset.x * stepX - groupCenter.x;
            const dy = center.y + offset.y * stepY - groupCenter.y;
            const candidate = laidOutNodes.map((node) => ({ ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }));
            if (!overlapsExistingNodes(candidate, existingNodes)) return candidate;
        }
    }

    return laidOutNodes;
}

function hasOverlappingNodes(nodes: CanvasNodeData[]) {
    for (let index = 0; index < nodes.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
            if (rectanglesOverlap(nodes[index], nodes[otherIndex])) return true;
        }
    }
    return false;
}

function arrangeOverlappingNodes(nodes: CanvasNodeData[], center: Position) {
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
    const rows = Math.ceil(nodes.length / columns);
    const cellWidth = Math.max(...nodes.map((node) => node.width));
    const cellHeight = Math.max(...nodes.map((node) => node.height));
    const startX = center.x - (columns * cellWidth + (columns - 1) * PASTE_LAYOUT_GAP) / 2;
    const startY = center.y - (rows * cellHeight + (rows - 1) * PASTE_LAYOUT_GAP) / 2;

    return nodes.map((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
            ...node,
            position: {
                x: startX + column * (cellWidth + PASTE_LAYOUT_GAP) + (cellWidth - node.width) / 2,
                y: startY + row * (cellHeight + PASTE_LAYOUT_GAP) + (cellHeight - node.height) / 2,
            },
        };
    });
}

function pasteSpiralOffsets(radius: number) {
    if (radius === 0) return [{ x: 0, y: 0 }];
    return [
        { x: radius, y: 0 },
        { x: 0, y: radius },
        { x: -radius, y: 0 },
        { x: 0, y: -radius },
        { x: radius, y: radius },
        { x: -radius, y: radius },
        { x: -radius, y: -radius },
        { x: radius, y: -radius },
    ];
}

function overlapsExistingNodes(nodes: CanvasNodeData[], existingNodes: CanvasNodeData[]) {
    return nodes.some((node) => existingNodes.some((existing) => rectanglesOverlap(node, existing, PASTE_COLLISION_GAP)));
}

function rectanglesOverlap(first: CanvasNodeData, second: CanvasNodeData, gap = 0) {
    return first.position.x < second.position.x + second.width + gap
        && first.position.x + first.width + gap > second.position.x
        && first.position.y < second.position.y + second.height + gap
        && first.position.y + first.height + gap > second.position.y;
}

function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (bounds, node) => ({
            left: Math.min(bounds.left, node.position.x),
            top: Math.min(bounds.top, node.position.y),
            right: Math.max(bounds.right, node.position.x + node.width),
            bottom: Math.max(bounds.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}
