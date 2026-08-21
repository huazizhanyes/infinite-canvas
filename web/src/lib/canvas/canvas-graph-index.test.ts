import { describe, expect, it } from "vitest";

import { createCanvasGraphIndex, incomingConnections, outgoingConnections } from "@/lib/canvas/canvas-graph-index";
import { getGenerationResourceNodes, getMentionResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function node(id: string, type: CanvasNodeData["type"], content?: string): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: content ? { content } : undefined };
}

describe("canvas graph index", () => {
    it("indexes valid incoming and outgoing connections once", () => {
        const nodes = [node("a", CanvasNodeType.Image, "blob:a"), node("b", CanvasNodeType.Text)];
        const connections: CanvasConnection[] = [
            { id: "ab", fromNodeId: "a", toNodeId: "b" },
            { id: "missing", fromNodeId: "a", toNodeId: "missing" },
        ];
        const index = createCanvasGraphIndex(nodes, connections);

        expect(outgoingConnections(index, "a").map((item) => item.id)).toEqual(["ab"]);
        expect(incomingConnections(index, "b").map((item) => item.id)).toEqual(["ab"]);
        expect(incomingConnections(index, "missing")).toEqual([]);
    });

    it("uses direct inputs before own resources", () => {
        const nodes = [
            node("direct-input", CanvasNodeType.Text, "直接输入"),
            node("target", CanvasNodeType.Text, "自身文本"),
        ];
        const connections: CanvasConnection[] = [
            { id: "direct-target", fromNodeId: "direct-input", toNodeId: "target" },
        ];
        const index = createCanvasGraphIndex(nodes, connections);

        expect(getGenerationResourceNodes("target", nodes, connections, index).map((item) => item.id)).toEqual(["direct-input"]);
        expect(getMentionResourceNodes("target", nodes, [], createCanvasGraphIndex(nodes, [])).map((item) => item.id)).toEqual(["target"]);
    });
});
