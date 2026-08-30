import { describe, expect, it } from "vitest";

import { buildCanvasResourceReferences, buildNodeMentionReferences, mentionedCanvasResourceReferences, mergeCanvasReferenceOrder, normalizeCanvasResourceMentions } from "@/lib/canvas/canvas-resource-references";
import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const references = [
    { label: "图片1", active: true },
    { label: "图片2", active: true },
];

describe("normalizeCanvasResourceMentions", () => {
    it("restores markers and separates a bare mention from following text", () => {
        expect(normalizeCanvasResourceMentions("图片1拿着铲子在猪圈赶猪图片2，一边骂骂咧咧", references)).toBe("@图片1 拿着铲子在猪圈赶猪@图片2，一边骂骂咧咧");
    });

    it("keeps existing markers without duplicating them", () => {
        expect(normalizeCanvasResourceMentions("@图片1 拿着铲子@图片2，一边骂骂咧咧", references)).toBe("@图片1 拿着铲子@图片2，一边骂骂咧咧");
    });

    it("leaves prompts without known references unchanged", () => {
        expect(normalizeCanvasResourceMentions("一边骂骂咧咧", references)).toBe("一边骂骂咧咧");
    });

    it("repairs accumulated legacy audio glyphs and stays idempotent", () => {
        const audioReferences = [{ label: "音频1", active: true }];
        const repaired = normalizeCanvasResourceMentions("男主声音参考音频@♫@♫@♪@音频1 继续生成", audioReferences);
        expect(repaired).toBe("男主声音参考音频@音频1 继续生成");
        expect(normalizeCanvasResourceMentions(repaired, audioReferences)).toBe(repaired);
    });
});

describe("buildNodeMentionReferences", () => {
    it("keeps canvas badge labels stable while hovering a connected target", () => {
        const image = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: `blob:${id}` } });
        const target: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { referenceOrder: ["image-b", "image-a"] } };
        const nodes = [target, image("image-a"), image("image-b")];
        const connections: CanvasConnection[] = [
            { id: "a", fromNodeId: "image-a", toNodeId: "video" },
            { id: "b", fromNodeId: "image-b", toNodeId: "video" },
        ];
        const idle = buildCanvasResourceReferences(nodes, connections, null);
        const hovered = buildCanvasResourceReferences(nodes, connections, "video");
        expect(hovered.map((reference) => [reference.nodeId, reference.label])).toEqual(idle.map((reference) => [reference.nodeId, reference.label]));
        expect(hovered.filter((reference) => reference.active).map((reference) => reference.nodeId)).toEqual(["image-a", "image-b"]);
    });

    it("keeps disconnected resources in their original positions when reconnected", () => {
        const target: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { referenceOrder: ["a", "b", "c"] } };
        const image = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: `blob:${id}` } });
        const nodes = [target, image("a"), image("b"), image("c")];
        const connections: CanvasConnection[] = [
            { id: "a", fromNodeId: "a", toNodeId: "video" },
            { id: "b", fromNodeId: "b", toNodeId: "video" },
        ];
        expect(mergeCanvasReferenceOrder("video", nodes, connections)).toEqual(["a", "b", "c"]);
        const reconnected = [...connections, { id: "c", fromNodeId: "c", toNodeId: "video" }];
        expect(mergeCanvasReferenceOrder("video", nodes, reconnected)).toEqual(["a", "b", "c"]);
    });

    it("uses referenceOrder before connection array order", () => {
        const target: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { referenceOrder: ["b", "a"] } };
        const image = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: `blob:${id}` } });
        const nodes = [target, image("a"), image("b")];
        const connections: CanvasConnection[] = [
            { id: "a", fromNodeId: "a", toNodeId: "video" },
            { id: "b", fromNodeId: "b", toNodeId: "video" },
        ];
        expect(buildNodeMentionReferences(target, nodes, connections).map((reference) => reference.nodeId)).toEqual(["b", "a"]);
    });

    it("keeps disconnected resources in the label map without marking them active", () => {
        const target: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { referenceOrder: ["a", "b", "c"] } };
        const image = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: `blob:${id}` } });
        const nodes = [target, image("a"), image("b"), image("c")];
        const connections: CanvasConnection[] = [
            { id: "a", fromNodeId: "a", toNodeId: "video" },
            { id: "c", fromNodeId: "c", toNodeId: "video" },
        ];

        expect(buildNodeMentionReferences(target, nodes, connections).map((reference) => [reference.label, reference.nodeId, reference.active])).toEqual([
            ["图片1", "a", true],
            ["图片2", "b", false],
            ["图片3", "c", true],
        ]);
    });

    it("appends a newly connected resource after stable disconnected slots", () => {
        const target: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { referenceOrder: ["a", "b", "c"] } };
        const image = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: `blob:${id}` } });
        const nodes = [target, image("a"), image("b"), image("c"), image("d")];
        const connections: CanvasConnection[] = [
            { id: "a", fromNodeId: "a", toNodeId: "video" },
            { id: "c", fromNodeId: "c", toNodeId: "video" },
            { id: "d", fromNodeId: "d", toNodeId: "video" },
        ];

        expect(buildNodeMentionReferences(target, nodes, connections).map((reference) => [reference.label, reference.nodeId, reference.active])).toEqual([
            ["图片1", "a", true],
            ["图片2", "b", false],
            ["图片3", "c", true],
            ["图片4", "d", true],
        ]);
    });

    it("matches image 10 without accidentally selecting image 1", () => {
        const target: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { referenceOrder: Array.from({ length: 10 }, (_, index) => `image-${index + 1}`) } };
        const images = Array.from({ length: 10 }, (_, index): CanvasNodeData => ({ id: `image-${index + 1}`, type: CanvasNodeType.Image, title: `图片${index + 1}`, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: `blob:${index + 1}` } }));
        const connections = images.map((image) => ({ id: `line-${image.id}`, fromNodeId: image.id, toNodeId: target.id }));
        const references = buildNodeMentionReferences(target, [target, ...images], connections);

        expect(mentionedCanvasResourceReferences("@图片10 出现", references).map((reference) => reference.nodeId)).toEqual(["image-10"]);
    });

    it("prefers a restored local image over an expired asset cover", () => {
        const node: CanvasNodeData = {
            id: "node-1",
            type: CanvasNodeType.Image,
            title: "图片节点",
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            metadata: { content: "blob:node-image" },
        };
        const asset: Asset = {
            id: "asset-1",
            kind: "image",
            title: "画布图片",
            coverUrl: "https://oss.example.test/expired.png",
            tags: [],
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
            data: {
                dataUrl: "blob:restored-local-image",
                storageKey: "image:u1:asset-1",
                width: 5504,
                height: 3072,
                bytes: 20_000_000,
                mimeType: "image/png",
            },
        };

        const reference = buildNodeMentionReferences(node, [node], [], undefined, [asset]).find((item) => item.source === "user-asset");

        expect(reference?.previewUrl).toBe("blob:restored-local-image");
    });
});
