import { describe, expect, it } from "vitest";

import { buildNodeGenerationContext } from "./canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { buildNodeMentionReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { ImageAsset } from "@/stores/use-asset-store";

const target: CanvasNodeData = {
    id: "target",
    type: CanvasNodeType.Image,
    title: "目标",
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata: {},
};

describe("buildNodeGenerationContext asset mentions", () => {
    it("passes connected script asset images as generation references", () => {
        const assetNode: CanvasNodeData = {
            id: "script-asset-1",
            type: CanvasNodeType.ScriptAsset,
            title: "林夏",
            position: { x: 0, y: 0 },
            width: 560,
            height: 320,
            metadata: { content: "blob:asset-image", mimeType: "image/png", scriptAssetId: "asset-1" },
        };
        const context = buildNodeGenerationContext(target.id, [target, assetNode], [{ id: "line", fromNodeId: assetNode.id, toNodeId: target.id }], "让人物走进车站");
        expect(context.referenceImages).toEqual([{ id: assetNode.id, name: "林夏.png", type: "image/png", dataUrl: "blob:asset-image", storageKey: undefined }]);
    });

    it("uses an image connected from a video's right handle as a mention and generation reference", () => {
        const video: CanvasNodeData = { ...target, id: "video", type: CanvasNodeType.Video, title: "视频", metadata: { content: "blob:video" } };
        const image: CanvasNodeData = { ...target, id: "image", title: "图片", metadata: { content: "blob:image", mimeType: "image/png" } };
        const connections = [{ id: "line", fromNodeId: video.id, toNodeId: image.id }];

        const references = buildNodeMentionReferences(video, [video, image], connections);
        const context = buildNodeGenerationContext(video.id, [video, image], connections, "让图片动起来", references);

        expect(references.map((reference) => reference.nodeId)).toEqual([image.id]);
        expect(context.referenceImages).toEqual([{ id: image.id, name: "图片.png", type: "image/png", dataUrl: "blob:image", storageKey: undefined }]);
    });

    it("passes a connected uploaded audio as a synthesis reference", () => {
        const audioTarget: CanvasNodeData = { ...target, id: "audio-target", type: CanvasNodeType.Audio, title: "配音", metadata: {} };
        const uploadedAudio: CanvasNodeData = {
            ...target,
            id: "voice-sample",
            type: CanvasNodeType.Audio,
            title: "参考声音.wav",
            metadata: { content: "blob:voice", storageKey: "audio:u1:voice", mediaId: "media-voice-1", mimeType: "audio/wav", durationMs: 5000 },
        };

        const context = buildNodeGenerationContext(audioTarget.id, [audioTarget, uploadedAudio], [{ id: "audio-line", fromNodeId: uploadedAudio.id, toNodeId: audioTarget.id }], "我是虾仁");

        expect(context.referenceAudios).toEqual([{ id: "voice-sample", name: "参考声音.wav", type: "audio/wav", url: "blob:voice", storageKey: "audio:u1:voice", mediaId: "media-voice-1", durationMs: 5000 }]);
    });

    it("uses an uploaded audio node as its own reference before creating the generated child", () => {
        const uploadedAudio: CanvasNodeData = {
            ...target,
            id: "uploaded-audio",
            type: CanvasNodeType.Audio,
            title: "参考音.wav",
            metadata: { content: "blob:voice", storageKey: "audio:u1:voice", mediaId: "media-voice-1", mimeType: "audio/wav", sourceType: "upload" },
        };

        const context = buildNodeGenerationContext(uploadedAudio.id, [uploadedAudio], [], "你好");

        expect(context.referenceAudios).toEqual([expect.objectContaining({ mediaId: "media-voice-1", name: "参考音.wav" })]);
    });

    it("only includes user assets mentioned in the prompt", () => {
        const references: CanvasResourceReference[] = [
            { id: "asset:image-1", nodeId: "asset:image-1", source: "user-asset", assetId: "image-1", kind: "image", label: "资产·秦墨", title: "秦墨", previewUrl: "blob:image", storageKey: "image-key", mimeType: "image/png", active: true },
            { id: "asset:video-1", nodeId: "asset:video-1", source: "user-asset", assetId: "video-1", kind: "video", label: "资产·庭院视频", title: "庭院视频", previewUrl: "blob:video", storageKey: "video-key", mimeType: "video/mp4", active: true },
        ];

        const context = buildNodeGenerationContext(target.id, [target], [], "让资产·秦墨站在庭院中", references);

        expect(context.referenceImages).toEqual([{ id: "image-1", name: "秦墨.png", type: "image/png", dataUrl: "blob:image", storageKey: "image-key" }]);
        expect(context.referenceVideos).toEqual([]);
    });

    it("gives same-title assets distinct mention labels", () => {
        const image = (id: string): ImageAsset => ({
            id,
            kind: "image",
            title: "秦墨",
            coverUrl: `blob:${id}`,
            tags: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            data: { dataUrl: `blob:${id}`, width: 100, height: 100, bytes: 1, mimeType: "image/png" },
        });

        const references = buildNodeMentionReferences(target, [target], [], undefined, [image("one"), image("two")]);

        expect(references.filter((reference) => reference.source === "user-asset").map((reference) => reference.label)).toEqual(["资产·秦墨·1", "资产·秦墨·2"]);
    });
});
