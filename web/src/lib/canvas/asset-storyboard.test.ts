import { describe, expect, it } from "vitest";

import { buildVideoScriptOps, buildVideoUnitPrompt, buildVideoUnits, inspectAssetReadiness, parseStoryboardAnalysis, resolveShotDuration } from "@/lib/canvas/asset-storyboard";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type AssetStoryboardShot, type AssetStoryboardState, type CanvasNodeData } from "@/types/canvas";
import type { ScriptAsset } from "@/services/api/canvas-script";

const source: CanvasNodeData = { id: "extract", type: CanvasNodeType.AssetExtraction, title: "资产提取", position: { x: 0, y: 0 }, width: 680, height: 560, metadata: { assetExtractionStatus: "success", assetExtractionContentHash: "hash", content: "正文" } };
const assetData = (id: string, content?: string): CanvasNodeData => ({ id: `node-${id}`, type: CanvasNodeType.ScriptAsset, title: id, position: { x: 0, y: 0 }, width: 560, height: 320, metadata: { assetExtractionNodeId: source.id, scriptAssetId: id, content, scriptAssetImageStatus: content ? "success" : "idle" } });
const asset = (id: string): ScriptAsset => ({ id, type: "character", name: id, aliases: [], identity: {}, visualDescription: id, imagePrompt: id, manuallyEdited: false, status: "active", mentionCount: 1, image: null, variants: [] });
const shot = (id: string, durationSec: number, assetIds: string[] = ["a"]): AssetStoryboardShot => ({ id, index: Number(id.replace(/\D/g, "")) || 1, durationSec, requiredDurationSec: durationSec, durationMode: "short", title: id, sourceExcerpt: "", storyPurpose: "", visualDescription: `${id}画面`, shotSize: "中景", lighting: "", dialogue: "", sound: "", cameraMovement: "固定", characters: [], assetIds, previousHandoff: "", startState: "", endState: "动作完成", continuity: "连续", negativeConstraints: [], promptStatus: "success" });

describe("asset storyboard workflow", () => {
    it("blocks storyboard creation until every asset image is ready", () => {
        const result = inspectAssetReadiness(source, [asset("a"), asset("b")], [source, assetData("a", "blob:a"), assetData("b")], 0, "hash");
        expect(result.ready).toBe(false);
        expect(result.reason).toContain("b");
    });

    it("accepts ready images from legacy extraction nodes", () => {
        const legacySource = { ...source, metadata: { ...source.metadata, assetExtractionStatus: "idle" as const } };
        const readyAsset = { ...assetData("a", "https://example.com/a.png"), metadata: { ...assetData("a", "https://example.com/a.png").metadata, mediaStatus: "failed" as const } };
        const result = inspectAssetReadiness(legacySource, [asset("a")], [legacySource, readyAsset], 0, "hash");
        expect(result).toMatchObject({ ready: true, pending: [] });
    });

    it("keeps atomic shot duration within the model maximum and filters unknown assets", () => {
        const parsed = parseStoryboardAnalysis(JSON.stringify({ title: "一场戏", continuityBible: "连续", shots: [{ durationSec: 2, assetIds: ["a", "unknown"], visualDescription: "画面" }, { durationSec: 20, assetIds: ["a"] }] }), new Set(["a"]));
        expect(parsed.shots.map((shot) => shot.durationSec)).toEqual([2, 15]);
        expect(parsed.shots[0].assetIds).toEqual(["a"]);
    });

    it("calculates shot duration from dialogue and action instead of trusting a tiny AI duration", () => {
        const parsed = parseStoryboardAnalysis(JSON.stringify({ title: "一场戏", shots: [{ durationSec: 1, dialogueLines: [{ speaker: "秦墨", text: "这里是完整对白不能压缩", type: "dialogue" }], actionBeats: [{ description: "起身" }, { description: "推门" }], assetIds: ["a"] }] }), new Set(["a"]));
        expect(parsed.shots[0].durationSec).toBeGreaterThan(3);
        expect(parsed.shots[0].dialogueLines).toHaveLength(1);
        expect(parsed.shots[0].actionBeats).toHaveLength(2);
    });

    it("selects short and long durations from the current model capability", () => {
        const capabilities = { min: 5, max: 30, options: null };
        expect(resolveShotDuration(9, "short", capabilities)).toMatchObject({ durationSec: 9, requiredDurationSec: 9 });
        expect(resolveShotDuration(9, "long", capabilities)).toMatchObject({ durationSec: 30, requiredDurationSec: 9 });
    });

    it("keeps random duration inside the valid model options", () => {
        const result = resolveShotDuration(8, "random", { min: 5, max: 15, options: [5, 10, 15] }, "shot-1");
        expect([10, 15]).toContain(result.durationSec);
    });

    it("packs five three-second shots into one fifteen-second video unit", () => {
        const units = buildVideoUnits([shot("s1", 3), shot("s2", 3), shot("s3", 3), shot("s4", 3), shot("s5", 3)], "short", { min: 5, max: 15, options: null });
        expect(units).toHaveLength(1);
        expect(units[0]).toMatchObject({ durationSec: 15, durationMode: "short" });
        expect(units[0].segments.map((segment) => `${segment.startSec}-${segment.endSec}`)).toEqual(["0-3", "3-6", "6-9", "9-12", "12-15"]);
    });

    it("keeps a twelve-second unit at twelve seconds instead of filling the model maximum", () => {
        const units = buildVideoUnits([shot("s1", 12)], "short", { min: 5, max: 15, options: null });
        expect(units[0]?.durationSec).toBe(12);
    });

    it("allows a twenty-four second continuous unit with a thirty-second model", () => {
        const units = buildVideoUnits([shot("s1", 12), shot("s2", 12)], "long", { min: 5, max: 30, options: null });
        expect(units).toHaveLength(1);
        expect(units[0]?.durationSec).toBe(24);
    });

    it("formats generated video prompts with readable section and timeline breaks", () => {
        const shots = [shot("s1", 5), shot("s2", 5)];
        const units = buildVideoUnits(shots, "long", { min: 5, max: 30, options: null });
        const prompt = buildVideoUnitPrompt(units[0], shots, [asset("a")], { ...source, metadata: { ...source.metadata, assetExtractionVisualStyle: "电影写实" } });
        expect(prompt).toContain("【格式】\n10秒");
        expect(prompt).toContain("【时间轴】\n【镜号1】0-5秒\n画面：");
        expect(prompt).toContain("\n\n【镜号2】5-10秒\n画面：");
    });

    it("plans one default keyframe for continuous or explicitly requested shots", () => {
        const first = { ...shot("s1", 6), needsKeyframe: true, transitionToNext: "continuous" as const };
        const second = { ...shot("s2", 6), transitionToNext: "continuous" as const };
        const units = buildVideoUnits([first, second], "long", { min: 5, max: 30, options: null });
        expect(units[0]?.keyframes?.map((keyframe) => keyframe.kind)).toEqual(["start"]);
    });

    it("does not create keyframes for a normal hard cut", () => {
        const units = buildVideoUnits([shot("s1", 5), shot("s2", 5)], "short", { min: 5, max: 15, options: null });
        expect(units[0]?.keyframes).toEqual([]);
    });

    it("keeps a scene reference in every video unit", () => {
        const character = asset("c1");
        const scene = { ...asset("s1"), type: "scene" as const, name: "宫殿" };
        const first = { ...shot("s1", 10, ["c1"]), sceneAssetId: "s1" };
        const second = { ...shot("s2", 10, ["c1"]) };
        const units = buildVideoUnits([first, second], "short", { min: 5, max: 15, options: null }, [character, scene]);
        expect(units).toHaveLength(2);
        expect(units[0]?.sceneAssetId).toBe("s1");
        expect(units[1]?.sceneAssetId).toBe("s1");
        expect(units[0]?.assetIds).toEqual(["c1", "s1"]);
        expect(units[1]?.assetIds).toEqual(["c1", "s1"]);
    });

    it("repairs a malformed first shot object returned by the model", () => {
        const parsed = parseStoryboardAnalysis('{"title":"一场戏","shots":[index":1,"durationSec":6,"title":"开场","assetIds":["a"]},{"index":2,"durationSec":7,"title":"转折","assetIds":["a"]}]}', new Set(["a"]));
        expect(parsed.shots).toHaveLength(2);
        expect(parsed.shots[0]).toMatchObject({ index: 1, title: "开场", durationSec: 6 });
    });

    it("creates one video script node per completed shot and connects only used assets", () => {
        const state: AssetStoryboardState = { version: 1, sourceNodeId: source.id, contentHash: "hash", status: "ready", title: "分镜", totalDurationSec: 13, continuityBible: "", shots: [
            { id: "s1", index: 1, durationSec: 5, title: "一", sourceExcerpt: "", storyPurpose: "", visualDescription: "", shotSize: "中景", lighting: "", dialogue: "", sound: "", cameraMovement: "", characters: [], assetIds: ["a"], previousHandoff: "", startState: "", endState: "", continuity: "", negativeConstraints: [], finalPrompt: "提示词1", promptStatus: "success" },
            { id: "s2", index: 2, durationSec: 8, title: "二", sourceExcerpt: "", storyPurpose: "", visualDescription: "", shotSize: "近景", lighting: "", dialogue: "", sound: "", cameraMovement: "", characters: [], assetIds: ["b"], previousHandoff: "", startState: "", endState: "", continuity: "", negativeConstraints: [], finalPrompt: "提示词2", promptStatus: "success" },
        ] };
        const storyboard = { id: "story", type: CanvasNodeType.AssetStoryboard, title: "分镜", position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { assetStoryboardSourceId: source.id } };
        const ops = buildVideoScriptOps(storyboard, source, state, [assetData("a", "blob:a"), assetData("b", "blob:b")], [source, storyboard], []);
        expect(ops.filter((op) => op.type === "add_node" && op.nodeType === CanvasNodeType.Video)).toHaveLength(2);
        expect(ops.filter((op) => op.type === "connect_nodes" && op.fromNodeId === "node-a")).toHaveLength(1);
        expect(ops.find((op) => op.type === "select_nodes")).toMatchObject({ ids: expect.arrayContaining([expect.any(String)]) });
    });

    it("creates one video node for a multi-shot video unit", () => {
        const shots = [shot("s1", 5), shot("s2", 5)];
        const videoUnits = buildVideoUnits(shots, "long", { min: 5, max: 30, options: null }).map((unit) => ({ ...unit, finalPrompt: "多时间段提示词", promptStatus: "success" as const, keyframes: [{ id: "keyframe-1", kind: "start" as const, title: "起始关键帧", prompt: "起始画面", required: true, status: "success" as const, nodeId: "keyframe-node-1" }] }));
        const state: AssetStoryboardState = { version: 1, sourceNodeId: source.id, contentHash: "hash", status: "ready", title: "分镜", totalDurationSec: 10, continuityBible: "", shots, videoUnits };
        const storyboard = { id: "story", type: CanvasNodeType.AssetStoryboard, title: "分镜", position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { assetStoryboardSourceId: source.id } };
        const keyframeNode = { id: "keyframe-node-1", type: CanvasNodeType.Image, title: "起始关键帧", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "blob:keyframe" } };
        const ops = buildVideoScriptOps(storyboard, source, state, [assetData("a", "blob:a")], [source, storyboard, keyframeNode], []);
        const videoOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "add_node" }> => op.type === "add_node" && op.nodeType === CanvasNodeType.Video);

        expect(videoOps).toHaveLength(1);
        const videoNodeId = videoOps[0].id;
        expect(videoOps[0]).toMatchObject({ metadata: { assetStoryboardShotIds: ["s1", "s2"], seconds: "10", referenceOrder: ["a", "keyframe-node-1"] } });
        expect(ops).toContainEqual(expect.objectContaining({ type: "connect_nodes", fromNodeId: "keyframe-node-1", toNodeId: videoNodeId }));
    });

    it("connects shot assets in the explicit assetIds order", () => {
        const state: AssetStoryboardState = { version: 1, sourceNodeId: source.id, contentHash: "hash", status: "ready", title: "分镜", totalDurationSec: 8, continuityBible: "", shots: [
            { id: "s1", index: 1, durationSec: 8, title: "一", sourceExcerpt: "", storyPurpose: "", visualDescription: "", shotSize: "中景", lighting: "", dialogue: "", sound: "", cameraMovement: "", characters: [], assetIds: ["b", "a"], previousHandoff: "", startState: "", endState: "", continuity: "", negativeConstraints: [], finalPrompt: "图片1是B，图片2是A", promptStatus: "success" },
        ] };
        const storyboard = { id: "story", type: CanvasNodeType.AssetStoryboard, title: "分镜", position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { assetStoryboardSourceId: source.id } };
        const ops = buildVideoScriptOps(storyboard, source, state, [assetData("a", "blob:a"), assetData("b", "blob:b")], [source, storyboard], []);
        const assetConnections = ops.filter((op): op is Extract<CanvasAgentOp, { type: "connect_nodes" }> => op.type === "connect_nodes" && op.fromNodeId.startsWith("node-"));

        expect(assetConnections.map((op) => op.fromNodeId)).toEqual(["node-b", "node-a"]);
        expect(ops.find((op) => op.type === "add_node" && op.nodeType === CanvasNodeType.Video)).toMatchObject({ metadata: { references: ["b", "a"], assetStoryboardPreviewNode: true } });
    });

    it("marks generated video nodes with their episode ownership", () => {
        const state: AssetStoryboardState = { version: 1, sourceNodeId: source.id, episodeId: "ep-2", contentHash: "hash", status: "ready", title: "第二集", totalDurationSec: 8, continuityBible: "", shots: [
            { id: "s1", index: 1, durationSec: 8, title: "一", sourceExcerpt: "", storyPurpose: "", visualDescription: "", shotSize: "中景", lighting: "", dialogue: "", sound: "", cameraMovement: "", characters: [], assetIds: ["a"], previousHandoff: "", startState: "", endState: "", continuity: "", negativeConstraints: [], finalPrompt: "提示词", promptStatus: "success" },
        ] };
        const storyboard = { id: "story-ep2", type: CanvasNodeType.AssetStoryboard, title: "第二集分镜", position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { assetStoryboardSourceId: source.id, assetStoryboardEpisodeId: "ep-2" } };
        const op = buildVideoScriptOps(storyboard, source, state, [assetData("a", "blob:a")], [source, storyboard], []).find((candidate) => candidate.type === "add_node");

        expect(op).toMatchObject({ metadata: { assetStoryboardEpisodeId: "ep-2", assetStoryboardSourceId: "story-ep2" } });
    });
});
