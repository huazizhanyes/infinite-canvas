import { describe, expect, it } from "vitest";

import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "./canvas-agent-ops";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function node(id: string, type = CanvasNodeType.Text): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} };
}

function snapshot(nodes: CanvasNodeData[], connections: CanvasConnection[] = []): CanvasAgentSnapshot {
    return { projectId: "project", title: "test", nodes, connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

describe("canvas agent connection operations", () => {
    it("does not create duplicate or reverse-duplicate connections", () => {
        const nodes = [node("image", CanvasNodeType.Image), node("video", CanvasNodeType.Video)];
        const existing = [{ id: "image-video", fromNodeId: "image", toNodeId: "video" }];
        const result = applyCanvasAgentOps(snapshot(nodes, existing), [
            { type: "connect_nodes", id: "duplicate", fromNodeId: "image", toNodeId: "video" },
            { type: "connect_nodes", id: "reverse", fromNodeId: "video", toNodeId: "image" },
        ]);

        expect(result.connections).toEqual(existing);
    });

    it("does not create a directed cycle", () => {
        const nodes = [node("a"), node("b"), node("c")];
        const existing = [
            { id: "ab", fromNodeId: "a", toNodeId: "b" },
            { id: "bc", fromNodeId: "b", toNodeId: "c" },
        ];
        const result = applyCanvasAgentOps(snapshot(nodes, existing), [{ type: "connect_nodes", id: "ca", fromNodeId: "c", toNodeId: "a" }]);

        expect(result.connections).toEqual(existing);
    });
});
