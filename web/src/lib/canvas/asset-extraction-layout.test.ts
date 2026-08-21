import { describe, expect, it } from "vitest";

import { ASSET_COLUMN_GAP, ASSET_NODE_GAP, ASSET_NODE_HEIGHT, ASSET_NODE_WIDTH, buildAssetExtractionOps } from "@/lib/canvas/asset-extraction-layout";
import type { ScriptAsset } from "@/services/api/canvas-script";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const source: CanvasNodeData = {
    id: "extract-1",
    type: CanvasNodeType.AssetExtraction,
    title: "资产提取",
    position: { x: 100, y: 200 },
    width: 620,
    height: 420,
    metadata: { scriptSetId: "set-1" },
};

function asset(id: string, type: ScriptAsset["type"], name: string): ScriptAsset {
    return { id, type, name, aliases: [], identity: {}, visualDescription: `${name}描述`, imagePrompt: `${name}提示词`, manuallyEdited: false, status: "active", mentionCount: 1, image: null, variants: [] };
}

describe("buildAssetExtractionOps", () => {
    it("按人物、场景、道具纵向排列，每列最多五个", () => {
        const items = [asset("p1", "prop", "钥匙"), asset("c1", "character", "林夏"), asset("s1", "scene", "车站"), asset("c2", "character", "周明"), asset("s2", "scene", "书房"), asset("p2", "prop", "玉佩")];
        const ops = buildAssetExtractionOps(source, items, [source], []);
        const additions = ops.filter((op) => op.type === "add_node");
        expect(additions.map((op) => op.title)).toEqual(["林夏", "周明", "车站", "书房", "钥匙", "玉佩"]);
        expect(additions[1].position!.y - additions[0].position!.y).toBe(ASSET_NODE_HEIGHT + ASSET_NODE_GAP);
        expect(additions[4].position!.x).toBe(additions[0].position!.x);
        expect(additions[5].position!.x - additions[0].position!.x).toBe(ASSET_NODE_WIDTH + ASSET_COLUMN_GAP);
        expect(additions[5].position!.y).toBe(additions[0].position!.y);
        expect(ops.filter((op) => op.type === "connect_nodes")).toHaveLength(6);
    });

    it("重复分析更新原节点并恢复到当前五行布局", () => {
        const existing: CanvasNodeData = {
            id: "script-asset-c1",
            type: CanvasNodeType.ScriptAsset,
            title: "旧名称",
            position: { x: 1400, y: 800 },
            width: 560,
            height: 320,
            metadata: { assetExtractionNodeId: source.id, scriptAssetId: "c1", scriptSetId: "set-1" },
        };
        const ops = buildAssetExtractionOps(source, [asset("c1", "character", "新名称")], [source, existing], [{ id: "line-1", fromNodeId: source.id, toNodeId: existing.id }]);
        expect(ops.some((op) => op.type === "add_node")).toBe(false);
        expect(ops.some((op) => op.type === "connect_nodes")).toBe(false);
        expect(ops).toContainEqual(expect.objectContaining({ type: "update_node", id: existing.id, patch: expect.objectContaining({ title: "新名称", position: { x: 816, y: 250 } }) }));
    });

    it("将本次未返回的既有资产标记为过期而不删除", () => {
        const existing: CanvasNodeData = {
            id: "script-asset-old",
            type: CanvasNodeType.ScriptAsset,
            title: "旧资产",
            position: { x: 0, y: 0 },
            width: 560,
            height: 320,
            metadata: { assetExtractionNodeId: source.id, scriptAssetId: "old" },
        };
        const ops = buildAssetExtractionOps(source, [], [source, existing], []);
        expect(ops).toEqual([{ type: "update_node", id: existing.id, metadata: { scriptAssetStale: true } }]);
    });
});
