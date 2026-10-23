import { describe, expect, it } from "vitest";

import { arrangePastedCanvasNodes, createCanvasNodeCopies, prepareCanvasNodeForClipboard, prepareCanvasNodeForDuplicate, remapCanvasClipboardConnections, selectCanvasClipboardConnections } from "./canvas-clipboard";
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

describe("prepareCanvasNodeForDuplicate", () => {
    it("clears a completed video while preserving its setup and references", () => {
        const referenceSlots = [{ slotId: "image:image-a", sourceNodeId: "image-a", mediaId: "reference-media", mediaType: "image" as const, order: 0, status: "ready" as const }];
        const duplicated = prepareCanvasNodeForDuplicate({
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
                referenceSlots,
                status: "success",
                content: "https://old.example/video.mp4",
                videoTaskId: "task-1",
                videoProvider: "canvas-video",
                videoResultUrl: "https://old.example/video.mp4",
                videoServerStorageKey: "generated/old.mp4",
                serverStorageKey: "generated/old.mp4",
                mediaId: "old-media",
                videoProgress: 100,
                durationMs: 5000,
            },
        });

        expect(duplicated.metadata).toMatchObject({
            prompt: "人物向前走",
            model: "video-model",
            referenceOrder: ["image-a"],
            referenceSlots,
            status: "idle",
        });
        expect(duplicated.metadata?.content).toBeUndefined();
        expect(duplicated.metadata?.videoTaskId).toBeUndefined();
        expect(duplicated.metadata?.videoResultUrl).toBeUndefined();
        expect(duplicated.metadata?.videoServerStorageKey).toBeUndefined();
        expect(duplicated.metadata?.serverStorageKey).toBeUndefined();
        expect(duplicated.metadata?.mediaId).toBeUndefined();
        expect(duplicated.metadata?.videoProgress).toBeUndefined();
        expect(duplicated.metadata?.durationMs).toBeUndefined();
    });

    it("does not change completed non-video nodes", () => {
        const image = prepareCanvasNodeForDuplicate({
            id: "image",
            type: CanvasNodeType.Image,
            title: "图片",
            position: { x: 0, y: 0 },
            width: 100,
            height: 100,
            metadata: { content: "https://old.example/image.png", status: "success", mediaId: "image-media" },
        });

        expect(image.metadata).toMatchObject({ content: "https://old.example/image.png", status: "success", mediaId: "image-media" });
    });
});

describe("createCanvasNodeCopies", () => {
    const imageNode: CanvasNodeData = {
        id: "image-a",
        type: CanvasNodeType.Image,
        title: "图片",
        position: { x: 10, y: 20 },
        width: 100,
        height: 80,
        metadata: { content: "https://old.example/image.png", status: "success", groupId: "group-1", batchRootId: "batch-1" },
    };

    it("offsets every copy and drops group/batch links that point outside the copied set", () => {
        const copies = createCanvasNodeCopies([imageNode], { x: 30, y: 40 });

        expect(copies).toHaveLength(1);
        expect(copies[0].id).not.toBe(imageNode.id);
        expect(copies[0].title).toBe("图片 Copy");
        expect(copies[0].position).toEqual({ x: 40, y: 60 });
        expect(copies[0].metadata).toMatchObject({ content: "https://old.example/image.png", status: "success" });
        expect(copies[0].metadata?.groupId).toBeUndefined();
        expect(copies[0].metadata?.batchRootId).toBeUndefined();
    });

    it("remaps group and batch links that stay inside the copied set", () => {
        const copies = createCanvasNodeCopies([
            { id: "group-1", type: CanvasNodeType.Group, title: "组", position: { x: 0, y: 0 }, width: 400, height: 400 },
            { id: "batch-1", type: CanvasNodeType.Image, title: "批次", position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { isBatchRoot: true, batchChildIds: ["image-a"], primaryImageId: "image-a" } },
            imageNode,
        ], { x: 200, y: 0 });

        const [groupCopy, batchCopy, childCopy] = copies;
        expect(childCopy.metadata?.groupId).toBe(groupCopy.id);
        expect(childCopy.metadata?.batchRootId).toBe(batchCopy.id);
        expect(batchCopy.metadata?.batchChildIds).toEqual([childCopy.id]);
        expect(batchCopy.metadata?.primaryImageId).toBe(childCopy.id);
    });

    it("keeps the duplicate button semantics for videos instead of copying the video result", () => {
        const copies = createCanvasNodeCopies([{
            id: "video-a",
            type: CanvasNodeType.Video,
            title: "视频",
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            metadata: { prompt: "人物向前走", model: "video-model", status: "success", content: "https://old.example/video.mp4", videoResultUrl: "https://old.example/video.mp4", videoTaskId: "task-1", mediaId: "old-media" },
        }], { x: 10, y: 10 });

        expect(copies[0].metadata).toMatchObject({ prompt: "人物向前走", model: "video-model", status: "idle" });
        expect(copies[0].metadata?.content).toBeUndefined();
        expect(copies[0].metadata?.videoResultUrl).toBeUndefined();
        expect(copies[0].metadata?.videoTaskId).toBeUndefined();
        expect(copies[0].metadata?.mediaId).toBeUndefined();
    });
});

describe("arrangePastedCanvasNodes", () => {
    const node = (id: string, position = { x: 0, y: 0 }): CanvasNodeData => ({
        id,
        type: CanvasNodeType.Image,
        title: id,
        position,
        width: 100,
        height: 80,
    });

    it("arranges overlapping pasted nodes into a grid", () => {
        const arranged = arrangePastedCanvasNodes([node("a"), node("b"), node("c"), node("d")], [], { x: 500, y: 400 });

        expect(arranged.map((item) => item.position)).toEqual([
            { x: 376, y: 296 },
            { x: 524, y: 296 },
            { x: 376, y: 424 },
            { x: 524, y: 424 },
        ]);
    });

    it("moves repeated pastes to an available position", () => {
        const arranged = arrangePastedCanvasNodes([node("copy")], [node("existing", { x: 450, y: 360 })], { x: 500, y: 400 });

        expect(arranged[0].position).toEqual({ x: 598, y: 360 });
    });
});
