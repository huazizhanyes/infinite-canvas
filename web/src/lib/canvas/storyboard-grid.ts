import type { StoryboardGridPlan, StoryboardGridShot } from "@/types/canvas";

export const STORYBOARD_GRID_MAX_OUTPUT_TOKENS = 5000;

export function buildStoryboardGridPrompt(source: string, visualStyle = "电影感、统一人物与光线", aspectRatio = "16:9") {
    return `你是专业分镜导演。请从下面的纯文案中选择一个最有表现力的连续核心场景，不要跨场景总结全文，规划一个九宫格分镜。画幅为 ${aspectRatio}，统一视觉设定为：${visualStyle}。必须严格只输出 JSON，不要 Markdown、不要解释。JSON 结构必须是：{"title":"","scene":"","visualBible":"","shots":[{"slot":1,"title":"","shotSize":"","cameraAngle":"","cameraMovement":"","durationSec":2,"visualDescription":"","characterAction":"","dialogue":"","continuity":"","imagePrompt":""}]}。shots 必须恰好 9 个，slot 为 1 到 9，镜头连续形成建立环境、推进动作、细节、反应和收束的完整节奏；每个 imagePrompt 必须是非空、可直接用于生图的完整提示词。长文案只选一个连续场景。\n\n纯文案：\n${source}`;
}

function stripCodeFence(value: string) {
    return value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}

function text(value: unknown, fallback = "") {
    return typeof value === "string" ? value.trim() : fallback;
}

export function parseStoryboardGridPlan(raw: string): StoryboardGridPlan {
    const parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
    const rawShots = Array.isArray(parsed.shots) ? parsed.shots : [];
    if (rawShots.length !== 9) throw new Error("AI 返回的镜头数量不是 9 个");
    const ids = new Set<string>();
    const shots: StoryboardGridShot[] = rawShots.map((item, index) => {
        const shot = (item || {}) as Record<string, unknown>;
        const imagePrompt = text(shot.imagePrompt);
        if (!imagePrompt) throw new Error(`第 ${index + 1} 格缺少图片提示词`);
        const id = text(shot.id, `shot-${index + 1}`);
        if (ids.has(id)) throw new Error("AI 返回的镜头 ID 重复");
        ids.add(id);
        return {
            id,
            slot: index + 1,
            title: text(shot.title, `镜头 ${index + 1}`),
            shotSize: text(shot.shotSize, "中景"),
            cameraAngle: text(shot.cameraAngle, "平视"),
            cameraMovement: text(shot.cameraMovement, "固定"),
            durationSec: Number(shot.durationSec) > 0 ? Number(shot.durationSec) : 2,
            visualDescription: text(shot.visualDescription),
            characterAction: text(shot.characterAction),
            dialogue: text(shot.dialogue),
            continuity: text(shot.continuity),
            imagePrompt,
        };
    });
    return { title: text(parsed.title, "九宫格分镜"), scene: text(parsed.scene), visualBible: text(parsed.visualBible), shots };
}
