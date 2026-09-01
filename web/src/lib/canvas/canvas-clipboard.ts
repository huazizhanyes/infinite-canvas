import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export function prepareCanvasNodeForClipboard(node: CanvasNodeData): CanvasNodeData {
    const metadata = node.metadata ? { ...node.metadata } : undefined;
    if (metadata?.status !== "loading") return { ...node, position: { ...node.position }, metadata };
    return {
        ...node,
        position: { ...node.position },
        metadata: {
            ...metadata,
            content: undefined,
            status: "idle",
            errorDetails: undefined,
            generationRequestId: undefined,
            videoTaskId: undefined,
            videoProvider: undefined,
            serverStorageKey: undefined,
            videoProgress: undefined,
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
