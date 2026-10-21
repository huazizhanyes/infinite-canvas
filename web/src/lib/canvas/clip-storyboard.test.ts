import { describe, expect, it } from "vitest";

import { buildClipStoryboardOps, getClipStoryboardAssetPool, matchClipStoryboardClips, normalizeClipAssetName, parseClipStoryboardScript } from "./clip-storyboard";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const media = (id: string, title: string, type = CanvasNodeType.Image, durationMs?: number): CanvasNodeData => ({
    id,
    type,
    title,
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    metadata: { content: `content-${id}`, ...(durationMs ? { durationMs } : {}) },
});

const storyboard = (id = "story"): CanvasNodeData => ({ id, type: CanvasNodeType.ClipStoryboard, title: "分镜拆解", position: { x: 0, y: 0 }, width: 560, height: 460, metadata: {} });

const SCRIPT = `【资产全局映射表 本Clip唯一绑定】
快递站 → @ → 夜晚室内，货架、纸箱和椅子位置固定。
沈晚柠 → @ → 坐在椅上，手持手机。
手机 → @ → 停电后屏幕熄灭。
快递箱 → @ → 最后一个待上架纸箱。
【声音参考锁定】
沈晚柠 → @待绑定

**Clip S01-01｜12s**

\`\`\`text
【全局规则】
风格：精品3D国漫。
【资产全局映射表 本Clip唯一绑定】
快递站 → @ → 夜晚，室内灯火通明。
沈晚柠 → @ → 穿现代短袖短裤。
手机 → @ → 沈晚柠手持。
快递箱 → @ → 最后一个待上架纸箱。
【声音参考锁定】
沈晚柠 → @待绑定

【分镜1】
编号时长：1-1，4秒
动作层：沈晚柠推上纸箱。
\`\`\`

**Clip S01-02｜12s**

\`\`\`text
【资产全局映射表 本Clip唯一绑定】
快递站 → @ → 停电后的快递站。
沈晚柠 → @ → 坐在椅上。
【声音参考锁定】
沈晚柠 → @待绑定
\`\`\``;

describe("parseClipStoryboardScript", () => {
    it("splits clips by Clip headers and keeps fenced bodies", () => {
        const parsed = parseClipStoryboardScript(SCRIPT);
        expect(parsed.error).toBeUndefined();
        expect(parsed.clips.map((clip) => [clip.code, clip.durationSec])).toEqual([["S01-01", 12], ["S01-02", 12]]);
        expect(parsed.clips[0].body).toContain("【分镜1】");
        expect(parsed.clips[0].body.startsWith("```")).toBe(false);
        expect(parsed.clips[0].body.endsWith("```")).toBe(false);
        expect(parsed.clips[1].body).not.toContain("【分镜1】");
    });

    it("collects asset and voice entries per clip only", () => {
        const [first, second] = parseClipStoryboardScript(SCRIPT).clips;
        expect(first.assets.filter((entry) => entry.kind === "image").map((entry) => entry.name)).toEqual(["快递站", "沈晚柠", "手机", "快递箱"]);
        expect(first.assets.filter((entry) => entry.kind === "audio").map((entry) => entry.name)).toEqual(["沈晚柠"]);
        expect(second.assets.filter((entry) => entry.kind === "image").map((entry) => entry.name)).toEqual(["快递站", "沈晚柠"]);
    });

    it("accepts markdown heading, quote, plain bar and 秒 variants", () => {
        const parsed = parseClipStoryboardScript(["## Clip S01-01 | 12秒", "正文", "> **clip s01-02｜12.5s**", "正文", "- Clip 1-1｜4s", "正文"].join("\n"));
        expect(parsed.clips.map((clip) => [clip.code, clip.durationSec])).toEqual([["S01-01", 12], ["S01-02", 12.5], ["1-1", 4]]);
    });

    it("reports an error when no Clip header exists", () => {
        const parsed = parseClipStoryboardScript("【分镜1】\n编号时长：1-1，4秒");
        expect(parsed.clips).toEqual([]);
        expect(parsed.error).toContain("Clip");
    });
});

describe("clip asset matching", () => {
    it("normalizes titles and extensions for strict matching", () => {
        expect(normalizeClipAssetName("沈晚柠.png")).toBe("沈晚柠");
        expect(normalizeClipAssetName("快递站 (夜景)")).toBe("快递站夜景");
        expect(normalizeClipAssetName("沈晚柠（音色）")).toBe("沈晚柠音色");
    });

    it("binds exact names and leaves unmatched entries untouched", () => {
        const pool = [media("img-scene", "快递站.png"), media("img-hero", "沈晚柠.png"), media("img-phone", "手机.png"), media("audio-hero", "沈晚柠", CanvasNodeType.Audio, 8000)];
        const [match] = matchClipStoryboardClips(parseClipStoryboardScript(SCRIPT).clips.slice(0, 1), pool);
        expect(match.images.map((node) => node.id)).toEqual(["img-scene", "img-hero", "img-phone"]);
        expect(match.audios.map((node) => node.id)).toEqual(["audio-hero"]);
        expect(match.fuzzy).toEqual([]);
        expect(match.unmatched).toEqual([{ name: "快递箱", kind: "image" }]);
        expect(match.prompt).toContain("快递站 → @[快递站](canvas-ref:img-scene) → 夜晚，室内灯火通明。");
        expect(match.prompt).toContain("沈晚柠 → @[沈晚柠](canvas-ref:audio-hero)");
        expect(match.prompt).toContain("快递箱 → @ → 最后一个待上架纸箱。");
    });

    it("fuzzy matches suffixed titles and reports the binding", () => {
        const fuzzyPool = [media("img-scene", "快递站.png"), media("img-hero", "沈晚柠.png"), media("audio-hero", "沈晚柠（音色）", CanvasNodeType.Audio, 8000)];
        const [match] = matchClipStoryboardClips(parseClipStoryboardScript(SCRIPT).clips.slice(1, 2), fuzzyPool);
        expect(match.audios.map((node) => node.id)).toEqual(["audio-hero"]);
        expect(match.unmatched).toEqual([]);
        expect(match.fuzzy).toContainEqual({ name: "沈晚柠", kind: "audio", nodeId: "audio-hero", nodeTitle: "沈晚柠（音色）" });
        expect(match.prompt).toContain("沈晚柠 → @[沈晚柠](canvas-ref:audio-hero)");
    });

    it("prefers an exact match over an earlier fuzzy candidate", () => {
        const clips = parseClipStoryboardScript(["**Clip S01-01｜12s**", "【资产全局映射表】", "沈晚柠 → @ → 描述"].join("\n")).clips;
        const [match] = matchClipStoryboardClips(clips, [media("img-variant", "沈晚柠-现代装"), media("img-exact", "沈晚柠")]);
        expect(match.images.map((node) => node.id)).toEqual(["img-exact"]);
        expect(match.fuzzy).toEqual([]);
    });

    it("takes the first fuzzy candidate in pool order", () => {
        const clips = parseClipStoryboardScript(["**Clip S01-01｜12s**", "【资产全局映射表】", "沈晚柠 → @ → 描述"].join("\n")).clips;
        const [match] = matchClipStoryboardClips(clips, [media("img-first", "沈晚柠-古装"), media("img-second", "沈晚柠-现代装")]);
        expect(match.images.map((node) => node.id)).toEqual(["img-first"]);
        expect(match.fuzzy).toEqual([{ name: "沈晚柠", kind: "image", nodeId: "img-first", nodeTitle: "沈晚柠-古装" }]);
    });

    it("fuzzy matches when the script name contains the node title", () => {
        const clips = parseClipStoryboardScript(["**Clip S01-01｜12s**", "【资产全局映射表】", "沈晚柠 → @ → 描述", "【声音参考锁定】", "沈晚柠（音色） → @待绑定"].join("\n")).clips;
        const [match] = matchClipStoryboardClips(clips, [media("img-hero", "沈晚柠"), media("audio-hero", "沈晚柠", CanvasNodeType.Audio, 8000)]);
        expect(match.fuzzy).toContainEqual({ name: "沈晚柠（音色）", kind: "audio", nodeId: "audio-hero", nodeTitle: "沈晚柠" });
        expect(match.prompt).toContain("沈晚柠（音色） → @[沈晚柠（音色）](canvas-ref:audio-hero)");
    });

    it("skips voice references when no image matched", () => {
        const audioOnlyPool = [media("audio-hero", "沈晚柠", CanvasNodeType.Audio, 8000)];
        const [match] = matchClipStoryboardClips(parseClipStoryboardScript(SCRIPT).clips.slice(1, 2), audioOnlyPool);
        expect(match.images).toEqual([]);
        expect(match.audios).toEqual([]);
        expect(match.fuzzy).toEqual([]);
        expect(match.warnings).toContain("该分镜没有匹配到图片，声音参考未绑定");
        expect(match.prompt).toContain("沈晚柠 → @待绑定");
    });

    it("caps reference images at nine", () => {
        const names = Array.from({ length: 11 }, (_, index) => `角色${index + 1}`);
        const pool = names.map((name, index) => media(`img-${index}`, `${name}.png`));
        const table = ["**Clip S01-01｜12s**", "【资产全局映射表】", ...names.map((name) => `${name} → @ → 描述`)].join("\n");
        const [match] = matchClipStoryboardClips(parseClipStoryboardScript(table).clips, pool);
        expect(match.images).toHaveLength(9);
        expect(match.warnings.some((warning) => warning.includes("最多 9 张"))).toBe(true);
        expect(match.prompt).toContain("角色10 → @ → 描述");
    });
});

describe("clip storyboard operations", () => {
    const pool = [media("img-scene", "快递站.png"), media("img-hero", "沈晚柠.png"), media("audio-hero", "沈晚柠", CanvasNodeType.Audio, 8000)];
    const connections: CanvasConnection[] = pool.map((node) => ({ id: `c-${node.id}`, fromNodeId: node.id, toNodeId: "story" }));

    it("orders the asset pool by referenceOrder", () => {
        const node = { ...storyboard(), metadata: { referenceOrder: ["audio-hero", "img-hero", "img-scene"] } };
        expect(getClipStoryboardAssetPool(node, [node, ...pool], connections).map((item) => item.id)).toEqual(["audio-hero", "img-hero", "img-scene"]);
    });

    it("creates one video node per clip and connects matched assets", () => {
        const parsed = parseClipStoryboardScript(SCRIPT);
        const matches = matchClipStoryboardClips(parsed.clips, pool);
        const ops = buildClipStoryboardOps({ storyboard: storyboard(), matches, nodes: [storyboard(), ...pool], connections });
        const added = ops.filter((op) => op.type === "add_node");
        expect(added).toHaveLength(2);
        expect(added[0]).toMatchObject({ nodeType: CanvasNodeType.Video, title: "S01-01 · 12s", metadata: { seconds: "12", clipStoryboardClipCode: "S01-01", referenceOrder: ["img-scene", "img-hero", "audio-hero"] } });
        const connectTargets = ops.filter((op) => op.type === "connect_nodes").map((op) => op.fromNodeId);
        expect(connectTargets).toContain("story");
        expect(connectTargets).toContain("img-hero");
        expect(connectTargets).toContain("audio-hero");
    });

    it("updates existing video nodes instead of duplicating them", () => {
        const parsed = parseClipStoryboardScript(SCRIPT);
        const matches = matchClipStoryboardClips(parsed.clips, pool);
        const existing: CanvasNodeData = { id: "video-1", type: CanvasNodeType.Video, title: "旧标题", position: { x: 700, y: 0 }, width: 420, height: 236, metadata: { clipStoryboardSourceId: "story", clipStoryboardClipCode: "S01-01", content: "https://example.test/v.mp4", status: "success" } };
        const ops = buildClipStoryboardOps({ storyboard: storyboard(), matches: matches.slice(0, 1), nodes: [storyboard(), existing, ...pool], connections });
        expect(ops.some((op) => op.type === "add_node")).toBe(false);
        expect(ops.find((op) => op.type === "update_node")).toMatchObject({ id: "video-1", patch: { title: "S01-01 · 12s" }, metadata: { clipStoryboardClipCode: "S01-01" } });
        expect(ops.some((op) => op.type === "delete_node")).toBe(false);
    });

    it("drops empty video nodes whose clip disappeared", () => {
        const parsed = parseClipStoryboardScript(SCRIPT);
        const matches = matchClipStoryboardClips(parsed.clips.slice(0, 1), pool);
        const stale: CanvasNodeData = { id: "video-old", type: CanvasNodeType.Video, title: "旧节点", position: { x: 700, y: 0 }, width: 420, height: 236, metadata: { clipStoryboardSourceId: "story", clipStoryboardClipCode: "S99-99" } };
        const generated: CanvasNodeData = { ...stale, id: "video-keep", metadata: { ...stale.metadata, clipStoryboardClipCode: "S98-98", content: "https://example.test/v.mp4", status: "success" } };
        const ops = buildClipStoryboardOps({ storyboard: storyboard(), matches, nodes: [storyboard(), stale, generated, ...pool], connections });
        expect(ops).toContainEqual({ type: "delete_node", id: "video-old" });
        expect(ops.some((op) => op.type === "delete_node" && op.id === "video-keep")).toBe(false);
    });
});

const SEEDANCE_SCRIPT = `## 资产全局映射表
- 张小酒 → @张小酒 → 少年男性，轻微沾尘。
- 明虚道人 → @明虚 → 老年道士，道袍固定。
- 道士群像 → @青字辈道士 → 群像参考。
- 落云观与三清殿 → @落云观门前、@三清殿、@外廊、@院内小径、@明虚厢房外屋 → 道观建筑。
## 声音参考锁定
张小酒 → @少年男声，质朴直率；明虚 → @老年男声，慢条斯理；青玄 → @少年男声，清朗恭谨。所有声线保持稳定。
## 全局规则
**风格与渲染：**精品3D国漫。
**全局负面约束：**无字幕、无水印。

### Clip S01-01A｜相互引见｜约13秒

**资产：**@张小酒、@明虚、@青字辈道士。

[镜头1｜13秒]
分镜编号：S01-01A-1；画面内容：三人见礼。

### Clip S12-02 | 青玄离开，张小酒沉默 | 约5秒

**资产：**@张小酒、@青玄、@茅草屋整理后、@道观院内小径。

[一镜到底｜5秒]
分镜编号：S12-02-1；画面内容：青玄退场。
`;

describe("seedance clip script format", () => {
    const pool = [
        media("img-zhang", "张小酒.png"),
        media("img-ming", "明虚道人"),
        media("img-group", "道士群像"),
        media("img-hut", "茅草屋整理后"),
        media("img-temple", "落云观与三清殿"),
        media("audio-zhang", "张小酒", CanvasNodeType.Audio, 5000),
        media("audio-ming", "明虚", CanvasNodeType.Audio, 5000),
        media("audio-qing", "青玄", CanvasNodeType.Audio, 5000),
    ];
    const parsed = parseClipStoryboardScript(SEEDANCE_SCRIPT);
    const matches = matchClipStoryboardClips(parsed.clips, pool, { assetTable: parsed.assetTable, voiceNames: parsed.voiceNames, globalRules: parsed.globalRules });

    it("parses three-part headers with 约 duration and letter suffix", () => {
        expect(parsed.clips.map((clip) => [clip.code, clip.title, clip.durationSec])).toEqual([
            ["S01-01A", "相互引见", 13],
            ["S12-02", "青玄离开，张小酒沉默", 5],
        ]);
    });

    it("parses the global asset table, voice names and global rules", () => {
        expect(parsed.assetTable.find((entry) => entry.assetName === "明虚道人")).toMatchObject({ aliases: ["明虚"] });
        expect(parsed.assetTable.find((entry) => entry.assetName === "落云观与三清殿")?.aliases).toEqual(["落云观门前", "三清殿", "外廊", "院内小径", "明虚厢房外屋"]);
        expect(parsed.voiceNames).toEqual(["张小酒", "明虚", "青玄"]);
        expect(parsed.globalRules).toContain("精品3D国漫");
        expect(parsed.globalRules).not.toContain("**");
    });

    it("resolves inline @aliases through the global table and binds them in the prompt", () => {
        const [clip] = matches;
        expect(clip.images.map((node) => node.id)).toEqual(["img-zhang", "img-ming", "img-group"]);
        expect(clip.aliases).toEqual([
            { name: "明虚", kind: "image", nodeId: "img-ming", nodeTitle: "明虚道人" },
            { name: "青字辈道士", kind: "image", nodeId: "img-group", nodeTitle: "道士群像" },
        ]);
        expect(clip.unmatched).toEqual([]);
        expect(clip.prompt.startsWith("【全局规则】\n")).toBe(true);
        expect(clip.prompt).toContain("**资产：**@[张小酒](canvas-ref:img-zhang)、@[明虚](canvas-ref:img-ming)、@[青字辈道士](canvas-ref:img-group)。");
    });

    it("matches a fuzzy global alias and keeps unmatched images", () => {
        const clip = matches[1];
        expect(clip.images.map((node) => node.id)).toEqual(["img-zhang", "img-hut", "img-temple"]);
        expect(clip.aliases).toContainEqual({ name: "道观院内小径", kind: "image", nodeId: "img-temple", nodeTitle: "落云观与三清殿" });
        expect(clip.unmatched).toEqual([{ name: "青玄", kind: "image" }]);
        expect(clip.prompt).toContain("@[道观院内小径](canvas-ref:img-temple)");
        expect(clip.prompt).toContain("@青玄");
    });

    it("binds voice audio by the character names declared in each clip", () => {
        expect(matches[0].audios.map((node) => node.id)).toEqual(["audio-zhang", "audio-ming"]);
        expect(matches[1].audios.map((node) => node.id)).toEqual(["audio-zhang", "audio-qing"]);
    });

    it("uses the clip title in the generated video node title", () => {
        const ops = buildClipStoryboardOps({ storyboard: storyboard(), matches: [matches[0]], nodes: [storyboard(), ...pool], connections: [] });
        expect(ops.find((op) => op.type === "add_node")).toMatchObject({
            title: "S01-01A · 相互引见 · 13s",
            metadata: { clipStoryboardClipTitle: "相互引见", clipStoryboardClipCode: "S01-01A", seconds: "13" },
        });
    });
});

const SECTIONED_SCRIPT = `## S01 明虚厢房·午后

### Clip 01｜初次引见｜12秒

【资产全局映射表 本Clip唯一绑定】
明虚厢房 → @ → 午后木构厢房，桌椅、茶具与卧榻位置稳定。
张小酒 → @ → 年轻男性俗家弟子，朴素衣着。
青玄 → @ → 年轻道士，憨直热心。
明虚 → @ → 年长道士，坐起后端坐。

【声音参考锁定】
青玄 → @待绑定
张小酒 → @待绑定

【全局身高参考图】
张小酒 → @ → 按已绑定身高参考保持比例稳定。
青玄 → @ → 按已绑定身高参考保持比例稳定。
明虚 → @ → 按已绑定身高参考保持比例稳定。

【镜头组｜Clip总时长12秒｜35mm f/4】全景主位机位平视，香炉轻烟细直上升。
动作层：青玄抱拳躬身，张小酒随后作揖。

### Clip 02｜明虚起身寒暄｜12秒

【资产全局映射表】
明虚 → @ → 坐起寒暄。
【声音参考锁定】
青玄 → @待绑定

## S02 院中·清晨

### Clip 01｜晨起｜10秒

【资产全局映射表】
院中 → @ → 清晨空院。
`;

describe("sectioned clip script format", () => {
    const pool = [
        media("img-room", "明虚厢房"),
        media("img-zhang", "张小酒"),
        media("img-qing", "青玄"),
        media("img-ming", "明虚"),
        media("img-yard", "院中"),
        media("audio-qing", "青玄", CanvasNodeType.Audio, 5000),
        media("audio-zhang", "张小酒", CanvasNodeType.Audio, 5000),
    ];
    const parsed = parseClipStoryboardScript(SECTIONED_SCRIPT);
    const matches = matchClipStoryboardClips(parsed.clips, pool);

    it("prefixes bare clip numbers with the section code", () => {
        expect(parsed.clips.map((clip) => [clip.code, clip.title, clip.durationSec])).toEqual([
            ["S01-01", "初次引见", 12],
            ["S01-02", "明虚起身寒暄", 12],
            ["S02-01", "晨起", 10],
        ]);
    });

    it("parses assets from any 【…】 section, including the height reference section", () => {
        const [clip] = parsed.clips;
        expect(clip.assets.filter((entry) => entry.kind === "image").map((entry) => entry.name)).toEqual(["明虚厢房", "张小酒", "青玄", "明虚", "张小酒", "青玄", "明虚"]);
        expect(clip.assets.filter((entry) => entry.kind === "audio").map((entry) => entry.name)).toEqual(["青玄", "张小酒"]);
    });

    it("binds every section and keeps duplicate asset names deduplicated", () => {
        const [match] = matches;
        expect(match.images.map((node) => node.id)).toEqual(["img-room", "img-zhang", "img-qing", "img-ming"]);
        expect(match.audios.map((node) => node.id)).toEqual(["audio-qing", "audio-zhang"]);
        expect(match.unmatched).toEqual([]);
        expect(match.prompt).toContain("张小酒 → @[张小酒](canvas-ref:img-zhang) → 按已绑定身高参考保持比例稳定。");
        expect(match.prompt).toContain("青玄 → @[青玄](canvas-ref:audio-qing)");
        expect(match.prompt).toContain("【镜头组｜Clip总时长12秒｜35mm f/4】");
    });

    it("uses the prefixed code in the video node title", () => {
        const ops = buildClipStoryboardOps({ storyboard: storyboard(), matches: [matches[2]], nodes: [storyboard(), ...pool], connections: [] });
        expect(ops.find((op) => op.type === "add_node")).toMatchObject({ title: "S02-01 · 晨起 · 10s", metadata: { clipStoryboardClipCode: "S02-01" } });
    });
});
