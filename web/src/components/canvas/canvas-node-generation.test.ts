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

    it("uses an image connected into a video's left input as a generation reference", () => {
        const video: CanvasNodeData = { ...target, id: "video", type: CanvasNodeType.Video, title: "视频", metadata: { content: "blob:video" } };
        const image: CanvasNodeData = { ...target, id: "image", title: "图片", metadata: { content: "blob:image", mimeType: "image/png" } };
        const connections = [{ id: "line", fromNodeId: image.id, toNodeId: video.id }];

        const references = buildNodeMentionReferences(video, [video, image], connections);
        const context = buildNodeGenerationContext(video.id, [video, image], connections, "@图片1 让图片动起来", references);

        expect(references.map((reference) => reference.nodeId)).toEqual([image.id]);
        expect(context.referenceImages).toEqual([{ id: image.id, name: "图片.png", type: "image/png", dataUrl: "blob:image", storageKey: undefined }]);
    });

    it("does not consume a resource connected from the target's right output", () => {
        const video: CanvasNodeData = { ...target, id: "video", type: CanvasNodeType.Video, title: "视频", metadata: { content: "blob:video" } };
        const image: CanvasNodeData = { ...target, id: "image", title: "图片", metadata: { content: "blob:image", mimeType: "image/png" } };
        const connections = [{ id: "line", fromNodeId: video.id, toNodeId: image.id }];

        expect(buildNodeMentionReferences(video, [video, image], connections).some((reference) => reference.nodeId === image.id)).toBe(false);
        expect(buildNodeGenerationContext(video.id, [video, image], connections, "@图片1", []).referenceImages).toEqual([]);
    });

    it("uploads only connected images explicitly mentioned by a video prompt without changing stable order", () => {
        const video: CanvasNodeData = { ...target, id: "video", type: CanvasNodeType.Video, title: "视频", metadata: { referenceOrder: ["a", "b", "c", "d", "e"] } };
        const images = ["a", "b", "c", "d", "e"].map((id) => ({ ...target, id, title: id.toUpperCase(), metadata: { content: `blob:${id}`, mimeType: "image/png" } }));
        const connections = images.map((image) => ({ id: `line-${image.id}`, fromNodeId: image.id, toNodeId: video.id }));
        const references = buildNodeMentionReferences(video, [video, ...images], connections);
        const context = buildNodeGenerationContext(video.id, [video, ...images], connections, "@图片5、@图片2、@图片4、@图片1", references);

        expect(context.referenceImages.map((image) => image.id)).toEqual(["a", "b", "d", "e"]);
        expect(context.selectedReferenceNodeIds).toEqual(["a", "b", "d", "e"]);
        expect(context.submissionPrompt).toBe("@图片4、@图片2、@图片3、@图片1");
        expect(context.referenceLabelMapping).toEqual({ 图片1: "图片1", 图片2: "图片2", 图片4: "图片3", 图片5: "图片4" });
    });

    it("ignores a mentioned image after its line is disconnected and does not rebind its label", () => {
        const video: CanvasNodeData = { ...target, id: "video", type: CanvasNodeType.Video, title: "视频", metadata: { referenceOrder: ["a", "b", "c"] } };
        const images = ["a", "b", "c"].map((id) => ({ ...target, id, title: id.toUpperCase(), metadata: { content: `blob:${id}`, mimeType: "image/png" } }));
        const connections = [
            { id: "line-a", fromNodeId: "a", toNodeId: video.id },
            { id: "line-c", fromNodeId: "c", toNodeId: video.id },
        ];
        const references = buildNodeMentionReferences(video, [video, ...images], connections);
        const context = buildNodeGenerationContext(video.id, [video, ...images], connections, "@图片2 离线，@图片3 保留", references);

        expect(references.filter((reference) => reference.source === "canvas").map((reference) => [reference.label, reference.nodeId, reference.active])).toEqual([
            ["图片1", "a", true],
            ["图片2", "b", false],
            ["图片3", "c", true],
        ]);
        expect(context.referenceImages.map((image) => image.id)).toEqual(["c"]);
        expect(context.ignoredReferenceLabels).toEqual(["图片2"]);
        expect(context.submissionPrompt).toBe("离线，@图片1 保留");
    });

    it("does not upload connected video images that are not mentioned", () => {
        const video: CanvasNodeData = { ...target, id: "video", type: CanvasNodeType.Video, title: "视频", metadata: { referenceOrder: ["a", "b"] } };
        const images = ["a", "b"].map((id) => ({ ...target, id, title: id.toUpperCase(), metadata: { content: `blob:${id}`, mimeType: "image/png" } }));
        const connections = images.map((image) => ({ id: `line-${image.id}`, fromNodeId: image.id, toNodeId: video.id }));
        const references = buildNodeMentionReferences(video, [video, ...images], connections);
        const context = buildNodeGenerationContext(video.id, [video, ...images], connections, "@图片1 作为唯一参考", references);

        expect(context.referenceImages.map((image) => image.id)).toEqual(["a"]);
    });

    it("does not upload a connected video unless the video prompt mentions it", () => {
        const targetVideo: CanvasNodeData = { ...target, id: "video-target", type: CanvasNodeType.Video, title: "目标视频", metadata: { referenceOrder: ["source-video"] } };
        const sourceVideo: CanvasNodeData = { ...target, id: "source-video", type: CanvasNodeType.Video, title: "参考视频", metadata: { content: "blob:source-video", mimeType: "video/mp4" } };
        const connections = [{ id: "line-video", fromNodeId: sourceVideo.id, toNodeId: targetVideo.id }];
        const references = buildNodeMentionReferences(targetVideo, [targetVideo, sourceVideo], connections);

        expect(buildNodeGenerationContext(targetVideo.id, [targetVideo, sourceVideo], connections, "只使用文字生成", references).referenceVideos).toEqual([]);
        expect(buildNodeGenerationContext(targetVideo.id, [targetVideo, sourceVideo], connections, "参考 @视频1 的动作", references).referenceVideos.map((video) => video.id)).toEqual([sourceVideo.id]);
    });

    it("keeps stable reference order when node and connection order differ", () => {
        const video: CanvasNodeData = { ...target, id: "video", type: CanvasNodeType.Video, title: "视频", metadata: { referenceOrder: ["image-b", "image-a"] } };
        const imageA: CanvasNodeData = { ...target, id: "image-a", type: CanvasNodeType.ScriptAsset, title: "A", metadata: { content: "blob:a", mimeType: "image/png", scriptAssetId: "a" } };
        const imageB: CanvasNodeData = { ...target, id: "image-b", type: CanvasNodeType.ScriptAsset, title: "B", metadata: { content: "blob:b", mimeType: "image/png", scriptAssetId: "b" } };
        const connections = [
            { id: "line-a", fromNodeId: imageA.id, toNodeId: video.id },
            { id: "line-b", fromNodeId: imageB.id, toNodeId: video.id },
        ];

        const references = buildNodeMentionReferences(video, [video, imageA, imageB], connections);
        const context = buildNodeGenerationContext(video.id, [video, imageA, imageB], connections, "@图片1 是B，@图片2 是A", references);

        expect(references.map((reference) => [reference.label, reference.nodeId])).toEqual([["图片1", imageB.id], ["图片2", imageA.id]]);
        expect(context.referenceImages.map((image) => image.id)).toEqual([imageB.id, imageA.id]);
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

    it("uploads manually mentioned assets in prompt order", () => {
        const references: CanvasResourceReference[] = [
            { id: "asset:image-a", nodeId: "asset:image-a", source: "user-asset", assetId: "image-a", kind: "image", label: "资产·A", title: "A", previewUrl: "blob:a", active: true },
            { id: "asset:image-b", nodeId: "asset:image-b", source: "user-asset", assetId: "image-b", kind: "image", label: "资产·B", title: "B", previewUrl: "blob:b", active: true },
        ];

        const context = buildNodeGenerationContext(target.id, [target], [], "@资产·B 先出现，@资产·A 后出现", references);

        expect(context.referenceImages.map((image) => image.id)).toEqual(["image-b", "image-a"]);
    });

    it("maps mentioned user assets to the compact upstream image numbering for video", () => {
        const video: CanvasNodeData = { ...target, id: "video", type: CanvasNodeType.Video, title: "视频" };
        const references: CanvasResourceReference[] = [
            { id: "asset:image-a", nodeId: "asset:image-a", source: "user-asset", assetId: "image-a", kind: "image", label: "资产·A", title: "A", previewUrl: "blob:a", active: true },
            { id: "asset:image-b", nodeId: "asset:image-b", source: "user-asset", assetId: "image-b", kind: "image", label: "资产·B", title: "B", previewUrl: "blob:b", active: true },
        ];

        const context = buildNodeGenerationContext(video.id, [video], [], "@资产·B 先出现，@资产·A 后出现", references);

        expect(context.referenceImages.map((image) => image.id)).toEqual(["image-b", "image-a"]);
        expect(context.submissionPrompt).toBe("@图片1 先出现，@图片2 后出现");
        expect(context.selectedReferenceNodeIds).toEqual(["asset:image-b", "asset:image-a"]);
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
