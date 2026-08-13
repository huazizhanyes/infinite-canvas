import { describe, expect, it } from "vitest";

import { sameNodeGeometry } from "@/lib/canvas/canvas-geometry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node: CanvasNodeData = {
    id: "node-1",
    type: CanvasNodeType.Text,
    title: "文本",
    position: { x: 10, y: 20 },
    width: 320,
    height: 240,
    metadata: { content: "first" },
};

describe("sameNodeGeometry", () => {
    it("ignores content-only changes", () => {
        expect(sameNodeGeometry([node], [{ ...node, metadata: { content: "streamed" } }])).toBe(true);
    });

    it("detects position, size, order and membership changes", () => {
        expect(sameNodeGeometry([node], [{ ...node, position: { x: 11, y: 20 } }])).toBe(false);
        expect(sameNodeGeometry([node], [{ ...node, width: 321 }])).toBe(false);
        expect(sameNodeGeometry([node], [])).toBe(false);
        expect(sameNodeGeometry([node, { ...node, id: "node-2" }], [{ ...node, id: "node-2" }, node])).toBe(false);
    });
});
