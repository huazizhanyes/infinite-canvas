import { describe, expect, it } from "vitest";

import { ASSET_BLOCK_GAP, ASSET_COLUMN_GAP, ASSET_NODE_GAP, ASSET_NODE_HEIGHT, ASSET_NODE_WIDTH, buildAssetExtractionOps, buildAssetGenerationTargets } from "@/lib/canvas/asset-extraction-layout";
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
    it("按人物、场景、道具排列，每列四个且宽度最多四列", () => {
        const items = [asset("p1", "prop", "钥匙"), asset("c1", "character", "林夏"), asset("s1", "scene", "车站"), asset("c2", "character", "周明"), asset("s2", "scene", "书房"), asset("p2", "prop", "玉佩")];
        const ops = buildAssetExtractionOps(source, items, [source], []);
        const additions = ops.filter((op) => op.type === "add_node");
        expect(additions.map((op) => op.title)).toEqual(["林夏", "周明", "车站", "书房", "钥匙", "玉佩"]);
        expect(additions[1].position!.y - additions[0].position!.y).toBe(ASSET_NODE_HEIGHT + ASSET_NODE_GAP);
        expect(additions[3].position!.x).toBe(additions[0].position!.x);
        expect(additions[4].position!.x - additions[0].position!.x).toBe(ASSET_NODE_WIDTH + ASSET_COLUMN_GAP);
        expect(additions[4].position!.y).toBe(additions[0].position!.y);
        expect(ops.filter((op) => op.type === "connect_nodes")).toHaveLength(6);
    });

    it("重复分析更新原节点内容但保留用户调整的位置和尺寸", () => {
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
        expect(ops).toContainEqual(expect.objectContaining({ type: "update_node", id: existing.id, patch: { title: "新名称" }, metadata: expect.objectContaining({ scriptAssetLayoutSlot: 0 }) }));
    });

    it("超过十六个资产后向下开启新区块而不继续横向扩张", () => {
        const items = Array.from({ length: 17 }, (_, index) => asset(`c${index}`, "character", `人物${index}`));
        const additions = buildAssetExtractionOps(source, items, [source], []).filter((op) => op.type === "add_node");
        const first = additions[0].position!;
        const sixteenth = additions[15].position!;
        const seventeenth = additions[16].position!;
        const blockHeight = 4 * ASSET_NODE_HEIGHT + 3 * ASSET_NODE_GAP;

        expect(sixteenth.x - first.x).toBe(3 * (ASSET_NODE_WIDTH + ASSET_COLUMN_GAP));
        expect(seventeenth.x).toBe(first.x);
        expect(seventeenth.y - first.y).toBe(blockHeight + ASSET_BLOCK_GAP);
    });

    it("当前集命中变体时在共享节点展示本集变体图", () => {
        const episodeSource = { ...source, metadata: { ...source.metadata, assetExtractionEpisodeId: "ep-2" } };
        const item = {
            ...asset("c1", "character", "林夏"),
            episodeIds: ["ep-1", "ep-2"],
            occurrences: [{ episodeId: "ep-2", matchStatus: "variant", variantId: "v-2" }],
            variants: [{ id: "v-2", firstEpisodeId: "ep-2", name: "林夏雨夜", state: {}, visualDescription: "湿发", imagePrompt: "雨夜", image: { id: "img-v2", imageUrl: "https://example.test/v2.png", status: "success", selected: true } }],
        } satisfies ScriptAsset;
        const op = buildAssetExtractionOps(episodeSource, [item], [episodeSource], []).find((candidate) => candidate.type === "add_node");

        expect(op).toMatchObject({ metadata: { scriptVariantId: "v-2", scriptAssetEpisodeIds: ["ep-1", "ep-2"], scriptAssetImageId: "img-v2", content: "https://example.test/v2.png" } });
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

    it("仅删除已被同类型同名活动资产替代的历史重复节点", () => {
        const duplicate: CanvasNodeData = {
            id: "script-asset-old-c1",
            type: CanvasNodeType.ScriptAsset,
            title: "秦 墨",
            position: { x: 0, y: 0 },
            width: 560,
            height: 320,
            metadata: { assetExtractionNodeId: source.id, scriptAssetId: "old-c1", scriptAssetType: "character" },
        };
        const ops = buildAssetExtractionOps(source, [asset("c1", "character", "秦墨")], [source, duplicate], []);

        expect(ops).toContainEqual({ type: "delete_node", ids: [duplicate.id] });
        expect(ops).not.toContainEqual({ type: "update_node", id: duplicate.id, metadata: { scriptAssetStale: true } });
    });
});

describe("buildAssetGenerationTargets", () => {
    it("六个本集资产中两个复用资产已有图片时只生成剩余四个", () => {
        const existingImage = { id: "img-existing", imageUrl: "https://example.test/existing.png", status: "success", selected: true };
        const episodeAssets: ScriptAsset[] = [
            { ...asset("qin-mo", "character", "秦墨"), episodeIds: ["ep-1", "ep-2"], occurrences: [{ episodeId: "ep-2", matchStatus: "reused" }], image: existingImage },
            { ...asset("qin-xiang-ru", "character", "秦相如"), episodeIds: ["ep-1", "ep-2"], occurrences: [{ episodeId: "ep-2", matchStatus: "reused" }], image: { ...existingImage, id: "img-existing-2" } },
            { ...asset("li-shi-long", "character", "李世隆"), episodeIds: ["ep-2"], occurrences: [{ episodeId: "ep-2", matchStatus: "new" }] },
            { ...asset("cheng-san-fu", "character", "程三斧"), episodeIds: ["ep-2"], occurrences: [{ episodeId: "ep-2", matchStatus: "new" }] },
            { ...asset("map", "prop", "堪舆图"), episodeIds: ["ep-2"], occurrences: [{ episodeId: "ep-2", matchStatus: "new" }] },
            { ...asset("palace", "scene", "大乾皇宫太极宫"), episodeIds: ["ep-2"], occurrences: [{ episodeId: "ep-2", matchStatus: "new" }] },
        ];

        expect(buildAssetGenerationTargets(episodeAssets, "ep-2")).toEqual([{ assetId: "li-shi-long" }, { assetId: "cheng-san-fu" }, { assetId: "map" }, { assetId: "palace" }]);
    });

    it("只提交本集缺图资产，不重复生成已有的复用资产", () => {
        const reused = {
            ...asset("reused", "character", "秦墨"),
            episodeIds: ["ep-1", "ep-2"],
            occurrences: [{ episodeId: "ep-2", matchStatus: "reused" }],
            image: { id: "img-1", imageUrl: "https://example.test/qinmo.png", status: "success", selected: true },
        } satisfies ScriptAsset;
        const fresh = { ...asset("fresh", "scene", "太极宫"), episodeIds: ["ep-2"], occurrences: [{ episodeId: "ep-2", matchStatus: "new" }] } satisfies ScriptAsset;

        expect(buildAssetGenerationTargets([reused, fresh], "ep-2")).toEqual([{ assetId: "fresh" }]);
    });

    it("本集变体缺图时提交 variantId，已有变体图时跳过", () => {
        const item: ScriptAsset = {
            ...asset("c1", "character", "林夏"),
            occurrences: [{ episodeId: "ep-2", matchStatus: "variant", variantId: "v2" }],
            variants: [{ id: "v2", name: "雨夜林夏", state: {}, visualDescription: "", imagePrompt: "", image: null }],
        };
        expect(buildAssetGenerationTargets([item], "ep-2")).toEqual([{ assetId: "c1", variantId: "v2" }]);

        item.variants[0].image = { id: "img-v2", imageUrl: "https://example.test/v2.png", status: "success", selected: true };
        expect(buildAssetGenerationTargets([item], "ep-2")).toEqual([]);
    });
});
