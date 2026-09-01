import { describe, expect, it } from "vitest";

import { prepareCanvasNodeForClipboard, remapCanvasClipboardConnections, selectCanvasClipboardConnections } from "./canvas-clipboard";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const connections = [
    { id: "incoming", fromNodeId: "outside-in", toNodeId: "selected-a" },
    { id: "internal", fromNodeId: "selected-a", toNodeId: "selected-b" },
    { id: "outgoing", fromNodeId: "selected-b", toNodeId: "outside-out" },
    { id: "outside", fromNodeId: "outside-in", toNodeId: "outside-out" },
];

describe("canvas clipboard connections", () => {
    it("copies incoming and outgoing connections for a single selected node", () => {
        const selected = selectCanvasClipboardConnections(connections, new Set(["selected-a"]));

        expect(selected.map((connection) => connection.id)).toEqual(["incoming", "internal"]);
    });

    it("copies internal and boundary connections for a multi-node selection", () => {
        const selected = selectCanvasClipboardConnections(connections, new Set(["selected-a", "selected-b"]));

        expect(selected.map((connection) => connection.id)).toEqual(["incoming", "internal", "outgoing"]);
    });

    it("maps copied endpoints while preserving endpoints outside the selection", () => {
        let index = 0;
        const remapped = remapCanvasClipboardConnections(
            selectCanvasClipboardConnections(connections, new Set(["selected-a", "selected-b"])),
            new Map([["selected-a", "copy-a"], ["selected-b", "copy-b"]]),
            () => `copy-line-${++index}`,
        );

        expect(remapped).toEqual([
            { id: "copy-line-1", fromNodeId: "outside-in", toNodeId: "copy-a" },
            { id: "copy-line-2", fromNodeId: "copy-a", toNodeId: "copy-b" },
            { id: "copy-line-3", fromNodeId: "copy-b", toNodeId: "outside-out" },
        ]);
    });
});

describe("prepareCanvasNodeForClipboard", () => {
    const videoNode: CanvasNodeData = {
        id: "video",
        type: CanvasNodeType.Video,
        title: "视频",
        position: { x: 10, y: 20 },
        width: 320,
        height: 240,
        metadata: {
            prompt: "人物向前走",
            model: "video-model",
            referenceOrder: ["image-a"],
            status: "loading",
            generationRequestId: "request-1",
            videoTaskId: "task-1",
            videoProgress: 42,
            content: "https://old.example/video.mp4",
            mediaId: "old-media",
            mediaStatus: "synced",
        },
    };

    it("turns a generating copy into an idle empty node while preserving its editable setup", () => {
        const copied = prepareCanvasNodeForClipboard(videoNode);

        expect(copied.metadata).toMatchObject({ prompt: "人物向前走", model: "video-model", referenceOrder: ["image-a"], status: "idle" });
        expect(copied.metadata?.generationRequestId).toBeUndefined();
        expect(copied.metadata?.videoTaskId).toBeUndefined();
        expect(copied.metadata?.videoProgress).toBeUndefined();
        expect(copied.metadata?.content).toBeUndefined();
        expect(copied.metadata?.mediaId).toBeUndefined();
    });

    it("keeps completed media content when the source is not generating", () => {
        const copied = prepareCanvasNodeForClipboard({ ...videoNode, metadata: { ...videoNode.metadata, status: "success" } });

        expect(copied.metadata?.status).toBe("success");
        expect(copied.metadata?.content).toBe("https://old.example/video.mp4");
        expect(copied.metadata?.mediaId).toBe("old-media");
    });
});
