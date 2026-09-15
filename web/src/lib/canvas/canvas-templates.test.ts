import { describe, expect, it } from "vitest";

import { buildCanvasTemplate } from "@/lib/canvas/canvas-templates";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType } from "@/types/canvas";

describe("canvas templates", () => {
    it("creates a complete character image template without placeholders", () => {
        const result = buildCanvasTemplate("character-image", { x: 0, y: 0 }, defaultConfig);
        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0]).toMatchObject({ type: CanvasNodeType.Image, title: "人物资产图 · 古风美女" });
        expect(result.nodes[0].metadata?.prompt).toContain("古风美女");
        expect(result.nodes[0].metadata?.prompt).toContain("大头近景");
        expect(result.nodes[0].metadata?.prompt).not.toContain("[填写");
    });

    it("creates a connected fifteen-second video example group", () => {
        const result = buildCanvasTemplate("video-flow", { x: 0, y: 0 }, defaultConfig);
        const video = result.nodes.find((node) => node.type === CanvasNodeType.Video);
        expect(result.nodes.filter((node) => node.type === CanvasNodeType.Image)).toHaveLength(3);
        expect(result.nodes.filter((node) => node.type === CanvasNodeType.Audio)).toHaveLength(1);
        expect(result.nodes.find((node) => node.type === CanvasNodeType.Audio)?.metadata?.content).toContain("reference-audio.wav");
        expect(result.nodes.filter((node) => node.type === CanvasNodeType.Image).map((node) => node.metadata?.content)).toEqual(expect.arrayContaining([expect.stringContaining("character-guofeng-woman.png"), expect.stringContaining("scene-guofeng-garden.png"), expect.stringContaining("prop-ancient-knife.png")]));
        expect(result.connections).toHaveLength(4);
        expect(video?.metadata?.seconds).toBe("15");
        expect(video?.metadata?.prompt).toContain("花园");
        expect(video?.metadata?.prompt).toContain("古刀");
        expect(video?.metadata?.prompt).not.toContain("[填写");
        expect(video?.metadata?.prompt).toContain("【时间轴】\n【镜号1】1-3秒\n画面：");
        expect(video?.metadata?.prompt).toContain("\n\n【镜号2】3-6秒\n画面：");
    });
});
