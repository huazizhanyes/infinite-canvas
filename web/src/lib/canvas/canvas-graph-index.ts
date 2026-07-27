import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

const EMPTY_CONNECTIONS: readonly CanvasConnection[] = [];

export type CanvasGraphIndex = {
    nodeById: ReadonlyMap<string, CanvasNodeData>;
    incomingByNodeId: ReadonlyMap<string, readonly CanvasConnection[]>;
    outgoingByNodeId: ReadonlyMap<string, readonly CanvasConnection[]>;
};

export function createCanvasGraphIndex(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasGraphIndex {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incomingByNodeId = new Map<string, CanvasConnection[]>();
    const outgoingByNodeId = new Map<string, CanvasConnection[]>();

    nodes.forEach((node) => {
        incomingByNodeId.set(node.id, []);
        outgoingByNodeId.set(node.id, []);
    });
    connections.forEach((connection) => {
        if (!nodeById.has(connection.fromNodeId) || !nodeById.has(connection.toNodeId)) return;
        incomingByNodeId.get(connection.toNodeId)?.push(connection);
        outgoingByNodeId.get(connection.fromNodeId)?.push(connection);
    });

    return { nodeById, incomingByNodeId, outgoingByNodeId };
}

export function incomingConnections(index: CanvasGraphIndex, nodeId: string) {
    return index.incomingByNodeId.get(nodeId) || EMPTY_CONNECTIONS;
}

export function outgoingConnections(index: CanvasGraphIndex, nodeId: string) {
    return index.outgoingByNodeId.get(nodeId) || EMPTY_CONNECTIONS;
}
