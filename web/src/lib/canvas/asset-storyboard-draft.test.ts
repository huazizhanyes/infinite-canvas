import { describe, expect, it } from "vitest";

import { buildAssetStoryboardDraft } from "@/lib/canvas/asset-storyboard-draft";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ScriptAsset } from "@/services/api/canvas-script";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const source: CanvasNodeData = {
    id: "extract-1",
    type: CanvasNodeType.AssetExtraction,
    title: "资产提取",
    position: { x: 0, y: 0 },
    width: 680,
    height: 560,
    metadata: { content: "林夏推开车站的门。" },
};

function asset(id: string, type: ScriptAsset["type"], name: string, image = false): ScriptAsset {
    return { id, type, name, aliases: [], identity: {}, visualDescription: `${name}视觉描述`, imagePrompt: `${name}提示词`, manuallyEdited: false, status: "active", mentionCount: 1, image: image ? { id: `${id}-image`, imageUrl: `https://example.test/${id}.png`, status: "success", selected: true } : null, variants: [] };
}

describe("buildAssetStoryboardDraft", () => {
    it("creates a reviewable text/video chain and connects asset images", () => {
        const assets = [asset("c1", "character", "林夏", true), asset("s1", "scene", "车站")];
        const nodes: CanvasNodeData[] = [source, { id: "script-asset-c1", type: CanvasNodeType.ScriptAsset, title: "林夏", position: { x: 800, y: 0 }, width: 560, height: 320, metadata: { assetExtractionNodeId: source.id, scriptAssetId: "c1", content: "blob:image" } }];
        const draft = buildAssetStoryboardDraft(source, assets, nodes, []);
        expect(draft.storyboardContent).toContain("林夏");
        expect(draft.videoPrompt).toContain("图片1");
        expect(draft.ops.filter((op) => op.type === "add_node")).toHaveLength(2);
        expect(draft.ops).toContainEqual(expect.objectContaining({ type: "connect_nodes", fromNodeId: "script-asset-c1", toNodeId: draft.videoNodeId }));
        expect(draft.ops).toContainEqual({ type: "select_nodes", ids: [draft.videoNodeId] });
    });

    it("reuses existing drafts instead of creating duplicates", () => {
        const storyboard: CanvasNodeData = { id: "storyboard-1", type: CanvasNodeType.Text, title: "旧分镜", position: { x: 0, y: 0 }, width: 340, height: 420, metadata: { assetExtractionStoryboardSourceId: source.id } };
        const video: CanvasNodeData = { id: "video-1", type: CanvasNodeType.Video, title: "旧视频", position: { x: 0, y: 0 }, width: 420, height: 236, metadata: { assetExtractionVideoDraftSourceId: source.id } };
        const draft = buildAssetStoryboardDraft(source, [asset("c1", "character", "林夏")], [source, storyboard, video], []);
        expect(draft.storyboardNodeId).toBe("storyboard-1");
        expect(draft.videoNodeId).toBe("video-1");
        expect(draft.ops.filter((op) => op.type === "add_node")).toHaveLength(0);
        expect(draft.ops.filter((op) => op.type === "update_node")).toHaveLength(2);
    });

    it("keeps prompt, metadata and asset connections in the same order", () => {
        const assets = [asset("b", "character", "B", true), asset("a", "character", "A", true)];
        const nodeA: CanvasNodeData = { id: "node-a", type: CanvasNodeType.ScriptAsset, title: "A", position: { x: 0, y: 0 }, width: 560, height: 320, metadata: { assetExtractionNodeId: source.id, scriptAssetId: "a", content: "blob:a" } };
        const nodeB: CanvasNodeData = { id: "node-b", type: CanvasNodeType.ScriptAsset, title: "B", position: { x: 0, y: 0 }, width: 560, height: 320, metadata: { assetExtractionNodeId: source.id, scriptAssetId: "b", content: "blob:b" } };
        const draft = buildAssetStoryboardDraft(source, assets, [source, nodeA, nodeB], []);
        const videoOp = draft.ops.find((op) => (op.type === "add_node" || op.type === "update_node") && op.id === draft.videoNodeId);
        const assetConnections = draft.ops.filter((op): op is Extract<CanvasAgentOp, { type: "connect_nodes" }> => op.type === "connect_nodes" && op.fromNodeId.startsWith("node-"));

        expect(draft.videoPrompt).toContain("图片1=B、图片2=A");
        expect(videoOp).toMatchObject({ metadata: { references: ["b", "a"] } });
        expect(assetConnections.map((op) => op.fromNodeId)).toEqual(["node-b", "node-a"]);
    });

    it("does not reuse another episode's draft nodes", () => {
        const episodeSource = { ...source, metadata: { ...source.metadata, assetExtractionEpisodeId: "ep-2" } };
        const oldStoryboard: CanvasNodeData = { id: "story-ep1", type: CanvasNodeType.Text, title: "第一集分镜", position: { x: 0, y: 0 }, width: 340, height: 420, metadata: { assetExtractionStoryboardSourceId: source.id, assetExtractionStoryboardEpisodeId: "ep-1" } };
        const draft = buildAssetStoryboardDraft(episodeSource, [asset("c1", "character", "林夏")], [episodeSource, oldStoryboard], []);

        expect(draft.storyboardNodeId).not.toBe(oldStoryboard.id);
        expect(draft.ops.find((op) => "id" in op && op.id === draft.storyboardNodeId)).toMatchObject({ type: "add_node", metadata: { assetExtractionStoryboardEpisodeId: "ep-2" } });
    });
});
