import { describe, expect, it } from "vitest";

import { buildVideoScriptOps, inspectAssetReadiness, parseStoryboardAnalysis } from "@/lib/canvas/asset-storyboard";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type AssetStoryboardState, type CanvasNodeData } from "@/types/canvas";
import type { ScriptAsset } from "@/services/api/canvas-script";

const source: CanvasNodeData = { id: "extract", type: CanvasNodeType.AssetExtraction, title: "资产提取", position: { x: 0, y: 0 }, width: 680, height: 560, metadata: { assetExtractionStatus: "success", assetExtractionContentHash: "hash", content: "正文" } };
const assetData = (id: string, content?: string): CanvasNodeData => ({ id: `node-${id}`, type: CanvasNodeType.ScriptAsset, title: id, position: { x: 0, y: 0 }, width: 560, height: 320, metadata: { assetExtractionNodeId: source.id, scriptAssetId: id, content, scriptAssetImageStatus: content ? "success" : "idle" } });
const asset = (id: string): ScriptAsset => ({ id, type: "character", name: id, aliases: [], identity: {}, visualDescription: id, imagePrompt: id, manuallyEdited: false, status: "active", mentionCount: 1, image: null, variants: [] });

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

    it("normalizes shot duration to 5-15 seconds and filters unknown assets", () => {
        const parsed = parseStoryboardAnalysis(JSON.stringify({ title: "一场戏", continuityBible: "连续", shots: [{ durationSec: 2, assetIds: ["a", "unknown"], visualDescription: "画面" }, { durationSec: 20, assetIds: ["a"] }] }), new Set(["a"]));
        expect(parsed.shots.map((shot) => shot.durationSec)).toEqual([5, 15]);
        expect(parsed.shots[0].assetIds).toEqual(["a"]);
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

    it("connects shot assets in the explicit assetIds order", () => {
        const state: AssetStoryboardState = { version: 1, sourceNodeId: source.id, contentHash: "hash", status: "ready", title: "分镜", totalDurationSec: 8, continuityBible: "", shots: [
            { id: "s1", index: 1, durationSec: 8, title: "一", sourceExcerpt: "", storyPurpose: "", visualDescription: "", shotSize: "中景", lighting: "", dialogue: "", sound: "", cameraMovement: "", characters: [], assetIds: ["b", "a"], previousHandoff: "", startState: "", endState: "", continuity: "", negativeConstraints: [], finalPrompt: "图片1是B，图片2是A", promptStatus: "success" },
        ] };
        const storyboard = { id: "story", type: CanvasNodeType.AssetStoryboard, title: "分镜", position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { assetStoryboardSourceId: source.id } };
        const ops = buildVideoScriptOps(storyboard, source, state, [assetData("a", "blob:a"), assetData("b", "blob:b")], [source, storyboard], []);
        const assetConnections = ops.filter((op): op is Extract<CanvasAgentOp, { type: "connect_nodes" }> => op.type === "connect_nodes" && op.fromNodeId.startsWith("node-"));

        expect(assetConnections.map((op) => op.fromNodeId)).toEqual(["node-b", "node-a"]);
        expect(ops.find((op) => op.type === "add_node" && op.nodeType === CanvasNodeType.Video)).toMatchObject({ metadata: { references: ["b", "a"] } });
    });
});
