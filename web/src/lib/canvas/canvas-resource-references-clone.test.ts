import { describe, expect, it } from "vitest";

import { buildNodeMentionReferences, cloneIncomingCanvasConnections, mergeCanvasReferenceOrder } from "./canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

describe("cloneIncomingCanvasConnections", () => {
    it("copies every input connection to a regenerated video node", () => {
        let id = 0;
        const cloned = cloneIncomingCanvasConnections("old-video", "new-video", [
            { id: "image-line", fromNodeId: "image-1", toNodeId: "old-video" },
            { id: "audio-line", fromNodeId: "audio-1", toNodeId: "old-video" },
            { id: "output-line", fromNodeId: "old-video", toNodeId: "other" },
        ], () => `clone-${++id}`);

        expect(cloned).toEqual([
            { id: "clone-1", fromNodeId: "image-1", toNodeId: "new-video" },
            { id: "clone-2", fromNodeId: "audio-1", toNodeId: "new-video" },
        ]);
    });

    it("keeps the source display labels when a generated node clones references with gaps", () => {
        const source: CanvasNodeData = {
            id: "source-video",
            type: CanvasNodeType.Video,
            title: "来源视频",
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            metadata: { referenceOrder: ["a", "b", "c", "d", "e", "f"] },
        };
        const images: CanvasNodeData[] = ["a", "b", "c", "d", "e", "f"].map((id) => ({
            id,
            type: CanvasNodeType.Image,
            title: id.toUpperCase(),
            position: { x: 0, y: 0 },
            width: 100,
            height: 100,
            metadata: { content: `blob:${id}` },
        }));
        const connections: CanvasConnection[] = ["a", "b", "d", "e", "f"].map((id) => ({ id: `line-${id}`, fromNodeId: id, toNodeId: source.id }));
        const referenceOrder = mergeCanvasReferenceOrder(source.id, [source, ...images], connections);
        const generated: CanvasNodeData = { ...source, id: "generated-video", metadata: { referenceOrder } };
        const cloned = cloneIncomingCanvasConnections(source.id, generated.id, connections, () => crypto.randomUUID());

        expect(buildNodeMentionReferences(generated, [source, generated, ...images], cloned).map((reference) => [reference.nodeId, reference.label, reference.active])).toEqual([
            ["a", "图片1", true],
            ["b", "图片2", true],
            ["c", "图片3", false],
            ["d", "图片4", true],
            ["e", "图片5", true],
            ["f", "图片6", true],
        ]);
    });
});
